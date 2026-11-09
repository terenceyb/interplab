/**
 * 桌面端（Electron）桥接。
 *
 * 打包后的应用里 `<a download>` 并不总是可靠（下载目录策略、
 * OneDrive 重定向、某些环境压根不落盘），所以导出统一改走主进程
 * 的「另存为」对话框 + fs 写入。浏览器里仍然用原来的 a[download]。
 */

export interface SaveResult {
  ok?: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

interface DesktopBridge {
  desktop: true;
  platform: string;
  saveFile: (name: string, data: Uint8Array) => Promise<SaveResult>;
  openDataDir: () => Promise<string>;
}

declare global {
  interface Window {
    interplab?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window !== 'undefined' ? window.interplab : undefined;
}

export function isDesktop(): boolean {
  return !!desktopBridge()?.saveFile;
}

export type SaveOutcome = 'saved' | 'canceled' | 'unsupported';

/**
 * 保存一个 Blob。桌面版弹原生另存为；浏览器返回 'unsupported' 由调用方回退。
 */
export async function saveBlob(name: string, blob: Blob): Promise<SaveOutcome> {
  const bridge = desktopBridge();
  if (!bridge?.saveFile) return 'unsupported';
  const data = new Uint8Array(await blob.arrayBuffer());
  const r = await bridge.saveFile(name, data);
  if (r?.canceled) return 'canceled';
  if (!r?.ok) throw new Error(r?.error || '保存失败，请检查目标文件夹是否可写');
  return 'saved';
}

/** 浏览器回退：a[download] */
export function browserDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
