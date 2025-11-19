// private-bot-control/bridge/commands.js
// ESM registry for private commands from MineScript

const handlers = new Map(); // name -> Set<fn(payload)>
const queues = new Map();   // name -> { items: [], running: false }

export function onCommand(name, handler) {
  if (!name || typeof handler !== 'function') return () => {};
  const key = String(name).toLowerCase();
  let set = handlers.get(key);
  if (!set) { set = new Set(); handlers.set(key, set); }
  set.add(handler);
  return () => { try { set.delete(handler); } catch (_) {} };
}

export function registerCommand(name, handler) {
  return onCommand(name, handler);
}

export async function emitCommand(name, payload = {}) {
  const key = String(name || '').toLowerCase();
  const set = handlers.get(key);
  if (!set || set.size === 0) return { ok: false, code: 'NO_HANDLER' };

  // Queue per command name to avoid stampedes
  let q = queues.get(key);
  if (!q) { q = { items: [], running: false }; queues.set(key, q); }

  return new Promise((resolve) => {
    q.items.push({ payload, resolve });
    if (!q.running) processQueue(key);
  });
}

async function processQueue(key) {
  const q = queues.get(key);
  if (!q) return;
  if (q.running) return;
  q.running = true;

  while (q.items.length > 0) {
    const item = q.items.shift();
    const set = handlers.get(key) || new Set();
    try {
      const results = await Promise.allSettled(Array.from(set).map(fn => fn(item.payload)));
      item.resolve({ ok: true, results });
    } catch (e) {
      item.resolve({ ok: false, code: 'HANDLER_ERROR', message: e?.message || String(e) });
    }
  }

  q.running = false;
}

export function clearAllHandlers() {
  handlers.clear();
  queues.clear();
}
