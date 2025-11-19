// private-bot-control/bridge/state.js
// Store the latest master/player state and allow subscribers to be notified (optional)

let latestState = null;
let lastUpdatedAt = 0;
const listeners = new Set(); // cb(state)

export function updateState(state) {
  latestState = sanitizeState(state);
  lastUpdatedAt = Date.now();
  for (const cb of listeners) {
    try { cb(latestState); } catch (_) {}
  }
}

function sanitizeState(state) {
  if (!state || typeof state !== 'object') return null;
  const s = { ...state };
  if (s.position) s.position = clampVec(s.position);
  if (s.rotation) {
    s.rotation = {
      yaw: Number(s.rotation.yaw) || 0,
      pitch: Number(s.rotation.pitch) || 0
    };
  }
  if (s.lookingAt) s.lookingAt = clampVec(s.lookingAt);
  return s;
}

function clampVec(v) {
  const x = Number(v.x); const y = Number(v.y); const z = Number(v.z);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    z: Number.isFinite(z) ? z : 0,
  };
}

export function getLatestMasterState() {
  return latestState ? { ...latestState, _ts: lastUpdatedAt } : null;
}

export function onState(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => { try { listeners.delete(cb); } catch (_) {} };
}

export function getStateAgeMs() {
  return latestState ? (Date.now() - lastUpdatedAt) : Infinity;
}
