// src/behaviors/LookBehavior.js
import Logger from '../utils/logger.js';
import chalk from 'chalk';

const logger = new Logger();
const lookLabel = chalk.green('[LookBehavior]');

export default class LookBehavior {
  constructor(bot) {
    this.bot = bot;
    this.currentTarget = null;
    this.enabled = true;

    // Bind event listeners
    this.onEntitySpawn = this.onEntitySpawn.bind(this);
    this.onEntityGone = this.onEntityGone.bind(this);

    this.bot.on('entitySpawn', this.onEntitySpawn);
    this.bot.on('entityGone', this.onEntityGone);
  }

  enable() {
    this.enabled = true;
    logger.info(`${lookLabel} Enabled`);
  }

  disable() {
    this.enabled = false;
    logger.info(`${lookLabel} Disabled`);
  }

  onEntitySpawn(entity) {
    if (!this.enabled) return;
    if (entity.type !== 'player') return;
    // ignore ourselves
    if (entity.username === this.bot.username) return;

    const name = entity.username ?? entity.displayName ?? '<unknown>';
    logger.info(`${lookLabel} Detected new player: ${name}`);
    this.lookAtEntity(entity);
    this.currentTarget = entity;
  }

  onEntityGone(entity) {
    if (!this.enabled) return;
    if (!this.currentTarget) return;
    if (entity.id === this.currentTarget.id) {
      const name = entity.username ?? entity.displayName ?? '<unknown>';
      logger.info(`${lookLabel} ${name} left view range.`);
      this.currentTarget = null;
    }
  }

  lookAtEntity(entity) {
    if (!entity || !entity.position) return;
    try {
      const pos = entity.position.offset(0, entity.height || 1.6, 0);
      this.bot.lookAt(pos, true);
      const name = entity.username ?? entity.displayName ?? '<unknown>';
      logger.info(`${lookLabel} Looking at ${name} (${pos.toString()})`);
    } catch (err) {
      logger.error(`${lookLabel} Error looking at player: ${err}`);
    }
  }
}
