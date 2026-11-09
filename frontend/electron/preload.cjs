'use strict';

/**
 * 预加载脚本：只暴露一个极小的桥，渲染进程拿不到任何 Node 能力。
 * 桌面版导出文件走主进程「另存为」，比浏览器 <a download> 可靠
 * （不受下载目录策略、OneDrive 重定向、无落盘等问题影响）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('interplab', {
  desktop: true,
  platform: process.platform,
  /** 保存二进制/文本到用户选择的位置 */
  saveFile: (name, data) => ipcRenderer.invoke('interplab:save-file', name, data),
  /** 打开数据存放目录 */
  openDataDir: () => ipcRenderer.invoke('interplab:open-data-dir'),
});
