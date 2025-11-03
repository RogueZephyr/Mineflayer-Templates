// src/behaviors/LookBehavior.js
import Logger from '../utils/logger.js';
import chalk from 'chalk';
import { Vec3 } from 'vec3';

const logger = new Logger();
const lookLabel = chalk.green('[LookBehavior]');

export default class LookBehavior {
  constructor(bot, config = {}) {
    this.bot = bot;
    this.enabled = false;
    this.paused = false;  // New flag for temporary suspension
    this.config = config;
    this.lookInterval = null;
  }

  enable() {
    this.enabled = true;
    if (!this.paused) {
      this._startLooking();
    }
  }

  disable() {
    this.enabled = false;
    this._stopLooking();
  }

  // New methods to support temporary suspension
  pause() {
    this.paused = true;
    this._stopLooking();
  }

  resume() {
    this.paused = false;
    if (this.enabled) {
      this._startLooking();
    }
  }

  _stopLooking() {
    if (this.lookInterval) {
      clearInterval(this.lookInterval);
      this.lookInterval = null;
    }
  }

  _startLooking() {
    if (this.lookInterval) return;
    
    this.lookInterval = setInterval(() => {
      if (!this.enabled || this.paused) return;
      this.updateLookTarget();
    }, this.config.interval || 5000);
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
