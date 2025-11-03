// src/core/BotController.js
import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import mcDataLoader from 'minecraft-data';
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

export default class BotController {
  static usernameList = ['RogueW0lfy', 'Subject_9-17', 'L@b_R4t']
  static usedNames = new Set()

  constructor(config, username = null) {
    this.username = username || this.getAvailableUsername();
    this.config = config;
    this.bot = null;
    this.mcData = null;
    this.logger = new Logger();
    this.behaviors = {};
    this.master = 'RogueZ3phyr';
    this.hungerCheckInterval = null;
  }

  getAvailableUsername() {
    for (const name of BotController.usernameList) {
      if (!BotController.usedNames.has(name)) {
        BotController.usedNames.add(name);
        return name;
      }
    }
  }

  start() {
    // create the bot instance
    this.bot = mineflayer.createBot({
      host: this.config.host,
      port: this.config.port,
      username: this.username,
      version: this.config.version || 'auto'
    });

    // load plugins immediately after creation
    this.bot.loadPlugin(pathfinder);

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
    this.mcData = mcDataLoader(this.bot.version);

    this.logger.info(`${chalk.green(this.username)} has loaded correctly`)
    this.bot.chat(`/msg ${this.master} Hello! Test environment loaded!`);

    // initialize and register behaviors
    const lookConfig = this.config.behaviors?.look || {};
    this.behaviors.look = new LookBehavior(this.bot, lookConfig);
    this.logger.info('LookBehavior initialized successfully!');

    this.behaviors.chatLogger = new ChatLogger(this.bot, this.logger, BotController.usernameList)
    this.behaviors.chatLogger.enable()
    this.logger.info('ChatLogger initialized successfully!')

    this.behaviors.eat = new EatBehavior(this.bot, this.logger, this.master);
    this.behaviors.sleep = new SleepBehavior(
      this.bot,
      this.mcData,
      this.logger,
      { bedColor: this.config.behaviors?.sleep?.bedColor || 'red' },
      { look: this.behaviors.look } // pass LookBehavior instance
    );

    this.behaviors.inventory = new InventoryBehavior(this.bot, this.logger);
    this.behaviors.inventory.logInventory();
    this.behaviors.deposit = new DepositBehavior(this.bot, this.logger);
    this.logger.info('DepositBehavior initialized successfully!');

    this.behaviors.chatCommands = new ChatCommandHandler(this.bot, this.master, this.behaviors);
    this.logger.info('ChatCommandHandler initialized successfully!');

    // Clear any existing hunger check interval
    if (this.hungerCheckInterval) {
      clearInterval(this.hungerCheckInterval);
    }

    // Re-enable hunger checking to see if the behavior changed
    this.hungerCheckInterval = setInterval(async () => {
      try {
        this.logger.info(`Checking hunger...`);
        await this.behaviors.eat.checkHunger(); // await to catch any async errors
      } catch (err) {
        this.logger.error(`Error in checkHunger: ${err.message}`);
      }
    }, 10000);

    // if you want an API to toggle behaviors later:
    // this.enableBehavior('look');
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
