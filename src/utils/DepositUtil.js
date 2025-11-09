// src/utils/DepositUtil.js
import fs from 'fs/promises';
import path from 'path';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

/**
 * Centralized deposit utility for all resource-gathering behaviors
 * Provides consistent chest finding, navigation, and item depositing
 */
export default class DepositUtil {
  constructor(bot, logger) {
    this.bot = bot;
    this.logger = logger;
    this.itemCategories = {};
    this._loadCategories();
  }

  async _loadCategories() {
    try {
      const file = path.join(process.cwd(), 'src', 'config', 'itemCategories.json');
      const raw = await fs.readFile(file, 'utf8');
      this.itemCategories = JSON.parse(raw);
    } catch (_err) {
      this.logger?.warn?.('[DepositUtil] Failed to load itemCategories.json');
      this.itemCategories = {};
    }
  }

  /**
   * Find nearest chest/container within range
   * @param {number} searchRadius - Maximum search distance
   * @param {Vec3} fromPos - Position to search from (defaults to bot position)
   * @returns {Vec3|null} Position of nearest chest or null
   */
  async findNearestChest(searchRadius = 20, fromPos = null) {
    const startPos = fromPos || this.bot.entity.position;
    
    try {
      const chestBlocks = this.bot.findBlocks({
        matching: block => {
          const name = block.name;
          return name.includes('chest') || name.includes('barrel') || name.includes('shulker_box');
        },
        maxDistance: searchRadius,
        count: 20,
      });

      if (!chestBlocks.length) {
        this.logger?.warn?.(`[DepositUtil] No containers found within ${searchRadius} blocks`);
        return null;
      }

      // Find closest chest
      const nearest = chestBlocks
        .map(pos => ({
          pos,
          distance: startPos.distanceTo(pos),
        }))
        .sort((a, b) => a.distance - b.distance)[0];

      return nearest.pos;
    } catch (err) {
      this.logger?.error?.(`[DepositUtil] Failed to find chest: ${err.message}`);
      return null;
    }
  }

  /**
   * Navigate to a chest position
   * @param {Vec3} chestPos - Target chest position
   * @param {number} timeoutMs - Navigation timeout
   * @returns {boolean} Success
   */
  async navigateToChest(chestPos, timeoutMs = 30000) {
    if (!chestPos) return false;

    try {
      const dist = this.bot.entity.position.distanceTo(chestPos);
      
      if (dist <= 4.5) {
        this.logger?.debug?.('[DepositUtil] Already near chest');
        return true;
      }

      this.logger?.info?.(`[DepositUtil] Navigating ${dist.toFixed(1)} blocks to chest...`);

      if (this.bot.pathfindingUtil) {
        await this.bot.pathfindingUtil.goto(chestPos, timeoutMs, 'deposit', 3);
      } else if (this.bot.pathfinder) {
        const goal = new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 3);
        await this.bot.pathfinder.goto(goal);
      } else {
        throw new Error('No pathfinding available');
      }

      return true;
    } catch (err) {
      this.logger?.error?.(`[DepositUtil] Navigation failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Open a chest with retry logic
   * @param {Block} chestBlock - The chest block to open
   * @param {number} attempts - Number of retry attempts
   * @returns {Window} Chest window
   */
  async openChestSafe(chestBlock, attempts = 3) {
    let lastErr;
    
    for (let i = 0; i < attempts; i++) {
      try {
        const chest = await this.bot.openChest(chestBlock);
        if (chest) return chest;
      } catch (err) {
        lastErr = err;
        this.logger?.warn?.(`[DepositUtil] Open chest attempt ${i + 1} failed: ${err.message}`);
        if (i < attempts - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    
    throw lastErr || new Error('Failed to open chest');
  }

  /**
   * Filter inventory items by type/category
   * @param {string} type - 'all', item name, or category ('wood', 'ores', 'crops', etc.)
   * @returns {Array} Filtered items
   */
  filterItemsByType(type = 'all') {
    const items = this.bot.inventory.items();
    
    if (!type || type === 'all') {
      return items;
    }

    // Exact item name match
    const exactMatch = items.filter(i => i.name === type);
    if (exactMatch.length > 0) return exactMatch;

    // Category matching
    const categoryItems = this.itemCategories[type];
    if (Array.isArray(categoryItems)) {
      return items.filter(i => categoryItems.includes(i.name));
    }

    // Heuristic matching for common types
    switch (type.toLowerCase()) {
      case 'wood':
      case 'logs':
        return items.filter(i => i.name.includes('log') || i.name.includes('_wood') || i.name.includes('plank'));
      
      case 'ores':
      case 'ore':
        return items.filter(i => 
          i.name.includes('ore') || 
          i.name.includes('raw_') ||
          i.name.includes('_ore') ||
          ['coal', 'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'quartz'].includes(i.name)
        );
      
      case 'crops':
      case 'food':
        return items.filter(i => 
          i.name.includes('wheat') || 
          i.name.includes('carrot') || 
          i.name.includes('potato') ||
          i.name.includes('beetroot') ||
          i.name.includes('seeds')
        );
      
      case 'resources':
        return items.filter(i => 
          i.name.includes('ingot') || 
          i.name.includes('gem') ||
          i.name.includes('raw_') ||
          ['diamond', 'emerald', 'lapis_lazuli', 'redstone', 'quartz', 'coal'].includes(i.name)
        );
      
      default:
        // Partial name match
        return items.filter(i => i.name.includes(type));
    }
  }

  /**
   * Deposit items to a chest
   * @param {Block} chestBlock - The chest block
   * @param {string} type - Item type/category to deposit
   * @returns {Object} { success: boolean, depositedCount: number, depositedItems: Array }
   */
  async depositItems(chestBlock, type = 'all') {
    const result = {
      success: false,
      depositedCount: 0,
      depositedItems: []
    };

    try {
      const chest = await this.openChestSafe(chestBlock);
      const itemsToDeposit = this.filterItemsByType(type);

      if (itemsToDeposit.length === 0) {
        this.logger?.warn?.(`[DepositUtil] No items found matching type: ${type}`);
        chest.close();
        return result;
      }

      this.logger?.info?.(`[DepositUtil] Depositing ${itemsToDeposit.length} item stacks...`);

      for (const item of itemsToDeposit) {
        try {
          await chest.deposit(item.type, null, item.count);
          result.depositedCount += item.count;
          result.depositedItems.push(item.name);
          this.logger?.info?.(`[DepositUtil] Deposited ${item.count}x ${item.name}`);
          
          // Small delay to prevent desyncs
          await new Promise(r => setTimeout(r, 150));
        } catch (err) {
          this.logger?.error?.(`[DepositUtil] Failed to deposit ${item.name}: ${err.message}`);
        }
      }

      chest.close();
      result.success = true;
      this.logger?.success?.(`[DepositUtil] Deposited ${result.depositedCount} items successfully`);
      
      return result;
    } catch (err) {
      this.logger?.error?.(`[DepositUtil] Deposit failed: ${err.message}`);
      return result;
    }
  }

  /**
   * Find nearest chest and deposit items
   * Main method to be called by behaviors
   * @param {string} type - Item type/category to deposit
   * @param {number} searchRadius - Maximum search distance for chests
   * @returns {Object} Deposit result
   */
  async depositToNearest(type = 'all', searchRadius = 20) {
    const result = {
      success: false,
      depositedCount: 0,
      depositedItems: [],
      error: null
    };

    try {
      // Check if we have items to deposit
      const itemsToDeposit = this.filterItemsByType(type);
      if (itemsToDeposit.length === 0) {
        result.error = `No items found matching type: ${type}`;
        this.logger?.warn?.(`[DepositUtil] ${result.error}`);
        return result;
      }

      // Find nearest chest
      const chestPos = await this.findNearestChest(searchRadius);
      if (!chestPos) {
        result.error = `No chest found within ${searchRadius} blocks`;
        this.logger?.warn?.(`[DepositUtil] ${result.error}`);
        return result;
      }

      // Navigate to chest
      const navigated = await this.navigateToChest(chestPos);
      if (!navigated) {
        result.error = 'Failed to navigate to chest';
        return result;
      }

      // Get chest block and deposit
      const chestBlock = this.bot.blockAt(chestPos);
      if (!chestBlock || !chestBlock.name.includes('chest')) {
        result.error = 'Chest block not found at target position';
        this.logger?.error?.(`[DepositUtil] ${result.error}`);
        return result;
      }

      // Deposit items
      return await this.depositItems(chestBlock, type);

    } catch (err) {
      result.error = err.message || String(err);
      this.logger?.error?.(`[DepositUtil] depositToNearest failed: ${result.error}`);
      return result;
    }
  }

  /**
   * Check if bot should deposit based on inventory fullness
   * @param {number} threshold - Percentage full (0-1)
   * @returns {boolean}
   */
  shouldDeposit(threshold = 0.8) {
    try {
      const items = this.bot.inventory.items();
      const usedSlots = items.length;
      const totalSlots = 36; // Standard inventory size
      return (usedSlots / totalSlots) >= threshold;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Get deposit diagnostics
   * @returns {Object} Diagnostic info
   */
  async getDiagnostics() {
    try {
      const items = this.bot.inventory.items();
      return {
        totalItems: items.reduce((sum, i) => sum + i.count, 0),
        usedSlots: items.length,
        totalSlots: 36,
        fullness: (items.length / 36 * 100).toFixed(1) + '%',
        categoriesLoaded: Object.keys(this.itemCategories).length
      };
    } catch (err) {
      return { error: String(err) };
    }
  }
}
