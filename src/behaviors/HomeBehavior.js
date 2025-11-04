// src/behaviors/HomeBehavior.js
import { Vec3 } from 'vec3';
import pkg from 'mineflayer-pathfinder';
import fs from 'fs';
import path from 'path';
const { goals } = pkg;

export default class HomeBehavior {
  constructor(bot, logger) {
    this.bot = bot;
    this.logger = logger;
    this.homePosition = null;
    this.enabled = true;
    this.isGoingHome = false;
    this.homeFilePath = path.join(process.cwd(), 'data', 'homeLocations.json');
    
    // Load saved home position on initialization
    this._loadHome();
  }

  /**
   * Load home position from disk
   */
  _loadHome() {
    try {
      if (fs.existsSync(this.homeFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.homeFilePath, 'utf8'));
        const botName = this.bot.username;
        if (data.homes && data.homes[botName]) {
          this.homePosition = data.homes[botName];
          this.logger.info(`[Home][${botName}] Loaded saved home position: ${this.homePosition.x}, ${this.homePosition.y}, ${this.homePosition.z}`);
        }
      }
    } catch (e) {
      this.logger.warn(`[Home][${this.bot.username}] Failed to load home position: ${e.message}`);
    }
  }

  /**
   * Save home position to disk
   */
  _saveHome() {
    try {
      let data = { homes: {} };
      
      if (fs.existsSync(this.homeFilePath)) {
        data = JSON.parse(fs.readFileSync(this.homeFilePath, 'utf8'));
      }
      
      const botName = this.bot.username;
      data.homes[botName] = this.homePosition;
      
      fs.writeFileSync(this.homeFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      this.logger.error(`[Home][${this.bot.username}] Failed to save home position: ${e.message}`);
    }
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  _emitDebug(...args) {
    const botName = this.bot.username || 'Unknown';
    try { 
      if (this.bot.debugTools) {
        this.bot.debugTools.log('home', `[${botName}]`, ...args); 
      }
    } catch (_) {}
  }

  /**
   * Set the home position to the bot's current location
   */
  setHome() {
    if (!this.bot.entity || !this.bot.entity.position) {
      this.logger.warn(`[Home][${this.bot.username}] Cannot set home - bot has no position`);
      return false;
    }

    this.homePosition = {
      x: Math.floor(this.bot.entity.position.x),
      y: Math.floor(this.bot.entity.position.y),
      z: Math.floor(this.bot.entity.position.z)
    };

    this._saveHome();
    this.logger.info(`[Home][${this.bot.username}] Home set to: ${this.homePosition.x}, ${this.homePosition.y}, ${this.homePosition.z}`);
    this._emitDebug(`Home position set: ${JSON.stringify(this.homePosition)}`);
    return true;
  }

  /**
   * Set home to specific coordinates
   */
  setHomeAt(x, y, z) {
    this.homePosition = {
      x: Math.floor(x),
      y: Math.floor(y),
      z: Math.floor(z)
    };

    this._saveHome();
    this.logger.info(`[Home][${this.bot.username}] Home set to: ${this.homePosition.x}, ${this.homePosition.y}, ${this.homePosition.z}`);
    this._emitDebug(`Home position set: ${JSON.stringify(this.homePosition)}`);
    return true;
  }

  /**
   * Get the current home position
   */
  getHome() {
    return this.homePosition;
  }

  /**
   * Check if bot is at home
   */
  isAtHome(tolerance = 3) {
    if (!this.homePosition || !this.bot.entity || !this.bot.entity.position) {
      return false;
    }

    const pos = this.bot.entity.position;
    const distance = Math.sqrt(
      Math.pow(pos.x - this.homePosition.x, 2) +
      Math.pow(pos.y - this.homePosition.y, 2) +
      Math.pow(pos.z - this.homePosition.z, 2)
    );

    return distance <= tolerance;
  }

  /**
   * Navigate bot to home position
   */
  async goHome(timeoutMs = 60000) {
    if (!this.enabled) {
      this._emitDebug('Home behavior is disabled');
      return false;
    }

    if (!this.homePosition) {
      this.logger.warn(`[Home][${this.bot.username}] No home position set`);
      return false;
    }

    if (this.isAtHome()) {
      this.logger.info(`[Home][${this.bot.username}] Already at home`);
      return true;
    }

    if (this.isGoingHome) {
      this._emitDebug('Already going home');
      return false;
    }

    this.isGoingHome = true;
    this.logger.info(`[Home][${this.bot.username}] Going home to: ${this.homePosition.x}, ${this.homePosition.y}, ${this.homePosition.z}`);
    this._emitDebug('Navigating to home position');

    try {
      if (!this.bot.pathfinder || typeof this.bot.pathfinder.goto !== 'function') {
        throw new Error('Pathfinder not available');
      }

      const homeVec = new Vec3(this.homePosition.x, this.homePosition.y, this.homePosition.z);
      const goal = new goals.GoalBlock(homeVec.x, homeVec.y, homeVec.z);
      
      await Promise.race([
        this.bot.pathfinder.goto(goal),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
      ]);

      this.logger.info(`[Home][${this.bot.username}] Arrived at home`);
      this._emitDebug('Successfully arrived at home');
      return true;

    } catch (err) {
      this.logger.error(`[Home][${this.bot.username}] Failed to go home: ${err.message || err}`);
      this._emitDebug(`goHome failed: ${err.message || err}`);
      return false;

    } finally {
      this.isGoingHome = false;
    }
  }

  /**
   * Graceful logout - stop all activities, go home, then disconnect
   */
  async gracefulLogout(timeoutMs = 60000) {
    this.logger.info(`[Home][${this.bot.username}] Starting graceful logout...`);
    this._emitDebug('Graceful logout initiated');

    try {
      // Stop all behaviors
      if (this.bot.farmBehavior && this.bot.farmBehavior.enabled) {
        this.bot.farmBehavior.disable();
        this._emitDebug('Farm behavior disabled');
      }

      if (this.bot.itemCollector && this.bot.itemCollector.enabled) {
        this.bot.itemCollector.stopAuto();
        this._emitDebug('Item collector stopped');
      }

      // Clear pathfinder goals
      if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
        this.bot.pathfinder.setGoal(null);
        this._emitDebug('Pathfinder goals cleared');
      }

      // Go home if position is set
      if (this.homePosition) {
        this.logger.info(`[Home][${this.bot.username}] Returning home before logout...`);
        await this.goHome(timeoutMs);
      } else {
        this._emitDebug('No home position set, skipping navigation');
      }

      // Wait a moment to ensure bot is settled
      await new Promise(r => setTimeout(r, 1000));

      this.logger.info(`[Home][${this.bot.username}] Disconnecting...`);
      this._emitDebug('Logout complete, disconnecting');

      // Quit the bot
      this.bot.quit();
      return true;

    } catch (err) {
      this.logger.error(`[Home][${this.bot.username}] Error during graceful logout: ${err.message || err}`);
      this._emitDebug(`Graceful logout error: ${err.message || err}`);
      
      // Force quit anyway
      try {
        this.bot.quit();
      } catch (_) {}
      
      return false;
    }
  }
}
