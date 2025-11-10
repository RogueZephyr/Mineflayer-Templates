// dashboards/electron/preload/preload.js
import { contextBridge, ipcRenderer } from 'electron';

// Expose secure API to renderer
contextBridge.exposeInMainWorld('dashboardAPI', {
  // Send command to bot(s)
  sendCommand: (payload) => {
    ipcRenderer.send('command:execute', payload);
  },

  // List available commands
  listCommands: () => {
    return ipcRenderer.invoke('command:list');
  },

  // Subscribe to log events
  onLog: (callback) => {
    const handler = (_event, log) => callback(log);
    ipcRenderer.on('runtime:log', handler);
    return () => ipcRenderer.removeListener('runtime:log', handler);
  },

  // Subscribe to bot status updates
  onBots: (callback) => {
    const handler = (_event, bots) => callback(bots);
    ipcRenderer.on('runtime:bots', handler);
    return () => ipcRenderer.removeListener('runtime:bots', handler);
  },

  // Subscribe to ready event
  onReady: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('runtime:ready', handler);
    return () => ipcRenderer.removeListener('runtime:ready', handler);
  },

  // Subscribe to error events
  onError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on('runtime:error', handler);
    return () => ipcRenderer.removeListener('runtime:error', handler);
  },

  // Subscribe to command metadata
  onCommandMeta: (callback) => {
    const handler = (_event, commands) => callback(commands);
    ipcRenderer.on('runtime:commandMeta', handler);
    return () => ipcRenderer.removeListener('runtime:commandMeta', handler);
  },
});
