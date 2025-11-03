// src/behaviors/LookBehavior.js
import Logger from '../utils/logger.js';
import chalk from 'chalk';

const logger = new Logger();
const lookLabel = chalk.green('[LookBehavior]');

export default class LookBehavior {
  constructor(bot, config = {}) {
    this.bot = bot;
    this.enabled = true;
    this.currentTarget = null;
    this.config = {
      updateInterval: config.updateInterval || 100,
      maxDistance: config.maxDistance || 6
    };

    // Bind event listeners
    this.onEntitySpawn = this.onEntitySpawn.bind(this);
    this.onEntityGone = this.onEntityGone.bind(this);
    this.updateLookTarget = this.updateLookTarget.bind(this);

    this.bot.on('path_update', (r) => {
      if (r.status === 'success' || r.status === 'incomplete') {
        this.disable();
      }
    });

    this.bot.on('goal_reached', () => {
        this.enable();
    });

    this.bot.on('entitySpawn', this.onEntitySpawn);
    this.bot.on('entityGone', this.onEntityGone);

    // Start continuous look updates using physics tick for smoother movement
    this.bot.on('physicsTick', this.updateLookTarget);
  }

  enable() {
    this.enabled = true;
    this.bot.on('physicsTick', this.updateLookTarget);
    logger.info(`${lookLabel} Enabled`);
  }

  disable() {
    this.enabled = false;
    this.currentTarget = null;
    this.bot.removeListener('physicsTick', this.updateLookTarget);
    logger.info(`${lookLabel} Disabled`);
  }

  onEntitySpawn(entity) {
    if (!this.enabled) return;
    // Optionally log new entities
    const name = entity.username ?? entity.displayName ?? entity.type ?? '<unknown>';
    //logger.info(`${lookLabel} Entity spawned: ${name}`);
  }

  onEntityGone(entity) {
    if (!this.enabled) return;
    if (this.currentTarget && entity.id === this.currentTarget.id) {
      const name = entity.username ?? entity.displayName ?? entity.type ?? '<unknown>';
      logger.info(`${lookLabel} ${name} left view range.`);
      this.currentTarget = null;
    }
  }

  updateLookTarget() {
    if (!this.enabled || !this.bot.entity) return;

    const botPos = this.bot.entity.position;

    // Find nearest player within configured distance (excluding self)
    const nearestPlayer = Object.values(this.bot.players)
      .map(p => p.entity)
      .filter(e => e && e.id !== this.bot.entity.id && e.position.distanceTo(botPos) <= this.config.maxDistance)
      .sort((a, b) => a.position.distanceTo(botPos) - b.position.distanceTo(botPos))[0];

    if (nearestPlayer) {
      const headPos = nearestPlayer.position.offset(0, nearestPlayer.height || 1.6, 0);
      this.lookAtPosition(headPos);
      if (this.currentTarget?.id !== nearestPlayer.id) {
        this.currentTarget = nearestPlayer;
        const name = nearestPlayer.username ?? nearestPlayer.displayName ?? nearestPlayer.type ?? '<unknown>';
        logger.info(`${lookLabel} Now tracking player: ${name}`);
      }
      return;
    }

    // If no nearby player, look at nearest entity (excluding self)
    const nearestEntity = Object.values(this.bot.entities)
      .filter(e => e && e.id !== this.bot.entity.id)
      .sort((a, b) => a.position.distanceTo(botPos) - b.position.distanceTo(botPos))[0];

    if (nearestEntity) {
      const headPos = nearestEntity.position.offset(0, nearestEntity.height || 1.6, 0);
      this.lookAtPosition(headPos);
      if (this.currentTarget?.id !== nearestEntity.id) {
        this.currentTarget = nearestEntity;
        const name = nearestEntity.username ?? nearestEntity.displayName ?? nearestEntity.type ?? '<unknown>';
        logger.info(`${lookLabel} Now tracking entity: ${name}`);
      }
    } else {
      this.currentTarget = null;
    }
  }

  lookAtPosition(position) {
    if (!position) return;
    try {
      this.bot.lookAt(position, true);
    } catch (err) {
      logger.error(`${lookLabel} Error looking at position: ${err}`);
    }
  }

  lookAtEntity(entity) {
    if (!entity || !entity.position) return;
    try {
      const pos = entity.position.offset(0, entity.height || 1.6, 0);
      this.bot.lookAt(pos, true);
      const name = entity.username ?? entity.displayName ?? entity.type ?? '<unknown>';
      logger.info(`${lookLabel} Looking at ${name} (${pos.toString()})`);
    } catch (err) {
      logger.error(`${lookLabel} Error looking at entity: ${err}`);
    }
  }
}
