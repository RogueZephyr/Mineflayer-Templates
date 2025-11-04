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
    this.currentTarget = null;
    this.botLastSeen = new Map(); // Track when we last saw each bot (username -> timestamp)
    this.botGreetDuration = 2000; // 2 seconds to look at other bots
    this.master = 'RogueZ3phyr'; // Master player username
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

  _isBotUsername(username) {
    // Check if username is in the bot list from coordinator or BotController
    if (this.bot.coordinator) {
      const diag = this.bot.coordinator.getDiagnostics();
      return diag.bots.includes(username);
    }
    // Fallback: check against common bot patterns or constructor static list
    const BotController = this.bot.constructor || {};
    if (BotController.usernameList) {
      return BotController.usernameList.includes(username);
    }
    return false;
  }

  _shouldGreetBot(username) {
    const now = Date.now();
    const lastSeen = this.botLastSeen.get(username);
    
    if (!lastSeen) {
      // First time seeing this bot - greet for 2 seconds
      this.botLastSeen.set(username, now);
      return true;
    }
    
    // Check if still within greet duration
    return (now - lastSeen) < this.botGreetDuration;
  }

  updateLookTarget() {
    if (!this.enabled || !this.bot.entity) return;

    const botPos = this.bot.entity.position;
    const maxDist = this.config.maxDistance || 8;
    const now = Date.now();

    // Get all nearby players
    const nearbyPlayers = Object.values(this.bot.players)
      .filter(p => p.entity && p.entity.id !== this.bot.entity.id)
      .map(p => ({
        entity: p.entity,
        username: p.username,
        distance: p.entity.position.distanceTo(botPos)
      }))
      .filter(p => p.distance <= maxDist);

    // Priority 1: Check for other bots to greet (only for 2 seconds)
    const botToGreet = nearbyPlayers.find(p => 
      this._isBotUsername(p.username) && this._shouldGreetBot(p.username)
    );

    if (botToGreet) {
      this._lookAtTarget(botToGreet.entity, `bot ${botToGreet.username} (greeting)`);
      return;
    }

    // Priority 2: Master player
    const masterPlayer = nearbyPlayers.find(p => p.username === this.master);
    if (masterPlayer) {
      this._lookAtTarget(masterPlayer.entity, `master ${this.master}`);
      return;
    }

    // Priority 3: Nearest non-bot player
    const nonBotPlayers = nearbyPlayers.filter(p => !this._isBotUsername(p.username));
    if (nonBotPlayers.length > 0) {
      const nearest = nonBotPlayers.sort((a, b) => a.distance - b.distance)[0];
      this._lookAtTarget(nearest.entity, `player ${nearest.username}`);
      return;
    }

    // Priority 4: Nearest entity (non-player)
    const nearestEntity = Object.values(this.bot.entities)
      .filter(e => e && e.id !== this.bot.entity.id && e.type !== 'player')
      .map(e => ({
        entity: e,
        distance: e.position.distanceTo(botPos)
      }))
      .filter(e => e.distance <= maxDist)
      .sort((a, b) => a.distance - b.distance)[0];

    if (nearestEntity) {
      const name = nearestEntity.entity.displayName || nearestEntity.entity.name || nearestEntity.entity.type || 'entity';
      this._lookAtTarget(nearestEntity.entity, name);
      return;
    }

    // Nothing to look at
    this.currentTarget = null;
  }

  _lookAtTarget(entity, description) {
    if (!entity || !entity.position) return;
    
    const headPos = entity.position.offset(0, entity.height || 1.6, 0);
    this.lookAtPosition(headPos);
    
    if (this.currentTarget?.id !== entity.id) {
      this.currentTarget = entity;
      logger.info(`${lookLabel} Now tracking: ${description}`);
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
