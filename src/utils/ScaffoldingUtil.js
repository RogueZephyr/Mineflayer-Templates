// src/utils/ScaffoldingUtil.js
import { Vec3 } from 'vec3';
import pkg from 'mineflayer-pathfinder';
const { Movements } = pkg;
import mcDataFactory from 'minecraft-data';

/**
 * ScaffoldingUtil - Manages mineflayer-pathfinder's scaffolding system
 * 
 * This utility configures and manages pathfinder's built-in scaffolding for climbing,
 * with optimizations for server lag, block tracking, and automatic cleanup.
 * 
 * Features:
 * - Dynamic lag compensation based on server ping
 * - Tracks placed scaffolding blocks for cleanup
 * - Configurable scaffolding materials
 * - Safety checks and collision prevention
 * - Integration with PathfindingUtil
 */
export default class ScaffoldingUtil {
  constructor(bot, logger, config = {}) {
    this.bot = bot;
    this.logger = logger;
    
    // Configuration
    this.settings = {
      allowedBlocks: Array.isArray(config.allowedBlocks) && config.allowedBlocks.length > 0 
        ? config.allowedBlocks 
        : ['dirt', 'cobblestone', 'netherrack', 'stone', 'cobbled_deepslate'],
      
      // Lag compensation settings
      basePlaceCost: Number.isFinite(config.basePlaceCost) ? config.basePlaceCost : 10,
      baseDigCost: Number.isFinite(config.baseDigCost) ? config.baseDigCost : 40,
      lagThresholdMs: Number.isFinite(config.lagThresholdMs) ? config.lagThresholdMs : 100,
      
      // Movement restrictions
      allowParkour: config.allowParkour === true,
      allowSprinting: config.allowSprinting === true,
      maxDropDown: Number.isFinite(config.maxDropDown) ? config.maxDropDown : 4,
      
      // Safety settings
      trackPlacedBlocks: config.trackPlacedBlocks !== false, // Default true
      cleanupDelayMs: Number.isFinite(config.cleanupDelayMs) ? config.cleanupDelayMs : 80,
    };
    
  // Track placed scaffolding blocks for cleanup
    this.placedBlocks = new Set();
    
    // Cache minecraft data and block IDs
    this.mcData = null;
    this.scaffoldBlockIds = [];
  }

  /**
   * Initialize minecraft data for current bot version
   */
  _initMcData() {
    if (!this.mcData) {
      this.mcData = mcDataFactory(this.bot.version);
      this._updateScaffoldBlockIds();
    }
  }

  /**
   * Update scaffold block IDs from allowed block names
   */
  _updateScaffoldBlockIds() {
    if (!this.mcData) return;
    
    this.scaffoldBlockIds = [];
    for (const blockName of this.settings.allowedBlocks) {
      const item = this.mcData.itemsByName[blockName];
      if (item && item.id) {
        this.scaffoldBlockIds.push(item.id);
      }
    }
  }

  /**
   * Log debug messages
   */
  _log(message) {
    if (this.logger) {
      this.logger.info(`[Scaffolding][${this.bot.username}] ${message}`);
    }
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
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('scaffold')) {
        this.logger.debug(`[Scaffold][${botName}] ${message}`);
        this.bot.debugTools.log('scaffold', `[${botName}] ${message}`);
      }
    } catch (_) {}
  }

  /**
  * Create Movements configuration optimized for scaffolding
  * @param {Object} options - scaffolding options
   * @param {boolean} options.aggressive - Use aggressive settings (less safe, faster)
   * @param {number} options.maxHeight - Maximum height to scaffold
   * @returns {Movements} Configured Movements instance
   */
  createScaffoldingMovements(options = {}) {
    this._initMcData();
    
    if (!this.mcData) {
      throw new Error('Failed to initialize minecraft data');
    }
    
    // Create base movements
    const movements = new Movements(this.bot, this.mcData);
    
    // Configure scaffolding blocks
    if (!movements.scaffoldingBlocks) {
      movements.scaffoldingBlocks = [];
    }
    if (!movements.canPlaceOn) {
      movements.canPlaceOn = [];
    }
    
    // Add scaffold block IDs
    for (const blockId of this.scaffoldBlockIds) {
      movements.scaffoldingBlocks.push(blockId);
      movements.canPlaceOn.push(blockId);
    }
    
    // Enable pillar building
    movements.allow1by1towers = true;
    
    // Movement restrictions (safety first unless aggressive mode)
    movements.allowParkour = options.aggressive === true ? true : this.settings.allowParkour;
    movements.allowSprinting = options.aggressive === true ? true : this.settings.allowSprinting;
    movements.maxDropDown = this.settings.maxDropDown;
    
    // Safety settings
    movements.dontCreateFlow = true; // Don't create water/lava flow
    movements.dontMineUnderFallingBlock = true; // Don't break sand/gravel support
    movements.infiniteLiquidDropdownDistance = false; // Don't fall into liquids
    
    // Calculate lag-adjusted costs
    const ping = this._getCurrentPing();
    let placeCost = this.settings.basePlaceCost;
    let digCost = this.settings.baseDigCost;
    
    // Adjust for lag
    if (ping > this.settings.lagThresholdMs) {
      const lagMultiplier = 1 + ((ping - this.settings.lagThresholdMs) / 100);
      placeCost = Math.min(50, Math.floor(placeCost * lagMultiplier));
      digCost = Math.min(150, Math.floor(digCost * lagMultiplier));
      this._emitDebug(`High latency (${ping}ms), adjusted costs: place=${placeCost}, dig=${digCost}`);
    }
    
    movements.placeCost = placeCost;
    movements.digCost = digCost;
    
    // If aggressive mode, reduce costs for faster movement
    if (options.aggressive === true) {
      movements.placeCost = Math.floor(movements.placeCost * 0.7);
      movements.digCost = Math.floor(movements.digCost * 0.7);
  this._emitDebug('Aggressive scaffolding mode enabled');
    }
    
    return movements;
  }

  /**
   * Get current server ping/latency
   */
  _getCurrentPing() {
    try {
      if (this.bot._client && typeof this.bot._client.latency === 'number') {
        return this.bot._client.latency;
      }
    } catch (_) {}
    return 0;
  }

  /**
  * Check if bot has scaffolding blocks in inventory
   * @returns {Object|null} First available scaffold item or null
   */
  getScaffoldItem() {
    const items = this.bot.inventory.items();
    for (const blockName of this.settings.allowedBlocks) {
      const item = items.find(i => i && i.name === blockName && i.count > 0);
      if (item) return item;
    }
    return null;
  }

  /**
  * Check if we have enough scaffolding blocks for a climb
   * @param {number} estimatedHeight - Estimated blocks needed
   * @returns {boolean}
   */
  hasEnoughBlocks(estimatedHeight) {
    let totalCount = 0;
    const items = this.bot.inventory.items();
    
    for (const blockName of this.settings.allowedBlocks) {
      const item = items.find(i => i && i.name === blockName);
      if (item) {
        totalCount += item.count;
      }
    }
    
    return totalCount >= estimatedHeight;
  }

  /**
  * Start tracking placed scaffolding blocks
  * Call this before starting a scaffolding operation
   */
  startTracking() {
    if (!this.settings.trackPlacedBlocks) return;
    
    this.placedBlocks.clear();
  this._emitDebug('Started tracking scaffolding blocks');
    
    // Listen for block place events
    this.bot.on('blockPlaced', this._onBlockPlaced);
  }

  /**
   * Stop tracking placed blocks
   */
  stopTracking() {
    if (!this.settings.trackPlacedBlocks) return;
    
    this.bot.removeListener('blockPlaced', this._onBlockPlaced);
    this._emitDebug(`Stopped tracking. Total blocks placed: ${this.placedBlocks.size}`);
  }

  /**
  * Event handler for block placement
   */
  _onBlockPlaced = (oldBlock, newBlock) => {
    if (!newBlock || !this.settings.trackPlacedBlocks) return;
    
  // Check if placed block is a scaffolding block
    if (this.settings.allowedBlocks.includes(newBlock.name)) {
      const pos = newBlock.position;
      const key = `${pos.x},${pos.y},${pos.z}`;
      this.placedBlocks.add(key);
      this._emitDebug(`Tracked scaffold block at ${key}`);
    }
  }

  /**
  * Clean up tracked scaffolding blocks
   * @param {Vec3} centerPos - Center position to clean around
   * @param {number} radius - Cleanup radius
   * @returns {Promise<number>} Number of blocks removed
   */
  async cleanup(centerPos, radius = 5) {
    if (!this.settings.trackPlacedBlocks || this.placedBlocks.size === 0) {
      this._emitDebug('No blocks to clean up');
      return 0;
    }
    
    this._emitDebug(`Starting cleanup of ${this.placedBlocks.size} tracked blocks...`);
    let removed = 0;
    
    // Convert tracked positions back to Vec3
    const positions = Array.from(this.placedBlocks).map(key => {
      const [x, y, z] = key.split(',').map(Number);
      return new Vec3(x, y, z);
    });
    
    // Sort by height (top to bottom for safe cleanup)
    positions.sort((a, b) => b.y - a.y);
    
    for (const pos of positions) {
      // Check if within cleanup radius
      if (centerPos && pos.distanceTo(centerPos) > radius) continue;
      
      try {
        const block = this.bot.blockAt(pos);
        
  // Verify it's still a scaffolding block
        if (!block || !this.settings.allowedBlocks.includes(block.name)) {
          continue;
        }
        
        // Move closer if needed
        const dist = this.bot.entity.position.distanceTo(pos);
        if (dist > 4.5) {
          // Use pathfindingUtil if available, otherwise skip
          if (this.bot.pathfindingUtil) {
            try {
              await this.bot.pathfindingUtil.goto(pos, 5000, 'scaffold_cleanup');
            } catch (e) {
              this._emitDebug(`Could not reach ${pos} for cleanup: ${e.message}`);
              continue;
            }
          } else {
            continue; // Skip if can't reach
          }
        }
        
        // Dig the block
        const blockNow = this.bot.blockAt(pos);
        if (blockNow && this.settings.allowedBlocks.includes(blockNow.name)) {
          if (this.bot.toolHandler) {
            await this.bot.toolHandler.smartDig(blockNow);
          } else {
            await this.bot.dig(blockNow);
          }
          removed++;
          await new Promise(r => setTimeout(r, this.settings.cleanupDelayMs));
        }
        
      } catch (e) {
        this._emitDebug(`Cleanup error at ${pos}: ${e.message}`);
      }
    }
    
    // Clear tracking
    this.placedBlocks.clear();
    this._emitDebug(`Cleanup complete. Removed ${removed} blocks`);
    
    return removed;
  }

  /**
  * Scan area for scaffolding blocks (alternative to tracking)
   * @param {Vec3} centerPos - Center position
   * @param {number} radius - Scan radius
   * @param {number} minY - Minimum Y coordinate
   * @param {number} maxY - Maximum Y coordinate
  * @returns {Vec3[]} Array of scaffolding block positions
   */
  scanForScaffoldBlocks(centerPos, radius = 5, minY = null, maxY = null) {
    const found = [];
    const scanMinY = minY !== null ? minY : centerPos.y - 5;
    const scanMaxY = maxY !== null ? maxY : centerPos.y + 20;
    
    for (let x = centerPos.x - radius; x <= centerPos.x + radius; x++) {
      for (let z = centerPos.z - radius; z <= centerPos.z + radius; z++) {
        for (let y = scanMinY; y <= scanMaxY; y++) {
          const pos = new Vec3(x, y, z);
          const block = this.bot.blockAt(pos);
          
          if (block && this.settings.allowedBlocks.includes(block.name)) {
            found.push(pos);
          }
        }
      }
    }
    
  this._emitDebug(`Scanned area, found ${found.length} scaffolding blocks`);
    return found;
  }

  /**
   * Update configuration settings
   */
  updateSettings(newConfig) {
    Object.assign(this.settings, newConfig);
    this._updateScaffoldBlockIds();
  }

  /**
  * Get statistics about scaffolding usage
   */
  getStats() {
    return {
      trackedBlocks: this.placedBlocks.size,
      allowedBlocks: this.settings.allowedBlocks,
      scaffoldBlockIds: this.scaffoldBlockIds,
      currentPing: this._getCurrentPing()
    };
  }
}
