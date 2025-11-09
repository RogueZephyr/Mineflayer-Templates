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
    try {
      await this.whitelist.loadWhitelist();
      this.logger.info(`[ChatCommandHandler] Whitelist loaded (${Object.keys(this.whitelist.whitelist).length} entries)`);
  } catch (_e) {
      this.logger.warn('[ChatCommandHandler] Whitelist async load failed, proceeding with empty list');
    }
    this.registerDefaultCommands();
    this.initListeners();
    this.initConsoleInput();
    this.logger.info('[ChatCommandHandler] Initialization complete');
    return this;
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
    
    this.logger.info('[ChatCommandHandler] Disposed');
  }

  // ------------------------------
  // Console Input Handler
  // ------------------------------
  initConsoleInput() {
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
      } catch (e) {
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
    if (username === this.bot.username) return;

    // Rate limiting check
    if (this.isRateLimited(username)) {
      this.logger.info(`[${this.bot.username}] Rate limited: ${username}`);
      return;
    }

    // For whispers, don't require the ! prefix (optional)
    // For public chat, require the ! prefix
    if (!isPrivate && !message.startsWith(cmdPrefix)) return;

    // Remove prefix if present, otherwise parse as-is for whispers
    const cleanMessage = message.startsWith(cmdPrefix) 
      ? message.replace(cmdPrefix, '').trim() 
      : message.trim();
    
    const parts = cleanMessage.split(/\s+/);
    const commandName = parts.shift().toLowerCase();
    const args = parts;

  if (this.commands.has(commandName)) {
      try {
    // Ensure whitelist is loaded before permission checks
    try { await this.whitelist.loadWhitelist(); } catch (_) { /* ignore, default empty */ }
        // Check if command is targeted at this bot
        const { isForThisBot, remainingArgs } = this.parseTargetedCommand(args);
        
        // Debug logging
        this.logger.info(`[${this.bot.username}] Command '${commandName}' - isForThisBot: ${isForThisBot}, args: [${args.join(', ')}], remainingArgs: [${remainingArgs.join(', ')}]`);
        
        if (!isForThisBot) {
          // Command is for another bot, ignore it silently
          this.logger.info(`[${this.bot.username}] Command not for this bot, ignoring`);
          return;
        }

        // Check whitelist permissions
        if (!this.whitelist.canCommandBot(username, this.bot.username)) {
          // Player not allowed to command this bot - ignore silently
          this.logger.info(`[${this.bot.username}] ${username} not whitelisted for this bot`);
          return;
        }

        if (!this.whitelist.canUseCommand(username, this.bot.username, commandName)) {
          // Player not allowed to use this command
          this.reply(username, `You don't have permission to use '${commandName}'`, isPrivate);
          this.logger.info(`[${this.bot.username}] ${username} denied command: ${commandName}`);
          return;
        }

        // Log command execution with bot name
        const targetInfo = (args.length > 0 && remainingArgs.length !== args.length) 
          ? ` (targeted at ${this.bot.username})`
          : '';
        this.logger.info(`[${this.bot.username}] ${username} executing: ${commandName}${targetInfo}`);

        const handler = this.commands.get(commandName);
        // allow async handlers, pass remaining args after bot name filtering
        const res = handler.call(this, username, remainingArgs, isPrivate);
        if (res instanceof Promise) await res.catch(err => this.logger.error(`[Cmd:${commandName}] ${err.message || err}`));
      } catch (err) {
        this.logger.error(`[Cmd:${commandName}] Handler threw: ${err.message || err}`);
      }
    } else {
      // unknown command - only reply if whitelisted
      try { await this.whitelist.loadWhitelist(); } catch (_) {}
      if (this.whitelist.isWhitelisted(username)) {
        this.reply(username, `Unknown command: ${commandName}`, isPrivate);
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
        helpMsg.push('!farm start - Start farming');
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
      this.reply(username, 'Going home...', isPrivate);
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
    this.register('sleep', async (username) => {
      if (!this.behaviors.sleep) return;
      await this.behaviors.sleep.sleep();
    });

    // 🧺 Inventory
    this.register('loginv', (username) => {
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
    this.register('depositall', async (username, args, isPrivate) => {
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

        switch (subCommand) {
            case 'start':
                // Load area from registry if not cached
                if (!this.behaviors.farm.farmingArea && this.bot.areaRegistry) {
                  this.behaviors.farm.farmingArea = await this.bot.areaRegistry.getArea('farm');
                }
                
                if (!this.behaviors.farm.farmingArea) {
                    this.bot.chat("No farming area set! Use !setarea farm start/end");
                    return;
                }
                // ensure behavior is enabled before starting
                if (!this.behaviors.farm.enabled && typeof this.behaviors.farm.enable === 'function') {
                  this.behaviors.farm.enable();
                }
                this.bot.chat("Starting farming routine...");
                await this.behaviors.farm.startFarming(this.behaviors.farm.farmingArea);
                break;

            case 'stop':
                // Force stop farming
                this.behaviors.farm.isWorking = false;
                this.behaviors.farm.disable();
                
                // Stop pathfinder
                if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
                  this.bot.pathfinder.setGoal(null);
                }
                
                this.bot.chat("Stopped farming");
                break;

            default:
                this.bot.chat("Usage: !farm <start|stop>");
                this.bot.chat("Set area first: !setarea farm start, then !setarea farm end");
        }
    });

    // 🪓 Woodcutting Commands
    this.register('wood', async (username, args, isPrivate) => {
        if (!this.behaviors.woodcutting) {
            this.reply(username, "Woodcutting behavior not available", isPrivate);
            return;
        }

        const subCommand = args[0]?.toLowerCase();

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

    // ⛏️ Mining Commands
    this.register('mine', async (username, args, isPrivate) => {
        if (!this.behaviors.mining) {
            this.bot.chat("Mining behavior not available");
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

                default:
        this.bot.chat("Usage: !mine <strip|tunnel|quarry|deposit|stop|status>");
          this.bot.chat("Strip: !mine strip <direction> [mainLength] [numBranches]");
        this.bot.chat("Tunnel: !mine tunnel <direction> [length] [width] [height]");
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
        const diag = await this.debug.getDiagnostics(module);
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
  }

  register(name, handler) {
    this.commands.set(name, handler);
  }
}
