// src/utils/OreScanner.js
import { Vec3 } from 'vec3';

/**
 * OreScanner - Flood-fill based ore vein detection utility
 * Scans for connected ore blocks starting from a seed position
 */
export default class OreScanner {
  constructor(bot, logger) {
    this.bot = bot;
    this.logger = logger;
    
    // Default ore whitelist (can be overridden via config)
    this.oreWhitelist = new Set([
      'coal_ore', 'deepslate_coal_ore',
      'iron_ore', 'deepslate_iron_ore',
      'copper_ore', 'deepslate_copper_ore',
      'gold_ore', 'deepslate_gold_ore',
      'redstone_ore', 'deepslate_redstone_ore',
      'emerald_ore', 'deepslate_emerald_ore',
      'lapis_ore', 'deepslate_lapis_ore',
      'diamond_ore', 'deepslate_diamond_ore',
      'nether_gold_ore',
      'nether_quartz_ore',
      'ancient_debris'
    ]);
    
    // Load additional ores from config if available
    this._loadOreWhitelist();
  }

  /**
   * Load ore whitelist from config
   * @private
   */
  _loadOreWhitelist() {
    try {
      // Try to load from itemCategories.json
      const config = this.bot.config;
      if (config?.itemCategories?.ores) {
        config.itemCategories.ores.forEach(ore => {
          this.oreWhitelist.add(ore);
        });
        this.logger.info(`[OreScanner] Loaded ${this.oreWhitelist.size} ore types from config`);
      }
      
      // Allow additional custom ores from mining config
      const miningCfg = config?.behaviors?.mining;
      if (miningCfg?.veinMiningOres && Array.isArray(miningCfg.veinMiningOres)) {
        miningCfg.veinMiningOres.forEach(ore => {
          this.oreWhitelist.add(ore);
        });
        this.logger.info(`[OreScanner] Added ${miningCfg.veinMiningOres.length} custom ore types`);
      }
    } catch (err) {
      this.logger.warn(`[OreScanner] Could not load ore config, using defaults: ${err.message}`);
    }
  }

  /**
   * Check if a block name is an ore
   * @param {string} blockName - Block name to check
   * @returns {boolean}
   */
  isOre(blockName) {
    return this.oreWhitelist.has(blockName);
  }

  /**
   * Scan for connected ore blocks starting from a seed position
   * Uses flood-fill algorithm (BFS) to find all connected ore blocks
   * 
   * @param {Vec3} startPos - Starting position (ore block)
   * @param {Object} options - Scan options
   * @param {number} options.maxBlocks - Maximum blocks to scan (default: 64)
   * @param {number} options.maxDistance - Maximum distance from start (default: 16)
   * @param {Set<string>} options.whitelist - Custom ore whitelist (optional)
   * @param {boolean} options.sortByDistance - Sort results by distance from start (default: true)
   * @returns {Object} Scan results: { oreType, blocks, frontierBlocks, count }
   */
  async scanVein(startPos, options = {}) {
    const {
      maxBlocks = 64,
      maxDistance = 16,
      whitelist = null,
      sortByDistance = true
    } = options;

    // Validate start position
    const startBlock = this.bot.blockAt(startPos);
    if (!startBlock) {
      throw new Error(`No block at start position ${startPos}`);
    }

    // Use custom whitelist or default
    const oreList = whitelist || this.oreWhitelist;
    
    // Check if start block is an ore
    if (!oreList.has(startBlock.name)) {
      return {
        oreType: startBlock.name,
        blocks: [],
        frontierBlocks: [],
        count: 0,
        message: 'Start block is not an ore'
      };
    }

    const oreType = startBlock.name;
    const visited = new Set();
    const veinBlocks = [];
    const frontierBlocks = new Set(); // Non-ore blocks adjacent to vein
    const queue = [startPos.clone()];
    
    // Track start position for distance calculations
    const origin = startPos.clone();
    
    // BFS flood-fill
    while (queue.length > 0 && veinBlocks.length < maxBlocks) {
      const current = queue.shift();
      const key = this._positionKey(current);
      
      // Skip if already visited
      if (visited.has(key)) continue;
      visited.add(key);
      
      // Check distance from origin
      const distance = current.distanceTo(origin);
      if (distance > maxDistance) continue;
      
      // Get block at current position
      const block = this.bot.blockAt(current);
      if (!block) continue;
      
      // If it's the same ore type, add to vein
      if (block.name === oreType) {
        veinBlocks.push({
          position: current.clone(),
          distance: distance,
          block: block
        });
        
        // Add neighbors to queue (6-directional)
        const neighbors = this._getNeighbors(current);
        for (const neighbor of neighbors) {
          const neighborKey = this._positionKey(neighbor);
          if (!visited.has(neighborKey)) {
            queue.push(neighbor);
          }
        }
      } else {
        // Non-ore block adjacent to vein - potential frontier
        if (!block.name.includes('air') && block.boundingBox === 'block') {
          frontierBlocks.add(current.clone());
        }
      }
    }

    // Sort blocks by distance if requested (closest first)
    if (sortByDistance && veinBlocks.length > 0) {
      veinBlocks.sort((a, b) => a.distance - b.distance);
    }

    const result = {
      oreType: oreType,
      blocks: veinBlocks,
      frontierBlocks: Array.from(frontierBlocks),
      count: veinBlocks.length,
      message: veinBlocks.length === maxBlocks 
        ? `Scan stopped at max blocks (${maxBlocks})` 
        : `Found complete vein`
    };

    this.logger.info(`[OreScanner] Found ${result.count} ${oreType} blocks in vein`);
    return result;
  }

  /**
   * Quick check if position contains ore without full scan
   * @param {Vec3} pos - Position to check
   * @returns {boolean}
   */
  isOreAt(pos) {
    const block = this.bot.blockAt(pos);
    return block && this.isOre(block.name);
  }

  /**
   * Get the 6 adjacent neighbors (no diagonals)
   * @param {Vec3} pos - Center position
   * @returns {Vec3[]} Array of neighbor positions
   * @private
   */
  _getNeighbors(pos) {
    return [
      pos.offset(1, 0, 0),   // East
      pos.offset(-1, 0, 0),  // West
      pos.offset(0, 1, 0),   // Up
      pos.offset(0, -1, 0),  // Down
      pos.offset(0, 0, 1),   // South
      pos.offset(0, 0, -1)   // North
    ];
  }

  /**
   * Generate unique key for position
   * @param {Vec3} pos - Position
   * @returns {string} Position key
   * @private
   */
  _positionKey(pos) {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  }

  /**
   * Get optimal mining order for vein
   * Sorts blocks to minimize movement and tool switches
   * @param {Array} veinBlocks - Vein scan results
   * @param {Vec3} startPos - Bot's starting position
   * @returns {Array} Sorted block positions
   */
  getOptimalMiningOrder(veinBlocks, startPos) {
    if (!veinBlocks || veinBlocks.length === 0) return [];
    
    // Start with closest block to bot
    const sorted = [...veinBlocks];
    const botPos = startPos || this.bot.entity.position;
    
    // Greedy nearest-neighbor ordering
    const ordered = [];
    let current = botPos;
    
    while (sorted.length > 0) {
      // Find nearest unvisited block
      let nearestIdx = 0;
      let nearestDist = current.distanceTo(sorted[0].position);
      
      for (let i = 1; i < sorted.length; i++) {
        const dist = current.distanceTo(sorted[i].position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }
      
      const nearest = sorted.splice(nearestIdx, 1)[0];
      ordered.push(nearest);
      current = nearest.position;
    }
    
    return ordered;
  }

  /**
   * Estimate vein mining time based on block count and tool
   * @param {number} blockCount - Number of blocks in vein
   * @param {Object} tool - Tool item (optional)
   * @returns {number} Estimated time in seconds
   */
  estimateMiningTime(blockCount, tool = null) {
    // Base time per block (seconds)
    const baseTime = 3.0;
    
    // Tool efficiency multiplier (rough estimates)
    let efficiency = 1.0;
    if (tool) {
      if (tool.name.includes('diamond')) efficiency = 0.4;
      else if (tool.name.includes('iron')) efficiency = 0.6;
      else if (tool.name.includes('stone')) efficiency = 0.8;
    }
    
    // Add movement overhead (0.5s per block)
    const movementTime = blockCount * 0.5;
    const miningTime = blockCount * baseTime * efficiency;
    
    return Math.ceil(miningTime + movementTime);
  }

  /**
   * Get statistics about current ore whitelist
   * @returns {Object} Whitelist statistics
   */
  getWhitelistStats() {
    const ores = Array.from(this.oreWhitelist);
    return {
      total: ores.length,
      vanilla: ores.filter(o => !o.includes(':')).length,
      modded: ores.filter(o => o.includes(':')).length,
      ores: ores.sort()
    };
  }

  /**
   * Add custom ores to whitelist at runtime
   * @param {string[]} oreNames - Array of ore block names
   */
  addOres(oreNames) {
    const before = this.oreWhitelist.size;
    oreNames.forEach(ore => this.oreWhitelist.add(ore));
    const added = this.oreWhitelist.size - before;
    this.logger.info(`[OreScanner] Added ${added} new ore types (${oreNames.length} provided)`);
  }

  /**
   * Remove ores from whitelist
   * @param {string[]} oreNames - Array of ore block names
   */
  removeOres(oreNames) {
    const before = this.oreWhitelist.size;
    oreNames.forEach(ore => this.oreWhitelist.delete(ore));
    const removed = before - this.oreWhitelist.size;
    this.logger.info(`[OreScanner] Removed ${removed} ore types`);
  }
}
