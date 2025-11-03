// src/utils/ChatCommandHandler.js
import chalk from 'chalk';
import Logger from './logger.js';
// import PathfinderBehavior from '../behaviors/PathfinderBehavior.js';
import * as PathfinderBehaviorModule from '../behaviors/PathfinderBehavior.js';
import SaveChestLocation from './SaveChestLocation.js';
import DepositBehavior from '../behaviors/DepositBehavior.js';
import DebugTools from './DebugTools.js';

const cmdPrefix = '!';

export default class ChatCommandHandler {
  constructor(bot, master, behaviors = {}) {
    this.bot = bot;
    this.master = master;
    this.behaviors = behaviors;
    this.logger = new Logger();
    this.commands = new Map();

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

    // Debug tools (expose for runtime inspection)
    this.debug = new DebugTools(this.bot, this.logger, this.behaviors, { chestRegistry: this.chestRegistry, depositBehavior: this.depositBehavior });
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

  // ------------------------------
  // Command Parser
  // ------------------------------
  handleMessage(username, message, isPrivate) {
    if (username === this.bot.username) return;
    const isMaster = username === this.master;

    if (!isMaster && isPrivate) return; // only master allowed private commands

    if (!isPrivate && !message.startsWith(cmdPrefix)) return;

    const parts = message.replace(cmdPrefix, '').trim().split(/\s+/);
    const commandName = parts.shift().toLowerCase();
    const args = parts;

    if (this.commands.has(commandName)) {
      try {
        const handler = this.commands.get(commandName);
        // allow async handlers
        const res = handler.call(this, username, args, isPrivate);
        if (res instanceof Promise) res.catch(err => this.logger.error(`[Cmd:${commandName}] ${err.message || err}`));
      } catch (err) {
        this.logger.error(`[Cmd:${commandName}] Handler threw: ${err.message || err}`);
      }
    } else {
      // unknown command
      if (isPrivate) {
        this.bot.whisper(username, `Unknown command: ${commandName}`);
      } else {
        this.bot.chat(`Unknown command: ${commandName}`);
      }
    }
  }

  // ------------------------------
  // Register Commands
  // ------------------------------
  registerDefaultCommands() {
    // 🧠 Basic
    this.register('ping', (username, args, isPrivate) => {
      const reply = 'Pong!';
      if (isPrivate) this.bot.whisper(username, reply);
      else this.bot.chat(reply);
    });

    this.register('say', (username, args) => {
      const message = args.join(' ');
      if (message.length > 0) this.bot.chat(message);
    });

    // 🧭 Movement
    this.register('come', (username) => {
      this.pathfinder.comeTo(username);
    });

    this.register('goto', (username, args) => {
      if (args.length < 3) {
        this.bot.chat('Usage: !goto <x> <y> <z>');
        return;
      }
      const [x, y, z] = args.map(Number);
      this.pathfinder.goTo(x, y, z);
    });

    this.register('follow', (username, args) => {
      if (!args[0]) {
        this.bot.chat('Usage: !follow <playerName>');
        return;
      }
      this.pathfinder.followPlayer(args[0]);
    });

    this.register('stop', () => {
      this.pathfinder.stop();
    });

    // 🍗 Eat
    this.register('eat', async (username) => {
      if (!this.behaviors?.eat) {
        this.bot.chat("Eat behavior not available.");
        return;
      }
      try {
        await this.behaviors.eat.checkHunger();
      } catch (err) {
        this.logger.error(`Error eating: ${err}`);
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

    // 🧭 Deposit nearest
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

    // 🌾 Farming Commands
    this.register('farm', async (username, args) => {
        if (!this.behaviors.farm) {
            this.bot.chat("Farming behavior not available");
            return;
        }

        const subCommand = args[0]?.toLowerCase();

        switch (subCommand) {
            case 'start':
                if (!this.behaviors.farm.farmingArea) {
                    this.bot.chat("No farming area set! Use !farm setarea first");
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
                this.behaviors.farm.disable();
                this.bot.chat("Stopped farming");
                break;

            case 'setarea':
                // Get player's position and create a 5x5 area around it
                const player = this.bot.players[username];
                if (!player) {
                    this.bot.chat("Couldn't find player position!");
                    return;
                }
                this.behaviors.farm.farmingArea = {
                    start: { x: Math.floor(player.entity.position.x - 4), z: Math.floor(player.entity.position.z - 4) },
                    end: { x: Math.floor(player.entity.position.x + 4), z: Math.floor(player.entity.position.z + 4) }
                };
                this.bot.chat(`Set farming area around ${JSON.stringify(this.behaviors.farm.farmingArea)}`);
                break;

            default:
                this.bot.chat("Usage: !farm <start|stop|setarea>");
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
        // prefer bot.pathfinder.goto when available (FarmBehavior uses same)
        if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
          await this.bot.pathfinder.goto(new (await import('mineflayer-pathfinder')).goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
        } else if (this.pathfinder && typeof this.pathfinder.goTo === 'function') {
          await this.pathfinder.goTo(x, y, z);
        } else {
          this.bot.chat('No pathfinder available to run goto');
        }
        this.bot.chat('testgoto completed (or timed out)');
      } catch (err) {
        this.bot.chat(`testgoto failed: ${err.message || err}`);
        this.logger.error(`[testgoto] ${err.message || err}`);
      }
    });
  }

  register(name, handler) {
    this.commands.set(name, handler);
  }
}
