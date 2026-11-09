'use strict';

/**
 * 打包后写入 Windows 可执行文件资源（图标 + 版本信息）。
 *
 * electron-builder 默认用 rcedit 干这件事，而 rcedit 是 Windows 程序，
 * 在 Linux 上要靠 wine（还要 32 位支持）。这里改用纯 JS 的 resedit，
 * 不依赖任何本机二进制，构建在哪台机器上都能出图标正常的 exe。
 */

const fs = require('node:fs');
const path = require('node:path');

const WIN_LANG = 1033; // en-US：Windows 用它显示资源字符串

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const { NtExecutable, NtExecutableResource } = require('pe-library');
  const ResEdit = require('resedit');

  const productName = context.packager.appInfo.productFilename;
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  if (!fs.existsSync(exePath)) {
    console.warn(`  • 未找到 ${exePath}，跳过资源写入`);
    return;
  }

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  /* ---- 图标：替换 exe 内已有的所有图标组 ---- */
  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico');
  if (fs.existsSync(icoPath)) {
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const ids = groups.length ? groups.map((g) => g.id) : [1];
    for (const id of ids) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        id,
        WIN_LANG,
        iconFile.icons.map((i) => i.data),
      );
    }
  } else {
    console.warn(`  • 未找到图标 ${icoPath}`);
  }

  /* ---- 版本信息 ---- */
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  {
    // 有些 Electron 发行包自带版本资源，有些没有——没有就新建一份
    const vi = viList.length ? viList[0] : ResEdit.Resource.VersionInfo.createEmpty();
    const version = context.packager.appInfo.version || '1.0.0';
    vi.setFileVersion(version, WIN_LANG);
    vi.setProductVersion(version, WIN_LANG);
    vi.setStringValues(
      { lang: WIN_LANG, codepage: 1200 },
      {
        FileDescription: '译训台 · 口译训练工作台',
        ProductName: 'InterpLab',
        CompanyName: 'InterpLab',
        LegalCopyright: 'Copyright © InterpLab',
        InternalName: 'InterpLab',
        OriginalFilename: `${productName}.exe`,
        FileVersion: version,
        ProductVersion: version,
      },
    );
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • 已写入图标与版本信息 → ${path.basename(exePath)}`);
};
