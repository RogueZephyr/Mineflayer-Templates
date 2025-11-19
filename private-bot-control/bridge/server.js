// private-bot-control/bridge/server.js
// WebSocket server that accepts messages from a local MineScript client

import { WebSocketServer } from 'ws';
import { emitCommand } from './commands.js';
import { updateState } from './state.js';

let server = null;
let started = false;
let connections = new Set();
let bridgeConfig = { host: '127.0.0.1', port: 8080, secret: '' };

export function startBridgeServer(config = {}) {
  if (started) return server;
  bridgeConfig = {
    host: config.host || '127.0.0.1',
    port: Number(config.port) || 8080,
    secret: String(config.secret || ''),
    maxMsgSize: Number(config.maxMsgSize) || 64 * 1024
  };

  server = new WebSocketServer({ host: bridgeConfig.host, port: bridgeConfig.port, maxPayload: bridgeConfig.maxMsgSize });

  server.on('connection', (ws, req) => {
    try {
      if (!isLocalhost(req.socket.remoteAddress)) {
        ws.close(1008, 'Forbidden');
        return;
      }
      ws._authed = bridgeConfig.secret ? false : true; // if no secret, treat as authed
      ws._id = `${Date.now()}-${Math.floor(Math.random()*1e6)}`;
      connections.add(ws);

      ws.on('message', (data) => {
        let msg = null;
        try {
          msg = JSON.parse(data.toString());
        } catch (_) {
          safeSend(ws, { type: 'error', v: 1, code: 'MALFORMED', message: 'Invalid JSON' });
          return;
        }
        handleMessage(ws, msg);
      });

      ws.on('close', () => { connections.delete(ws); });
      ws.on('error', () => { connections.delete(ws); });
    } catch (_) {}
  });

  started = true;
  return server;
}

export function getBridgeStatus() {
  return {
    started,
    host: bridgeConfig.host,
    port: bridgeConfig.port,
    connections: connections.size,
  };
}

function isLocalhost(addr) {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function safeSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

async function handleMessage(ws, msg) {
  // Hello/auth
  if (msg?.type === 'hello') {
    const provided = String(msg.secret || '');
    if (bridgeConfig.secret && provided !== bridgeConfig.secret) {
      safeSend(ws, { type: 'error', v: 1, code: 'UNAUTHORIZED', message: 'Bad secret' });
      try { ws.close(1008, 'Unauthorized'); } catch (_) {}
      return;
    }
    ws._authed = true;
    safeSend(ws, { type: 'ack', v: 1, ok: true });
    return;
  }

  if (!ws._authed) {
    safeSend(ws, { type: 'error', v: 1, code: 'UNAUTHORIZED', message: 'Send hello first' });
    return;
  }

  // State updates
  if (msg?.type === 'state') {
    updateState({ position: msg.position, rotation: msg.rotation, lookingAt: msg.lookingAt });
    return;
  }

  // Commands
  if (msg?.type === 'command') {
    const name = String(msg.name || '').toLowerCase();
    const args = Array.isArray(msg.args) ? msg.args : [];
    const id = msg.id || `${Date.now()}`;
    try {
      const res = await emitCommand(name, { args, id, source: 'minescript' });
      safeSend(ws, { type: 'ack', v: 1, id, ok: !!res?.ok });
    } catch (e) {
      safeSend(ws, { type: 'error', v: 1, id, code: 'DISPATCH_ERROR', message: e?.message || String(e) });
    }
    return;
  }

  // Ping
  if (msg?.type === 'ping') {
    safeSend(ws, { type: 'pong', v: 1 });
    return;
  }

  safeSend(ws, { type: 'error', v: 1, code: 'UNKNOWN_TYPE', message: `Unhandled type ${msg?.type}` });
}
