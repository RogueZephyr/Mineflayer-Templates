// src/core/BotController.js
import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import mcDataLoader from 'minecraft-data';
import chalk from 'chalk';
import figlet from 'figlet';

import LookBehavior from '../behaviors/LookBehavior.js';
import Logger from '../utils/logger.js';

export default class BotController {
  constructor(config) {
    this.config = config;
    this.bot = null;
    this.mcData = null;
    this.logger = new Logger();
    this.behaviors = {};
  }

  start() {
    // create the bot instance
    this.bot = mineflayer.createBot({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      version: this.config.version || 'auto'
    });

    // load plugins immediately after creation
    this.bot.loadPlugin(pathfinder);

    // Basic lifecycle listeners
    this.bot.once('login', () => this.onLogin());
    this.bot.once('spawn', () => this.onSpawn());

    // global error handling
    this.bot.on('kicked', (reason) => this.logger.warn(`Kicked: ${reason}`));
    this.bot.on('end', () => this.logger.warn('Connection ended'));
    this.bot.on('error', (err) => this.logger.error(`Bot error: ${err}`));
  }

  onLogin() {
    // choose host text defensively because internals differ by net impl
    const host = (this.bot?._client?.socket?._host) || this.config.host || 'unknown';
    this.logger.success(`[BOT] Logged into ${host}`);
  }

  onSpawn() {
    console.clear();
    console.log(chalk.cyan(figlet.textSync('MineBot', { horizontalLayout: 'full' })));
    this.logger.info(`Connected to ${this.config.host}:${this.config.port}`);
    this.logger.success('Spawn event detected, initializing data...');

    // load minecraft-data now that bot.version is available
    this.mcData = mcDataLoader(this.bot.version);

    this.bot.chat('Hello! Test environment loaded!');

    // initialize and register behaviors
    this.behaviors.look = new LookBehavior(this.bot);
    this.logger.info('LookBehavior initialized successfully!');

    // if you want an API to toggle behaviors later:
    // this.enableBehavior('look');
  }

  // optional: behavior registration helpers
  registerBehavior(name, behaviorInstance) {
    this.behaviors[name] = behaviorInstance;
  }

  enableBehavior(name) {
    const b = this.behaviors[name];
    if (b && typeof b.enable === 'function') b.enable();
  }

  disableBehavior(name) {
    const b = this.behaviors[name];
    if (b && typeof b.disable === 'function') b.disable();
  }
}
