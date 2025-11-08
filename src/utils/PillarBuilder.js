// src/utils/PillarBuilder.js
import { Vec3 } from 'vec3';

/**
 * @deprecated As of v2.1.1, use ScaffoldingUtil with mineflayer-pathfinder instead.
 * 
 * PillarBuilder - Utility for building vertical pillars (jump-placing blocks underfoot)
 * Used for climbing trees, reaching high places, etc.
 * 
 * DEPRECATION NOTICE:
 * This utility has been replaced by ScaffoldingUtil which properly integrates with
 * mineflayer-pathfinder's native scaffolding functionality.
 * 
 * Benefits of using ScaffoldingUtil:
 * - Automatic lag compensation based on server ping
 * - Tracks placed blocks for reliable cleanup
 * - Configurable scaffolding materials
 * - Safety checks and collision prevention
 * - Better integration with PathfindingUtil
 * - More reliable block placement timing
 * - Native support for different block types
 * - Handles uneven terrain better
 * 
 * Migration example:
 * ```javascript
 * // Old way (PillarBuilder)
 * const pillarBuilder = new PillarBuilder(bot, logger);
 * await pillarBuilder.buildUp(column, startY, 3);
 * 
 * // New way (ScaffoldingUtil with PathfindingUtil)
 * // In BotController, ScaffoldingUtil is automatically initialized
 * // Then use PathfindingUtil with scaffolding mode:
 * await bot.pathfindingUtil.goto(
 *   targetPos,
 *   15000,
 *   'climb',
 *   1.5,
 *   { scaffolding: true }
 * );
 * 
 * // Or use ScaffoldingUtil directly:
 * bot.scaffoldingUtil.startTracking();
 * const movements = bot.scaffoldingUtil.createScaffoldingMovements({ aggressive: false });
 * bot.pathfinder.setMovements(movements);
 * // ... pathfind to target ...
 * await bot.scaffoldingUtil.cleanup(centerPos, 5);
 * ```
 * 
 * This file is kept for backward compatibility but will be removed in a future version.
 * See ScaffoldingUtil.js and PathfindingUtil.js for the new implementation.
 */
export default class PillarBuilder {
  constructor(bot, logger, config = {}) {
    this.bot = bot;
    this.logger = logger;
    
    // Configurable settings with defaults
    this.settings = {
      allowedBlocks: Array.isArray(config.allowedBlocks) && config.allowedBlocks.length > 0 
        ? config.allowedBlocks 
        : ['dirt', 'cobblestone'],
      preDelayMs: Number.isFinite(config.preDelayMs) ? config.preDelayMs : 150,
      jumpDelayMs: Number.isFinite(config.jumpDelayMs) ? config.jumpDelayMs : 100,
      placeDelayMs: Number.isFinite(config.placeDelayMs) ? config.placeDelayMs : 100,
      moveDelayMs: Number.isFinite(config.moveDelayMs) ? config.moveDelayMs : 80,
      maxConsecutiveFailures: Number.isFinite(config.maxConsecutiveFailures) ? config.maxConsecutiveFailures : 5,
      failureRetryDelayMs: Number.isFinite(config.failureRetryDelayMs) ? config.failureRetryDelayMs : 250
    };

    this.placedBlocks = [];
    this.consecutiveFailures = 0;
  }

  /**
   * Get a suitable block from inventory for pillar building
   */
  _getScaffoldItem() {
    const items = this.bot.inventory.items();
    for (const name of this.settings.allowedBlocks) {
      const it = items.find(i => i && i.name === name && i.count > 0);
      if (it) return it;
    }
    return null;
  }

  /**
   * Emit debug message if debug tools are available
   */
  _emitDebug(...args) {
    const botName = this.bot.username || 'Unknown';
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    try { 
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('wood')) {
        this.logger.debug(`[Pillar] [${botName}] ${message}`);
        this.bot.debugTools.log('wood', `[${botName}] ${message}`);
      }
    } catch (_) {}
  }

  /**
   * Move to a position using available pathfinding
   */
  async _goto(pos, timeoutMs = 8000, task = 'pillar') {
    if (this.bot.pathfindingUtil) {
      await this.bot.pathfindingUtil.goto(pos, timeoutMs, task, 1.5);
    } else if (this.bot.pathfinder) {
      const goal = new this.bot.pathfinder.goals.GoalBlock(pos.x, pos.y, pos.z);
      await this.bot.pathfinder.goto(goal);
    } else {
      throw new Error('No pathfinding available');
    }
  }

  /**
   * Place one pillar block at the specified column position
   * @param {Vec3} columnPos - The x,z position of the pillar column
   * @param {number} currentTopY - The current top Y level of the pillar
   * @returns {Object} { success: boolean, newTopY: number }
   */
  async placeStep(columnPos, currentTopY) {
    // Pre-delay to ensure bot is centered
    try { await new Promise(r => setTimeout(r, this.settings.preDelayMs)); } catch {}

    const refPos = new Vec3(columnPos.x, currentTopY, columnPos.z);
    const refBlock = this.bot.blockAt(refPos);
    
    if (!refBlock || refBlock.type === 0) {
      this._emitDebug('Reference block is air, cannot place');
      return { success: false, newTopY: currentTopY };
    }

    const abovePos = new Vec3(columnPos.x, currentTopY + 1, columnPos.z);
    const aboveBlock = this.bot.blockAt(abovePos);
    
    // If block already exists, just move up
    if (aboveBlock && aboveBlock.type !== 0) {
      this._emitDebug('Block already exists at target position');
      const newY = currentTopY + 1;
      await this._goto(new Vec3(columnPos.x, newY + 1, columnPos.z), 8000, 'pillar_step_up');
      return { success: true, newTopY: newY };
    }

    // Get scaffold item
    const scaff = this._getScaffoldItem();
    if (!scaff) {
      this._emitDebug('No scaffold items available');
      return { success: false, newTopY: currentTopY };
    }

    // Equip scaffold
    try { await this.bot.equip(scaff, 'hand'); } catch {}

    try {
      // Jump and place block
      try { this.bot.setControlState('jump', true); } catch {}
      await new Promise(r => setTimeout(r, this.settings.jumpDelayMs));
      await this.bot.placeBlock(refBlock, new Vec3(0, 1, 0));
      try { this.bot.setControlState('jump', false); } catch {}
      
      // Track placed block
      this.placedBlocks.push(abovePos.clone());
      const newY = currentTopY + 1;
      
      // Wait for block to settle
      await new Promise(r => setTimeout(r, this.settings.placeDelayMs));
      
      // Move to top of new block
      await this._goto(new Vec3(columnPos.x, newY + 1, columnPos.z), 8000, 'pillar_step_top');
      
      this.consecutiveFailures = 0; // Reset on success
      return { success: true, newTopY: newY };
      
    } catch (e) {
      try { this.bot.setControlState('jump', false); } catch {}
      this._emitDebug('Failed to place pillar step:', e.message);
      return { success: false, newTopY: currentTopY };
    }
  }

  /**
   * Build pillar upward by specified number of steps
   * @param {Vec3} columnPos - The x,z position of the pillar column
   * @param {number} startY - The starting Y level (top of current pillar)
   * @param {number} steps - Number of blocks to place upward
   * @returns {Object} { success: boolean, finalY: number, stepsPlaced: number }
   */
  async buildUp(columnPos, startY, steps) {
    let currentY = startY;
    let stepsPlaced = 0;
    let anySuccess = false;

    for (let i = 0; i < steps; i++) {
      const result = await this.placeStep(columnPos, currentY);
      
      if (result.success) {
        currentY = result.newTopY;
        stepsPlaced++;
        anySuccess = true;
        
        // Delay between steps
        if (i < steps - 1) {
          await new Promise(r => setTimeout(r, this.settings.moveDelayMs));
        }
      } else {
        this._emitDebug(`Failed to place step ${i + 1}/${steps}`);
        break;
      }
    }

    // Handle consecutive failures with retry delay
    if (!anySuccess) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.settings.maxConsecutiveFailures) {
        this._emitDebug(`${this.settings.maxConsecutiveFailures} consecutive failures, waiting ${this.settings.failureRetryDelayMs}ms...`);
        await new Promise(r => setTimeout(r, this.settings.failureRetryDelayMs));
        this.consecutiveFailures = 0;
      }
    } else {
      this.consecutiveFailures = 0;
    }

    return {
      success: anySuccess,
      finalY: currentY,
      stepsPlaced: stepsPlaced
    };
  }

  /**
   * Clean up placed pillar blocks from top to bottom
   * @param {number} digDelayMs - Optional delay between digging blocks
   */
  async cleanup(digDelayMs = 80) {
    if (this.placedBlocks.length === 0) {
      this._emitDebug('No blocks to clean up');
      return;
    }

    this._emitDebug(`Cleaning up ${this.placedBlocks.length} pillar blocks`);
    
    // Cleanup from top to bottom
    for (let i = this.placedBlocks.length - 1; i >= 0; i--) {
      const blockPos = this.placedBlocks[i];
      
      try {
        // Move near the block
        await this._goto(blockPos.offset(0, 1, 0), 8000, 'cleanup');
        
        const block = this.bot.blockAt(blockPos);
        if (block && block.type !== 0) {
          await this.bot.dig(block);
          await new Promise(r => setTimeout(r, digDelayMs));
        }
      } catch (e) {
        this._emitDebug('Cleanup failed at', blockPos, e.message);
      }
    }
    
    // Clear the placed blocks array
    this.placedBlocks = [];
    this._emitDebug('Pillar cleanup complete');
  }

  /**
   * Get list of placed block positions
   */
  getPlacedBlocks() {
    return [...this.placedBlocks];
  }

  /**
   * Clear the placed blocks tracking without cleanup
   */
  clearTracking() {
    this.placedBlocks = [];
    this.consecutiveFailures = 0;
  }

  /**
   * Update configuration settings
   */
  updateSettings(newConfig) {
    Object.assign(this.settings, newConfig);
  }
}
