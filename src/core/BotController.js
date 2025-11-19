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
import MessageHandler from '../behaviors/MessageHandler.js';
import IdleBehavior from '../behaviors/IdleBehavior.js';
import SaveChestLocation from '../utils/SaveChestLocation.js';
import DebugTools from '../utils/DebugTools.js';
import PathfindingUtil from '../utils/PathfindingUtil.js';
import ToolHandler from '../utils/ToolHandler.js';
import ScaffoldingUtil from '../utils/ScaffoldingUtil.js';
import DepositUtil from '../utils/DepositUtil.js';
import AreaRegistry from '../state/AreaRegistry.js';
import ProxyManager from '../utils/ProxyManager.js';
import OreScanner from '../utils/OreScanner.js';
import BedRegistry from '../state/BedRegistry.js';
import TaskQueue from '../utils/TaskQueue.js';
import BotLoginCache from './BotLoginCache.js';
// NOTE: Legacy 'fs' import removed to satisfy lint (unused)
import fsp from 'fs/promises';
import path from 'path';
// Bridge (private command system) - optional
import { startBridgeServer, getBridgeStatus } from '../../private-bot-control/bridge/server.js';
import { wireBotToBridge } from '../../private-bot-control/mineflayer/bridgeClient.js';

export class BotController {
  static usernameList = null
  static usedNames = new Set()

  static async loadUsernameList() {
    if (BotController.usernameList !== null) return BotController.usernameList;
    const namesPath = path.join(process.cwd(), 'data', 'botNames.json');
    try {
      const raw = await fsp.readFile(namesPath, 'utf8');
      const data = JSON.parse(raw);
      BotController.usernameList = data.names || [];
      if (!Array.isArray(BotController.usernameList) || BotController.usernameList.length === 0) {
        console.warn('[BotController] No names found in botNames.json, using fallback');
        BotController.usernameList = ['bot'];
      }
    } catch (e) {
      console.warn('[BotController] Failed to load botNames.json asynchronously, using fallback:', e.message);
      BotController.usernameList = ['bot'];
    }
    return BotController.usernameList;
  }

  constructor(config, username = null, coordinator = null, instanceId = 0) {
    // Defer username selection until start() to allow async loading
    this.username = username || null;
    this.config = config;
    this.bot = null;
    this.mcData = null;
  this.logger = new Logger({ botId: this.username || undefined });
  this.behaviors = {};
  // Master player: prefer config, fallback to default
  this.master = (this.config && this.config.master) ? this.config.master : 'RogueZ3phyr';
    this.hungerCheckInterval = null;
    this.coordinator = coordinator; // Shared coordinator for multi-bot sync
    this.instanceId = instanceId; // Bot instance ID for proxy rotation
    this.shouldReconnect = true; // Allow runtime to disable auto-reconnect when removing

    // Initialize login cache for per-bot credentials & per-server registration
    this.loginCache = new BotLoginCache(this.logger, {
      cacheFilePath: this.config.security?.botLoginCache?.filePath
    });
    this.loginCache.init();
    this.loginCredentials = null;
    // Activation gate: bots start inactive and do nothing until activated via console command
    this.activated = false;
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
    return new Promise((resolve, reject) => {
      // Wrap async logic without using an async executor
      (async () => {
      // Ensure username list is loaded asynchronously before selecting a name
      try {
        await BotController.loadUsernameList();
        if (!this.username) {
          this.username = this.getAvailableUsername();
        }
        if (this.logger && typeof this.logger.setBotId === 'function') {
          this.logger.setBotId(this.username);
        }
  } catch (_e) {
        console.warn('[BotController] Username list load failed, continuing with fallback username');
        if (!this.username) this.username = 'Bot';
        if (this.logger && typeof this.logger.setBotId === 'function') {
          this.logger.setBotId(this.username);
        }
      }
      // Build bot options
      const botOptions = {
        host: this.config.host,
        port: this.config.port,
        username: this.username,
        version: this.config.version || 'auto'
      };

      // Retrieve or create persistent credentials for this bot username
      try {
        this.loginCredentials = this.loginCache.getOrCreateCredentials(this.username);
      } catch (credErr) {
        this.logger.warn('[BotController] Failed to load login credentials, continuing without cache:', credErr.message || credErr);
        this.loginCredentials = null;
      }

  // Initialize proxy manager (ensure async pool load completed first)
  await ProxyManager.loadProxyPool(this.logger);
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
              } catch (_e) {
                this.logger.warn(`[Proxy] IP check error: ${_e.message || _e}`);
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

  // Expose controller and activation state on bot for cross-module access
  try { this.bot.controller = this; } catch (_) {}
  try { this.bot.isActivated = false; } catch (_) {}

      // Apply global chat cooldown wrapper to prevent spammy output
      try {
        this.applyChatCooldown();
      } catch (e) {
        this.logger.warn('[BotController] Failed to apply chat cooldown wrapper:', e.message || e);
      }

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
      } catch (_e) {
        this.logger.warn('[BotController] Failed to load pathfinder plugin:', _e.message || _e);
      }
      
      // Track login timeout to clear it once authenticated
      let loginTimeout = null;
      
      // Basic lifecycle listeners
      this.bot.once('login', () => {
        // Clear the login timeout
        if (loginTimeout) {
          clearTimeout(loginTimeout);
          loginTimeout = null;
        }
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
          } catch (_e) {
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
      loginTimeout = setTimeout(() => {
        if (loginTimeout) {
          loginTimeout = null;
          reject(new Error('Bot login timeout after 30 seconds'));
        }
      }, 30000);

      // Register with BotManager early (before behaviors) if available
      if (this.coordinator && this.coordinator.manager) {
        try {
          this.coordinator.manager.registerBot(this.username, this);
          this.bot.manager = this.coordinator.manager;
          this.logger.debug('[BotController] Registered with BotManager');
        } catch (e) {
          this.logger.warn(`[BotController] BotManager registration failed: ${e.message}`);
        }
      }

      })().catch(reject);
    });
  }

  // Global chat cooldown wrapper to throttle bot.chat calls
  applyChatCooldown() {
    const bot = this.bot;
    if (!bot || typeof bot.chat !== 'function') return;

    const cooldownCfg = this.config.chat?.cooldown || {};
    const enabled = cooldownCfg.enabled !== false; // default: enabled
    const minIntervalMs = typeof cooldownCfg.minIntervalMs === 'number' && cooldownCfg.minIntervalMs > 0
      ? cooldownCfg.minIntervalMs
      : 1500;
    const loginGraceMs = typeof cooldownCfg.loginGraceMs === 'number' && cooldownCfg.loginGraceMs > 0
      ? cooldownCfg.loginGraceMs
      : 10000; // default: 10s with no outbound chat

    if (!enabled) {
      this.logger.info('[ChatCooldown] Global chat cooldown disabled via config');
      return;
    }

    const originalChat = bot.chat.bind(bot);
    this._originalChatFn = originalChat;

    let lastSent = 0;
    let queue = [];
    let timer = null;
    const loginTime = Date.now();

    const flushQueue = () => {
      if (!this.bot || typeof this.bot.chat !== 'function') {
        queue = [];
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }

      const now = Date.now();

      // During login grace period, do not send anything yet – just delay flush
      const sinceLogin = now - loginTime;
      if (sinceLogin < loginGraceMs) {
        const delay = Math.max(loginGraceMs - sinceLogin, 50);
        timer = setTimeout(flushQueue, delay);
        return;
      }

      if (queue.length === 0) {
        timer = null;
        return;
      }

      const elapsed = now - lastSent;

      if (elapsed >= minIntervalMs) {
        const msg = queue.shift();
        lastSent = now;
        try {
          originalChat(msg);
        } catch (err) {
          this.logger.warn(`[ChatCooldown] Failed to send queued message: ${err.message || err}`);
        }
      }

      if (queue.length > 0) {
        const delay = Math.max(minIntervalMs - (Date.now() - lastSent), 50);
        timer = setTimeout(flushQueue, delay);
      } else {
        timer = null;
      }
    };

    bot.chat = (msg) => {
      if (!msg) return;
      queue.push(msg);

      if (!timer) {
        const now = Date.now();
        const sinceLogin = now - loginTime;
        let delay;

        if (sinceLogin < loginGraceMs) {
          // Defer first flush until grace period has ended
          delay = loginGraceMs - sinceLogin;
        } else {
          const elapsed = now - lastSent;
          delay = elapsed >= minIntervalMs ? 0 : (minIntervalMs - elapsed);
        }

        timer = setTimeout(flushQueue, Math.max(delay, 0));
      }
    };

    this.logger.info(`[ChatCooldown] Enabled with minIntervalMs=${minIntervalMs}, loginGraceMs=${loginGraceMs}`);
  }

  onLogin() {
    // choose host text defensively because internals differ by net impl
    const host = (this.bot?._client?.socket?._host) || this.config.host || 'unknown';
    this.logger.success(`[BOT] Logged into ${host}`);
  }

  onSpawn() {
  // Show banner; prefix with marker only in dashboard mode so runtime can preserve coloring
  if (process.env.DASHBOARD_MODE === 'electron') {
    console.log('[BANNER]', figlet.textSync('MineBot', { horizontalLayout: 'full' }));
  } else {
    console.log(figlet.textSync('MineBot', { horizontalLayout: 'full' }));
  }
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

    // Initialize ore scanner for vein mining
    this.oreScanner = new OreScanner(this.bot, this.logger);
    this.bot.oreScanner = this.oreScanner;
    this.logger.info('[BotController] OreScanner initialized');

    // Initialize task queue for sequential task execution
    this.taskQueue = new TaskQueue(this.bot, this.logger);
    this.bot.taskQueue = this.taskQueue;
    this.logger.info('[BotController] TaskQueue initialized');

    this.behaviors.deposit = new DepositBehavior(this.bot, this.logger);
    this.bot.depositBehavior = this.behaviors.deposit;

  // Item collector (modular)
  this.behaviors.itemCollector = new ItemCollectorBehavior(this.bot, this.logger, this.areaRegistry);
  this.bot.itemCollector = this.behaviors.itemCollector;
    // Auto-start item collector if configured
    try {
      const icCfg = this.config?.behaviors?.itemCollector || {};
      if (icCfg.autoStart) {
        if (this.activated) {
          this.behaviors.itemCollector.startAuto({
            type: icCfg.type || 'farm',
            intervalMs: typeof icCfg.intervalMs === 'number' ? icCfg.intervalMs : 10000,
            radius: typeof icCfg.radius === 'number' ? icCfg.radius : 8
          });
          this.logger.info('[BotController] ItemCollector auto-started');
        } else {
          this.logger.info('[BotController] ItemCollector autoStart deferred until activation');
        }
      }
    } catch (e) {
      this.logger.warn('[BotController] Failed to evaluate ItemCollector auto-start:', e.message || e);
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
    
    // Initialize centralized deposit utility
    this.depositUtil = new DepositUtil(this.bot, this.logger);
    this.bot.depositUtil = this.depositUtil;
    this.logger.info('[BotController] DepositUtil initialized');
    
  // Initialize scaffolding utility unless basic mode is requested
    const useBasicScaffolding = !!(this.config.behaviors?.woodcutting?.useBasicScaffolding);
    if (!useBasicScaffolding) {
      const scaffoldConfig = this.config.behaviors?.woodcutting?.scaffolding || {};
      this.scaffoldingUtil = new ScaffoldingUtil(this.bot, this.logger, {
        allowedBlocks: scaffoldConfig.allowedBlocks || this.config.behaviors?.woodcutting?.scaffoldBlocks || ['dirt', 'cobblestone'],
        basePlaceCost: scaffoldConfig.basePlaceCost || 10,
        baseDigCost: scaffoldConfig.baseDigCost || 40,
        lagThresholdMs: scaffoldConfig.lagThresholdMs || 100,
        allowParkour: scaffoldConfig.allowParkour === true,
        allowSprinting: scaffoldConfig.allowSprinting === true,
        maxDropDown: scaffoldConfig.maxDropDown || 4,
        trackPlacedBlocks: scaffoldConfig.trackPlacedBlocks !== false,
        cleanupDelayMs: scaffoldConfig.cleanupDelayMs || 80
      });
      this.bot.scaffoldingUtil = this.scaffoldingUtil;
      this.logger.info('[BotController] ScaffoldingUtil initialized (full mode)');
    } else {
      this.logger.info('[BotController] Basic scaffolding mode enabled (no ScaffoldingUtil)');
    }
    this.bot.scaffoldingMode = useBasicScaffolding ? 'base' : 'full';

    this.logger.info(`${chalk.green(this.username)} has loaded correctly`)
    //this.bot.chat(`/msg ${this.master} Hello! Test environment loaded!`);

    // Initialize all behaviors with proper configuration
    const lookConfig = this.config.behaviors?.look || {};
  this.behaviors.look = new LookBehavior(this.bot, lookConfig);
  this.behaviors.look.master = this.master; // Pass master username
  // Do NOT enable by default; activation required to start any behavior
    this.bot.lookBehavior = this.behaviors.look; // Make accessible via bot object
    this.logger.info('LookBehavior initialized successfully!');

    this.behaviors.chatLogger = new ChatLogger(this.bot, this.logger, BotController.usernameList);
  // ChatLogger is safe to enable (logging only, no actions)
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
    this.bot.sleepBehavior = this.behaviors.sleep; // make accessible via bot object

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

    // ItemCollector with look behavior integration
    this.behaviors.itemCollector.setLookBehavior(this.behaviors.look);
    this.logger.info('ItemCollector look behavior integrated');

    // Home behavior for graceful logout
    this.behaviors.home = new HomeBehavior(this.bot, this.logger);
    this.bot.homeBehavior = this.behaviors.home; // Make accessible via bot object
  this.logger.info('HomeBehavior initialized successfully!');

    // Start Bridge server once per process (optional, gated by config)
    try {
      const pb = this.config?.security?.privateBridge || {};
      if (pb.enabled && !BotController._bridgeServerStarted) {
        startBridgeServer({ host: pb.host, port: pb.port, secret: pb.secret });
        BotController._bridgeServerStarted = true;
        const st = getBridgeStatus();
        this.logger.info(`[Bridge] Started on ${st.host}:${st.port}`);
      }
    } catch (e) {
      this.logger.warn(`[Bridge] Failed to start: ${e?.message || e}`);
    }

    this.behaviors.chatCommands = new ChatCommandHandler(this.bot, this.master, this.behaviors, this.config);
    // Expose for external controllers (dashboard runtime) to invoke commands directly
    // This is required because the Electron runtime calls controller.bot.chatCommandHandler.handleMessage(...)
    // when relaying commands from the dashboard UI.
    this.bot.chatCommandHandler = this.behaviors.chatCommands;
    // Initialize asynchronously but do not block spawn completion
    (async () => {
      try {
        await this.behaviors.chatCommands.init();
        this.logger.info('ChatCommandHandler initialized successfully!');
      } catch (e) {
        this.logger.warn(`ChatCommandHandler init failed: ${e.message || e}`);
      }
    })();

    // Wire this bot to the bridge so it can handle private commands (come/follow/mine)
    try {
      const pb = this.config?.security?.privateBridge || {};
      if (pb.enabled) {
        wireBotToBridge(this.bot, this.logger);
        this.logger.info('[Bridge] Bot wired to private command bridge');
      }
    } catch (e) {
      this.logger.warn(`[Bridge] Wiring failed: ${e?.message || e}`);
    }

    // Set up hunger check interval (gated by activation; logs only in debug mode)
    if (this.hungerCheckInterval) {
      clearInterval(this.hungerCheckInterval);
    }

    this.hungerCheckInterval = setInterval(async () => {
      try {
        if (!this.activated) {
          // Skip hunger checks while inactive
          return;
        }
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

    // MessageHandler: handle out-of-band manager messages
    try {
      this.behaviors.messageHandler = new MessageHandler(this.bot, this.logger, this.master);
      // Do not enable MessageHandler until activation (prevents manager-driven actions)
      // if (typeof this.behaviors.messageHandler.enable === 'function') this.behaviors.messageHandler.enable();
      this.logger.info('MessageHandler initialized (disabled until activation)');
    } catch (e) {
      this.logger.warn(`MessageHandler init failed: ${e.message || e}`);
    }

    // IdleBehavior: send bot to idle area and wait for tasks or night
    try {
      const idleCfg = this.config.behaviors?.idle || {};
      this.behaviors.idle = new IdleBehavior(this.bot, this.logger, idleCfg);
      // Do not enable idle by default; activation or explicit command should start it
      this.logger.info('IdleBehavior initialized (disabled by default)');
    } catch (e) {
      this.logger.warn(`IdleBehavior init failed: ${e.message || e}`);
    }

    // Auto bed claim attempt upon spawn (non-sleep claim for ownership; notify master if none)
    try {
      if (this.behaviors.sleep && !this.behaviors.sleep.bedPos && this.activated) {
        (async () => {
          try {
            const pos = await this.behaviors.sleep.findAvailableBed();
            if (pos) {
              this.logger.info(`[AutoBed] Claimed bed at ${pos.x},${pos.y},${pos.z} on spawn`);
              // Track claimed bed on sleep behavior for later release
              this.behaviors.sleep.bedPos = pos;
            } else {
              this.logger.warn('[AutoBed] No available bed to claim on spawn');

              // Optionally whisper master requesting a bed placement, but respect chat timing guards.
              if (this.master && this.bot && typeof this.bot.chat === 'function') {
                const cooldownCfg = this.config.chat?.cooldown || {};
                const loginGraceMs = typeof cooldownCfg.loginGraceMs === 'number' && cooldownCfg.loginGraceMs > 0
                  ? cooldownCfg.loginGraceMs
                  : 10000;

                const bedMsg = `/msg ${this.master} No free bed found near spawn. Please place a ${this.config.behaviors?.sleep?.bedColor || 'red'} bed.`;

                // Defer the message until after the login grace period to avoid early command spam
                setTimeout(() => {
                  try {
                    if (this.bot && typeof this.bot.chat === 'function') {
                      this.bot.chat(bedMsg);
                    }
                  } catch (err) {
                    this.logger.warn('[AutoBed] Failed to send bed request whisper:', err.message || err);
                  }
                }, loginGraceMs);
              }
            }
          } catch (bedErr) {
            this.logger.warn(`[AutoBed] Bed claim failed: ${bedErr.message || bedErr}`);
          }
        })();
      }
    } catch (_) {}

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

    // After full spawn initialization, handle server auth (first-time register or login-on-join)
    try {
      this.handleServerAuthCommands();
    } catch (e) {
      this.logger.warn('[Auth] Server auth handler failed:', e.message || e);
    }
  }

  // -------- Activation controls --------
  isActive() { return this.activated === true; }

  activate(_options = {}) {
    // Idempotent activation
    this.activated = true;
    if (this.bot) this.bot.isActivated = true;

    this.logger.info(`[Activation] ${this.username} activated`);

    // Enable safe, non-invasive behaviors on activation if desired
    try { if (this.behaviors.look && !this.behaviors.look.enabled) this.behaviors.look.enable(); } catch (_) {}

    // Start item collector auto loop if configured
    try {
      const icCfg = this.config?.behaviors?.itemCollector || {};
      if (this.behaviors.itemCollector && icCfg.autoStart && !this.behaviors.itemCollector.isRunning) {
        this.behaviors.itemCollector.startAuto({
          type: icCfg.type || 'farm',
          intervalMs: typeof icCfg.intervalMs === 'number' ? icCfg.intervalMs : 10000,
          radius: typeof icCfg.radius === 'number' ? icCfg.radius : 8
        });
        this.logger.info('[Activation] ItemCollector auto-started');
      }
    } catch (e) {
      this.logger.warn('[Activation] Failed to auto-start ItemCollector:', e.message || e);
    }

    // Enable manager message handler if present
    try {
      if (this.behaviors.messageHandler && typeof this.behaviors.messageHandler.enable === 'function') {
        this.behaviors.messageHandler.enable();
      }
    } catch (_) {}

    return true;
  }

  deactivate() {
    this.activated = false;
    if (this.bot) this.bot.isActivated = false;
    this.logger.info(`[Activation] ${this.username} deactivated`);

    // Stop movement/pathfinding
    try { if (this.bot?.pathfindingUtil) this.bot.pathfindingUtil.stop(); } catch (_) {}
    try { if (this.bot?.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') this.bot.pathfinder.setGoal(null); } catch (_) {}

    // Disable/stop behaviors that could perform actions
    try { if (this.behaviors.mining?.isWorking && typeof this.behaviors.mining.stopMining === 'function') this.behaviors.mining.stopMining(); } catch (_) {}
    try { if (this.behaviors.farm?.isWorking && typeof this.behaviors.farm.disable === 'function') this.behaviors.farm.disable(); } catch (_) {}
    try { if (this.behaviors.woodcutting?.isWorking && typeof this.behaviors.woodcutting.disable === 'function') this.behaviors.woodcutting.disable(); } catch (_) {}
    try { if (this.behaviors.itemCollector?.isRunning && typeof this.behaviors.itemCollector.stopAuto === 'function') this.behaviors.itemCollector.stopAuto(); } catch (_) {}
    try { if (this.behaviors.idle?.isIdle && typeof this.behaviors.idle.stopIdle === 'function') this.behaviors.idle.stopIdle(); } catch (_) {}
    try { if (this.behaviors.look?.enabled && typeof this.behaviors.look.pause === 'function') this.behaviors.look.pause(); } catch (_) {}

    // Disable manager message handler to avoid task triggers
    try { if (this.behaviors.messageHandler && typeof this.behaviors.messageHandler.disable === 'function') this.behaviors.messageHandler.disable(); } catch (_) {}

    return true;
  }

  handleServerAuthCommands() {
    const bot = this.bot;
    const creds = this.loginCredentials;
    if (!bot || !creds || !this.loginCache) return;

    const host = this.config.host;
    const port = this.config.port;
    const serverKey = `${host}:${port}`;
    const username = creds.username;
    const password = creds.password;

    if (!password) {
      this.logger.warn('[Auth] No password available for server auth');
      return;
    }

    const isRegistered = this.loginCache.hasServerRegistration(username, serverKey);

    // Resolve templates and delays (supports per-server overrides)
    const globalCfg = this.config.security?.botLoginCache || {};
    const override = (globalCfg.serverOverrides && globalCfg.serverOverrides[serverKey]) || {};

  const firstTpl = override.firstLoginCommandTemplate ?? globalCfg.firstLoginCommandTemplate ?? '/register {password} {confirm}';
  const firstDelay = override.firstLoginCommandDelayMs ?? globalCfg.firstLoginCommandDelayMs ?? 3000;

  // Optional second step for registration confirmation (e.g., "/password confirm {password}")
  const confirmTpl = override.firstLoginConfirmCommandTemplate ?? globalCfg.firstLoginConfirmCommandTemplate;
  // Interpret confirm delay as time AFTER the first command is sent
  const confirmDelay = override.firstLoginConfirmCommandDelayMs ?? globalCfg.firstLoginConfirmCommandDelayMs ?? 4000;

    const loginTpl = override.loginOnJoinCommandTemplate ?? globalCfg.loginOnJoinCommandTemplate; // may be undefined to disable
    const loginDelay = override.loginCommandDelayMs ?? globalCfg.loginCommandDelayMs ?? 12000;

    const render = (tpl) => (tpl || '')
      .replaceAll('{password}', password)
      .replaceAll('{confirm}', password)
      .replaceAll('{username}', username);

    // For authentication, bypass global chat cooldown and allowInGameChat guard
    // Auth commands are essential and should be sent even when normal chat is disabled.
    const sendAuthCommand = (msg) => {
      if (!msg) return;
      try {
        const fn = this._originalChatFn || (this.bot && this.bot.chat && this.bot.chat.bind(this.bot));
        if (fn) fn(msg);
      } catch (err) {
        this.logger.error('[Auth] Failed to send auth command:', err?.message || err);
      }
    };

    if (!isRegistered) {
      const cmd = render(firstTpl);
      if (!cmd) {
        this.logger.warn('[Auth] No firstLoginCommandTemplate configured; cannot register');
        return;
      }
      this.logger.info(`[Auth] Scheduling first-time register for "${username}" on ${serverKey} in ${firstDelay} ms: ${cmd}`);
      setTimeout(() => {
        try {
          if (!this.bot) return;
          sendAuthCommand(cmd);

          // If a confirm template is provided, chain it after a delay, then mark as registered
          const confirmCmd = confirmTpl ? render(confirmTpl) : null;
          if (confirmCmd) {
            this.logger.info(`[Auth] Scheduling registration confirm for "${username}" on ${serverKey} in ${confirmDelay} ms after first command: ${confirmCmd}`);
            setTimeout(() => {
              try {
                if (!this.bot) return;
                sendAuthCommand(confirmCmd);
                this.loginCache.markServerRegistration(username, serverKey);
              } catch (err) {
                this.logger.error('[Auth] Failed to send registration confirm command:', err);
              }
            }, Math.max(0, confirmDelay));
          } else {
            // No confirm step configured; mark registration now
            this.loginCache.markServerRegistration(username, serverKey);
          }
        } catch (err) {
          this.logger.error('[Auth] Failed to send register command:', err);
        }
      }, firstDelay);
      return;
    }

    // Already registered – optionally send a login command if configured
    this.loginCache.markServerRegistration(username, serverKey); // update lastSeen
    if (loginTpl) {
      const loginCmd = render(loginTpl);
      if (loginCmd) {
        this.logger.info(`[Auth] Scheduling login-on-join for "${username}" on ${serverKey} in ${loginDelay} ms: ${loginCmd}`);
        setTimeout(() => {
          try {
            if (!this.bot) return;
            sendAuthCommand(loginCmd);
          } catch (err) {
            this.logger.error('[Auth] Failed to send login-on-join command:', err);
          }
        }, loginDelay);
      }
    }
  }

  onEnd() {
    this.logger.warn(`${chalk.green(this.username)} has been logged out of the server`)
    this.logger.warn(`Attempting to reconnect in 10sec`)

    // Clear the hunger check interval
    if (this.hungerCheckInterval) {
      clearInterval(this.hungerCheckInterval);
      this.hungerCheckInterval = null;
    }

    // Clear task polling interval if enabled
    // Disable task polling (clears interval and unregisters manager handler)
    try {
      this.disableTaskPolling();
    } catch (_) {
      if (this._taskPollTimer) {
        clearInterval(this._taskPollTimer);
        this._taskPollTimer = null;
      }
    }

    // Clear coordinator cleanup interval
    if (this.coordinatorCleanupInterval) {
      clearInterval(this.coordinatorCleanupInterval);
      this.coordinatorCleanupInterval = null;
    }
    
    // Dispose of chat command handler listeners
    if (this.bot && this.bot.chatCommandHandler && typeof this.bot.chatCommandHandler.dispose === 'function') {
      this.bot.chatCommandHandler.dispose();
    }
    
    // Dispose of path cache listeners
    if (this.pathfindingUtil && this.pathfindingUtil.pathCache && typeof this.pathfindingUtil.pathCache.dispose === 'function') {
      this.pathfindingUtil.pathCache.dispose();
    }

    // Clear behaviors to prevent references to old bot instance
    this.behaviors = {};

    // Release any claimed bed (best-effort) if sleep behavior tracked one
    try {
      const sb = this.bot?.sleepBehavior;
      if (sb?.claimedBedKey) {
        BedRegistry.release(sb.claimedBedKey);
        this.logger.info('[AutoBed] Released bed claim on end');
      } else if (sb?.bedPos) {
        // Backward compatibility fallback
        BedRegistry.release(BedRegistry.toKey(sb.bedPos));
        this.logger.info('[AutoBed] Released bed claim on end (fallback)');
      }
    } catch (_) {}

    // Don't remove all listeners as it can cause issues with reconnection
    // Just set bot to null so a new instance can be created
    
    this.bot = null;

    if (this.shouldReconnect) {
      setTimeout(() => {
        this.start();
      }, 10000)
    }
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

  /**
   * Enable periodic polling of the task manager so this bot can pull work.
   * Bots should call this after they are spawned (or BotController can call it
   * when a manager is available). Claimed tasks are handled by a behavior
   * named `taskHandler` if present, otherwise a small default handler runs.
   *
   * @param {object} taskManager - instance of BotManager
   * @param {number} intervalMs - poll interval in ms
   */
  enableTaskPolling(taskManager, intervalMs = 5000) {
    if (!taskManager) return;
    this.taskManager = taskManager;
    if (this._taskPollTimer) clearInterval(this._taskPollTimer);
    this._taskPollTimer = null;

    // Handler for incoming manager messages (out-of-band)
    this._managerMsgHandler = (msg) => {
      try {
        if (!this.activated) return; // ignore while inactive
        if (msg.to && msg.to !== this.username) return; // not for me
        // If behavior exists to handle manager messages, call it
        if (this.behaviors.messageHandler && typeof this.behaviors.messageHandler.handleManagerMessage === 'function') {
          this.behaviors.messageHandler.handleManagerMessage(msg, this);
          return;
        }
        this.logger.info(`[INTERNAL MSG] ${msg.from} -> ${msg.to || 'ALL'}: ${JSON.stringify(msg.payload)}`);
      } catch (err) {
        this.logger.warn(`[INTERNAL MSG] handler error: ${err.message || err}`);
      }
    };
    taskManager.on('botMessage', this._managerMsgHandler);

    const pollFn = async () => {
      try {
        if (!this.activated) return; // do not claim tasks while inactive
        if (!this.bot || !this.bot.entity) return;
        const task = this.taskManager.claimNextTask(this.username);
        if (!task) return;

        this.logger.info(`[TASK] ${this.username} claimed ${task.id} (${task.type})`);

        // If a taskHandler behavior exists, delegate execution
        if (this.behaviors.taskHandler && typeof this.behaviors.taskHandler.handleTask === 'function') {
          try {
            await this.behaviors.taskHandler.handleTask(task, this);
          } catch (err) {
            this.logger.error(`[TASK] handler error for ${task.id}: ${err.message || err}`);
            // release so others can pick it up
            this.taskManager.releaseTask(this.username, task.id);
            return;
          }
        } else {
          // Default lightweight handlers for demo purposes
          try {
                // Avoid using public in-game chat by default to prevent spam/kicks.
                // If config allows in-game chat, use it; otherwise forward to master via manager.
                if (task.type === 'chat') {
                  const msg = String(task.payload?.message || '');
                  const allowChat = !!(this.config?.allowInGameChat === true);
                  if (allowChat && this.bot.chat) {
                    this.bot.chat(msg);
                  } else if (this.taskManager) {
                    // send out-of-band to master (or broadcast if no master set)
                    const target = this.master || null;
                    this.taskManager.sendBotMessage(this.username, target, { type: 'chat', message: msg });
                  } else {
                    this.logger.info(`[TASK] ${this.username} would send chat: ${msg}`);
                  }
                } else if (task.type === 'log') {
                  this.logger.info(`[TASK-LOG] ${this.username}: ${JSON.stringify(task.payload)}`);
                } else {
                  this.logger.info(`[TASK] ${this.username} received unknown task type '${task.type}'`);
                }
          } catch (err) {
            this.logger.error(`[TASK] default handler failed for ${task.id}: ${err.message || err}`);
            this.taskManager.releaseTask(this.username, task.id);
            return;
          }
        }

        // Mark complete
        try {
          this.taskManager.completeTask(this.username, task.id);
        } catch (err) {
          this.logger.error(`[TASK] failed to complete ${task.id}: ${err.message || err}`);
        }
      } catch (err) {
        this.logger.error(`[TASK-POLL] error: ${err.message || err}`);
      }
    };

    // Start interval and run immediately
    this._taskPollTimer = setInterval(pollFn, intervalMs);
    // run once immediately
    setImmediate(pollFn);
  }

  disableTaskPolling() {
    if (this._taskPollTimer) {
      clearInterval(this._taskPollTimer);
      this._taskPollTimer = null;
    }
    this.taskManager = null;
    if (this._managerMsgHandler && this.taskManager) {
      try {
        this.taskManager.off('botMessage', this._managerMsgHandler);
      } catch (_) {}
      this._managerMsgHandler = null;
    }
  }
}
