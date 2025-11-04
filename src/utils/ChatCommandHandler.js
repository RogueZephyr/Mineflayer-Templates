// src/utils/ChatCommandHandler.js
import chalk from 'chalk';
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
  constructor(bot, master, behaviors = {}) {
    this.bot = bot;
    this.master = master;
    this.behaviors = behaviors;
    this.logger = new Logger();
    this.commands = new Map();
    
    // Whitelist manager for player permissions
    this.whitelist = new WhitelistManager(master);
    this.bot.whitelist = this.whitelist;

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

    // Private messages via /msg or /tell
    this.bot.on('whisper', (username, message) => {
      try {
        this.handleMessage(username, message, true);
      } catch (e) {
        this.logger.error(`[Chat] Error handling whisper from ${username}: ${e.message || e}`);
      }
    });
  }

  // Helper method to reply (whisper if private, chat if public)
  reply(username, message, isPrivate) {
    if (isPrivate) {
      this.bot.whisper(username, message);
    } else {
      this.bot.chat(message);
    }
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
        
        if (!isForThisBot) {
          // Command is for another bot, ignore it silently
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

    this.register('help', (username, args, isPrivate) => {
      const playerInfo = this.whitelist.getPlayerInfo(username);
      const helpMsg = [
        '=== Bot Commands ===',
        'Movement: come, goto, follow, stop',
        'Home: sethome [x y z], home, ishome',
        'Actions: eat, sleep, farm, wood, collect',
        'Utility: loginv, drop, deposit, debug'
      ];
      
      if (playerInfo) {
        helpMsg.push('--- Your Permissions ---');
        const bots = playerInfo.allowedBots.includes('*') ? 'All bots' : playerInfo.allowedBots.join(', ');
        const cmds = playerInfo.allowedCommands.includes('*') ? 'All commands' : playerInfo.allowedCommands.join(', ');
        helpMsg.push(`Bots: ${bots}`);
        helpMsg.push(`Commands: ${cmds}`);
      }
      
      // Always send help via whisper to avoid spam
      helpMsg.forEach(line => this.bot.whisper(username, line));
      if (!isPrivate) {
        this.reply(username, 'Check private messages for help!', isPrivate);
      }
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

    this.register('drop', async (username, args) => {
      if (!this.behaviors.inventory) return;

      if (!args[0]) {
        this.bot.chat("Usage: !drop <wood|ores|resources|itemName>");
        return;
      }

      const type = args[0].toLowerCase();
      const success = await this.behaviors.inventory.dropItem(type);
      if (success) this.bot.chat(`Dropped all ${type}`);
      else this.bot.chat(`No ${type} found to drop`);
    });

    // 🧱 Deposit manually (with coords)
    this.register('deposit', async (username, args) => {
      if (!this.behaviors.inventory) {
        this.bot.chat("Inventory behavior not available.");
        return;
      }

      if (args.length < 3) {
        this.bot.chat("Usage: !deposit <x> <y> <z> [all|wood|ores|resources|itemName]");
        return;
      }

      const [xStr, yStr, zStr, typeArg] = args;
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      const z = parseInt(zStr, 10);
      const type = (typeArg || 'all').toLowerCase();

      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        this.bot.chat("Invalid coordinates. Usage: !deposit <x> <y> <z> [all|wood|ores|resources|itemName]");
        return;
      }

      this.bot.chat(`Depositing ${type} to chest at (${x}, ${y}, ${z})...`);
      try {
        const success = await this.behaviors.inventory.depositToChest({ x, y, z }, type);
        if (success) this.bot.chat(`✅ Successfully deposited ${type} items.`);
        else this.bot.chat(`⚠️ No items deposited.`);
      } catch (err) {
        this.bot.chat(`❌ Failed to deposit items: ${err.message}`);
      }
    });

    // 📦 Deposit all items to their categorized chests
    this.register('depositall', async (username) => {
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
    this.register('collect', async (username, args) => {
      if (!this.bot.itemCollector) {
        this.bot.whisper(username, 'Item collector not available.');
        return;
      }

      const sub = (args[0] || 'once').toLowerCase();
      if (sub === 'start') {
        const type = (args[1] || 'farm').toLowerCase();
        const intervalMs = Math.max(2000, Number(args[2]) || 10000);
        const radius = Math.max(2, Number(args[3]) || 8);
        this.bot.itemCollector.startAuto({ type, intervalMs, radius });
        this.bot.whisper(username, `Auto-collect started (type=${type}, every ${intervalMs}ms, radius=${radius}).`);
        return;
      }
      if (sub === 'stop') {
        this.bot.itemCollector.stopAuto();
        this.bot.whisper(username, 'Auto-collect stopped.');
        return;
      }
      // once (optional: type or radius)
      const type = (args[1] || 'farm').toLowerCase();
      const radius = Math.max(2, Number(args[2]) || 8);
      try {
        const n = await this.bot.itemCollector.collectOnce({ type, radius });
        this.bot.whisper(username, `Collected ${n} dropped items.`);
      } catch (e) {
        this.bot.whisper(username, `Collect failed: ${e.message || e}`);
      }
    });

    // �🧭 Deposit nearest
    this.register('depositnearest', async (username, args) => {
      if (!this.behaviors.inventory) {
        this.bot.chat("Inventory behavior not available.");
        return;
      }

      const type = (args[0] || 'all').toLowerCase();
      this.bot.chat(`Depositing ${type} items into nearest chest...`);
      try {
        const success = await this.behaviors.inventory.depositNearest(type);
        if (success) this.bot.chat(`✅ Successfully deposited ${type} items.`);
        else this.bot.chat(`⚠️ No items deposited or no nearby chest found.`);
      } catch (err) {
        this.bot.chat(`❌ Deposit failed: ${err.message}`);
      }
    });

    // 📦 Set Chest (auto & manual)
    this.register('setchest', async (username, args) => {
      if (args.length < 1) {
        this.bot.whisper(username, 'Usage: !setchest <category> [x y z]');
        return;
      }
      const category = args[0].toLowerCase();

      let x, y, z;
      if (args.length >= 4) {
        // manual coordinates provided
        [x, y, z] = args.slice(1, 4).map(Number);
        if ([x, y, z].some(n => Number.isNaN(n))) {
          this.bot.whisper(username, 'Invalid coordinates. Use integers: !setchest <category> x y z');
          return;
        }
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      } else {
        // fallback: use player's current position (floored)
        const player = this.bot.players[username];
        if (!player || !player.entity) {
          this.bot.whisper(username, "Couldn't find your player entity. Provide coords: !setchest <category> x y z");
          return;
        }
        const pos = player.entity.position;
        x = Math.floor(pos.x); y = Math.floor(pos.y); z = Math.floor(pos.z);
      }

      try {
        await this.chestRegistry.setChest(category, { x, y, z });
        this.bot.whisper(username, `Saved chest "${category}" at ${x},${y},${z}`);
        this.logger.info(`[SetChest] ${username} -> ${category} @ ${x},${y},${z}`);
      } catch (err) {
        this.logger.error(`[SetChest] Failed to save chest ${category}: ${err}`);
        this.bot.whisper(username, `Failed to save chest: ${err.message || err}`);
      }
    });

    // 👀 Look behavior toggle
    this.register('look', (username, args) => {
      const lookBehavior = this.behaviors.look;
      if (!lookBehavior) {
        this.bot.chat("LookBehavior is not available.");
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
    this.register('setarea', async (username, args) => {
      if (!this.bot.areaRegistry) {
        this.bot.chat("Area registry not available");
        return;
      }

      if (args.length < 2) {
        this.bot.chat("Usage: !setarea <type> <start|end|clear> [x y z]");
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
    this.register('farm', async (username, args) => {
        if (!this.behaviors.farm) {
            this.bot.chat("Farming behavior not available");
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
    this.register('wood', async (username, args) => {
        if (!this.behaviors.woodcutting) {
            this.bot.chat("Woodcutting behavior not available");
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

    // Debug toggles: master only
    this.register('debug', async (username, args) => {
      const sub = (args[0] || '').toLowerCase();
      const module = (args[1] || 'all').toLowerCase();
      if (username !== this.master) {
        this.bot.whisper(username, 'Only master can toggle debug.');
        return;
      }
      switch (sub) {
        case 'enable':
          this.debug.enable(module);
          this.bot.whisper(username, `Debug enabled for ${module}`);
          break;
        case 'disable':
          this.debug.disable(module);
          this.bot.whisper(username, `Debug disabled for ${module}`);
          break;
        case 'status': {
          const status = { global: this.debug.global, modules: Array.from(this.debug.flags.entries()) };
          this.bot.whisper(username, `Debug status: ${JSON.stringify(status)}`);
          break;
        }
        default:
          this.bot.whisper(username, 'Usage: !debug <enable|disable|status> [module]');
      }
    });

    // Diagnostics: dump module diagnostics and write snapshot
    this.register('diag', async (username, args) => {
      const module = (args[0] || 'all').toLowerCase();
      if (username !== this.master) {
        this.bot.whisper(username, 'Only master can request diagnostics.');
        return;
      }
      try {
        const diag = await this.debug.getDiagnostics(module);
        const snap = await this.debug.snapshot(module);
        // whisper short reply and log full path on server console
        this.bot.whisper(username, `Diagnostics for ${module} saved to ${snap.snapshotFile}`);
        this.logger.info(`[Diag] ${username} requested diagnostics for ${module} -> ${snap.snapshotFile}`);
      } catch (e) {
        this.logger.error(`[Diag] Failed to produce diagnostics: ${e.message || e}`);
        this.bot.whisper(username, `Failed to collect diagnostics: ${e.message || e}`);
      }
    });

    // quick test for pathfinding: !testgoto x y z
    this.register('testgoto', async (username, args) => {
      if (args.length < 3) {
        this.bot.chat('Usage: !testgoto <x> <y> <z>');
        return;
      }
      const [x, y, z] = args.map(Number);
      if ([x, y, z].some(n => Number.isNaN(n))) {
        this.bot.chat('Invalid coordinates');
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
          this.bot.chat('No pathfinder available to run goto');
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
  }

  register(name, handler) {
    this.commands.set(name, handler);
  }
}
