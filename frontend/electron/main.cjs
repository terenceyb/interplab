'use strict';

/**
 * InterpLab 译训台 · Electron 主进程
 *
 * 关键设计：
 * 1. 用自定义 `app://` 协议加载页面，而不是 file://。
 *    file:// 的 origin 是 null，Web Worker（pdf.js 解析线程）会被拒绝，
 *    IndexedDB 也拿不到稳定的 origin，训练记录会丢。
 * 2. userData 指向 exe 同级 `InterpLabData` 目录（便携版），
 *    拷走整个文件夹换台机器，素材与训练记录都还在。
 * 3. 会话权限全放行（麦克风/录音），并关闭后台节流，
 *    否则窗口失焦时计时器与 VAD 会被降频，同传计时会走偏。
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/* 调试日志：仅在设置 INTERPLAB_DEBUG 时写文件（管道缓冲会挡住 stdout） */
const DEBUG_LOG = process.env.INTERPLAB_DEBUG ? '/tmp/interplab-main.log' : '';
function trace(...args) {
  if (!DEBUG_LOG) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${args.join(' ')}\n`);
  } catch {
    /* 忽略 */
  }
}

const SCHEME = 'app';
const HOST = 'interplab';
const APP_URL = `${SCHEME}://${HOST}/`;
const DIST = path.join(__dirname, '..', 'dist');
const ICON = path.join(__dirname, 'icon.png');

/* ------------------------------------------------------------------ *
 * 便携数据目录
 * ------------------------------------------------------------------ */
/**
 * 数据目录优先跟程序走：整个文件夹拷到 U 盘或另一台电脑，素材与记录都在。
 * - 便携版 exe：PORTABLE_EXECUTABLE_DIR 指向 exe 所在目录（运行时本体在临时目录）
 * - 绿色版（解压即用）：exe 所在目录
 * - 只读位置（Program Files / 光盘）：回落到 %APPDATA%\InterpLab
 */
(function pickDataDir() {
  const bases = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) bases.push(process.env.PORTABLE_EXECUTABLE_DIR);
  try {
    bases.push(path.dirname(app.getPath('exe')));
  } catch {
    /* 极早期拿不到 exe 路径时忽略 */
  }
  for (const base of bases) {
    const dir = path.join(base, 'InterpLabData');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      app.setPath('userData', dir);
      return;
    } catch {
      /* 不可写，试下一个 */
    }
  }
})();

// 允许音频在无手势时继续播放（训练页切换面板时不应该断音）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// 中文字体渲染更接近系统观感
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

/* ------------------------------------------------------------------ *
 * 静态资源服务
 * ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      allowServiceWorkers: true,
    },
  },
]);

function serve() {
  protocol.handle(SCHEME, async (request) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (!rel || rel === '/') rel = '/index.html';

    // 防目录穿越：规范化后必须仍在 dist 内
    const full = path.join(DIST, path.normalize(rel).replace(/^[/\\]+/, ''));
    if (full !== DIST && !full.startsWith(DIST + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await fs.promises.readFile(full); // fs 支持读取 asar 内文件
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      return new Response(body, { headers: { 'Content-Type': type } });
    } catch {
      // 未知路径一律回 index.html，交给 HashRouter
      try {
        const html = await fs.promises.readFile(path.join(DIST, 'index.html'));
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch {
        return new Response('应用资源缺失，请重新解压完整的程序包。', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    }
  });
}

/* ------------------------------------------------------------------ *
 * 权限：本地单机应用，麦克风等一律放行
 * ------------------------------------------------------------------ */
const ALLOWED = new Set([
  'media',
  'audioCapture',
  'videoCapture',
  'display-capture',
  'fullscreen',
  'clipboard-read',
  'clipboard-sanitized-write',
  'notifications',
  'pointerLock',
]);

function harden(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));

  // 兜底：若渲染层用了 <a download>，也走系统「另存为」并提示结果
  ses.on('will-download', (_event, item) => {
    item.once('done', async (_e, state) => {
      if (state !== 'completed') return;
      const file = item.getSavePath();
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: '导出完成',
        message: '文件已保存',
        detail: file,
        buttons: ['打开所在文件夹', '知道了'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) shell.showItemInFolder(file);
    });
  });
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */
let mainWin = null;

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch {
    /* 首次启动 */
  }
  return { width: 1440, height: 920 };
}

function saveState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {
    /* 忽略 */
  }
}

function createWindow() {
  const state = loadState();

  mainWin = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: '译训台 InterpLab',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 训练计时与录音不能被后台节流，否则最小化后计时会走慢
      backgroundThrottling: false,
      devTools: true,
    },
  });

  if (state.maximized) mainWin.maximize();

  mainWin.once('ready-to-show', () => {
    mainWin.show();
  });

  mainWin.loadURL(`${APP_URL}#/`);

  // 外部链接交给系统浏览器，不在应用内开新窗口
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // 渲染进程崩溃时不要留一个白屏死窗口
  mainWin.webContents.on('render-process-gone', async (_e, details) => {
    if (details.reason === 'clean-exit') return;
    await dialog.showMessageBox({
      type: 'error',
      title: '界面已停止',
      message: '渲染进程异常退出，可能是一次加载的文件过大。',
      detail: `原因：${details.reason}`,
      buttons: ['重新加载', '退出'],
      defaultId: 0,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) mainWin?.reload();
      else app.quit();
    });
  });

  const persist = () => saveState(mainWin);
  mainWin.on('resize', persist);
  mainWin.on('move', persist);
  mainWin.on('close', persist);
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

/* ------------------------------------------------------------------ *
 * 文件保存：桌面版统一走这里，避免浏览器下载在打包环境里落不了盘
 * ------------------------------------------------------------------ */
function registerIpc() {
  ipcMain.handle('interplab:save-file', async (event, name, data) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const safeName = String(name || 'export.bin').replace(/[\\/:*?"<>|]/g, '_');
    // 自动化校验时直接落到指定目录，避免原生对话框卡住脚本
    const auto = process.env.INTERPLAB_DOWNLOAD_DIR;
    let canceled = false;
    let filePath;
    if (auto) {
      await fs.promises.mkdir(auto, { recursive: true }).catch(() => {});
      filePath = path.join(auto, safeName);
    } else {
      ({ canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '保存文件',
        defaultPath: path.join(app.getPath('downloads'), safeName),
        buttonLabel: '保存',
      }));
    }
    if (canceled || !filePath) return { canceled: true };
    try {
      await fs.promises.writeFile(filePath, Buffer.from(data));
      trace('[save-file]', filePath, Buffer.byteLength(Buffer.from(data)));
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('interplab:open-data-dir', async () => {
    const dir = app.getPath('userData');
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
    return shell.openPath(dir);
  });
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新加载', accelerator: 'F5', click: () => mainWin?.reload() },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '数据存放位置',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: '数据存放位置',
              message: '所有素材、稿件与训练记录都只存在本机',
              detail: app.getPath('userData'),
              buttons: ['打开文件夹', '知道了'],
              defaultId: 1,
              cancelId: 1,
              noLink: true,
            }).then(({ response }) => {
              if (response === 0) shell.openPath(app.getPath('userData'));
            }),
        },
        {
          label: '关于',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: '关于译训台',
              message: `译训台 InterpLab ${app.getVersion()}`,
              detail: [
                '口译训练工作台 · 纯本地运行，不上传任何内容',
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
              ].join('\n'),
              buttons: ['知道了'],
              noLink: true,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */
app.on('second-instance', () => {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
});

app.whenReady().then(() => {
  harden(session.defaultSession);
  serve();
  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
