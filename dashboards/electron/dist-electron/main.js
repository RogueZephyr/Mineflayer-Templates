import { ipcMain as l, app as a, BrowserWindow as w } from "electron";
import f from "fs/promises";
import { spawn as p } from "child_process";
import { dirname as b, join as m } from "path";
import { fileURLToPath as y } from "url";
import c from "readline";
const v = y(import.meta.url), d = b(v);
let e = null, n = null;
function u() {
  e = new w({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: !0,
      nodeIntegration: !1,
      // Prefer CommonJS preload to avoid ESM loader issues in Electron
      // Falls back to ESM preload if needed
      preload: m(d, "../preload/preload.cjs")
    },
    title: "Mineflayer Dashboard",
    backgroundColor: "#1e1e1e"
  }), process.env.VITE_DEV_SERVER_URL ? (e.loadURL(process.env.VITE_DEV_SERVER_URL), e.webContents.openDevTools()) : (e.loadFile(m(d, "../dist/index.html")), e.webContents.openDevTools()), e.on("closed", () => {
    e = null;
  });
}
function g() {
  const r = m(d, "../../../src/dashboard/runtimeEntry.js");
  return console.log("[Main] Spawning runtime:", r), n = p(process.execPath, [r], {
    env: {
      ...process.env,
      DASHBOARD_MODE: "electron",
      FORCE_COLOR: "1"
    },
    stdio: ["pipe", "pipe", "pipe"]
  }), c.createInterface({
    input: n.stdout,
    crlfDelay: 1 / 0
  }).on("line", (t) => {
    try {
      const s = JSON.parse(t);
      console.log("[Main] Runtime event:", s.type), e && !e.isDestroyed() && e.webContents.send(`runtime:${s.type}`, s.payload);
    } catch {
      console.log("[Runtime]", t), e && !e.isDestroyed() && e.webContents.send("runtime:log", {
        level: "info",
        message: t,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }), c.createInterface({
    input: n.stderr,
    crlfDelay: 1 / 0
  }).on("line", (t) => {
    console.error("[Runtime Error]", t), e && !e.isDestroyed() && e.webContents.send("runtime:log", {
      level: "error",
      message: t,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }), n.on("error", (t) => {
    console.error("[Main] Runtime spawn error:", t);
  }), n.on("exit", (t, s) => {
    console.log(`[Main] Runtime exited with code ${t}, signal ${s}`), n = null, t !== 0 && !a.isQuitting && (console.log("[Main] Restarting runtime in 3 seconds..."), setTimeout(g, 3e3));
  }), n;
}
l.on("command:execute", (r, o) => {
  if (n && n.stdin) {
    const i = JSON.stringify({ type: "command:execute", payload: o });
    console.log("[Main] IPC command:execute received, forwarding to runtime:", i), console.log("[Main] runtime.stdin writable?", !!n.stdin.writable);
    const t = n.stdin.write(i + `
`);
    if (console.log("[Main] runtime.stdin.write returned", t), e && !e.isDestroyed())
      try {
        e.webContents.send("runtime:inbox", { type: "command:execute", payload: o });
      } catch {
      }
  }
});
l.on("bot:add", (r, o) => {
  if (console.log("[Main] IPC bot:add received", o), n && n.stdin) {
    const i = JSON.stringify({ type: "bot:add", payload: o });
    console.log("[Main] Forwarding bot:add to runtime stdin:", i), console.log("[Main] runtime.stdin writable?", !!n.stdin.writable);
    const t = n.stdin.write(i + `
`);
    if (console.log("[Main] runtime.stdin.write returned", t), e && !e.isDestroyed())
      try {
        e.webContents.send("runtime:inbox", { type: "bot:add", payload: o });
      } catch {
      }
  } else
    console.warn("[Main] Cannot forward bot:add - runtime not running"), e && !e.isDestroyed() && e.webContents.send("runtime:log", { level: "warn", message: "Cannot add bot: runtime not running", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
l.on("bot:remove", (r, o) => {
  if (console.log("[Main] IPC bot:remove received", o), n && n.stdin) {
    const i = JSON.stringify({ type: "bot:remove", payload: o });
    console.log("[Main] Forwarding bot:remove to runtime stdin:", i), console.log("[Main] runtime.stdin writable?", !!n.stdin.writable);
    const t = n.stdin.write(i + `
`);
    if (console.log("[Main] runtime.stdin.write returned", t), e && !e.isDestroyed())
      try {
        e.webContents.send("runtime:inbox", { type: "bot:remove", payload: o });
      } catch {
      }
  } else
    console.warn("[Main] Cannot forward bot:remove - runtime not running"), e && !e.isDestroyed() && e.webContents.send("runtime:log", { level: "warn", message: "Cannot remove bot: runtime not running", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
l.handle("command:list", async () => new Promise((r) => {
  if (!n || !n.stdin) {
    r([]);
    return;
  }
  const o = (t, s) => {
    l.removeListener("runtime:commandMeta", o), r(s);
  };
  e.webContents.once("runtime:commandMeta", o);
  const i = JSON.stringify({ type: "command:list", payload: {} });
  n.stdin.write(i + `
`), setTimeout(() => {
    e.webContents.removeListener("runtime:commandMeta", o), r([]);
  }, 5e3);
}));
l.handle("items:list", async () => {
  try {
    const r = m(d, "../../../src/config/itemCategories.json"), o = await f.readFile(r, "utf-8"), i = JSON.parse(o), t = Object.values(i).flat();
    return Array.from(new Set(t));
  } catch {
    return [];
  }
});
a.whenReady().then(() => {
  u(), g(), a.on("activate", () => {
    w.getAllWindows().length === 0 && u();
  });
});
a.on("window-all-closed", () => {
  a.isQuitting = !0, n && (n.kill("SIGTERM"), n = null), process.platform !== "darwin" && a.quit();
});
a.on("before-quit", () => {
  a.isQuitting = !0, n && (n.kill("SIGTERM"), n = null);
});
