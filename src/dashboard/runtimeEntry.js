// src/dashboard/runtimeEntry.js
import readline from 'readline';
import { BotController } from '../core/BotController.js';
import ConfigLoader from '../core/ConfigLoader.js';
import BotCoordinator from '../core/BotCoordinator.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Runtime bridge for Electron dashboard
 * Wraps the bot system and emits structured events to STDOUT
 * Consumes commands from STDIN
 */

// Set working directory to project root (3 levels up from this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');
process.chdir(projectRoot);

const botControllers = new Map();
let coordinator = null;
let instanceCounter = 1;

// Emit structured JSON events to STDOUT for the main process
function emit(type, payload) {
  // Pass through structured events (logger already outputs JSON for log lines in dashboard mode)
  const event = { type, payload, timestamp: new Date().toISOString() };
  console.log(JSON.stringify(event));
}

// Setup STDIN listener for commands from dashboard
const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

// Debug: confirm readline attached
console.error('[Runtime] stdin readline attached');

// Optional raw stdin probe for debugging; disabled by default to avoid interfering with readline
if (process.env.DASH_DEBUG_STDIN === '1') {
  process.stdin.on('data', (chunk) => {
    try {
      const s = chunk.toString();
      const trimmed = s.trim();
      try {
        const parsed = JSON.parse(trimmed);
        console.log(JSON.stringify({ type: 'inbox', payload: parsed, timestamp: new Date().toISOString() }));
      } catch (_parseErr) {
        console.log(JSON.stringify({ type: 'inbox', payload: { raw: s.replace(/\n/g, '\\n') }, timestamp: new Date().toISOString() }));
      }
    } catch (_e) {
      // Best effort - don't crash the runtime on logging
    }
  });
}

rl.on('line', async (line) => {
  try {
    emit('log', { level: 'debug', message: `[Runtime] stdin line received (${line.length} bytes)` });
    let message;
    try {
      message = JSON.parse(line);
    } catch (e) {
      emit('log', { level: 'warn', message: `[Runtime] Failed to parse JSON line: ${e.message}` });
      return;
    }
    emit('log', { level: 'debug', message: `[Runtime] Parsed message type: ${message.type || '(none)'}` });
    // Emit structured inbox event so the dashboard can see what arrived on stdin
    try {
      emit('inbox', message);
      console.error('[Runtime] Emitted inbox event');
    } catch (_) {
      // fallback to console if emit fails
      console.log('[Runtime] Received stdin message:', message.type || '(unknown)');
    }
    
    if (message.type === 'command:execute') {
      const { botId, command } = message.payload || {};
      const normalizedCmd = String(command || '').trim();
      if (!normalizedCmd) return;
      // Prefer using the bot's configured master identity and private context
      // so whitelist permits the action and we don't require public '!' prefix.
      const execFor = async (controller) => {
        try {
          if (!controller || !controller.bot) {
            emit('log', { level: 'warn', message: '[Runtime] No bot/controller available for command' });
            emit('commandResult', {
              botId: controller?.username || '(unknown)',
              command: normalizedCmd,
              success: false,
              error: 'no_controller',
            });
            return;
          }
          // Wait until chatCommandHandler exists and commands are registered (size > 0)
          const start = Date.now();
          while ((!controller.bot.chatCommandHandler || (controller.bot.chatCommandHandler.commands && controller.bot.chatCommandHandler.commands.size === 0)) && (Date.now() - start) < 4000) {
            await new Promise(r => setTimeout(r, 100));
          }
          const h = controller.bot.chatCommandHandler;
          if (!h || (h.commands && h.commands.size === 0)) {
            emit('log', { level: 'warn', message: '[Runtime] chatCommandHandler not ready (no commands registered); try again after a moment' });
            emit('commandResult', {
              botId: controller.username,
              command: normalizedCmd,
              success: false,
              error: 'handler_not_ready',
            });
            return;
          }
          // Use dashboard sentinel so handler routes as master privately and logs [Console Reply]
          const username = 'Console';
          emit('log', { level: 'debug', message: `[Runtime] Dispatching dashboard command to ${controller.username}: ${normalizedCmd}` });
          const t0 = Date.now();
          let success = true;
          let errorMsg = null;
          try {
            await h.handleMessage(username, normalizedCmd, true);
          } catch (e) {
            success = false;
            errorMsg = e?.message || String(e);
          }
          const durationMs = Date.now() - t0;
          emit('log', { level: 'debug', message: `[Runtime] Completed dashboard command on ${controller.username}: ${normalizedCmd} (${durationMs}ms, ${success ? 'ok' : 'fail'})` });
          emit('commandResult', {
            botId: controller.username,
            command: normalizedCmd,
            success,
            durationMs,
            error: errorMsg || undefined,
          });
        } catch (e) {
          emit('log', { level: 'error', message: `[Runtime] Command execution error: ${e.message || e}` });
          try {
            if (controller && controller.username) {
              emit('commandResult', {
                botId: controller.username,
                command: normalizedCmd,
                success: false,
                error: e?.message || String(e),
              });
            }
          } catch (_) {}
        }
      };

      // Execute command on specific bot or all bots
      if (botId) {
        const controller = botControllers.get(botId);
        await execFor(controller);
      } else {
        // Execute on all bots
        for (const controller of botControllers.values()) {
          await execFor(controller);
        }
      }
  } else if (message.type === 'command:list') {
      // Send command metadata
      const commands = [];
      for (const controller of botControllers.values()) {
        if (controller.bot && controller.bot.chatCommandHandler) {
          const handler = controller.bot.chatCommandHandler;
          for (const [name, _] of handler.commands) {
            if (!commands.some(c => c.name === name)) {
              commands.push({
                name,
                description: `Bot command: ${name}`,
                args: []
              });
            }
          }
          break; // Commands are shared, only need one bot
        }
      }
      emit('commandMeta', commands);
    } else if (message.type === 'bot:add') {
      const { username } = message.payload || {};
      await spawnBot(username || null);
    } else if (message.type === 'bot:remove') {
      const { botId } = message.payload || {};
      await removeBot(botId);
    }
  } catch (err) {
    emit('log', { level: 'error', message: `[Runtime] rl.on(line) handler error: ${err.message || err}` });
  }
});

// Intercept console methods to emit logs
function interceptLogs() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const stripAnsi = (s) => {
    if (typeof s !== 'string') return s;
    // Whitelist: preserve ASCII art (e.g., figlet banner) with color codes intact.
    // Heuristic: long lines composed primarily of ASCII art characters and spaces.
    const isAsciiArtLine = (line) => {
      if (line.startsWith('[BANNER]')) return true;
      if (line.length < 20) return false;
      const artChars = line.match(/[ _|\\/`'.-]/g) || [];
      const ratio = artChars.length / line.length;
      const hasLogPrefix = /\[[A-Z]{3,}\]/.test(line);
      return ratio > 0.6 && !hasLogPrefix;
    };
    if (isAsciiArtLine(s)) return s; // keep color for banner
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code === 27 /* ESC */ && s[i + 1] === '[') {
        i += 2;
        while (i < s.length) {
          const c = s.charCodeAt(i);
          if (c >= 64 && c <= 126) break;
          i++;
        }
        continue;
      }
      out += s[i];
    }
    return out;
  };

  // If a line is already a structured JSON with type/log event (from Logger), let it pass through untouched.
  console.log = (...args) => {
    const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (message.startsWith('{')) {
      // Assume structured event already; forward raw
      originalLog(...args);
      return;
    }
    emit('log', {
      level: 'info',
      message: stripAnsi(message),
      timestamp: new Date().toISOString()
    });
    originalLog(...args);
  };

  console.warn = (...args) => {
    const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    emit('log', {
      level: 'warn',
      message: stripAnsi(message),
      timestamp: new Date().toISOString()
    });
    originalWarn(...args);
  };

  console.error = (...args) => {
    const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    emit('log', {
      level: 'error',
      message: stripAnsi(message),
      timestamp: new Date().toISOString()
    });
    originalError(...args);
  };
}

async function spawnBot(username = null) {
  try {
    const controller = new BotController(globalConfig, username, coordinator, instanceCounter++);
    await controller.start();
    const botId = controller.username;
    botControllers.set(botId, controller);
    emit('log', { level: 'info', message: `Spawning bot ${botId}`, botId });

    controller.bot.once('spawn', () => {
      // Emit FULL status list so the renderer doesn't temporarily drop existing bots
      const statuses = Array.from(botControllers.values()).map(getBotStatus);
      emit('bots', statuses);
    });

    controller.bot.on('end', () => {
      // Emit full list with updated statuses to avoid replacing state with a partial array
      const statuses = Array.from(botControllers.values()).map(getBotStatus);
      emit('bots', statuses);
    });
  } catch (e) {
    emit('error', { message: `Failed to spawn bot: ${e.message || e}` });
  }
}

async function removeBot(botId) {
  if (!botId) return;
  const controller = botControllers.get(botId);
  if (!controller) return;
  try {
    controller.shouldReconnect = false;
    if (controller.bot) {
      controller.bot.removeAllListeners();
      controller.bot.quit();
    }
    emit('log', { level: 'info', message: `Removing bot ${botId}`, botId });
  } catch (_) {}
  botControllers.delete(botId);
  // Emit current list
  const statuses = Array.from(botControllers.values()).map(getBotStatus);
  emit('bots', statuses);
}

function getBotStatus(controller) {
  const bot = controller.bot;
  return {
    id: controller.username,
    username: controller.username,
    online: !!(bot && bot.entity),
    health: bot?.health ?? 0,
    hunger: bot?.food ?? 0,
    position: bot?.entity?.position ? {
      x: bot.entity.position.x,
      y: bot.entity.position.y,
      z: bot.entity.position.z,
    } : undefined,
  };
}

let globalConfig = null;

// Start the bot system
async function start() {
  try {
    interceptLogs();
    
    // Load config
    const result = await ConfigLoader.loadConfig();
    if (!result.success) {
      throw new Error(result.error);
    }
    const config = result.config;
    globalConfig = config;
    
    // Initialize coordinator
    coordinator = new BotCoordinator();
    
    // Start with one bot initially
    await spawnBot(null);

    // Send initial ready with current bots
    emit('ready', {
      bots: Array.from(botControllers.values()).map(getBotStatus),
      commands: []
    });

    // Global periodic status
    setInterval(() => {
      const statuses = Array.from(botControllers.values()).map(getBotStatus);
      emit('bots', statuses);
    }, 2000);
    
  } catch (err) {
    emit('error', { message: `Failed to start runtime: ${err.message}` });
    process.exit(1);
  }
}

start();
