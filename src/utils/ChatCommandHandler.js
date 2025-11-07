// src/utils/ChatCommandHandler.js
import chalk from 'chalk';
import { Vec3 } from 'vec3';
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
    
    // Init everything
    this.registerDefaultCommands();
    this.initListeners();
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
    this.bot.on('chat', (username, message) => {
      try {
        this.handleMessage(username, message, false);
      } catch (e) {
        this.logger.error(`[Chat] Error handling public message from ${username}: ${e.message || e}`);
      }
    });

    // Private messages via /msg or /tell (standard Mineflayer event)
    this.bot.on('whisper', (username, message) => {
      try {
        this.handleMessage(username, message, true);
      } catch (e) {
        this.logger.error(`[Chat] Error handling whisper from ${username}: ${e.message || e}`);
      }
    });

    // Raw message listener for custom whisper formats
    // Some server plugins don't trigger the 'whisper' event properly
    this.bot._client.on('chat', (packet) => {
      try {
        const jsonMsg = packet.message;
        const rawText = this._extractRawText(jsonMsg);
        
        if (rawText) {
          const whisperData = this._parseCustomWhisper(rawText);
          if (whisperData) {
            this.logger.info(`[Whisper] Detected custom format from ${whisperData.username}: ${whisperData.message}`);
            this.handleMessage(whisperData.username, whisperData.message, true);
          }
        }
      } catch (e) {
        // Silent fail - this is just a fallback for custom formats
      }
    });
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
      } catch (e) {
        this.logger.error(`[Whisper] Failed to compile pattern '${pattern.name}': ${e.message}`);
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

  handleMessage(username, message, isPrivate) {
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
        if (res instanceof Promise) res.catch(err => this.logger.error(`[Cmd:${commandName}] ${err.message || err}`));
      } catch (err) {
        this.logger.error(`[Cmd:${commandName}] Handler threw: ${err.message || err}`);
      }
    } else {
      // unknown command - only reply if whitelisted
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
        'Utility: loginv, drop, deposit, debug',
        '',
        'For detailed help: !help <command>',
        'Examples: !help mine, !help tools'
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
      
      this.bot.whisper(username, '=== Your Permissions ===');
      this.bot.whisper(username, `Allowed Bots: ${bots}`);
      this.bot.whisper(username, `Allowed Commands: ${cmds}`);
      if (playerInfo.description) {
        this.bot.whisper(username, `Note: ${playerInfo.description}`);
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
          this.bot.whisper(username, `Whitelisted players (${players.length}):`);
          players.forEach(p => this.bot.whisper(username, `- ${p}`));
        }
      } else {
        this.reply(username, 'Usage: whitelist <reload|list>', isPrivate);
      }
    });

    this.register('say', (username, args, isPrivate) => {
      const message = args.join(' ');
      if (message.length > 0) {
        this.reply(username, message, isPrivate);
      }
    });

    // 🧭 Movement (using centralized PathfindingUtil)
    this.register('come', async (username) => {
      if (!this.bot.pathfindingUtil) {
        this.bot.chat('Pathfinding not available');
        return;
      }
      
      try {
        await this.bot.pathfindingUtil.gotoPlayer(username, 3);
        this.bot.chat(`Coming to ${username}`);
      } catch (e) {
        this.bot.chat(`Failed to come: ${e.message}`);
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
        this.bot.chat(`Arrived at ${x}, ${y}, ${z}`);
      } catch (e) {
        this.bot.chat(`Failed to go to location: ${e.message}`);
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
        this.bot.chat(`Following ${args[0]}`);
      } catch (e) {
        this.bot.chat(`Failed to follow: ${e.message}`);
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

    // 🧱 Deposit manually (with coords)
    this.register('deposit', async (username, args, isPrivate) => {
      if (!this.behaviors.inventory) {
        this.reply(username, "Inventory behavior not available.", isPrivate);
        return;
      }

      if (args.length < 3) {
        this.reply(username, "Usage: !deposit <x> <y> <z> [all|wood|ores|resources|itemName]", isPrivate);
        return;
      }

      const [xStr, yStr, zStr, typeArg] = args;
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      const z = parseInt(zStr, 10);
      const type = (typeArg || 'all').toLowerCase();

      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        this.reply(username, "Invalid coordinates. Usage: !deposit <x> <y> <z> [all|wood|ores|resources|itemName]", isPrivate);
        return;
      }

      this.bot.chat(`Depositing ${type} to chest at (${x}, ${y}, ${z})...`);
      try {
        const success = await this.behaviors.inventory.depositToChest({ x, y, z }, type);
        if (success) this.bot.chat(`✅ Successfully deposited ${type} items.`);
        else this.bot.chat(`⚠️ No items deposited.`);
      } catch (err) {
        this.reply(username, `❌ Failed to deposit items: ${err.message}`, isPrivate);
      }
    });

    // 📦 Deposit all items to their categorized chests
    this.register('depositall', async (username, args, isPrivate) => {
      if (!this.depositBehavior || typeof this.depositBehavior.depositAll !== 'function') {
        this.bot.whisper(username, 'Deposit behavior not available on this bot.');
        return;
      }
      try {
        this.bot.whisper(username, 'Starting deposit of inventory to categorized chests...');
        await this.depositBehavior.depositAll();
        this.bot.whisper(username, 'Deposit complete.');
      } catch (err) {
        this.logger.error(`[DepositAll] ${err.message || err}`);
        this.bot.whisper(username, `Deposit failed: ${err.message || err}`);
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

    // �🧭 Deposit nearest
    this.register('depositnearest', async (username, args, isPrivate) => {
      if (!this.behaviors.inventory) {
        this.reply(username, "Inventory behavior not available.", isPrivate);
        return;
      }

      const type = (args[0] || 'all').toLowerCase();
      this.bot.chat(`Depositing ${type} items into nearest chest...`);
      try {
        const success = await this.behaviors.inventory.depositNearest(type);
        if (success) this.bot.chat(`✅ Successfully deposited ${type} items.`);
        else this.bot.chat(`⚠️ No items deposited or no nearby chest found.`);
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
          this.bot.chat("LookBehavior enabled.");
        } else if (action === 'off') {
          lookBehavior.disable();
          this.bot.chat("LookBehavior disabled.");
        } else {
          this.bot.chat("Usage: !look <on|off>");
        }
      } else {
        if (lookBehavior.enabled) {
          lookBehavior.disable();
          this.bot.chat("LookBehavior disabled.");
        } else {
          lookBehavior.enable();
          this.bot.chat("LookBehavior enabled.");
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
        this.bot.chat("Types: farm, quarry, lumber");
        this.bot.chat("Example: !setarea farm start");
        return;
      }

      const type = args[0].toLowerCase();
      const action = args[1].toLowerCase();

      if (action === 'clear') {
        try {
          await this.bot.areaRegistry.deleteArea(type);
          this.bot.chat(`Cleared ${type} area`);
          // Also clear behavior-specific cache if present
          if (type === 'farm' && this.behaviors.farm) {
            this.behaviors.farm.farmingArea = null;
          }
        } catch (e) {
          this.bot.chat(`Failed to clear area: ${e.message}`);
        }
        return;
      }

      if (!['start', 'end'].includes(action)) {
        this.bot.chat("Action must be 'start', 'end', or 'clear'");
        return;
      }

      let x, y, z;
      if (args.length >= 5) {
        // Manual coordinates
        [x, y, z] = args.slice(2, 5).map(Number);
        if ([x, y, z].some(n => Number.isNaN(n))) {
          this.bot.chat('Invalid coordinates');
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
  }

  register(name, handler) {
    this.commands.set(name, handler);
  }
}
