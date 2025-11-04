// src/core/BotController.js
import mineflayer from 'mineflayer';
import * as pathfinderModule from 'mineflayer-pathfinder';
import mcDataFactory from 'minecraft-data';
import chalk from 'chalk';
import figlet from 'figlet';

import LookBehavior from '../behaviors/LookBehavior.js';
import Logger from '../utils/logger.js';
import ChatLogger from '../behaviors/ChatLogger.js';
import ChatCommandHandler from '../utils/ChatCommandHandler.js';
import EatBehavior from '../behaviors/EatBehavior.js';
import SleepBehavior from '../behaviors/SleepBehavior.js';
import InventoryBehavior from '../behaviors/InventoryBehavior.js';
import DepositBehavior from '../behaviors/DepositBehavior.js';
import FarmBehavior from '../behaviors/FarmBehavior.js';
import ItemCollectorBehavior from '../behaviors/ItemCollectorBehavior.js';
import HomeBehavior from '../behaviors/HomeBehavior.js';
import SaveChestLocation from '../utils/SaveChestLocation.js';
import DebugTools from '../utils/DebugTools.js';
import AreaRegistry from '../state/AreaRegistry.js';
import fs from 'fs';
import path from 'path';

export default class BotController {
  static usernameList = null
  static usedNames = new Set()

  static loadUsernameList() {
    if (BotController.usernameList !== null) return BotController.usernameList;
    
    try {
      const namesPath = path.join(process.cwd(), 'data', 'botNames.json');
      const data = JSON.parse(fs.readFileSync(namesPath, 'utf8'));
      BotController.usernameList = data.names || [];
      
      if (BotController.usernameList.length === 0) {
        console.warn('[BotController] No names found in botNames.json, using fallback');
        BotController.usernameList = ['RogueW0lfy', 'Subject_9-17', 'L@b_R4t'];
      }
      
      return BotController.usernameList;
    } catch (e) {
      console.warn('[BotController] Failed to load botNames.json, using fallback:', e.message);
      BotController.usernameList = ['RogueW0lfy', 'Subject_9-17', 'L@b_R4t'];
      return BotController.usernameList;
    }
  }

  constructor(config, username = null, coordinator = null) {
    // Ensure username list is loaded
    BotController.loadUsernameList();
    this.username = username || this.getAvailableUsername();
    this.config = config;
    this.bot = null;
    this.mcData = null;
    this.logger = new Logger();
    this.behaviors = {};
    this.master = 'RogueZ3phyr';
    this.hungerCheckInterval = null;
    this.coordinator = coordinator; // Shared coordinator for multi-bot sync
  }

  getAvailableUsername() {
    BotController.loadUsernameList();
    
    for (const name of BotController.usernameList) {
      if (!BotController.usedNames.has(name)) {
        BotController.usedNames.add(name);
        return name;
      }
    }
    
    // If all names used, cycle back (add suffix)
    const baseName = BotController.usernameList[0] || 'Bot';
    let counter = 1;
    while (BotController.usedNames.has(`${baseName}_${counter}`)) {
      counter++;
    }
    const newName = `${baseName}_${counter}`;
    BotController.usedNames.add(newName);
    return newName;
  }

  start() {
    // create the bot instance
    this.bot = mineflayer.createBot({
      host: this.config.host,
      port: this.config.port,
      username: this.username,
      version: this.config.version || 'auto'
    });

    // load mineflayer-pathfinder plugin safely (support named/default exports)
    try {
      const PathfinderPlugin = pathfinderModule.pathfinder || pathfinderModule.default || pathfinderModule;
      if (PathfinderPlugin) {
        this.bot.loadPlugin(PathfinderPlugin);
        this.logger.info('[BotController] pathfinder plugin loaded');
      } else {
        this.logger.warn('[BotController] pathfinder plugin not found in module import');
      }
    } catch (e) {
      this.logger.warn('[BotController] Failed to load pathfinder plugin:', e.message || e);
    }
    
    // Basic lifecycle listeners
    this.bot.once('login', () => this.onLogin());
    this.bot.once('spawn', () => this.onSpawn());

    // global error handling
    this.bot.on('kicked', (reason) => this.logger.warn(`Kicked: ${reason}`));
    this.bot.on('end', (reason) => {
      this.logger.warn(`Connection ended. Reason: ${reason || 'unknown'}`);
      this.onEnd();
    });
    this.bot.on('error', (err) => this.logger.error(`Bot error: ${err}`));
    this.bot.on('disconnect', (packet) => this.logger.warn(`Disconnected: ${JSON.stringify(packet)}`));
  }

  onLogin() {
    // choose host text defensively because internals differ by net impl
    const host = (this.bot?._client?.socket?._host) || this.config.host || 'unknown';
    this.logger.success(`[BOT] Logged into ${host}`);
  }

  onSpawn() {
    console.log(chalk.cyan(figlet.textSync('MineBot', { horizontalLayout: 'full' })));
    this.logger.info(`Connected to ${this.config.host}:${this.config.port}`);
    this.logger.success('Spawn event detected, initializing data...');

    // load minecraft-data now that bot.version is available
    this.mcData = mcDataFactory(this.bot.version);

    // Ensure pathfinder plugin + movements are loaded and configured
    try {
      // support both named/default exports from mineflayer-pathfinder
      const PathfinderPlugin = pathfinderModule.pathfinder || pathfinderModule.default || pathfinderModule;
      const MovementsCtor = pathfinderModule.Movements || (pathfinderModule.default && pathfinderModule.default.Movements);

      if (!MovementsCtor) {
        this.logger.warn('[BotController] mineflayer-pathfinder Movements not found');
      } else {
        if (!this.bot.pathfinder) this.bot.loadPlugin(PathfinderPlugin);
        const moves = new MovementsCtor(this.bot, this.mcData);
        
        // Add collision avoidance if coordinator is available
        if (this.coordinator) {
          // Override the cost calculation to add penalties for positions near other bots
          const originalGetMoveForward = moves.getMoveForward;
          if (originalGetMoveForward) {
            moves.getMoveForward = function(node, dir, neighbors) {
              const result = originalGetMoveForward.call(this, node, dir, neighbors);
              if (result && result.cost) {
                const targetPos = { x: result.x, y: result.y, z: result.z };
                if (this.bot.coordinator && this.bot.coordinator.isPositionOccupied(targetPos, 1.5, this.bot.username)) {
                  result.cost *= 50; // Make occupied positions expensive
                }
              }
              return result;
            }.bind(moves);
          }
          
          // Also override getLandingBlock to avoid bot positions
          const originalGetLandingBlock = moves.getLandingBlock;
          if (originalGetLandingBlock) {
            moves.getLandingBlock = function(node, dir) {
              const result = originalGetLandingBlock.call(this, node, dir);
              if (result && result.x !== undefined) {
                const targetPos = { x: result.x, y: result.y, z: result.z };
                if (this.bot.coordinator && this.bot.coordinator.isPositionOccupied(targetPos, 1.5, this.bot.username)) {
                  return null; // Block this movement
                }
              }
              return result;
            }.bind(moves);
          }
          
          this.logger.info('[BotController] Collision avoidance enabled in pathfinder');
        }
        
        this.bot.pathfinder.setMovements(moves);

        // optional: extend search radius if present
        if (typeof this.bot.pathfinder.searchRadius === 'number') {
          this.bot.pathfinder.searchRadius = Math.max(this.bot.pathfinder.searchRadius, 80);
        }
        this.logger.info('[BotController] pathfinder plugin and movements configured');
      }
    } catch (e) {
      this.logger.warn('[BotController] Failed to initialize pathfinder movements:', e.message || e);
    }

    // create shared helpers early so behaviors can use them
    this.chestRegistry = new SaveChestLocation(this.bot);
    this.bot.chestRegistry = this.chestRegistry;

    this.areaRegistry = new AreaRegistry(this.bot);
    this.bot.areaRegistry = this.areaRegistry;

    this.behaviors.deposit = new DepositBehavior(this.bot, this.logger);
    this.bot.depositBehavior = this.behaviors.deposit;

  // Item collector (modular)
  this.behaviors.itemCollector = new ItemCollectorBehavior(this.bot, this.logger, this.areaRegistry);
  this.bot.itemCollector = this.behaviors.itemCollector;
    // Auto-start item collector if configured
    try {
      const icCfg = this.config?.behaviors?.itemCollector || {};
      if (icCfg.autoStart) {
        this.behaviors.itemCollector.startAuto({
          type: icCfg.type || 'farm',
          intervalMs: typeof icCfg.intervalMs === 'number' ? icCfg.intervalMs : 10000,
          radius: typeof icCfg.radius === 'number' ? icCfg.radius : 8
        });
        this.logger.info('[BotController] ItemCollector auto-started');
      }
    } catch (e) {
      this.logger.warn('[BotController] Failed to auto-start ItemCollector:', e.message || e);
    }

    this.debug = new DebugTools(this.bot, this.logger, this.behaviors, { chestRegistry: this.chestRegistry, depositBehavior: this.behaviors.deposit });
    this.bot.debugTools = this.debug;

    // Register with coordinator for multi-bot sync
    if (this.coordinator) {
      this.coordinator.registerBot(this.bot);
      this.bot.coordinator = this.coordinator;
      this.logger.info('[BotController] Registered with shared coordinator');
    }

    this.logger.info(`${chalk.green(this.username)} has loaded correctly`)
    this.bot.chat(`/msg ${this.master} Hello! Test environment loaded!`);

    // Initialize all behaviors with proper configuration
    const lookConfig = this.config.behaviors?.look || {};
    this.behaviors.look = new LookBehavior(this.bot, lookConfig);
    this.behaviors.look.master = this.master; // Pass master username
    this.behaviors.look.enable(); // enable by default
    this.logger.info('LookBehavior initialized successfully!');

    this.behaviors.chatLogger = new ChatLogger(this.bot, this.logger, BotController.usernameList);
    this.behaviors.chatLogger.enable();
    this.logger.info('ChatLogger initialized successfully!');

    this.behaviors.eat = new EatBehavior(this.bot, this.logger, this.master);
    this.behaviors.sleep = new SleepBehavior(
      this.bot,
      this.mcData,
      this.logger,
      { bedColor: this.config.behaviors?.sleep?.bedColor || 'red' },
      { look: this.behaviors.look }
    );

    this.behaviors.inventory = new InventoryBehavior(this.bot, this.logger);
    this.behaviors.inventory.logInventory();

    // Farm behavior with look behavior integration
    this.behaviors.farm = new FarmBehavior(this.bot, this.logger, this.master);
    this.behaviors.farm.setLookBehavior(this.behaviors.look);
    this.logger.info('FarmBehavior initialized successfully!');

    // Home behavior for graceful logout
    this.behaviors.home = new HomeBehavior(this.bot, this.logger);
    this.bot.homeBehavior = this.behaviors.home; // Make accessible via bot object
    this.logger.info('HomeBehavior initialized successfully!');

    this.behaviors.chatCommands = new ChatCommandHandler(this.bot, this.master, this.behaviors);
    this.logger.info('ChatCommandHandler initialized successfully!');

    // Set up hunger check interval (always runs, logs only in debug mode)
    if (this.hungerCheckInterval) {
      clearInterval(this.hungerCheckInterval);
    }

    this.hungerCheckInterval = setInterval(async () => {
      try {
        if (this.config.debug === true) {
          this.logger.info(`[Debug] Checking hunger...`);
        }
        await this.behaviors.eat.checkHunger();
      } catch (err) {
        if (this.config.debug === true) {
          this.logger.error(`[Debug] Error in checkHunger: ${err.message}`);
        }
      }
    }, 30000); // Check every 30 seconds

    this.logger.info('All behaviors initialized successfully!');
  }

  onEnd() {
    this.logger.warn(`${chalk.green(this.username)} has been logged out of the server`)
    this.logger.warn(`Attempting to reconnect in 10sec`)

    // Clear the hunger check interval
    if (this.hungerCheckInterval) {
      clearInterval(this.hungerCheckInterval);
      this.hungerCheckInterval = null;
    }

    // Clear behaviors to prevent references to old bot instance
    this.behaviors = {};

    // Don't remove all listeners as it can cause issues with reconnection
    // Just set bot to null so a new instance can be created
    /**
    this.bot = null;

    setTimeout(() => {
      this.start();
    }, 10000)*/
  }

  // optional: behavior registration helpers
  registerBehavior(name, behaviorInstance) {
    this.behaviors[name] = behaviorInstance;
  }

  disableBehaviors(names = []) {
    names.forEach(name => {
      const b = this.behaviors[name];
      if (b && b.enabled) b.disable();
    });
  }

  enableBehaviors(names = []) {
    names.forEach(name => {
      const b = this.behaviors[name];
      if (b && !b.enabled) b.enable();
    });
  }
}
