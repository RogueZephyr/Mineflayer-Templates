// dashboards/electron/preload/preload.cjs (CommonJS version)
// Using CommonJS to ensure Electron can load the preload without ESM loader conflicts.
const { contextBridge, ipcRenderer } = require('electron');

try {
  console.log('[Preload] Initializing preload bridge (CJS)...');

  contextBridge.exposeInMainWorld('dashboardAPI', {
    sendCommand: (payload) => ipcRenderer.send('command:execute', payload),
    listCommands: () => ipcRenderer.invoke('command:list'),
    getItems: () => ipcRenderer.invoke('items:list'),
    onLog: (callback) => {
      const handler = (_e, log) => callback(log);
      ipcRenderer.on('runtime:log', handler);
      return () => ipcRenderer.removeListener('runtime:log', handler);
    },
    onBots: (callback) => {
      const handler = (_e, bots) => callback(bots);
      ipcRenderer.on('runtime:bots', handler);
      return () => ipcRenderer.removeListener('runtime:bots', handler);
    },
    onReady: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('runtime:ready', handler);
      return () => ipcRenderer.removeListener('runtime:ready', handler);
    },
    onError: (callback) => {
      const handler = (_e, error) => callback(error);
      ipcRenderer.on('runtime:error', handler);
      return () => ipcRenderer.removeListener('runtime:error', handler);
    },
    onCommandMeta: (callback) => {
      const handler = (_e, commands) => callback(commands);
      ipcRenderer.on('runtime:commandMeta', handler);
      return () => ipcRenderer.removeListener('runtime:commandMeta', handler);
    }
    , onInbox: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('runtime:inbox', handler);
      return () => ipcRenderer.removeListener('runtime:inbox', handler);
    }
    , addBot: (username) => ipcRenderer.send('bot:add', { username })
    , removeBot: (botId) => ipcRenderer.send('bot:remove', { botId })
  });

  console.log('[Preload] Bridge exposed successfully');
} catch (err) {
  console.error('[Preload] Failed to initialize:', err);
}
