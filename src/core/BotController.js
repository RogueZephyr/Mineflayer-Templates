// src/core/BotController.js
import mineflayer from 'mineflayer';
import * as pathfinderModule from 'mineflayer-pathfinder';
import mcDataFactory from 'minecraft-data';
import chalk from 'chalk';
import figlet from 'figlet';

import LookBehavior from '../behaviors/LookBehavior.js';
import Logger from '../utils/logger.js';
import ChatLogger from '../behaviors/ChatLogger.js';
import ChatDebugLogger from '../utils/ChatDebugLogger.js';
import ChatCommandHandler from '../utils/ChatCommandHandler.js';
import EatBehavior from '../behaviors/EatBehavior.js';
import SleepBehavior from '../behaviors/SleepBehavior.js';
import InventoryBehavior from '../behaviors/InventoryBehavior.js';
import DepositBehavior from '../behaviors/DepositBehavior.js';
import FarmBehavior from '../behaviors/FarmBehavior.js';
import ItemCollectorBehavior from '../behaviors/ItemCollectorBehavior.js';
import HomeBehavior from '../behaviors/HomeBehavior.js';
import WoodCuttingBehavior from '../behaviors/WoodCuttingBehavior.js';
import MiningBehavior from '../behaviors/MiningBehavior.js';
import SaveChestLocation from '../utils/SaveChestLocation.js';
import DebugTools from '../utils/DebugTools.js';
import PathfindingUtil from '../utils/PathfindingUtil.js';
import ToolHandler from '../utils/ToolHandler.js';
import AreaRegistry from '../state/AreaRegistry.js';
import ProxyManager from '../utils/ProxyManager.js';
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

  constructor(config, username = null, coordinator = null, instanceId = 0) {
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
    this.instanceId = instanceId; // Bot instance ID for proxy rotation
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

  start(retryCount = 0, maxRetries = 3) {
    // Return a promise that resolves when bot successfully logs in
    return new Promise(async (resolve, reject) => {
      // Build bot options
      const botOptions = {
        host: this.config.host,
        port: this.config.port,
        username: this.username,
        version: this.config.version || 'auto'
      };

      // Initialize proxy manager
      const proxyManager = new ProxyManager(this.config, this.logger, this.instanceId);
      
      // Assign proxy from pool if rotation is enabled
      if (ProxyManager.proxyPool?.rotation?.enabled) {
        proxyManager.assignProxyFromPool();
      }
      
      // Validate proxy configuration
      const validation = proxyManager.validateConfig();
      if (!validation.valid) {
        this.logger.error('[Proxy] Invalid configuration:');
        validation.errors.forEach(err => this.logger.error(`  - ${err}`));
        reject(new Error('Invalid proxy configuration'));
        return;
      }

      // Add proxy connection if enabled
      if (proxyManager.isEnabled()) {
        try {
          const connectFn = await proxyManager.getProxyConnectFunction(
            this.config.host,
            this.config.port
          );
          
          if (connectFn) {
            botOptions.connect = connectFn;
            const proxyInfo = proxyManager.getProxyInfo();
            const label = proxyInfo.label || `${proxyInfo.host}:${proxyInfo.port}`;
            this.logger.info(`[Proxy] Enabled: ${label} (${proxyInfo.type}${proxyInfo.authenticated ? ', authenticated' : ''})`);
            // Optional: check and log external IP before connecting, if configured
            if (this.config.proxy?.ipCheckOnStart) {
              try {
                const ip = await proxyManager.fetchExternalIP();
                if (ip) this.logger.info(`[Proxy] External IP (pre-login): ${ip}`);
                else this.logger.warn('[Proxy] External IP could not be determined before login');
              } catch (e) {
                this.logger.warn(`[Proxy] IP check error: ${e.message || e}`);
              }
            }
          }
        } catch (err) {
          this.logger.error(`[Proxy] Failed to initialize: ${err.message}`);
          reject(err);
          return;
        }
      }

      // create the bot instance
      this.bot = mineflayer.createBot(botOptions);

      // Attach usernameList to bot for ChatCommandHandler access
      this.bot.constructor.usernameList = BotController.usernameList;

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
      this.bot.once('login', () => {
        this.onLogin();
        resolve(this); // Resolve promise when login succeeds
      });
      
      this.bot.once('spawn', () => this.onSpawn());

      // global error handling
      this.bot.on('kicked', (reason) => {
        const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
        this.logger.warn(`Kicked: ${reasonStr}`);
        
        // Check if it's a rate limit kick
        const isRateLimit = reasonStr.includes('wait') && reasonStr.includes('seconds');
        
        if (isRateLimit && retryCount < maxRetries) {
          // Extract wait time from message (e.g., "You must wait 11 seconds")
          const waitMatch = reasonStr.match(/wait (\d+) seconds?/i);
          const waitTime = waitMatch ? parseInt(waitMatch[1]) : 5;
          const actualWait = Math.max(waitTime, 5) + 2; // Add 2 second buffer
          
          this.logger.info(`Rate limited. Retrying in ${actualWait} seconds... (Attempt ${retryCount + 1}/${maxRetries})`);
          
          // Clean up current bot instance
          try {
            this.bot.removeAllListeners();
            this.bot.quit();
          } catch (e) {
            // Ignore cleanup errors
          }
          
          // Retry after waiting
          setTimeout(() => {
            this.start(retryCount + 1, maxRetries)
              .then(resolve)
              .catch(reject);
          }, actualWait * 1000);
        } else {
          reject(new Error(`Bot kicked: ${reasonStr}`));
        }
      });
      
      this.bot.on('end', (reason) => {
        this.logger.warn(`Connection ended. Reason: ${reason || 'unknown'}`);
        this.onEnd();
      });
      
      this.bot.on('error', (err) => {
        // Handle PartialReadError gracefully (common with complex NBT data)
        if (err.partialReadError || err.message?.includes('PartialReadError')) {
          this.logger.warn(`[Protocol] Partial read error (likely NBT/inventory data) - continuing...`);
          return;
        }
        this.logger.error(`Bot error: ${err}`);
        reject(err);
      });
      
      this.bot.on('disconnect', (packet) => this.logger.warn(`Disconnected: ${JSON.stringify(packet)}`));

      // Timeout after 30 seconds if login doesn't succeed
      setTimeout(() => {
        reject(new Error('Bot login timeout after 30 seconds'));
      }, 30000);
    });
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
        
        // Simplified collision avoidance - only check final goal, not every movement
        // (Checking every movement is too expensive and causes lag)
        if (this.coordinator) {
          this.logger.info('[BotController] Bot coordination enabled (work zones & block claiming)');
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

    // Initialize tool handler for optimal tool selection
    this.toolHandler = new ToolHandler(this.bot, this.logger);
    this.bot.toolHandler = this.toolHandler;
    this.logger.info('[BotController] ToolHandler initialized');

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

    // Initialize centralized pathfinding utility with config
    this.pathfindingUtil = new PathfindingUtil(this.bot, this.coordinator, this.logger, this.config);
    this.bot.pathfindingUtil = this.pathfindingUtil;
    this.logger.info('[BotController] PathfindingUtil initialized with path caching');

    this.logger.info(`${chalk.green(this.username)} has loaded correctly`)
    //this.bot.chat(`/msg ${this.master} Hello! Test environment loaded!`);

    // Initialize all behaviors with proper configuration
    const lookConfig = this.config.behaviors?.look || {};
    this.behaviors.look = new LookBehavior(this.bot, lookConfig);
    this.behaviors.look.master = this.master; // Pass master username
    this.behaviors.look.enable(); // enable by default
    this.logger.info('LookBehavior initialized successfully!');

    this.behaviors.chatLogger = new ChatLogger(this.bot, this.logger, BotController.usernameList);
    this.behaviors.chatLogger.enable();
    this.logger.info('ChatLogger initialized successfully!');

    // Initialize ChatDebugLogger if enabled in config
    if (this.config.chatDebugLogger?.enabled) {
      this.behaviors.chatDebugLogger = new ChatDebugLogger(this.bot, this.logger, this.config);
      this.behaviors.chatDebugLogger.enable();
      this.logger.info('ChatDebugLogger enabled - logging all chat events to file');
    }

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

    // WoodCutting behavior with look behavior integration
    this.behaviors.woodcutting = new WoodCuttingBehavior(this.bot, this.logger, this.master);
    this.behaviors.woodcutting.setLookBehavior(this.behaviors.look);
    this.logger.info('WoodCuttingBehavior initialized successfully!');

    // Mining behavior with look behavior integration
    this.behaviors.mining = new MiningBehavior(this.bot, this.logger, this.master);
    this.behaviors.mining.setLookBehavior(this.behaviors.look);
    this.logger.info('MiningBehavior initialized successfully!');

    // Home behavior for graceful logout
    this.behaviors.home = new HomeBehavior(this.bot, this.logger);
    this.bot.homeBehavior = this.behaviors.home; // Make accessible via bot object
    this.logger.info('HomeBehavior initialized successfully!');

    this.behaviors.chatCommands = new ChatCommandHandler(this.bot, this.master, this.behaviors, this.config);
    this.logger.info('ChatCommandHandler initialized successfully!');

    // Set up hunger check interval (always runs, logs only in debug mode)
    if (this.hungerCheckInterval) {
      clearInterval(this.hungerCheckInterval);
    }

    this.hungerCheckInterval = setInterval(async () => {
      try {
        if (this.config.debug === true) {
          this.logger.debug(`Checking hunger...`);
        }
        await this.behaviors.eat.checkHunger();
      } catch (err) {
        if (this.config.debug === true) {
          this.logger.error(`Error in checkHunger: ${err.message}`);
        }
      }
    }, 30000); // Check every 30 seconds

    // Set up coordinator cleanup interval (if coordinator is available)
    if (this.coordinator) {
      this.coordinatorCleanupInterval = setInterval(() => {
        try {
          this.coordinator.cleanup();
        } catch (err) {
          this.logger.error(`[Coordinator] Cleanup error: ${err.message}`);
        }
      }, 10000); // Clean up every 10 seconds
    }

    this.logger.info('All behaviors initialized successfully!');

    // If proxy is enabled and ipCheckOnStart is true, show the external IP once after spawn
    try {
      const proxyManager = new ProxyManager(this.config, this.logger);
      if (proxyManager.isEnabled() && this.config.proxy?.ipCheckOnStart === true) {
        // Run asynchronously; no need to block
        (async () => {
          const ip = await proxyManager.fetchExternalIP();
          if (ip) this.logger.success(`[Proxy] External IP (post-login): ${ip}`);
          else this.logger.warn('[Proxy] External IP could not be determined post-login');
        })();
      }
    } catch (_) { /* ignore */ }
  }

  onEnd() {
    this.logger.warn(`${chalk.green(this.username)} has been logged out of the server`)
    this.logger.warn(`Attempting to reconnect in 10sec`)

    // Clear the hunger check interval
    if (this.hungerCheckInterval) {
      clearInterval(this.hungerCheckInterval);
      this.hungerCheckInterval = null;
    }

    // Clear coordinator cleanup interval
    if (this.coordinatorCleanupInterval) {
      clearInterval(this.coordinatorCleanupInterval);
      this.coordinatorCleanupInterval = null;
    }

    // Clear behaviors to prevent references to old bot instance
    this.behaviors = {};

    // Don't remove all listeners as it can cause issues with reconnection
    // Just set bot to null so a new instance can be created
    
    this.bot = null;

    setTimeout(() => {
      this.start();
    }, 10000)
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
