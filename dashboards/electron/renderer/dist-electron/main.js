import { ipcMain as l, app as i, BrowserWindow as p } from "electron";
import { spawn as w } from "child_process";
import { dirname as g, join as m } from "path";
import { fileURLToPath as R } from "url";
import d from "readline";
const y = R(import.meta.url), c = g(y);
let n = null, e = null;
function u() {
  n = new p({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: !0,
      nodeIntegration: !1,
      preload: m(c, "../preload/preload.js")
    },
    title: "Mineflayer Dashboard",
    backgroundColor: "#1e1e1e"
  }), process.env.VITE_DEV_SERVER_URL ? (n.loadURL(process.env.VITE_DEV_SERVER_URL), n.webContents.openDevTools()) : n.loadFile(m(c, "../renderer/dist/index.html")), n.on("closed", () => {
    n = null;
  });
}
function f() {
  const r = m(c, "../../../src/dashboard/runtimeEntry.js");
  return console.log("[Main] Spawning runtime:", r), e = w(process.execPath, [r], {
    env: {
      ...process.env,
      DASHBOARD_MODE: "electron",
      FORCE_COLOR: "1"
    },
    stdio: ["pipe", "pipe", "pipe"]
  }), d.createInterface({
    input: e.stdout,
    crlfDelay: 1 / 0
  }).on("line", (t) => {
    try {
      const o = JSON.parse(t);
      console.log("[Main] Runtime event:", o.type), n && !n.isDestroyed() && n.webContents.send(`runtime:${o.type}`, o.payload);
    } catch {
      console.log("[Runtime]", t), n && !n.isDestroyed() && n.webContents.send("runtime:log", {
        level: "info",
        message: t,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }), d.createInterface({
    input: e.stderr,
    crlfDelay: 1 / 0
  }).on("line", (t) => {
    console.error("[Runtime Error]", t), n && !n.isDestroyed() && n.webContents.send("runtime:log", {
      level: "error",
      message: t,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }), e.on("error", (t) => {
    console.error("[Main] Runtime spawn error:", t);
  }), e.on("exit", (t, o) => {
    console.log(`[Main] Runtime exited with code ${t}, signal ${o}`), e = null, t !== 0 && !i.isQuitting && (console.log("[Main] Restarting runtime in 3 seconds..."), setTimeout(f, 3e3));
  }), e;
}
l.on("command:execute", (r, s) => {
  if (e && e.stdin) {
    const a = JSON.stringify({ type: "command:execute", payload: s });
    e.stdin.write(a + `
`);
  }
});
l.handle("command:list", async () => new Promise((r) => {
  if (!e || !e.stdin) {
    r([]);
    return;
  }
  const s = (t, o) => {
    l.removeListener("runtime:commandMeta", s), r(o);
  };
  n.webContents.once("runtime:commandMeta", s);
  const a = JSON.stringify({ type: "command:list", payload: {} });
  e.stdin.write(a + `
`), setTimeout(() => {
    n.webContents.removeListener("runtime:commandMeta", s), r([]);
  }, 5e3);
}));
i.whenReady().then(() => {
  u(), f(), i.on("activate", () => {
    p.getAllWindows().length === 0 && u();
  });
});
i.on("window-all-closed", () => {
  i.isQuitting = !0, e && (e.kill("SIGTERM"), e = null), process.platform !== "darwin" && i.quit();
});
i.on("before-quit", () => {
  i.isQuitting = !0, e && (e.kill("SIGTERM"), e = null);
});
