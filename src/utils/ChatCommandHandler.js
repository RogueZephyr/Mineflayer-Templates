// src/utils/ChatCommandHandler.js
import chalk from 'chalk';
import { Vec3 } from 'vec3';
import readline from 'readline';
import Logger from './logger.js';
// import PathfinderBehavior from '../behaviors/PathfinderBehavior.js';
import * as PathfinderBehaviorModule from '../behaviors/PathfinderBehavior.js';
import SaveChestLocation from './SaveChestLocation.js';
import DepositBehavior from '../behaviors/DepositBehavior.js';
import DebugTools from './DebugTools.js';
import AreaRegistry from '../state/AreaRegistry.js';
import WhitelistManager from './WhitelistManager.js';

const cmdPrefix = '!';
// Sentinel name used by dashboard runtime to indicate a synthetic master command
const DASHBOARD_CONSOLE_SENDER = 'Console';

export default class ChatCommandHandler {
  constructor(bot, master, behaviors = {}, config = {}) {
    this.bot = bot;
    this.master = master;
    this.behaviors = behaviors;
    this.logger = new Logger();
    this.commands = new Map();
    this.config = config;
    // Flag indicating a command originated from the local console.
    // While true, all outbound chat/whisper/reply traffic is suppressed
    // from the Minecraft server and logged to console instead.
  this._consoleCommandActive = false;
  this._initialized = false;
  this._initPromise = null;
    
    // Rate limiting per user (prevents spam/abuse)
    this.rateLimits = new Map(); // username -> lastCommandTime
    this.rateLimitMs = 1000; // 1 second between commands per user
    
    // Whitelist manager for player permissions
    this.whitelist = new WhitelistManager(master);
    this.bot.whitelist = this.whitelist;

    // Compile whisper patterns from config
    this.whisperPatterns = this._compileWhisperPatterns(config.whisperPatterns || []);

    // Core systems
    // support modules that export default OR named export
    const PathfinderCtor = PathfinderBehaviorModule.default || PathfinderBehaviorModule.PathfinderBehavior || PathfinderBehaviorModule;
    this.pathfinder = new PathfinderCtor(this.bot);
    if (typeof this.pathfinder.initialize === 'function') {
      this.pathfinder.initialize();
    }

    // reuse any existing registry created by BotController, otherwise create one
    this.chestRegistry = this.bot.chestRegistry || new SaveChestLocation(this.bot);
    this.bot.chestRegistry = this.chestRegistry;

    // reuse depositBehavior if already attached by BotController
    this.depositBehavior = this.bot.depositBehavior || new DepositBehavior(this.bot, this.logger);
    this.bot.depositBehavior = this.depositBehavior;

    // Area registry for modular area management
    this.areaRegistry = this.bot.areaRegistry || new AreaRegistry(this.bot);
    this.bot.areaRegistry = this.areaRegistry;

    // Debug tools (expose for runtime inspection)
    this.debug = new DebugTools(this.bot, this.logger, this.behaviors, { chestRegistry: this.chestRegistry, depositBehavior: this.depositBehavior, areaRegistry: this.areaRegistry });
    this.bot.debugTools = this.debug;
    
  // Defer heavy initialization (commands, listeners, console input) until async init() is called
  // This allows whitelist to load asynchronously first.
    
    // Track listener references for cleanup
    this._chatHandler = null;
    this._whisperHandler = null;
    this._rawChatHandler = null;
  }
  
  /**
   * Asynchronous initialization sequence to load whitelist and set up listeners/commands.
   */
  async init() {
    if (this._initialized) return this;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        try {
          await this.whitelist.loadWhitelist();
          this.logger.info(`[ChatCommandHandler] Whitelist loaded (${Object.keys(this.whitelist.whitelist).length} entries)`);
        } catch (_e) {
          this.logger.warn('[ChatCommandHandler] Whitelist async load failed, proceeding with empty list');
        }
        this.registerDefaultCommands();
        this.initListeners();
        this.initConsoleInput();
        this._initialized = true;
        this.logger.info('[ChatCommandHandler] Initialization complete');
        return this;
      } finally {
        // Clear promise but keep initialized flag
        this._initPromise = null;
      }
    })();

    // Expose a readiness promise for external awaiters (e.g., runtime)
    try { this.bot.chatCommandHandlerReady = this._initPromise; } catch (_) {}

    return this._initPromise;
  }

  isReady() { return this._initialized; }

  async waitUntilReady() {
    if (this._initialized) return;
    if (this._initPromise) { await this._initPromise; return; }
    await this.init();
  }
  
  /**
   * Dispose of all listeners and cleanup resources
   * Called by BotController on shutdown to prevent memory leaks
   */
  dispose() {
    // Remove bot listeners
    if (this._chatHandler) {
      this.bot.removeListener('chat', this._chatHandler);
      this._chatHandler = null;
    }
    if (this._whisperHandler) {
      this.bot.removeListener('whisper', this._whisperHandler);
      this._whisperHandler = null;
    }
    if (this._rawChatHandler && this.bot._client) {
      this.bot._client.removeListener('chat', this._rawChatHandler);
      this._rawChatHandler = null;
    }
    
    // Clear rate limit tracking
    this.rateLimits.clear();
    
    // Reset init flags
    this._initialized = false;
    this._initPromise = null;

    this.logger.info('[ChatCommandHandler] Disposed');
  }

  // ------------------------------
  // Console Input Handler
  // ------------------------------
  initConsoleInput() {
    // In Electron dashboard runtime, reserve stdin for IPC
    if (process.env.DASHBOARD_MODE === 'electron') {
      if (!this.constructor._consoleDashboardNotice) {
        this.logger.info('[Console] Dashboard mode detected; skipping local stdin command handler');
        this.constructor._consoleDashboardNotice = true;
      }
      return;
    }
    // Skip if already initialized (prevent duplicate listeners)
    if (this.constructor._consoleInitialized) return;
    this.constructor._consoleInitialized = true;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) return;

      try {
        // Check if input is a bot command (starts with !)
        if (input.startsWith('!')) {
          const cleanMessage = input.replace(cmdPrefix, '').trim();
          const parts = cleanMessage.split(/\s+/);
          const commandName = parts.shift().toLowerCase();
          const args = parts;

          if (this.commands.has(commandName)) {
            this.logger.info(chalk.cyan(`[Console] Executing command: ${commandName}`));
            
            // Execute command as master (console has full permissions)
            const handler = this.commands.get(commandName);
            // Override chat + whisper temporarily so any direct calls are captured.
            const originalChat = this.bot.chat ? this.bot.chat.bind(this.bot) : null;
            const originalWhisper = this.bot.whisper ? this.bot.whisper.bind(this.bot) : null;
            this._consoleCommandActive = true;
            this._originalBotChat = originalChat; // Store for commands that need real chat (like !say)
            if (originalChat) {
              this.bot.chat = (msg) => { if (msg) this.logger.info(`[Console Reply] ${msg}`); };
            }
            if (originalWhisper) {
              this.bot.whisper = (target, msg) => { if (msg) this.logger.info(`[Console Reply->${target}] ${msg}`); };
            }
            try {
              const res = handler.call(this, this.master, args, true); // treat console as private context
              if (res instanceof Promise) await res;
            } catch (err) {
              this.logger.error(`[Console] Command error: ${err?.message || err}`);
            } finally {
              // Restore originals
              this._consoleCommandActive = false;
              this._originalBotChat = null;
              if (originalChat) this.bot.chat = originalChat;
              if (originalWhisper) this.bot.whisper = originalWhisper;
            }
          } else {
            this.logger.warn(chalk.yellow(`[Console] Unknown command: ${commandName}`));
            this.logger.info(chalk.gray('Type !help for available commands'));
          }
        } else {
          // If not a command, send as chat message
          this.bot.chat(input);
        }
      } catch (err) {
        this.logger.error(`[Console] Error processing input: ${err.message || err}`);
      }
    });

    rl.on('close', () => {
      this.logger.info(chalk.gray('[Console] Input closed'));
    });

    this.logger.success(chalk.green('[Console] Command input enabled - Type !help for commands or just type to chat'));
  }

  // ------------------------------
  // Safe chat helpers (rate-limited)
  // ------------------------------
  async _sendLines(username, lines, isPrivate, delayMs = 350) {
    // Send a sequence of lines with a small delay to avoid server anti-spam
    for (const line of lines) {
      if (!line) continue;
      this.reply(username, line, isPrivate);
      // Basic throttle; many servers kick for rapid whispers/chats
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // ------------------------------
  // Listener Setup
  // ------------------------------
  initListeners() {
    // Public chat commands
    this._chatHandler = async (username, message) => {
      try {
        await this.handleMessage(username, message, false);
      } catch (e) {
        this.logger.error(`[Chat] Error handling public message from ${username}: ${e.message || e}`);
      }
    };
    this.bot.on('chat', this._chatHandler);

    // Private messages via /msg or /tell (standard Mineflayer event)
    this._whisperHandler = async (username, message) => {
      try {
        await this.handleMessage(username, message, true);
      } catch (e) {
        this.logger.error(`[Chat] Error handling whisper from ${username}: ${e.message || e}`);
      }
    };
    this.bot.on('whisper', this._whisperHandler);

    // Raw message listener for custom whisper formats
    // Some server plugins don't trigger the 'whisper' event properly
    this._rawChatHandler = async (packet) => {
      try {
        const jsonMsg = packet.message;
        const rawText = this._extractRawText(jsonMsg);
        
        if (rawText) {
          const whisperData = this._parseCustomWhisper(rawText);
          if (whisperData) {
            this.logger.info(`[Whisper] Detected custom format from ${whisperData.username}: ${whisperData.message}`);
            await this.handleMessage(whisperData.username, whisperData.message, true);
            return;
          }
          
          // Try to parse custom chat format from unsigned field
          const chatData = this._parseCustomChat(jsonMsg, rawText);
          if (chatData) {
            this.logger.info(`[Chat] Custom format detected from ${chatData.username}: ${chatData.message}`);
            await this.handleMessage(chatData.username, chatData.message, false);
          }
        }
      } catch (_e) {
        // Silent fail - this is just a fallback for custom formats
      }
    };
    this.bot._client.on('chat', this._rawChatHandler);
  }

  // ------------------------------
  // Custom Chat Parser
  // ------------------------------
  
  /**
   * Parse custom chat format from server (handles unsigned field with rank prefixes)
   */
  _parseCustomChat(jsonMsg, rawText) {
    try {
      // Check if there's an unsigned field with chat data
      if (jsonMsg?.unsigned?.with) {
        const unsignedWith = jsonMsg.unsigned.with[0];
        if (unsignedWith?.extra) {
          const extras = unsignedWith.extra;
          let username = '';
          let message = '';
          
          // Parse the extra array: [rank, username, message]
          extras.forEach(part => {
            const text = part.text || part.json?.text || part[''] || '';
            
            // Skip rank prefixes like [Member]
            if (text.includes('[') && text.includes(']')) {
              return;
            }
            
            // Extract message after colon
            if (text.includes(':')) {
              const parts = text.split(':');
              message = parts.slice(1).join(':').trim();
              return;
            }
            
            // First non-rank text is the username
            if (!username && text.trim() && !text.includes('[')) {
              username = text.trim();
            }
          });
          
          if (username && message) {
            return { username, message };
          }
        }
      }
      
      // Fallback: try to extract from rawText if it matches pattern
      // Format: "[Rank] Username: Message" or "Username: Message"
      const chatPattern = /(?:\[.+?\]\s*)?(\w+):\s*(.+)/;
      const match = rawText.match(chatPattern);
      if (match) {
        return {
          username: match[1],
          message: match[2]
        };
      }
  } catch (_e) {
      // Failed to parse, return null
    }
    
    return null;
  }

  // ------------------------------
  // Whisper Pattern Helpers
  // ------------------------------
  
  /**
   * Compile whisper patterns from config into RegExp objects
   */
  _compileWhisperPatterns(patterns) {
    const compiled = [];
    
    for (const pattern of patterns) {
      if (!pattern.enabled) continue;
      
      try {
        compiled.push({
          name: pattern.name,
          regex: new RegExp(pattern.pattern),
          usernameGroup: pattern.usernameGroup || 1,
          messageGroup: pattern.messageGroup || 2
        });
        this.logger.info(`[Whisper] Loaded pattern: ${pattern.name}`);
    } catch (_e) {
        this.logger.error(`[Whisper] Failed to compile pattern '${pattern.name}': ${_e.message || _e}`);
      }
    }
    
    return compiled;
  }

  /**
   * Extract raw text from Minecraft JSON chat message
   */
  _extractRawText(jsonMsg) {
    if (typeof jsonMsg === 'string') {
      return jsonMsg;
    }
    
    if (!jsonMsg) return null;
    
    // Handle JSON chat format
    let text = '';
    
    if (jsonMsg.text) {
      text += jsonMsg.text;
    }
    
    if (jsonMsg.extra && Array.isArray(jsonMsg.extra)) {
      for (const part of jsonMsg.extra) {
        if (typeof part === 'string') {
          text += part;
        } else if (part.text) {
          text += part.text;
        }
      }
    }
    
    return text || null;
  }

  /**
   * Parse custom whisper formats using configured patterns
   */
  _parseCustomWhisper(rawText) {
    for (const pattern of this.whisperPatterns) {
      const match = rawText.match(pattern.regex);
      
      if (match) {
        const username = match[pattern.usernameGroup];
        const message = match[pattern.messageGroup];
        
        if (username && message) {
          this.logger.info(`[Whisper] Matched pattern '${pattern.name}': ${username} -> ${message}`);
          return { username, message };
        }
      }
    }
    
    return null;
  }

  // Helper method to reply (whisper if private, chat if public)
  reply(username, message, isPrivate) {
    if (!message) return;
    // Intercept replies during console command execution
    if (this._consoleCommandActive) {
      if (isPrivate) {
        this.logger.info(`[Console Reply->${username}] ${message}`);
      } else {
        this.logger.info(`[Console Reply] ${message}`);
      }
      return; // do not send to server
    }
    if (isPrivate) {
      this.bot.whisper(username, message);
    } else {
      this.bot.chat(message);
    }
  }

  /**
   * Check if user is rate limited (prevents command spam)
   */
  isRateLimited(username) {
    const now = Date.now();
    const lastTime = this.rateLimits.get(username) || 0;
    
    if (now - lastTime < this.rateLimitMs) {
      return true; // Too soon
    }
    
    this.rateLimits.set(username, now);
    return false;
  }

  // ------------------------------
  // Command Parser
  // ------------------------------
  /**
   * Check if command is targeted at this bot
   * Returns { isForThisBot: boolean, remainingArgs: array }
   */
  parseTargetedCommand(args) {
    if (args.length === 0) {
      return { isForThisBot: true, remainingArgs: args };
    }

    const firstArg = args[0];
    
    // Check if first arg is a bot name
    const botNameList = this.bot.constructor.usernameList || [];
    const isBotName = botNameList.some(name => 
      name.toLowerCase() === firstArg.toLowerCase()
    );

    if (isBotName) {
      // Command is targeted at a specific bot
      const isForThisBot = firstArg.toLowerCase() === this.bot.username.toLowerCase();
      return { 
        isForThisBot, 
        remainingArgs: args.slice(1) // Remove bot name from args
      };
    }
    

    // No bot name specified, command is for all bots
    return { isForThisBot: true, remainingArgs: args };
  }
  

  async handleMessage(username, message, isPrivate) {
    // Ensure handler is ready; allow runtime to call immediately after spawn
    if (!this._initialized) {
      try { await this.waitUntilReady(); } catch (err) { this.logger.error(`[ChatCommandHandler] Command ignored; init failed: ${err?.message || err}`); return; }
      if (!this._initialized) { this.logger.warn('[ChatCommandHandler] Command ignored; handler not ready'); return; }
    }

    if (username === this.bot.username) return;
    if (!message || typeof message !== 'string') return;

    const isDashboardConsole = username === DASHBOARD_CONSOLE_SENDER;
    const effectiveUsername = isDashboardConsole ? this.master : username;
    const effectivePrivate = isDashboardConsole ? true : isPrivate;

    // Rate limiting only for real players, not dashboard-originated commands
    if (!isDashboardConsole && this.isRateLimited(effectiveUsername)) {
      this.logger.info(`[${this.bot.username}] Rate limited: ${effectiveUsername}`);
      return;
    }

    // Require prefix for public chat from players; dashboard private commands may omit it.
    if (!effectivePrivate && !message.startsWith(cmdPrefix)) return;

    // Strip prefix if present
    const cleanMessage = message.startsWith(cmdPrefix)
      ? message.slice(cmdPrefix.length).trim()
      : message.trim();
    if (!cleanMessage) return;

    const parts = cleanMessage.split(/\s+/);
    const commandName = (parts.shift() || '').toLowerCase();
    if (!commandName) return;
    const args = parts;

    // Ensure whitelist loaded before checks (non-blocking catch)
    try { await this.whitelist.loadWhitelist(); } catch (_) {}

    if (!this.commands.has(commandName)) {
      // Unknown command: only inform whitelisted real players (not dashboard synthetic sender)
      if (!isDashboardConsole && this.whitelist.isWhitelisted(effectiveUsername)) {
        this.reply(effectiveUsername, `Unknown command: ${commandName}`, effectivePrivate);
      }
      return;
    }

    // Targeting (first arg can be bot name)
    const { isForThisBot, remainingArgs } = this.parseTargetedCommand(args);
    this.logger.info(`[${this.bot.username}] Command '${commandName}' actor='${effectiveUsername}' isForThisBot=${isForThisBot} args=[${args.join(', ')}] rem=[${remainingArgs.join(', ')}]`);
    if (!isForThisBot) return;

    // Whitelist checks (skip for dashboard/master synthetic unless master is set incorrectly)
    if (!isDashboardConsole) {
      if (!this.whitelist.canCommandBot(effectiveUsername, this.bot.username)) {
        this.logger.info(`[${this.bot.username}] ${effectiveUsername} not whitelisted for this bot`);
        return;
      }
      if (!this.whitelist.canUseCommand(effectiveUsername, this.bot.username, commandName)) {
        this.reply(effectiveUsername, `You don't have permission to use '${commandName}'`, effectivePrivate);
        this.logger.info(`[${this.bot.username}] ${effectiveUsername} denied command: ${commandName}`);
        return;
      }
    }

    // Log execution
    const targetInfo = (args.length > 0 && remainingArgs.length !== args.length) ? ` (targeted)` : '';
    this.logger.info(`[${this.bot.username}] ${effectiveUsername}${isDashboardConsole ? ' [dashboard]' : ''} executing: ${commandName}${targetInfo}`);

    const handler = this.commands.get(commandName);

    // Dashboard console emulation: temporarily redirect bot.chat/whisper so command output is logged not sent publicly
    let originalChat = null;
    let originalWhisper = null;
    if (isDashboardConsole) {
      originalChat = this.bot.chat ? this.bot.chat.bind(this.bot) : null;
      originalWhisper = this.bot.whisper ? this.bot.whisper.bind(this.bot) : null;
      this._consoleCommandActive = true;
      this._originalBotChat = originalChat;
      if (originalChat) this.bot.chat = (msg) => { if (msg) this.logger.info(`[Console Reply] ${msg}`); };
      if (originalWhisper) this.bot.whisper = (target, msg) => { if (msg) this.logger.info(`[Console Reply->${target}] ${msg}`); };
    }

    try {
      const res = handler.call(this, effectiveUsername, remainingArgs, effectivePrivate);
      try { this.bot.lastCommandAt = Date.now(); } catch (_) {}
      if (res instanceof Promise) await res.catch(err => this.logger.error(`[Cmd:${commandName}] ${err.message || err}`));
    } catch (err) {
      this.logger.error(`[Cmd:${commandName}] Handler threw: ${err.message || err}`);
    } finally {
      if (isDashboardConsole) {
        this._consoleCommandActive = false;
        this._originalBotChat = null;
        if (originalChat) this.bot.chat = originalChat;
        if (originalWhisper) this.bot.whisper = originalWhisper;
      }
    }
  }

  // ------------------------------
  // Register Commands
  // ------------------------------
  registerDefaultCommands() {
    // 🧠 Basic
    this.register('ping', (username, args, isPrivate) => {
      this.reply(username, 'Pong!', isPrivate);
    });

    // Bot Manager (Phase A.1) - minimal control & inspection
    this.register('manager', (username, args, isPrivate) => {
      const mgr = this.bot.manager;
      const sub = (args[0] || '').toLowerCase();
      if (!mgr) {
        return this.reply(username, 'BotManager not initialized', isPrivate);
      }
      if (sub === 'status') {
        const status = mgr.getStatus();
        const leader = status.leader || 'none';
        const onlineCount = status.workers.filter(w => w.online).length;
        return this.reply(username, `Leader: ${leader} | Online: ${onlineCount}/${status.workers.length}`, isPrivate);
      }
      if (sub === 'list') {
        const workers = mgr.getStatus().workers;
        if (workers.length === 0) return this.reply(username, 'No workers registered', isPrivate);
        for (const w of workers) {
          const up = w.uptimeSec;
          let upStr;
          if (up < 60) upStr = `${up}s`; else if (up < 3600) upStr = `${Math.floor(up/60)}m ${up%60}s`; else upStr = `${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m`;
          this.reply(username, `${w.name}: ${w.online ? 'online' : 'offline'} (uptime ${upStr})`, isPrivate);
        }
        return;
      }
      if (sub === 'leader') {
        const leader = mgr.getLeader();
        return this.reply(username, `Leader: ${leader?.name || 'none'}`, isPrivate);
      }
      if (sub === 'elect') {
        mgr.forceReelection();
        const leader = mgr.getLeader();
        return this.reply(username, `Re-elected leader: ${leader?.name || 'none'}`, isPrivate);
      }
      return this.reply(username, 'Usage: !manager status | list | leader | elect', isPrivate);
    });

    this.register('help', async (username, args, isPrivate) => {
      const playerInfo = this.whitelist.getPlayerInfo(username);
      const helpMsg = [
        '=== Bot Commands ===',
        'Movement: come, goto, follow, stop',
        'Home: sethome [x y z], home, ishome',
        'Actions: eat, sleep, farm, wood, collect',
        'Mining: mine <strip|tunnel|stop|status>',
        'Tools: tools <status|report|check|equip>',
        'Deposit: deposit, depositall, depositnearest',
        'Utility: loginv, drop, debug',
        '',
        'For detailed help: !help <command>',
        'Examples: !help mine, !help tools, !help deposit'
      ];
      
      // Detailed help for specific commands
      const cmd = args[0]?.toLowerCase();
      if (cmd === 'mine') {
        helpMsg.length = 0;
        helpMsg.push('=== Mining Commands ===');
        helpMsg.push('!mine strip <dir> [length] [branches]');
        helpMsg.push('  - Strip mine with side branches');
        helpMsg.push('  - Example: !mine strip east 100 10');
        helpMsg.push('!mine tunnel <dir> [length] [width] [height]');
        helpMsg.push('  - Create a tunnel; defaults from config (e.g., 3x3)');
        helpMsg.push('  - Examples:');
        helpMsg.push('    • !mine tunnel north 50');
        helpMsg.push('    • !mine tunnel south 30 4 3  (width=4, height=3)');
        helpMsg.push('!mine stop - Stop mining');
        helpMsg.push('!mine status - Show progress');
        helpMsg.push('Directions: north, south, east, west');
      } else if (cmd === 'tools') {
        helpMsg.length = 0;
        helpMsg.push('=== Tool Commands ===');
        helpMsg.push('!tools status - Quick tool count');
        helpMsg.push('!tools report - Detailed durability');
        helpMsg.push('!tools check <type> - Check for tool');
        helpMsg.push('  - Types: pickaxe, axe, shovel, hoe');
        helpMsg.push('!tools equip <block> - Equip for block');
        helpMsg.push('  - Example: !tools equip stone');
        helpMsg.push('');
        helpMsg.push('Note: Bot auto-switches tools');
        helpMsg.push('during mining and woodcutting!');
      } else if (cmd === 'wood') {
        helpMsg.length = 0;
        helpMsg.push('=== Woodcutting Commands ===');
        helpMsg.push('!wood start - Start woodcutting');
        helpMsg.push('!wood stop - Stop woodcutting');
        helpMsg.push('Optional: Set area with');
        helpMsg.push('  !setarea wood start/end');
      } else if (cmd === 'farm') {
        helpMsg.length = 0;
        helpMsg.push('=== Farming Commands ===');
        helpMsg.push('!farm start [-b N] - Start farming (default 1 bot, use -b N for multiple)');
        helpMsg.push('!farm stop - Stop farming');
        helpMsg.push('Set area with:');
        helpMsg.push('  !setarea farm start/end');
      } else if (cmd === 'deposit') {
        helpMsg.length = 0;
        helpMsg.push('=== Deposit Commands ===');
        helpMsg.push('!deposit [type] - Deposit to nearest chest');
        helpMsg.push('!deposit <x> <y> <z> [type] - Deposit to specific chest');
        helpMsg.push('!depositall - Deposit all items');
        helpMsg.push('!depositnearest [type] [radius] - Deposit with custom radius');
        helpMsg.push('');
        helpMsg.push('Types: all, wood, ores, crops, resources');
        helpMsg.push('Examples:');
        helpMsg.push('  • !deposit ores');
        helpMsg.push('  • !deposit 100 64 200 wood');
        helpMsg.push('  • !depositnearest crops 40');
        helpMsg.push('');
        helpMsg.push('Smart fallback: Uses nearest chest first,');
        helpMsg.push('then categorized chests if available');
      }
      
      if (playerInfo && !cmd) {
        helpMsg.push('');
        helpMsg.push('--- Your Permissions ---');
        const bots = playerInfo.allowedBots.includes('*') ? 'All bots' : playerInfo.allowedBots.join(', ');
        const cmds = playerInfo.allowedCommands.includes('*') ? 'All commands' : playerInfo.allowedCommands.join(', ');
        helpMsg.push(`Bots: ${bots}`);
        helpMsg.push(`Commands: ${cmds}`);
      }
      
      // Always send help via whisper to avoid public spam; throttle to avoid kicks
      await this._sendLines(username, helpMsg, true, 350);
      if (!isPrivate) this.reply(username, 'Check private messages for help!', isPrivate);
    });

  this.register('whoami', (username, args, isPrivate) => {
      const playerInfo = this.whitelist.getPlayerInfo(username);
      if (!playerInfo) {
        this.reply(username, 'You are not whitelisted', isPrivate);
        return;
      }
      
      const bots = playerInfo.allowedBots.includes('*') ? 'All bots' : playerInfo.allowedBots.join(', ');
      const cmds = playerInfo.allowedCommands.includes('*') ? 'All commands' : `${playerInfo.allowedCommands.length} commands`;
      
      // Always private summary
      this.reply(username, '=== Your Permissions ===', true);
      this.reply(username, `Allowed Bots: ${bots}`, true);
      this.reply(username, `Allowed Commands: ${cmds}`, true);
      if (playerInfo.description) {
        this.reply(username, `Note: ${playerInfo.description}`, true);
      }
    });

    this.register('whitelist', (username, args, isPrivate) => {
      // Only master can manage whitelist
      if (username !== this.master) {
        this.reply(username, 'Only master can manage whitelist', isPrivate);
        return;
      }

      const subCmd = args[0]?.toLowerCase();
      
      if (subCmd === 'reload') {
        const count = this.whitelist.reload();
        this.reply(username, `Whitelist reloaded: ${count} players`, isPrivate);
      } else if (subCmd === 'list') {
        const players = Object.keys(this.whitelist.whitelist);
        if (players.length === 0) {
          this.reply(username, 'No players whitelisted', isPrivate);
        } else {
          this.reply(username, `Whitelisted players (${players.length}):`, true);
          players.forEach(p => this.reply(username, `- ${p}`, true));
        }
      } else {
        this.reply(username, 'Usage: whitelist <reload|list>', isPrivate);
      }
    });

    this.register('say', (username, args, isPrivate) => {
      const message = args.join(' ');
      if (message.length > 0) {
        // Always send to in-game chat, bypassing console override
        if (this._originalBotChat) {
          this._originalBotChat(message);
        } else {
          this.reply(username, message, isPrivate);
        }
      }
    });

    // 🧭 Movement (using centralized PathfindingUtil)
    this.register('come', async (username, args, isPrivate) => {
      if (!this.bot.pathfindingUtil) {
        this.reply(username, 'Pathfinding not available', isPrivate);
        return;
      }
      
      try {
        await this.bot.pathfindingUtil.gotoPlayer(username, 3);
        this.reply(username, `Coming to ${username}`, isPrivate);
      } catch (e) {
        this.reply(username, `Failed to come: ${e.message}`, isPrivate);
      }
    });

    this.register('goto', async (username, args, isPrivate) => {
      if (args.length < 3) {
        this.reply(username, 'Usage: goto <x> <y> <z>', isPrivate);
        return;
      }
      
      if (!this.bot.pathfindingUtil) {
        this.reply(username, 'Pathfinding not available', isPrivate);
        return;
      }
      
      const [x, y, z] = args.map(Number);
      if ([x, y, z].some(isNaN)) {
        this.reply(username, 'Invalid coordinates', isPrivate);
        return;
      }
      
      try {
        await this.bot.pathfindingUtil.goto({ x, y, z }, 30000, 'goto_command');
        this.reply(username, `Arrived at ${x}, ${y}, ${z}`, isPrivate);
      } catch (e) {
        this.reply(username, `Failed to go to location: ${e.message}`, isPrivate);
      }
    });

    this.register('follow', (username, args, isPrivate) => {
      if (!args[0]) {
        this.reply(username, 'Usage: follow <playerName>', isPrivate);
        return;
      }
      
      if (!this.bot.pathfindingUtil) {
        this.reply(username, 'Pathfinding not available', isPrivate);
        return;
      }
      
      try {
        this.bot.pathfindingUtil.followPlayer(args[0], 3);
        this.reply(username, `Following ${args[0]}`, isPrivate);
      } catch (e) {
        this.reply(username, `Failed to follow: ${e.message}`, isPrivate);
      }
    });

    this.register('stop', (username, args, isPrivate) => {
      // Stop pathfinding using utility
      if (this.bot.pathfindingUtil) {
        this.bot.pathfindingUtil.stop();
      }
      
      // Fallback: stop pathfinder directly
      if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
        this.bot.pathfinder.setGoal(null);
      }
      
      // Stop all active behaviors
      let stoppedTasks = [];
      
      if (this.behaviors.mining && this.behaviors.mining.isWorking) {
        this.behaviors.mining.stopMining();
        stoppedTasks.push('mining');
      }
      
      if (this.behaviors.farm && this.behaviors.farm.isWorking) {
        this.behaviors.farm.disable();
        stoppedTasks.push('farming');
      }
      
      if (this.behaviors.itemCollector && this.behaviors.itemCollector.isRunning) {
        this.behaviors.itemCollector.stopAuto();
        stoppedTasks.push('collection');
      }
      
      // Release all claimed blocks/areas if coordinator exists
      if (this.bot.coordinator) {
        this.bot.coordinator.cleanup();
      }
      
      const message = stoppedTasks.length > 0 
        ? `Stopped: ${stoppedTasks.join(', ')}` 
        : 'All tasks stopped';
      this.reply(username, message, isPrivate);
    });

    // 🏠 Home
    this.register('sethome', (username, args, isPrivate) => {
      if (!this.behaviors.home) {
        this.reply(username, 'Home behavior not available', isPrivate);
        return;
      }
      
      // If coordinates provided, use them
      if (args.length === 3) {
        const [x, y, z] = args.map(Number);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          this.behaviors.home.setHomeAt(x, y, z);
          this.reply(username, `Home set to: ${x}, ${y}, ${z}`, isPrivate);
          return;
        }
      }
      
      // Otherwise use current position
      if (this.behaviors.home.setHome()) {
        this.reply(username, 'Home position set!', isPrivate);
      } else {
        this.reply(username, 'Failed to set home position', isPrivate);
      }
    });

    this.register('home', async (username, args, isPrivate) => {
      if (!this.behaviors.home) {
        this.reply(username, 'Home behavior not available', isPrivate);
        return;
      }
      
      // Stop mining if in progress
      if (this.behaviors.mining && this.behaviors.mining.isWorking) {
        this.behaviors.mining.stopMining();
        this.reply(username, 'Stopping mining and going home...', isPrivate);
      } else {
        this.reply(username, 'Going home...', isPrivate);
      }
      
      const success = await this.behaviors.home.goHome();
      if (success) {
        this.reply(username, 'Arrived at home!', isPrivate);
      } else {
        this.reply(username, 'Failed to reach home', isPrivate);
      }
    });

    this.register('ishome', (username, args, isPrivate) => {
      if (!this.behaviors.home) {
        this.reply(username, 'Home behavior not available', isPrivate);
        return;
      }
      const home = this.behaviors.home.getHome();
      if (!home) {
        this.reply(username, 'No home position set. Use sethome', isPrivate);
        return;
      }
      if (this.behaviors.home.isAtHome()) {
        this.reply(username, 'Yes, I am at home!', isPrivate);
      } else {
        this.reply(username, `Home is at: ${home.x}, ${home.y}, ${home.z}`, isPrivate);
      }
    });

    // �🍗 Eat
    this.register('eat', async (username, args, isPrivate) => {
      if (!this.behaviors?.eat) {
        this.reply(username, "Eat behavior not available.", isPrivate);
        return;
      }
      try {
        await this.behaviors.eat.checkHunger();
        this.reply(username, "Checked hunger", isPrivate);
      } catch (err) {
        this.logger.error(`Error eating: ${err}`);
        this.reply(username, "Failed to eat", isPrivate);
      }
    });

    // 🛏️ Sleep
  this.register('sleep', async (_username) => {
      if (!this.behaviors.sleep) return;
      await this.behaviors.sleep.sleep();
    });

    // 🧺 Inventory
  this.register('loginv', (_username) => {
      if (!this.behaviors.inventory) return;
      this.behaviors.inventory.logInventory();
    });

    this.register('drop', async (username, args, isPrivate) => {
      if (!this.behaviors.inventory) return;

      if (!args[0]) {
        this.reply(username, "Usage: !drop <wood|ores|resources|itemName>", isPrivate);
        return;
      }

      const type = args[0].toLowerCase();
      const success = await this.behaviors.inventory.dropItem(type);
      if (success) this.reply(username, `Dropped all ${type}`, isPrivate);
      else this.reply(username, `No ${type} found to drop`, isPrivate);
    });

    // 🧱 Deposit (smart: nearest chest OR specific coordinates)
    this.register('deposit', async (username, args, isPrivate) => {
      // Usage:
      // !deposit [type] - Deposit to nearest chest
      // !deposit <x> <y> <z> [type] - Deposit to specific chest
      
      // Parse arguments: check if first 3 args are coordinates
      let x, y, z, type;
      let useCoordinates = false;
      
      if (args.length >= 3) {
        const [arg0, arg1, arg2] = args;
        const possibleX = parseInt(arg0, 10);
        const possibleY = parseInt(arg1, 10);
        const possibleZ = parseInt(arg2, 10);
        
        // If first 3 args are valid integers, treat as coordinates
        if (!isNaN(possibleX) && !isNaN(possibleY) && !isNaN(possibleZ)) {
          useCoordinates = true;
          x = possibleX;
          y = possibleY;
          z = possibleZ;
          type = (args[3] || 'all').toLowerCase();
        }
      }
      
      // If not using coordinates, first arg is the type
      if (!useCoordinates) {
        type = (args[0] || 'all').toLowerCase();
      }

      // Try DepositUtil first (nearest chest)
      if (!useCoordinates && this.bot.depositUtil) {
        this.reply(username, `Depositing ${type} to nearest chest...`, isPrivate);
        try {
          const result = await this.bot.depositUtil.depositToNearest(type, 30);
          
          if (result.success) {
            this.reply(username, `✅ Deposited ${result.depositedCount} items (${[...new Set(result.depositedItems)].join(', ')})`, isPrivate);
          } else {
            this.reply(username, `⚠️ ${result.error || 'No items deposited'}`, isPrivate);
          }
          return;
        } catch (err) {
          this.logger.error(`[Deposit] DepositUtil failed: ${err.message}`);
          this.reply(username, `Failed to deposit: ${err.message}`, isPrivate);
          return;
        }
      }
      
      // Fallback: manual coordinates using inventory behavior
      if (useCoordinates) {
        if (!this.behaviors.inventory) {
          this.reply(username, "Inventory behavior not available.", isPrivate);
          return;
        }

        this.reply(username, `Depositing ${type} to chest at (${x}, ${y}, ${z})...`, isPrivate);
        try {
          const success = await this.behaviors.inventory.depositToChest({ x, y, z }, type);
          if (success) this.reply(username, `✅ Successfully deposited ${type} items.`, isPrivate);
          else this.reply(username, `⚠️ No items deposited.`, isPrivate);
        } catch (err) {
          this.reply(username, `❌ Failed to deposit items: ${err.message}`, isPrivate);
        }
      } else {
        // No coordinates provided and DepositUtil not available
        this.reply(username, "Usage: !deposit [type] OR !deposit <x> <y> <z> [type]", isPrivate);
        this.reply(username, "Types: all, wood, ores, crops, resources, or item name", isPrivate);
      }
    });

    // 📦 Deposit all items (tries nearest chest first, then categorized chests)
  this.register('depositall', async (username, _args, _isPrivate) => {
      // Try DepositUtil first (nearest chest)
      if (this.bot.depositUtil) {
        try {
          this.reply(username, 'Depositing all items to nearest chest...', true);
          const result = await this.bot.depositUtil.depositToNearest('all', 30);
          
          if (result.success) {
            this.reply(username, `✅ Deposited ${result.depositedCount} items to nearest chest`, true);
            return;
          } else {
            this.logger.warn(`[DepositAll] DepositUtil failed: ${result.error}`);
            // Fall through to categorized deposit
          }
        } catch (err) {
          this.logger.error(`[DepositAll] DepositUtil error: ${err.message}`);
          // Fall through to categorized deposit
        }
      }
      
      // Fallback: try categorized deposit via DepositBehavior
      if (!this.depositBehavior || typeof this.depositBehavior.depositAll !== 'function') {
        this.reply(username, 'No deposit method available. Try !deposit [type] instead.', true);
        return;
      }
      
      try {
        this.reply(username, 'Trying categorized chest deposit...', true);
        await this.depositBehavior.depositAll();
        this.reply(username, 'Deposit complete.', true);
      } catch (err) {
        this.logger.error(`[DepositAll] ${err.message || err}`);
        this.reply(username, `Deposit failed: ${err.message || err}`, true);
      }
    });

    // � Item collection controls
    this.register('collect', async (username, args, isPrivate) => {
      if (!this.bot.itemCollector) {
        this.reply(username, 'Item collector not available.', isPrivate);
        return;
      }

      const sub = (args[0] || 'once').toLowerCase();
      if (sub === 'start') {
        const type = (args[1] || 'farm').toLowerCase();
        const intervalMs = Math.max(2000, Number(args[2]) || 10000);
        const radius = Math.max(2, Number(args[3]) || 8);
        this.bot.itemCollector.startAuto({ type, intervalMs, radius });
        this.reply(username, `Auto-collect started (type=${type}, every ${intervalMs}ms, radius=${radius}).`, isPrivate);
        return;
      }
      if (sub === 'stop') {
        this.bot.itemCollector.stopAuto();
        this.reply(username, 'Auto-collect stopped.', isPrivate);
        return;
      }
      // once (optional: type or radius)
      const type = (args[1] || 'farm').toLowerCase();
      const radius = Math.max(2, Number(args[2]) || 8);
      try {
        const n = await this.bot.itemCollector.collectOnce({ type, radius });
        this.reply(username, `Collected ${n} dropped items.`, isPrivate);
      } catch (e) {
        this.reply(username, `Collect failed: ${e.message || e}`, isPrivate);
      }
    });

    // 🧭 Deposit to nearest chest
    this.register('depositnearest', async (username, args, isPrivate) => {
      const type = (args[0] || 'all').toLowerCase();
      const searchRadius = args[1] ? parseInt(args[1]) : 30;
      
      if (!this.bot.depositUtil) {
        this.reply(username, "DepositUtil not available.", isPrivate);
        return;
      }

      this.reply(username, `Depositing ${type} items to nearest chest (${searchRadius}m radius)...`, isPrivate);
      try {
        const result = await this.bot.depositUtil.depositToNearest(type, searchRadius);
        
        if (result.success) {
          const uniqueItems = [...new Set(result.depositedItems)];
          this.reply(username, `✅ Deposited ${result.depositedCount} items`, isPrivate);
          if (uniqueItems.length > 0 && uniqueItems.length <= 5) {
            this.reply(username, `Items: ${uniqueItems.join(', ')}`, isPrivate);
          }
        } else {
          this.reply(username, `⚠️ ${result.error || 'No items deposited'}`, isPrivate);
        }
      } catch (err) {
        this.reply(username, `❌ Deposit failed: ${err.message}`, isPrivate);
      }
    });

    // 📦 Set Chest (auto & manual)
    this.register('setchest', async (username, args, isPrivate) => {
      if (args.length < 1) {
        this.reply(username, 'Usage: !setchest <category> [x y z]', isPrivate);
        return;
      }
      const category = args[0].toLowerCase();

      let x, y, z;
      if (args.length >= 4) {
        // manual coordinates provided
        [x, y, z] = args.slice(1, 4).map(Number);
        if ([x, y, z].some(n => Number.isNaN(n))) {
          this.reply(username, 'Invalid coordinates. Use integers: !setchest <category> x y z', isPrivate);
          return;
        }
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      } else {
        // fallback: use player's current position (floored)
        const player = this.bot.players[username];
        if (!player || !player.entity) {
          this.reply(username, "Couldn't find your player entity. Provide coords: !setchest <category> x y z", isPrivate);
          return;
        }
        const pos = player.entity.position;
        x = Math.floor(pos.x); y = Math.floor(pos.y); z = Math.floor(pos.z);
      }

      try {
        await this.chestRegistry.setChest(category, { x, y, z });
        this.reply(username, `Saved chest "${category}" at ${x},${y},${z}`, isPrivate);
        this.logger.info(`[SetChest] ${username} -> ${category} @ ${x},${y},${z}`);
      } catch (err) {
        this.logger.error(`[SetChest] Failed to save chest ${category}: ${err}`);
        this.reply(username, `Failed to save chest: ${err.message || err}`, isPrivate);
      }
    });

    // 👀 Look behavior toggle
    this.register('look', (username, args, isPrivate) => {
      const lookBehavior = this.behaviors.look;
      if (!lookBehavior) {
        this.reply(username, "LookBehavior is not available.", isPrivate);
        return;
      }

      if (args[0]) {
        const action = args[0].toLowerCase();
        if (action === 'on') {
          lookBehavior.enable();
          this.reply(username, 'LookBehavior enabled.', isPrivate);
        } else if (action === 'off') {
          lookBehavior.disable();
          this.reply(username, 'LookBehavior disabled.', isPrivate);
        } else {
          this.reply(username, 'Usage: !look <on|off>', isPrivate);
        }
      } else {
        if (lookBehavior.enabled) {
          lookBehavior.disable();
          this.reply(username, 'LookBehavior disabled.', isPrivate);
        } else {
          lookBehavior.enable();
          this.reply(username, 'LookBehavior enabled.', isPrivate);
        }
      }
    });

    // 📐 Set Area (modular for farm, quarry, lumber, etc.)
    this.register('setarea', async (username, args, isPrivate) => {
      if (!this.bot.areaRegistry) {
        this.reply(username, "Area registry not available", isPrivate);
        return;
      }

      if (args.length < 2) {
        this.reply(username, "Usage: !setarea <type> <start|end|clear> [x y z]", isPrivate);
  this.reply(username, 'Types: farm, quarry, lumber', isPrivate);
  this.reply(username, 'Example: !setarea farm start', isPrivate);
        return;
      }

      const type = args[0].toLowerCase();
      const action = args[1].toLowerCase();

      if (action === 'clear') {
        try {
          await this.bot.areaRegistry.deleteArea(type);
          this.reply(username, `Cleared ${type} area`, isPrivate);
          // Also clear behavior-specific cache if present
          if (type === 'farm' && this.behaviors.farm) {
            this.behaviors.farm.farmingArea = null;
          }
        } catch (e) {
          this.reply(username, `Failed to clear area: ${e.message}`, isPrivate);
        }
        return;
      }

      if (!['start', 'end'].includes(action)) {
  this.reply(username, "Action must be 'start', 'end', or 'clear'", isPrivate);
        return;
      }

      let x, y, z;
      if (args.length >= 5) {
        // Manual coordinates
        [x, y, z] = args.slice(2, 5).map(Number);
        if ([x, y, z].some(n => Number.isNaN(n))) {
          this.reply(username, 'Invalid coordinates', isPrivate);
          return;
        }
      } else {
        // Use player's position
        const player = this.bot.players[username];
        if (!player || !player.entity) {
          this.bot.chat("Stand at the corner or provide coords: !setarea <type> <start|end> x y z");
          return;
        }
        const pos = player.entity.position;
        x = pos.x; y = pos.y; z = pos.z;
      }

      try {
        const result = await this.bot.areaRegistry.setCorner(type, action, { x, y, z });
        
        if (result.completed) {
          const dims = this.bot.areaRegistry.calculateDimensions(result.area);
          this.bot.chat(`✅ ${type} area set: ${dims.width}x${dims.height}x${dims.depth} (${dims.volume} blocks)`);
          
          // Update behavior-specific cache
          if (type === 'farm' && this.behaviors.farm) {
            this.behaviors.farm.farmingArea = result.area;
          }
        } else {
          this.bot.chat(`Set ${type} ${action} corner at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}). Now set the ${action === 'start' ? 'end' : 'start'} corner.`);
        }
      } catch (e) {
        this.bot.chat(`Failed to set area: ${e.message}`);
      }
    });

  // 🌾 Farming Commands
    this.register('farm', async (username, args, isPrivate) => {
        if (!this.behaviors.farm) {
            this.reply(username, "Farming behavior not available", isPrivate);
            return;
        }

        const subCommand = args[0]?.toLowerCase();
        // Group management subcommands (manager only, leader only)
        if (['add','remove','group'].includes(subCommand)) {
          if (!this.bot.manager) { this.reply(username, 'Group management requires manager active.', isPrivate); return; }
            const leader = this.bot.manager.getLeader?.()?.name;
            if (leader && leader.toLowerCase() !== this.bot.username.toLowerCase()) { this.reply(username, `Leader is ${leader}; only leader can manage farm group.`, isPrivate); return; }
          if (subCommand === 'group') {
            const group = this.bot.coordinator?.getGroup('farm') || [];
            this.reply(username, `Farm group (${group.length}): ${group.join(', ') || 'none'}`, isPrivate);
            return;
          }
          const namePattern = /^[a-zA-Z0-9_-]+$/;
          const targetsRaw = args.slice(1);
          const targets = targetsRaw.filter(n => namePattern.test(n));
          if (!targets.length) { this.reply(username, `Usage: !farm ${subCommand} <bot1> [bot2...]`, isPrivate); return; }
          const rejected = targetsRaw.filter(n => !namePattern.test(n));
          if (rejected.length) this.reply(username, `Ignored invalid: ${rejected.join(', ')}`, isPrivate);
          const payload = { type: 'farm-command', action: subCommand === 'add' ? 'add' : 'remove', bots: targets };
          this.bot.manager.sendBotMessage(this.bot.username, null, payload);
          // Confirmation will come after manager redistributes; show immediate intent
          const group = this.bot.coordinator?.getGroup('farm') || [];
          this.reply(username, `${subCommand === 'add' ? 'Adding' : 'Removing'} farm bots: ${targets.join(', ')} (prev size ${group.length})`, isPrivate);
          return;
        }

        // Parse optional -b N flag (bot count) from args for 'start'
        let requestedBots = 1;
        if (subCommand === 'start') {
          // Look for pattern -b <number>
          const bIndex = args.findIndex(a => /^-b$/i.test(a));
          if (bIndex !== -1 && args[bIndex + 1]) {
            const n = parseInt(args[bIndex + 1], 10);
            if (Number.isFinite(n) && n > 0) requestedBots = Math.min(n, 20); // safety cap
          }
        }

        // Helper: broadcast manager message instructing farm start/stop to specific bot list
        const sendManagerFarmCommand = (action, botNames) => {
          if (!this.bot.manager) return false;
          const payload = { type: 'farm-command', action, bots: botNames };
          // send as broadcast; individual bots will filter
          this.bot.manager.sendBotMessage(this.bot.username, null, payload);
          return true;
        };

        switch (subCommand) {
            case 'start':
                // Manager-coordinated multi-bot start
                if (this.bot.manager) {
                  const leader = this.bot.manager.getLeader?.()?.name;
                  if (leader && leader.toLowerCase() !== this.bot.username.toLowerCase()) {
                    // Non-leader: ignore and let leader coordinate
                    this.logger.info(`[${this.bot.username}] Deferring farm start to leader ${leader}`);
                    break;
                  }
                  // Determine candidate bots (online workers)
                  const workers = this.bot.manager.getWorkers().filter(w => w.online);
                  if (workers.length === 0) {
                    this.reply(username, 'No online bots available for farming', isPrivate);
                    break;
                  }
                  // Use manager idle predicate instead of peeking into behaviors
                  const idleBots = workers.filter(w => {
                    try { return this.bot.manager.isWorkerIdle(w.name); } catch (_) { return true; }
                  });
                  if (idleBots.length === 0) {
                    this.reply(username, 'All bots already farming', isPrivate);
                    break;
                  }
                  const selected = idleBots.slice(0, requestedBots).map(w => w.name);
                  // Verify area exists before broadcasting
                  const area = await this.bot.areaRegistry?.getArea('farm').catch(() => null);
                  if (!area) {
                    this.reply(username, 'No farm area set. Use !setarea farm start/end first.', isPrivate);
                    break;
                  }
                  sendManagerFarmCommand('start', selected);

                  // Wait briefly for farm-status responses and summarize
                  const results = await this._collectFarmStatus(1500, selected);
                  const ok = results.filter(r => r.success).map(r => r.bot);
                  const fail = results.filter(r => !r.success).map(r => `${r.bot}${r.code ? `(${r.code})` : ''}`);
                  if (ok.length) this.reply(username, `Farming started: ${ok.join(', ')}`, isPrivate);
                  if (fail.length) this.reply(username, `Failed/ignored: ${fail.join(', ')}`, isPrivate);
                  if (!ok.length && !fail.length) this.reply(username, `Requested farming start for ${selected.length} bot(s): ${selected.join(', ')} (pending)`, isPrivate);
                  break;
                }
                // Single bot fallback (no manager)
                if (!this.behaviors.farm.farmingArea && this.bot.areaRegistry) {
                  this.behaviors.farm.farmingArea = await this.bot.areaRegistry.getArea('farm');
                }
                if (!this.behaviors.farm.farmingArea) {
                  this.bot.chat('No farming area set! Use !setarea farm start/end');
                  break;
                }
                if (!this.behaviors.farm.enabled && typeof this.behaviors.farm.enable === 'function') {
                  this.behaviors.farm.enable();
                }
                this.bot.chat('Starting farming routine (single bot mode)...');
                await this.behaviors.farm.startFarming(this.behaviors.farm.farmingArea);
                break;

            case 'stop':
                if (this.bot.manager) {
                  const leader = this.bot.manager.getLeader?.()?.name;
                  if (leader && leader.toLowerCase() !== this.bot.username.toLowerCase()) {
                    this.logger.info(`[${this.bot.username}] Deferring farm stop to leader ${leader}`);
                    break;
                  }
                  // Manager broadcast stop for all bots or targeted ones (optional: parse names after 'stop')
                  const targetNames = args.slice(1).filter(a => /^[a-zA-Z0-9_]+$/.test(a));
                  sendManagerFarmCommand('stop', targetNames.length ? targetNames : null);
                  // Briefly collect stop acknowledgements
                  const expected = targetNames.length ? targetNames : this.bot.manager.getWorkers().filter(w=>w.online).map(w=>w.name);
                  const results = await this._collectFarmStatus(1000, expected);
                  const stopped = results.filter(r => r.success && r.code === 'stopped').map(r => r.bot);
                  if (stopped.length) this.reply(username, `Stopped: ${stopped.join(', ')}`, isPrivate);
                  else this.reply(username, `Requested farming stop${targetNames.length ? ' for ' + targetNames.join(', ') : ' (all bots)'}`, isPrivate);
                  break;
                }
                this.behaviors.farm.isWorking = false;
                this.behaviors.farm.disable();
                if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
                  this.bot.pathfinder.setGoal(null);
                }
                this.bot.chat('Stopped farming');
                break;

            default:
                this.bot.chat('Usage: !farm <start|stop> [-b N]');
                this.bot.chat('Set area first: !setarea farm start, then !setarea farm end');
                this.bot.chat('Default assigns 1 bot; use -b N with manager for multi-bot');
        }
    });

    // Internal helper: aggregate farm-status messages for a short window
    this._collectFarmStatus = (timeoutMs, expectedBots=[]) => {
      return new Promise((resolve) => {
        const results = [];
        const timer = setTimeout(() => {
          cleanup();
          resolve(results);
        }, Math.max(300, timeoutMs || 1000));

        const handler = (msg) => {
          try {
            const p = msg?.payload || {};
            if (p.type !== 'farm-status') return;
            const bot = msg.from;
            if (expectedBots.length && !expectedBots.map(b => b.toLowerCase()).includes(String(bot).toLowerCase())) return;
            results.push({ bot, success: !!p.success, code: p.code });
          } catch (_) {}
        };

        const mgr = this.bot.manager;
        if (!mgr) return resolve([]);
        mgr.on('botMessage', handler);
        const cleanup = () => {
          try { mgr.off('botMessage', handler); } catch (_) {}
          clearTimeout(timer);
        };
      });
    };

    // 🪓 Woodcutting Commands
    this.register('wood', async (username, args, isPrivate) => {
        if (!this.behaviors.woodcutting) {
            this.reply(username, "Woodcutting behavior not available", isPrivate);
            return;
        }

        const subCommand = args[0]?.toLowerCase();
        if (['add','remove','group'].includes(subCommand)) {
          if (!this.bot.manager) { this.reply(username, 'Group management requires manager active.', isPrivate); return; }
          const leader = this.bot.manager.getLeader?.()?.name;
          if (leader && leader.toLowerCase() !== this.bot.username.toLowerCase()) { this.reply(username, `Leader is ${leader}; only leader can manage wood group.`, isPrivate); return; }
          if (subCommand === 'group') {
            const group = this.bot.coordinator?.getGroup('wood') || [];
            this.reply(username, `Wood group (${group.length}): ${group.join(', ') || 'none'}`, isPrivate);
            return;
          }
          const namePattern = /^[a-zA-Z0-9_-]+$/;
          const targetsRaw = args.slice(1);
          const targets = targetsRaw.filter(n => namePattern.test(n));
          if (!targets.length) { this.reply(username, `Usage: !wood ${subCommand} <bot1> [bot2...]`, isPrivate); return; }
          const rejected = targetsRaw.filter(n => !namePattern.test(n));
          if (rejected.length) this.reply(username, `Ignored invalid: ${rejected.join(', ')}`, isPrivate);
          const payload = { type: 'wood-command', action: subCommand === 'add' ? 'add' : 'remove', bots: targets };
          this.bot.manager.sendBotMessage(this.bot.username, null, payload);
          const group = this.bot.coordinator?.getGroup('wood') || [];
          this.reply(username, `${subCommand === 'add' ? 'Adding' : 'Removing'} wood bots: ${targets.join(', ')} (prev size ${group.length})`, isPrivate);
          return;
        }

        switch (subCommand) {
            case 'start':
                // Check if area is set
                let woodcuttingArea = null;
                if (this.bot.areaRegistry) {
                    woodcuttingArea = await this.bot.areaRegistry.getArea('wood');
                }
                
                if (woodcuttingArea) {
                    this.bot.chat(`Starting woodcutting in designated area...`);
                } else {
                    this.bot.chat("No woodcutting area set - will search for nearest trees");
                }
                
                // Enable behavior and start
                if (!this.behaviors.woodcutting.enabled && typeof this.behaviors.woodcutting.enable === 'function') {
                    this.behaviors.woodcutting.enable();
                }
                
                await this.behaviors.woodcutting.startWoodcutting(woodcuttingArea);
                break;

            case 'stop':
                // Force stop woodcutting
                this.behaviors.woodcutting.isWorking = false;
                this.behaviors.woodcutting.disable();
                
                // Stop pathfinder
                if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
                    this.bot.pathfinder.setGoal(null);
                }
                
                this.bot.chat("Stopped woodcutting");
                break;

            default:
                this.bot.chat("Usage: !wood <start|stop>");
                this.bot.chat("Optional: Set area with !setarea wood start/end");
                this.bot.chat("Without area, bot will find nearest trees");
        }
    });

    // 🌲 Woodcutting Commands (manager-aware)
    this.register('wood', async (username, args, isPrivate) => {
        if (!this.behaviors.woodcutting) {
            this.reply(username, "Woodcutting behavior not available", isPrivate);
            return;
        }

        const sub = (args[0] || '').toLowerCase();

        // Manager-coordinated: !wood start|stop [-b N]
        if (sub === 'start' || sub === 'stop') {
          const action = sub;
          let requestedBots = 1;
          if (action === 'start') {
            const bIndex = args.findIndex(a => /^-b$/i.test(a));
            if (bIndex !== -1 && args[bIndex + 1]) {
              const n = parseInt(args[bIndex + 1], 10);
              if (Number.isFinite(n) && n > 0) requestedBots = Math.min(n, 20);
            }
          }

          // helper to broadcast wood-command
          const sendManagerWoodCommand = (action, botNames) => {
            if (!this.bot.manager) return false;
            const payload = { type: 'wood-command', action, bots: botNames };
            this.bot.manager.sendBotMessage(this.bot.username, null, payload);
            return true;
          };

          // status aggregation
          const collectWoodStatus = (timeoutMs, expectedBots=[]) => new Promise(resolve => {
            const results = [];
            const timer = setTimeout(() => { cleanup(); resolve(results); }, Math.max(300, timeoutMs || 1000));
            const handler = (msg) => {
              try {
                const p = msg?.payload || {};
                if (p.type !== 'wood-status') return;
                const bot = msg.from;
                if (expectedBots.length && !expectedBots.map(b => b.toLowerCase()).includes(String(bot).toLowerCase())) return;
                results.push({ bot, success: !!p.success, code: p.code });
              } catch (_) {}
            };
            const mgr = this.bot.manager; if (!mgr) return resolve([]);
            mgr.on('botMessage', handler);
            const cleanup = () => { try { mgr.off('botMessage', handler); } catch (_) {} clearTimeout(timer); };
          });

          if (this.bot.manager) {
            const leader = this.bot.manager.getLeader?.()?.name;
            if (leader && leader.toLowerCase() !== this.bot.username.toLowerCase()) {
              this.logger.info(`[${this.bot.username}] Deferring wood ${action} to leader ${leader}`);
              return;
            }
            const workers = this.bot.manager.getWorkers().filter(w=>w.online);
            if (action === 'start') {
              if (workers.length === 0) { this.reply(username, 'No online bots available for woodcutting', isPrivate); return; }
              const idleBots = workers.filter(w => { try { return this.bot.manager.isWorkerIdle(w.name); } catch (_) { return true; } });
              if (idleBots.length === 0) { this.reply(username, 'All bots are busy', isPrivate); return; }
              // Preflight area
              const area = await this.bot.areaRegistry?.getArea('wood').catch(()=>null);
              if (!area) { this.reply(username, 'No woodcutting area set. Use !setarea wood start/end first.', isPrivate); return; }
              const selected = idleBots.slice(0, requestedBots).map(w=>w.name);
              sendManagerWoodCommand('start', selected);
              const results = await collectWoodStatus(1500, selected);
              const ok = results.filter(r => r.success).map(r => r.bot);
              const fail = results.filter(r => !r.success).map(r => `${r.bot}${r.code ? `(${r.code})` : ''}`);
              if (ok.length) this.reply(username, `Woodcutting started: ${ok.join(', ')}`, isPrivate);
              if (fail.length) this.reply(username, `Failed/ignored: ${fail.join(', ')}`, isPrivate);
              if (!ok.length && !fail.length) this.reply(username, `Requested woodcutting start for ${selected.join(', ')}`, isPrivate);
              return;
            } else {
              const targetNames = args.slice(1).filter(a => /^[a-zA-Z0-9_]+$/.test(a));
              sendManagerWoodCommand('stop', targetNames.length ? targetNames : null);
              const expected = targetNames.length ? targetNames : this.bot.manager.getWorkers().filter(w=>w.online).map(w=>w.name);
              const results = await collectWoodStatus(1000, expected);
              const stopped = results.filter(r => r.success && r.code === 'stopped').map(r => r.bot);
              if (stopped.length) this.reply(username, `Stopped: ${stopped.join(', ')}`, isPrivate);
              else this.reply(username, `Requested woodcutting stop${targetNames.length ? ' for ' + targetNames.join(', ') : ' (all bots)'}`, isPrivate);
              return;
            }
          }

          // No manager: local single-bot
          let woodcuttingArea = null;
          if (this.bot.areaRegistry) woodcuttingArea = await this.bot.areaRegistry.getArea('wood');
          if (woodcuttingArea) this.bot.chat(`Starting woodcutting in designated area...`);
          else this.bot.chat('No woodcutting area set - will search for nearest trees');
          if (!this.behaviors.woodcutting.enabled && typeof this.behaviors.woodcutting.enable === 'function') this.behaviors.woodcutting.enable();
          await this.behaviors.woodcutting.startWoodcutting(woodcuttingArea);
          return;
        }

        // Legacy wood commands (fallback)
        switch (sub) {
          case 'start': // handled above
          case 'stop': // handled above
            break;
          default:
            this.bot.chat("Usage: !wood <start|stop> [-b N]");
            this.bot.chat("Optional: Set area with !setarea wood start/end");
            this.bot.chat("Leader will coordinate multiple bots if manager is active");
        }
    });

    // ⛏️ Mining Commands
  this.register('mine', async (username, args, _isPrivate) => {
        if (!this.behaviors.mining) {
            this.bot.chat("Mining behavior not available");
            return;
        }

        // New protocol: !mine <mode> start|stop [-b N] [params]
        const maybeMode = (args[0] || '').toLowerCase();
        const maybeAction = (args[1] || '').toLowerCase();
  const isNewProtocol = ['start', 'stop','group'].includes(maybeAction) && ['strip','tunnel','quarry','vein'].includes(maybeMode);

        // === Quarry group summary ===
        // Syntax: !mine quarry group
        if (maybeMode === 'quarry' && maybeAction === 'group') {
          const group = this.bot.coordinator?.getGroup('quarry') || [];
          this.bot.chat(`Quarry group (${group.length}): ${group.join(', ') || 'none'}`);
          return;
        }

        // === Quarry dynamic group add/remove ===
        // Syntax: !mine quarry add <bot1> [bot2...]
        //         !mine quarry remove <bot1> [bot2...]
        // Works only when BotManager (multi-bot) is active. Recomputes zones without stopping.
        if (maybeMode === 'quarry' && ['add','remove'].includes(maybeAction)) {
          if (!this.bot.manager) {
            this.bot.chat('Quarry add/remove requires manager (multi-bot mode)');
            return;
          }
          const leader = this.bot.manager.getLeader?.()?.name;
          if (leader && leader.toLowerCase() !== this.bot.username.toLowerCase()) {
            this.bot.chat(`Leader is ${leader}; only leader can quarry ${maybeAction}.`);
            this.logger.info(`[${this.bot.username}] Deferring quarry ${maybeAction} to leader ${leader}`);
            return; // only leader issues group updates
          }
          // Allow letters, digits, underscore, hyphen in bot names (e.g., Subject_9-17)
          const namePattern = /^[a-zA-Z0-9_-]+$/;
          const targetBotsRaw = args.slice(2);
          const targetBots = targetBotsRaw.filter(b => namePattern.test(b));
          const rejected = targetBotsRaw.filter(b => !namePattern.test(b));
          if (!targetBots.length) {
            this.bot.chat(`Usage: !mine quarry ${maybeAction} <bot1> [bot2...]`);
            return;
          }
          if (rejected.length) {
            this.bot.chat(`Ignored invalid bot name(s): ${rejected.join(', ')}`);
          }
          // Optionally verify names exist in manager registry
          const knownNames = new Set(this.bot.manager.getWorkers().map(w => w.name));
          const unknown = targetBots.filter(n => !knownNames.has(n));
          if (unknown.length) {
            this.bot.chat(`Warning: unknown bot(s) ${unknown.join(', ')} (will attempt anyway)`);
          }
          // Determine area + depth: prefer stored lastQuarryArea, else registry 'quarry' area
          let area = this.bot.lastQuarryArea || null;
          try {
            if (!area && this.bot.areaRegistry) area = await this.bot.areaRegistry.getArea('quarry');
          } catch (_) {}
          if (!area || !area.start || !area.end) {
            this.bot.chat('No quarry area known. Start a quarry first or set area with !setarea quarry');
            return;
          }
          const depth = Number.isFinite(this.bot.lastQuarryDepth) ? this.bot.lastQuarryDepth : 5;
          const x1 = Math.floor(area.start.x); const z1 = Math.floor(area.start.z);
          const x2 = Math.floor(area.end.x);   const z2 = Math.floor(area.end.z);
          const rawArgs = [x1, z1, x2, z2, depth];
          // Broadcast add/remove payload; MessageHandler will recompute and send targeted starts
          try {
            const payload = { type: 'mine-command', action: maybeAction, mode: 'quarry', bots: targetBots, rawArgs };
            this.bot.manager.sendBotMessage(this.bot.username, null, payload);
            this.bot.chat(`${maybeAction === 'add' ? 'Adding' : 'Removing'} quarry bots: ${targetBots.join(', ')}`);
          } catch (e) {
            this.bot.chat(`Failed to ${maybeAction} bots: ${e.message || e}`);
          }
          return;
        }

        // Helper: broadcast manager message for mining
        const sendManagerMineCommand = (action, botNames, mode, rawArgs) => {
          if (!this.bot.manager) return false;
          const payload = { type: 'mine-command', action, mode, rawArgs, bots: botNames };
          this.bot.manager.sendBotMessage(this.bot.username, null, payload);
          return true;
        };

        // Mining status aggregation (similar to farm)
        const collectMineStatus = (timeoutMs, expectedBots=[]) => {
          return new Promise((resolve) => {
            const results = [];
            const timer = setTimeout(() => { cleanup(); resolve(results); }, Math.max(300, timeoutMs || 1000));
            const handler = (msg) => {
              try {
                const p = msg?.payload || {};
                if (p.type !== 'mine-status') return;
                const bot = msg.from;
                if (expectedBots.length && !expectedBots.map(b => b.toLowerCase()).includes(String(bot).toLowerCase())) return;
                results.push({ bot, success: !!p.success, code: p.code });
              } catch (_) {}
            };
            const mgr = this.bot.manager; if (!mgr) return resolve([]);
            mgr.on('botMessage', handler);
            const cleanup = () => { try { mgr.off('botMessage', handler); } catch (_) {} clearTimeout(timer); };
          });
        };

        if (isNewProtocol) {
          const mode = maybeMode;
          const action = maybeAction;

          // Parse -b N for manager case
          let requestedBots = 1;
          const bIndex = args.findIndex(a => /^-b$/i.test(a));
          if (bIndex !== -1 && args[bIndex + 1]) {
            const n = parseInt(args[bIndex + 1], 10); if (Number.isFinite(n) && n > 0) requestedBots = Math.min(n, 20);
          }
          // Strip flags from params
          const params = args.slice(2).filter((a, i) => !(i === bIndex - 2 || i === bIndex - 1));

          // Manager-coordinated path
          if (this.bot.manager) {
            const leader = this.bot.manager.getLeader?.()?.name;
            if (leader && leader.toLowerCase() !== this.bot.username.toLowerCase()) {
              this.logger.info(`[${this.bot.username}] Deferring mine ${action} to leader ${leader}`);
              return;
            }
            const workers = this.bot.manager.getWorkers().filter(w => w.online);
            if (action === 'start') {
              if (workers.length === 0) { this.bot.chat('No online bots available for mining'); return; }
              const idleBots = workers.filter(w => { try { return this.bot.manager.isWorkerIdle(w.name); } catch (_) { return true; } });
              if (idleBots.length === 0) { this.bot.chat('All bots are busy'); return; }
              const selected = idleBots.slice(0, requestedBots).map(w => w.name);

              // Quarry: support runtime add/remove and targeted messages
              if (mode === 'quarry') {
                // Expect params: x1 z1 x2 z2 depth
                if (params.length < 5) { this.bot.chat('Usage: !mine quarry start [-b N] <x1> <z1> <x2> <z2> <depth>'); return; }
                const x1 = parseInt(params[0]); const z1 = parseInt(params[1]);
                const x2 = parseInt(params[2]); const z2 = parseInt(params[3]);
                const depth = parseInt(params[4]) || 5;
                if (![x1,z1,x2,z2].every(Number.isFinite)) { this.bot.chat('Invalid quarry coordinates'); return; }

                // Build an area and try coordinator division if available
                const y = Math.floor(this.bot.entity?.position?.y || 64);
                const area = { start: { x: x1, y, z: z1 }, end: { x: x2, y, z: z2 } };
                // Persist for dynamic add/remove commands
                try { this.bot.lastQuarryArea = area; this.bot.lastQuarryDepth = depth; } catch (_) {}
                let zones = [];
                try {
                  if (this.bot.coordinator) zones = this.bot.coordinator.divideArea(area, selected.length, this.bot.username) || [];
                } catch (_) { zones = []; }
                if (!zones.length) {
                  // Fallback manual split along longer axis
                  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
                  const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
                  const width = maxX - minX + 1; const depthZ = maxZ - minZ + 1;
                  if (width >= depthZ) {
                    const zoneW = Math.ceil(width / selected.length);
                    for (let i=0;i<selected.length;i++) {
                      const zx1 = minX + i*zoneW; const zx2 = Math.min(zx1 + zoneW - 1, maxX);
                      zones.push({ start: { x: zx1, y, z: minZ }, end: { x: zx2, y, z: maxZ } });
                    }
                  } else {
                    const zoneD = Math.ceil(depthZ / selected.length);
                    for (let i=0;i<selected.length;i++) {
                      const zz1 = minZ + i*zoneD; const zz2 = Math.min(zz1 + zoneD - 1, maxZ);
                      zones.push({ start: { x: minX, y, z: zz1 }, end: { x: maxX, y, z: zz2 } });
                    }
                  }
                }

                // Update coordinator group for quarry and recompute/assign zones centrally
                try {
                  if (this.bot.coordinator) {
                    // set the group so coordinator can track it
                    this.bot.coordinator.groupRegistry.set('quarry', selected.slice());
                    const assignments = this.bot.coordinator.recomputeAndAssignZones('quarry', area, selected);
                    // send per-bot start with assigned zone
                    for (const a of assignments) {
                      const payload = { type: 'mine-command', action: 'start', mode: 'quarry', rawArgs: [a.zone.start.x, a.zone.start.z, a.zone.end.x, a.zone.end.z, depth] };
                      try { this.bot.manager.sendBotMessage(this.bot.username, a.botId, payload); } catch (_) {}
                    }
                  } else {
                    // no coordinator: fallback to targeted sends
                    for (let i=0;i<selected.length;i++) {
                      const name = selected[i];
                      const zone = zones[i] || area;
                      const zx1 = zone.start.x, zz1 = zone.start.z, zx2 = zone.end.x, zz2 = zone.end.z;
                      const payload = { type: 'mine-command', action: 'start', mode, rawArgs: [zx1, zz1, zx2, zz2, depth] };
                      this.bot.manager.sendBotMessage(this.bot.username, name, payload);
                    }
                  }
                } catch (_) {}
              } else {
                // Other modes: broadcast one payload to all selected
                sendManagerMineCommand('start', selected, mode, params);
              }
              const results = await collectMineStatus(1500, selected);
              const ok = results.filter(r => r.success).map(r => r.bot);
              const fail = results.filter(r => !r.success).map(r => `${r.bot}${r.code ? `(${r.code})` : ''}`);
              if (ok.length) this.bot.chat(`Mining started (${mode}): ${ok.join(', ')}`);
              if (fail.length) this.bot.chat(`Failed/ignored: ${fail.join(', ')}`);
              if (!ok.length && !fail.length) this.bot.chat(`Requested mining start for ${selected.join(', ')} (${mode})`);
              return;
            } else if (action === 'stop') {
              const targetNames = args.slice(2).filter(a => /^[a-zA-Z0-9_]+$/.test(a));
              sendManagerMineCommand('stop', targetNames.length ? targetNames : null, mode, []);
              const expected = targetNames.length ? targetNames : this.bot.manager.getWorkers().filter(w=>w.online).map(w=>w.name);
              const results = await collectMineStatus(1000, expected);
              const stopped = results.filter(r => r.success && r.code === 'stopped').map(r => r.bot);
              if (stopped.length) this.bot.chat(`Stopped mining: ${stopped.join(', ')}`);
              else this.bot.chat(`Requested mining stop${targetNames.length ? ' for ' + targetNames.join(', ') : ' (all bots)'}`);
              return;
            }
          }

          // No manager: execute locally based on mode
          try {
            if (!this.behaviors.mining.enabled && typeof this.behaviors.mining.enable === 'function') this.behaviors.mining.enable();
            switch (mode) {
              case 'strip': {
                const direction = params[0] || 'east';
                const mainLength = parseInt(params[1]) || 100;
                const numBranches = parseInt(params[2]) || 10;
                const startPos = this.bot.entity.position.floored();
                await this.behaviors.mining.startStripMining(startPos, direction, mainLength, numBranches);
                this.bot.chat('Strip mining complete!');
                break;
              }
              case 'tunnel': {
                const direction = params[0] || 'east';
                const length = parseInt(params[1]) || 100;
                const width = params[2] !== undefined ? parseInt(params[2]) : null;
                const height = params[3] !== undefined ? parseInt(params[3]) : null;
                const startPos = this.bot.entity.position.floored();
                await this.behaviors.mining.startTunnel(startPos, direction, length, Number.isFinite(width)?width:null, Number.isFinite(height)?height:null);
                this.bot.chat('Tunnel complete!');
                break;
              }
              case 'quarry': {
                const x1 = parseInt(params[0]); const z1 = parseInt(params[1]); const x2 = parseInt(params[2]); const z2 = parseInt(params[3]); const depth = parseInt(params[4]) || 5;
                const y = Math.floor(this.bot.entity.position.y);
                const corner1 = new (await import('vec3')).Vec3(x1, y, z1);
                const corner2 = new (await import('vec3')).Vec3(x2, y, z2);
                // Persist for potential future add/remove (single-bot mode mostly irrelevant but keep consistent)
                try { this.bot.lastQuarryArea = { start: { x: x1, y, z: z1 }, end: { x: x2, y, z: z2 } }; this.bot.lastQuarryDepth = depth; } catch (_) {}
                await this.behaviors.mining.startQuarry(corner1, corner2, depth);
                this.bot.chat('Quarry complete!');
                break;
              }
              case 'vein': {
                const radius = params[0] !== undefined ? parseInt(params[0]) : null;
                const result = await this.behaviors.mining.startContinuousVeinMining(radius);
                if (result.success) this.bot.chat(`Vein mining complete! ${result.totalOresMined} ores mined`);
                else this.bot.chat(`Vein mining stopped: ${result.error || 'Unknown error'}`);
                break;
              }
              case 'stop': {
                this.behaviors.mining.stopMining();
                this.behaviors.mining.disable();
                if (this.bot.pathfinder?.setGoal) this.bot.pathfinder.setGoal(null);
                this.bot.chat('Stopped mining');
                break;
              }
            }
          } catch (e) {
            this.logger.error(`[ChatCommandHandler] Mine ${mode} error: ${e.message || e}`);
            this.bot.chat(`Mining error: ${e.message || 'Unknown error'}`);
          }
          return;
        }

        const sub = (args[0] || '').toLowerCase();

        try {
            switch (sub) {
                case 'strip': {
                    // !mine strip <direction> <mainLength> <numBranches>
                    // Example: !mine strip east 100 10
                    const direction = args[1] || 'east';
                    const mainLength = parseInt(args[2]) || 100;
                    const numBranches = parseInt(args[3]) || 10;
                    
                    this.bot.chat(`Starting strip mine: ${direction}, ${mainLength}m, ${numBranches} branches`);
                    
                    if (!this.behaviors.mining.enabled && typeof this.behaviors.mining.enable === 'function') {
                        this.behaviors.mining.enable();
                    }
                    
                    const startPos = this.bot.entity.position.floored();
                    await this.behaviors.mining.startStripMining(startPos, direction, mainLength, numBranches);
                    this.bot.chat("Strip mining complete!");
                    break;
                }
                
                case 'tunnel': {
                  // !mine tunnel <direction> <length> [width] [height]
                  // Examples: !mine tunnel north 50
                  //           !mine tunnel south 30 4 3
                  const direction = args[1] || 'east';
                  const length = parseInt(args[2]) || 100;
                  const widthArg = args[3];
                  const heightArg = args[4];
                  const width = widthArg !== undefined ? parseInt(widthArg) : null;
                  const height = heightArg !== undefined ? parseInt(heightArg) : null;

                  const dimsText = (Number.isFinite(width) && Number.isFinite(height))
                    ? `, ${width}x${height}`
                    : '';
                  this.bot.chat(`Starting tunnel: ${direction}, ${length}m${dimsText}`);

                  if (!this.behaviors.mining.enabled && typeof this.behaviors.mining.enable === 'function') {
                    this.behaviors.mining.enable();
                  }

                  const startPos = this.bot.entity.position.floored();
                  await this.behaviors.mining.startTunnel(startPos, direction, length, Number.isFinite(width) ? width : null, Number.isFinite(height) ? height : null);
                  this.bot.chat("Tunnel complete!");
                  break;
                }
                
                case 'quarry': {
                    // !mine quarry <x1> <z1> <x2> <z2> <depth>
                    // Example: !mine quarry 100 200 120 220 10
                    // Digs a rectangular area from (x1,z1) to (x2,z2), going down 10 layers
                    
                    this.logger.info(`[Mine] Quarry command - args: [${args.join(', ')}]`);
                    
                    if (args.length < 6) {
                        this.bot.chat("Usage: !mine quarry <x1> <z1> <x2> <z2> <depth>");
                        this.bot.chat("Example: !mine quarry 100 200 120 220 10");
                        this.logger.info(`[Mine] Quarry failed - not enough args (${args.length}/6)`);
                        break;
                    }
                    
                    const x1 = parseInt(args[1]);
                    const z1 = parseInt(args[2]);
                    const x2 = parseInt(args[3]);
                    const z2 = parseInt(args[4]);
                    const depth = parseInt(args[5]) || 5;
                    
                    this.logger.info(`[Mine] Parsed coords - x1:${x1}, z1:${z1}, x2:${x2}, z2:${z2}, depth:${depth}`);
                    
                    if (isNaN(x1) || isNaN(z1) || isNaN(x2) || isNaN(z2) || isNaN(depth)) {
                        this.bot.chat("Invalid coordinates or depth. All values must be numbers.");
                        this.logger.info(`[Mine] Quarry failed - invalid numbers`);
                        break;
                    }
                    
                    if (depth <= 0) {
                        this.bot.chat("Depth must be greater than 0");
                        this.logger.info(`[Mine] Quarry failed - depth <= 0`);
                        break;
                    }
                    
                    const botY = Math.floor(this.bot.entity.position.y);
                    const corner1 = new Vec3(x1, botY, z1);
                    const corner2 = new Vec3(x2, botY, z2);
                    
                    const width = Math.abs(x2 - x1) + 1;
                    const length = Math.abs(z2 - z1) + 1;
                    
                    this.bot.chat(`Starting quarry: ${width}x${length} area, ${depth} layers deep`);
                    this.bot.chat(`From (${x1}, ${z1}) to (${x2}, ${z2})`);
                    this.logger.info(`[Mine] Starting quarry - ${width}x${length}, depth:${depth}, botY:${botY}`);
                    
                    if (!this.behaviors.mining.enabled && typeof this.behaviors.mining.enable === 'function') {
                        this.behaviors.mining.enable();
                    }
                    
                    try {
                        await this.behaviors.mining.startQuarry(corner1, corner2, depth);
                        this.bot.chat("Quarry complete!");
                        this.logger.info(`[Mine] Quarry completed successfully`);
                    } catch (quarryError) {
                        this.logger.error(`[Mine] Quarry error: ${quarryError.message || quarryError}`);
                        this.bot.chat(`Quarry failed: ${quarryError.message || 'Unknown error'}`);
                    }
                    break;
                }
                
        case 'deposit': {
          // Request a deposit after the current mining task finishes.
          if (!this.behaviors.mining) {
            this.bot.chat("Mining behavior not available");
            break;
          }
          if (this.behaviors.mining.isWorking) {
            this.behaviors.mining.depositAfterCompletion = true;
            const kb = this.behaviors.mining?.settings?.keepBridgingTotal ?? 64;
            const kf = this.behaviors.mining?.settings?.keepFoodMin ?? 16;
            this.bot.chat(`Will deposit after mining completes (keeping tools, up to ${kb} bridging blocks, and at least ${kf} food).`);
          } else {
            // If idle, perform an immediate deposit once with keep rules.
            try {
              // Reuse behavior's internal deposit routine by toggling flag and triggering a no-op plan end path
              this.behaviors.mining.depositAfterCompletion = true;
              // Directly invoke the post-completion branch by calling the plan executor on empty plan
              this.behaviors.mining.miningPlan = [];
              await this.behaviors.mining._executeMiningPlan();
              this.bot.chat("Deposited inventory (kept essentials).");
            } catch (e) {
              this.bot.chat(`Deposit failed: ${e.message || e}`);
            }
          }
          break;
        }
                
                case 'stop': {
                    // Force stop mining
                    this.behaviors.mining.stopMining();
                    this.behaviors.mining.disable();
                    
                    // Stop pathfinder
                    if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
                        this.bot.pathfinder.setGoal(null);
                    }
                    
                    this.bot.chat("Stopped mining");
                    break;
                }
                
                case 'status': {
                    const status = this.behaviors.mining.isWorking ? 'Working' : 'Idle';
                    const mode = this.behaviors.mining.currentMode || 'None';
                    const current = this.behaviors.mining.currentPlanIndex || 0;
                    const total = this.behaviors.mining.miningPlan.length || 0;
                    const percentage = total > 0 ? ((current / total) * 100).toFixed(1) : '0';
                    const progress = total > 0 
                        ? `${current}/${total} (${percentage}%)`
                        : 'N/A';
                    const blocks = this.behaviors.mining.blocksMinedThisSession || 0;
                    
                    this.bot.chat(`Mining Status: ${status}`);
                    this.bot.chat(`Mode: ${mode} | Progress: ${progress}`);
                    this.bot.chat(`Blocks mined this session: ${blocks}`);
                    break;
                }
                
                case 'vein': {
                    // !mine vein - Continuous vein mining mode (scans and mines in radius)
                    // !mine vein <radius> - Continuous vein mining with custom radius
                    // !mine vein <x> <y> <z> - Mine single vein at specific position (legacy)
                    if (!this.bot.oreScanner) {
                        this.bot.chat("Ore scanner not available");
                        break;
                    }
                    
                    // Check if coordinates provided (legacy single-vein mode)
                    if (args.length >= 4) {
                        const x = parseInt(args[1]);
                        const y = parseInt(args[2]);
                        const z = parseInt(args[3]);
                        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                            // Legacy mode: mine single vein at coordinates
                            const targetPos = new (await import('vec3')).Vec3(x, y, z);
                            const block = this.bot.blockAt(targetPos);
                            if (!block || !this.bot.oreScanner.isOre(block.name)) {
                                this.bot.chat(`No ore at ${targetPos.x} ${targetPos.y} ${targetPos.z}`);
                                break;
                            }
                            
                            this.bot.chat(`Mining vein of ${block.name} at ${targetPos.x} ${targetPos.y} ${targetPos.z}...`);
                            const result = await this.behaviors.mining.mineVeinAt(targetPos);
                            
                            if (result.success) {
                                this.bot.chat(`Vein mined! ${result.minedCount} blocks of ${result.oreType}`);
                            } else {
                                this.bot.chat(`Vein mining failed: ${result.error || 'Unknown error'}`);
                            }
                            break;
                        }
                    }
                    
                    // New mode: continuous vein mining
                    let scanRadius = null;
                    if (args.length >= 2) {
                        const radius = parseInt(args[1]);
                        if (Number.isFinite(radius) && radius > 0 && radius <= 64) {
                            scanRadius = radius;
                        } else {
                            this.bot.chat("Invalid radius (1-64). Usage: !mine vein [radius]");
                            break;
                        }
                    }
                    
                    const cfg = this.bot.config?.behaviors?.mining || {};
                    const defaultRadius = cfg.continuousVeinScanRadius || 32;
                    const radius = scanRadius || defaultRadius;
                    
                    this.bot.chat(`Starting continuous vein mining (radius: ${radius})`);
                    this.bot.chat("Mining all ores until inventory fills or you send !stop");
                    
                    const result = await this.behaviors.mining.startContinuousVeinMining(scanRadius);
                    
                    if (result.success) {
                        this.bot.chat(`Vein mining complete! ${result.totalOresMined} ores mined in ${result.scanIterations} scans (${result.duration}s)`);
                    } else {
                        this.bot.chat(`Vein mining stopped: ${result.error || 'Unknown error'}`);
                    }
                    break;
                }
                
                case 'scan': {
                    // !mine scan - Scan for ore vein at cursor
                    // !mine scan <x> <y> <z> - Scan at specific position
                    if (!this.bot.oreScanner) {
                        this.bot.chat("Ore scanner not available");
                        break;
                    }
                    
                    let targetPos;
                    if (args.length >= 4) {
                        const x = parseInt(args[1]);
                        const y = parseInt(args[2]);
                        const z = parseInt(args[3]);
                        targetPos = new (await import('vec3')).Vec3(x, y, z);
                    } else {
                        const block = this.bot.blockAtCursor(5);
                        if (!block) {
                            this.bot.chat("No block in sight");
                            break;
                        }
                        targetPos = block.position;
                    }
                    
                    const block = this.bot.blockAt(targetPos);
                    if (!block || !this.bot.oreScanner.isOre(block.name)) {
                        this.bot.chat(`No ore at position (block: ${block?.name || 'none'})`);
                        break;
                    }
                    
                    this.bot.chat(`Scanning vein of ${block.name}...`);
                    
                    const cfg = this.bot.config?.behaviors?.mining || {};
                    const result = await this.bot.oreScanner.scanVein(targetPos, {
                        maxBlocks: cfg.veinMaxBlocks || 64,
                        maxDistance: cfg.veinSearchRadius || 16
                    });
                    
                    this.bot.chat(`Found ${result.count} ${result.oreType} blocks`);
                    if (result.count > 0) {
                        const closest = result.blocks[0];
                        const farthest = result.blocks[result.blocks.length - 1];
                        this.bot.chat(`Closest: ${closest.distance.toFixed(1)}m, Farthest: ${farthest.distance.toFixed(1)}m`);
                        const estimatedTime = this.bot.oreScanner.estimateMiningTime(result.count);
                        this.bot.chat(`Est. mining time: ${estimatedTime}s`);
                    }
                    break;
                }

                default:
        this.bot.chat("Usage: !mine <strip|tunnel|quarry|vein|scan|deposit|stop|status>");
          this.bot.chat("Strip: !mine strip <direction> [mainLength] [numBranches]");
        this.bot.chat("Tunnel: !mine tunnel <direction> [length] [width] [height]");
        this.bot.chat("Vein: !mine vein [radius] - Continuous ore mining (scans area)");
        this.bot.chat("Scan: !mine scan [x y z] - Scan ore vein without mining");
        this.bot.chat("Deposit after finish: !mine deposit");
                    this.bot.chat("Directions: north, south, east, west");
            }
        } catch (err) {
            this.logger.error(`[ChatCommandHandler] Mining command error: ${err.message || err}`);
            this.bot.chat(`Mining error: ${err.message || 'Unknown error'}`);
        }
    });

    // 🔧 Tool Management Commands
    this.register('tools', async (username, args, isPrivate) => {
        if (!this.bot.toolHandler) {
            this.reply(username, "ToolHandler not available", isPrivate);
            return;
        }

        const sub = (args[0] || 'status').toLowerCase();

        try {
            switch (sub) {
                case 'status': {
                    const inventory = this.bot.toolHandler.getToolInventory();
                    let response = "Tool Inventory:";
                    
                    for (const [toolType, tools] of Object.entries(inventory)) {
                        if (tools.length > 0) {
                            response += ` ${toolType}:${tools.length}`;
                        }
                    }
                    
                    this.bot.chat(response);
                    break;
                }
                
                case 'report': {
                    const report = this.bot.toolHandler.getToolReport();
                    this.bot.chat("=== Tool Report ===");
                    
                    for (const [toolType, tools] of Object.entries(report.details)) {
                        if (tools.length > 0) {
                            this.bot.chat(`${toolType}: ${tools.length} tools`);
                            tools.forEach(t => {
                                const durInfo = t.durability !== null 
                                    ? ` (${t.percentage}% - ${t.durability} uses left)`
                                    : '';
                                this.bot.chat(`  - ${t.name}${durInfo}`);
                            });
                        }
                    }
                    break;
                }
                
                case 'check': {
                    // Check if bot has specific tool type
                    const toolType = args[1];
                    if (!toolType) {
                        this.bot.chat("Usage: !tools check <pickaxe|axe|shovel|hoe|sword|shears>");
                        return;
                    }
                    
                    const hasTool = this.bot.toolHandler.hasTool(toolType);
                    if (hasTool) {
                        const tools = this.bot.toolHandler.getAvailableTools(toolType);
                        this.bot.chat(`Yes, ${tools.length} ${toolType}(s) available`);
                    } else {
                        this.bot.chat(`No ${toolType} available`);
                    }
                    break;
                }
                
                case 'equip': {
                    // Equip best tool for a block type
                    const blockName = args[1];
                    if (!blockName) {
                        this.bot.chat("Usage: !tools equip <blockName>");
                        return;
                    }
                    
                    // Find a nearby block of that type
                    const blocks = this.bot.findBlocks({
                        matching: (block) => block && block.name === blockName,
                        maxDistance: 5,
                        count: 1
                    });
                    
                    if (blocks.length === 0) {
                        this.bot.chat(`No ${blockName} found nearby`);
                        return;
                    }
                    
                    const block = this.bot.blockAt(blocks[0]);
                    const equipped = await this.bot.toolHandler.equipBestTool(block);
                    
                    if (equipped) {
                        const tool = this.bot.heldItem;
                        this.bot.chat(`Equipped ${tool ? tool.name : 'hand'} for ${blockName}`);
                    } else {
                        this.bot.chat(`No suitable tool for ${blockName}`);
                    }
                    break;
                }

                default:
                    this.bot.chat("Usage: !tools <status|report|check|equip>");
                    this.bot.chat("status - Quick tool count");
                    this.bot.chat("report - Detailed tool durability");
                    this.bot.chat("check <type> - Check for specific tool type");
                    this.bot.chat("equip <block> - Equip best tool for block type");
            }
        } catch (err) {
            this.logger.error(`[ChatCommandHandler] Tools command error: ${err.message || err}`);
            this.bot.chat(`Tools error: ${err.message || 'Unknown error'}`);
        }
    });

    // Debug toggles: master only
    this.register('debug', async (username, args, isPrivate) => {
      const sub = (args[0] || '').toLowerCase();
      const module = (args[1] || 'all').toLowerCase();
      if (username !== this.master) {
        this.reply(username, 'Only master can toggle debug.', isPrivate);
        return;
      }
      switch (sub) {
        case 'enable':
          this.debug.enable(module);
          this.reply(username, `Debug enabled for ${module}`, isPrivate);
          break;
        case 'disable':
          this.debug.disable(module);
          this.reply(username, `Debug disabled for ${module}`, isPrivate);
          break;
        case 'status': {
          const status = { global: this.debug.global, modules: Array.from(this.debug.flags.entries()) };
          this.reply(username, `Debug status: ${JSON.stringify(status)}`, isPrivate);
          break;
        }
        default:
          this.reply(username, 'Usage: !debug <enable|disable|status> [module]', isPrivate);
      }
    });

    // Diagnostics: dump module diagnostics and write snapshot
    this.register('diag', async (username, args, isPrivate) => {
      const module = (args[0] || 'all').toLowerCase();
      if (username !== this.master) {
        this.reply(username, 'Only master can request diagnostics.', isPrivate);
        return;
      }
      try {
        await this.debug.getDiagnostics(module);
        const snap = await this.debug.snapshot(module);
        // whisper short reply and log full path on server console
        this.reply(username, `Diagnostics for ${module} saved to ${snap.snapshotFile}`, isPrivate);
        this.logger.info(`[Diag] ${username} requested diagnostics for ${module} -> ${snap.snapshotFile}`);
      } catch (e) {
        this.logger.error(`[Diag] Failed to produce diagnostics: ${e.message || e}`);
        this.reply(username, `Failed to collect diagnostics: ${e.message || e}`, isPrivate);
      }
    });

    // quick test for pathfinding: !testgoto x y z
    this.register('testgoto', async (username, args, isPrivate) => {
      if (args.length < 3) {
        this.reply(username, 'Usage: !testgoto <x> <y> <z>', isPrivate);
        return;
      }
      const [x, y, z] = args.map(Number);
      if ([x, y, z].some(n => Number.isNaN(n))) {
        this.reply(username, 'Invalid coordinates', isPrivate);
        return;
      }
      this.bot.chat(`Attempting test goto ${x},${y},${z}`);
      try {
        // Use PathfindingUtil for collision avoidance
        if (this.bot.pathfindingUtil) {
          await this.bot.pathfindingUtil.gotoBlock({x, y, z}, 60000, 'testgoto');
        } else if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
          // Fallback to direct pathfinder
          await this.bot.pathfinder.goto(new (await import('mineflayer-pathfinder')).goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
        } else {
          this.reply(username, 'No pathfinder available to run goto', isPrivate);
        }
        this.bot.chat('testgoto completed (or timed out)');
      } catch (err) {
        this.bot.chat(`testgoto failed: ${err.message || err}`);
        this.logger.error(`[testgoto] ${err.message || err}`);
      }
    });

    // Coordinator status (master only)
    this.register('coordstatus', (username) => {
      if (username !== this.master) {
        this.bot.whisper(username, 'Only master can view coordinator status.');
        return;
      }
      
      if (!this.bot.coordinator) {
        this.bot.whisper(username, 'No coordinator available (single bot mode)');
        return;
      }
      
      const diag = this.bot.coordinator.getDiagnostics();
      this.bot.whisper(username, `=== Coordinator Status ===`);
      this.bot.whisper(username, `Active Bots: ${diag.activeBots}`);
      this.bot.whisper(username, `Claimed Blocks: ${diag.claimedBlocks}`);
      this.bot.whisper(username, `Claimed Areas: ${diag.claimedAreas}`);
      this.bot.whisper(username, `Bot Names: ${diag.bots.join(', ')}`);
    });

    // Path cache management (master only)
    this.register('cache', (username, args) => {
      if (username !== this.master) {
        this.bot.whisper(username, 'Only master can manage path cache.');
        return;
      }

      if (!this.bot.pathfindingUtil) {
        this.bot.whisper(username, 'PathfindingUtil not available');
        return;
      }

      const sub = args[0]?.toLowerCase();
      
      switch (sub) {
        case 'stats': {
          const stats = this.bot.pathfindingUtil.getCacheStats();
          this.bot.whisper(username, `=== Path Cache Stats ===`);
          this.bot.whisper(username, `Size: ${stats.size}/${stats.maxSize}`);
          this.bot.whisper(username, `Hit Rate: ${stats.hitRate} (${stats.hits}/${stats.total})`);
          this.bot.whisper(username, `Saves: ${stats.saves}, Invalidations: ${stats.invalidations}`);
          break;
        }
        case 'debug': {
          const debug = this.bot.pathfindingUtil.getCacheDebugInfo();
          this.bot.whisper(username, `=== Path Cache Debug ===`);
          this.bot.whisper(username, `Hit Rate: ${debug.stats.hitRate}`);
          this.bot.whisper(username, `Top paths (by usage):`);
          debug.paths.slice(0, 5).forEach((p, i) => {
            this.bot.whisper(username, `${i+1}. ${p.key.substring(0, 30)}... (${p.useCount} uses, ${p.length} nodes, ${p.age}s old)`);
          });
          break;
        }
        case 'clear': {
          this.bot.pathfindingUtil.clearCache();
          this.bot.whisper(username, 'Path cache cleared');
          break;
        }
        default:
          this.bot.whisper(username, 'Usage: !cache <stats|debug|clear>');
      }
    });

    // Whisper pattern management (master only)
    this.register('whisper', (username, args) => {
      if (username !== this.master) {
        this.bot.whisper(username, 'Only master can manage whisper patterns.');
        return;
      }

      const sub = args[0]?.toLowerCase();
      
      switch (sub) {
        case 'list': {
          this.bot.whisper(username, `=== Whisper Patterns (${this.whisperPatterns.length}) ===`);
          this.whisperPatterns.forEach((p, i) => {
            this.bot.whisper(username, `${i+1}. ${p.name}: ${p.regex.source.substring(0, 50)}...`);
          });
          break;
        }
        case 'test': {
          const testText = args.slice(1).join(' ');
          if (!testText) {
            this.bot.whisper(username, 'Usage: !whisper test <raw text>');
            return;
          }
          
          this.bot.whisper(username, `Testing: "${testText}"`);
          const result = this._parseCustomWhisper(testText);
          
          if (result) {
            this.bot.whisper(username, `✓ Matched! User: ${result.username}, Message: ${result.message}`);
          } else {
            this.bot.whisper(username, '✗ No pattern matched');
          }
          break;
        }
        default:
          this.bot.whisper(username, 'Usage: !whisper <list|test>');
      }
    });

  // Chat debug logger management (master only)
    this.register('chatdebug', (username, args) => {
      if (username !== this.master) {
        this.bot.whisper(username, 'Only master can manage chat debug logger.');
        return;
      }

      const sub = args[0]?.toLowerCase();
      
      if (!this.behaviors.chatDebugLogger) {
        this.bot.whisper(username, 'ChatDebugLogger not enabled. Set "chatDebugLogger.enabled: true" in config.json');
        return;
      }

      switch (sub) {
        case 'start':
        case 'enable': {
          this.behaviors.chatDebugLogger.enable();
          this.bot.whisper(username, 'ChatDebugLogger enabled - logging all chat events');
          break;
        }
        case 'stop':
        case 'disable': {
          this.behaviors.chatDebugLogger.disable();
          this.bot.whisper(username, 'ChatDebugLogger disabled and logs flushed');
          break;
        }
        case 'summary': {
          const summary = this.behaviors.chatDebugLogger.getSummary();
          this.bot.whisper(username, `=== Chat Debug Summary ===`);
          this.bot.whisper(username, `Total Logs: ${summary.totalLogs}`);
          if (summary.error) {
            this.bot.whisper(username, `Error: ${summary.error}`);
          } else {
            Object.entries(summary.eventTypes).forEach(([type, count]) => {
              this.bot.whisper(username, `  ${type}: ${count}`);
            });
          }
          break;
        }
        case 'clear': {
          this.behaviors.chatDebugLogger.clearLogs();
          this.bot.whisper(username, 'Chat debug logs cleared');
          break;
        }
        case 'flush': {
          this.behaviors.chatDebugLogger.flushLogs();
          this.bot.whisper(username, 'Chat debug logs flushed to file');
          break;
        }
        default:
          this.bot.whisper(username, 'Usage: !chatdebug <start|stop|summary|clear|flush>');
      }
    });

  // Proxy management (master only)
    this.register('proxy', async (username, args, isPrivate) => {
      if (username !== this.master) {
        this.reply(username, 'Only master can manage proxy settings.', isPrivate);
        return;
      }

      const sub = (args[0] || '').toLowerCase();
      try {
        const ProxyManagerModule = await import('./ProxyManager.js');
        const ProxyManager = ProxyManagerModule.default;
        const proxyManager = new ProxyManager(this.config, this.logger);

        switch (sub) {
          case 'status': {
            const info = proxyManager.getProxyInfo();
            this.reply(username, '=== Proxy Status ===', true);
            if (info.enabled) {
              this.reply(username, `Enabled: Yes`, true);
              this.reply(username, `Host: ${info.host}`, true);
              this.reply(username, `Port: ${info.port}`, true);
              this.reply(username, `Type: ${info.type}`, true);
              this.reply(username, `Auth: ${info.authenticated ? 'Yes' : 'No'}`, true);
            } else {
              this.reply(username, 'Enabled: No', true);
              this.reply(username, 'Set proxy.enabled to true in config.json', true);
            }
            break;
          }
          case 'test': {
            if (!proxyManager.isEnabled()) {
              this.reply(username, 'Proxy is not enabled in config', true);
              return;
            }
            this.reply(username, 'Testing proxy connection...', true);
            try {
              const success = await proxyManager.testConnection();
              this.reply(username, success ? '✓ Proxy connection successful!' : '✗ Proxy connection failed', true);
            } catch (err) {
              this.reply(username, `✗ Test failed: ${err.message}`, true);
            }
            break;
          }
          case 'validate': {
            const validation = proxyManager.validateConfig();
            this.reply(username, '=== Proxy Config Validation ===', true);
            if (validation.valid) {
              this.reply(username, '✓ Configuration is valid', true);
            } else {
              this.reply(username, '✗ Configuration errors:', true);
              validation.errors.forEach(err => this.reply(username, `  - ${err}`, true));
            }
            break;
          }
          case 'ip':
          case 'ipcheck': {
            try {
              const ip = await proxyManager.fetchExternalIP();
              if (ip) this.reply(username, `External IP (via proxy): ${ip}`, true);
              else this.reply(username, `Failed to determine external IP`, true);
            } catch (e) {
              this.reply(username, `IP check error: ${e.message || e}`, true);
            }
            break;
          }
          default:
            this.reply(username, 'Usage: !proxy <status|test|validate>', true);
        }
      } catch (e) {
        this.logger.error(`[ProxyCmd] Failed: ${e.message || e}`);
        this.reply(username, `Proxy command failed: ${e.message || e}`, true);
      }
    });

    // 📋 Task Queue Management Commands
    this.register('task', async (username, args, isPrivate) => {
      if (!this.bot.taskQueue) {
        this.reply(username, 'Task queue not available', isPrivate);
        return;
      }

      const sub = args[0]?.toLowerCase();

      try {
        switch (sub) {
          case 'status': {
            const status = this.bot.taskQueue.getStatus();
            this.reply(username, '=== Task Queue Status ===', true);
            this.reply(username, `State: ${status.isPaused ? 'Paused' : status.isProcessing ? 'Processing' : 'Idle'}`, true);
            this.reply(username, `Queue length: ${status.queueLength}`, true);
            
            if (status.currentTask) {
              this.reply(username, `Current: ${status.currentTask.name} (${Math.round(status.currentTask.runningFor / 1000)}s)`, true);
            } else {
              this.reply(username, 'No task currently running', true);
            }
            
            this.reply(username, `Completed: ${status.stats.tasksCompleted} | Failed: ${status.stats.tasksFailed}`, true);
            break;
          }

          case 'list': {
            const tasks = this.bot.taskQueue.getAllTasks();
            if (tasks.length === 0) {
              this.reply(username, 'No tasks in queue', true);
              break;
            }

            this.reply(username, `=== Task List (${tasks.length} tasks) ===`, true);
            tasks.slice(0, 10).forEach(task => {
              const statusIcon = task.status === 'running' ? '▶' : 
                                task.status === 'completed' ? '✓' : 
                                task.status === 'failed' ? '✗' : '⏸';
              this.reply(username, `${statusIcon} [${task.id}] ${task.name} (Priority: ${task.priority})`, true);
            });

            if (tasks.length > 10) {
              this.reply(username, `...and ${tasks.length - 10} more`, true);
            }
            break;
          }

          case 'stats': {
            const stats = this.bot.taskQueue.getStats();
            this.reply(username, '=== Task Queue Statistics ===', true);
            this.reply(username, `Total tasks: ${stats.totalTasks}`, true);
            this.reply(username, `Completed: ${stats.tasksCompleted} | Failed: ${stats.tasksFailed} | Skipped: ${stats.tasksSkipped}`, true);
            this.reply(username, `Success rate: ${stats.successRate}`, true);
            this.reply(username, `Avg execution time: ${stats.averageExecutionTime}ms`, true);
            break;
          }

          case 'pause': {
            this.bot.taskQueue.pause();
            this.reply(username, 'Task queue paused', isPrivate);
            break;
          }

          case 'resume': {
            this.bot.taskQueue.resume();
            this.reply(username, 'Task queue resumed', isPrivate);
            break;
          }

          case 'clear': {
            const count = this.bot.taskQueue.clearQueue();
            this.reply(username, `Cleared ${count} pending tasks`, isPrivate);
            break;
          }

          case 'remove': {
            const taskId = parseInt(args[1]);
            if (!Number.isFinite(taskId)) {
              this.reply(username, 'Usage: !task remove <taskId>', isPrivate);
              break;
            }

            const removed = this.bot.taskQueue.removeTask(taskId);
            if (removed) {
              this.reply(username, `Task ${taskId} removed`, isPrivate);
            } else {
              this.reply(username, `Task ${taskId} not found`, isPrivate);
            }
            break;
          }

          default:
            this.reply(username, 'Usage: !task <status|list|stats|pause|resume|clear|remove>', isPrivate);
        }
      } catch (err) {
        this.logger.error(`[TaskCmd] Failed: ${err.message || err}`);
        this.reply(username, `Task command failed: ${err.message || err}`, isPrivate);
      }
    });
  }

  register(name, handler) {
    this.commands.set(name, handler);
  }
}
