import { contextBridge as m, ipcRenderer as n } from "electron";
m.exposeInMainWorld("dashboardAPI", {
  // Send command to bot(s)
  sendCommand: (r) => {
    n.send("command:execute", r);
  },
  // List available commands
  listCommands: () => n.invoke("command:list"),
  // Subscribe to log events
  onLog: (r) => {
    const e = (t, o) => r(o);
    return n.on("runtime:log", e), () => n.removeListener("runtime:log", e);
  },
  // Subscribe to bot status updates
  onBots: (r) => {
    const e = (t, o) => r(o);
    return n.on("runtime:bots", e), () => n.removeListener("runtime:bots", e);
  },
  // Subscribe to ready event
  onReady: (r) => {
    const e = (t, o) => r(o);
    return n.on("runtime:ready", e), () => n.removeListener("runtime:ready", e);
  },
  // Subscribe to error events
  onError: (r) => {
    const e = (t, o) => r(o);
    return n.on("runtime:error", e), () => n.removeListener("runtime:error", e);
  },
  // Subscribe to command metadata
  onCommandMeta: (r) => {
    const e = (t, o) => r(o);
    return n.on("runtime:commandMeta", e), () => n.removeListener("runtime:commandMeta", e);
  }
});
