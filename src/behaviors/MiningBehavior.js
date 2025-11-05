// src/behaviors/MiningBehavior.js
import { Vec3 } from 'vec3';
import PillarBuilder from '../utils/PillarBuilder.js';

/**
 * MiningBehavior - Modular mining with multiple strategies
 * Supports strip-mining, quarry, and tunneling with inventory management
 */
export default class MiningBehavior {
  constructor(bot, logger, master) {
    this.bot = bot;
    this.logger = logger;
    this.master = master;
    this.enabled = false;
    this.isWorking = false;
    this.lookBehavior = null;
    
    // Mining mode: 'strip', 'quarry', 'tunnel'
    this.currentMode = null;
    this.miningPlan = [];
    this.currentPlanIndex = 0;
    
    // Settings (can be overridden via bot.config.behaviors.mining)
    const cfg = (bot && bot.config && bot.config.behaviors && bot.config.behaviors.mining) || {};
    this.settings = {
      // General settings
      depositThreshold: Number.isFinite(cfg.depositThreshold) ? cfg.depositThreshold : 320, // 5 stacks
      returnOnFullInventory: typeof cfg.returnOnFullInventory === 'boolean' ? cfg.returnOnFullInventory : true,
      
      // Strip mining settings
      stripMainTunnelHeight: Number.isFinite(cfg.stripMainTunnelHeight) ? cfg.stripMainTunnelHeight : 2,
      stripMainTunnelWidth: Number.isFinite(cfg.stripMainTunnelWidth) ? cfg.stripMainTunnelWidth : 1,
      stripBranchSpacing: Number.isFinite(cfg.stripBranchSpacing) ? cfg.stripBranchSpacing : 3,
      stripBranchLength: Number.isFinite(cfg.stripBranchLength) ? cfg.stripBranchLength : 32,
      
      // Quarry settings
      quarryLayerHeight: Number.isFinite(cfg.quarryLayerHeight) ? cfg.quarryLayerHeight : 1,
      quarryStairwayInterval: Number.isFinite(cfg.quarryStairwayInterval) ? cfg.quarryStairwayInterval : 10,
      
      // Tunnel settings
      tunnelHeight: Number.isFinite(cfg.tunnelHeight) ? cfg.tunnelHeight : 2,
      tunnelWidth: Number.isFinite(cfg.tunnelWidth) ? cfg.tunnelWidth : 2,
      
      // Torch settings (placeholder for future implementation)
      torchInterval: Number.isFinite(cfg.torchInterval) ? cfg.torchInterval : 8,
      autoPlaceTorches: typeof cfg.autoPlaceTorches === 'boolean' ? cfg.autoPlaceTorches : false,
      
      // Tool management
      toolMinDurability: Number.isFinite(cfg.toolMinDurability) ? cfg.toolMinDurability : 10,
      
      // Safety settings (placeholder)
      checkLightLevel: typeof cfg.checkLightLevel === 'boolean' ? cfg.checkLightLevel : false,
      minLightLevel: Number.isFinite(cfg.minLightLevel) ? cfg.minLightLevel : 8
    };

    // Tool priority (best to worst)
    this.pickaxeTypes = [
      'netherite_pickaxe',
      'diamond_pickaxe',
      'iron_pickaxe',
      'stone_pickaxe',
      'golden_pickaxe',
      'wooden_pickaxe'
    ];

    // Track mining state
    this.depositChestLocation = null;
    this.toolChestLocation = null;
    this.miningStartPosition = null;
    this.currentPickaxe = null;
    this.blocksMinedThisSession = 0;
  }

  setLookBehavior(lookBehavior) {
    this.lookBehavior = lookBehavior;
  }

  enable() {
    this.enabled = true;
    if (this.lookBehavior) this.lookBehavior.pause();
    this.logger.info(`[Mining][${this.bot.username}] Behavior enabled; look paused`);
  }

  disable() {
    this.enabled = false;
    this.isWorking = false;
    if (this.lookBehavior) this.lookBehavior.resume();
    this.logger.info(`[Mining][${this.bot.username}] Behavior disabled; look resumed`);
  }

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
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('mining')) {
        console.log('[DEBUG:Mining]', `[${botName}]`, message);
        this.bot.debugTools.log('mining', `[${botName}] ${message}`);
      }
    } catch (_) {}
  }

  async _goto(pos, timeoutMs = 30000, task = 'mining') {
    if (!pos) throw new Error('_goto: pos required');

    if (this.bot.pathfindingUtil) {
      await this.bot.pathfindingUtil.goto(pos, timeoutMs, task, 1.5);
      return;
    }

    if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
      try {
        const goal = new this.bot.pathfinder.goals.GoalNear(
          Math.floor(pos.x), 
          Math.floor(pos.y), 
          Math.floor(pos.z), 
          1.5
        );
        await this.bot.pathfinder.goto(goal);
        return;
      } catch (e) {
        this._emitDebug('pathfinder.goto failed:', e.message || e);
        throw e;
      }
    }

    throw new Error('No pathfinding available');
  }

  // ============================================================================
  // TOOL MANAGEMENT (now uses ToolHandler)
  // ============================================================================

  /**
   * Get the best pickaxe from inventory
   * @deprecated Use bot.toolHandler._getBestToolOfType('pickaxe') instead
   * @returns {Item|null} Best pickaxe or null if none available
   * 
   * REFACTORED: Now uses ToolHandler as primary method with fallback to legacy code.
   * See CHANGELOG.md v2.0.0 for details.
   */
  _getBestPickaxe() {
    if (this.bot.toolHandler) {
      return this.bot.toolHandler._getBestToolOfType('pickaxe');
    }
    
    // Fallback to old method (preserved for compatibility)
    for (const pickType of this.pickaxeTypes) {
      const pick = this.bot.inventory.items().find(item => item && item.name === pickType);
      if (pick) {
        this._emitDebug(`Found ${pickType} in inventory`);
        return pick;
      }
    }
    return null;
  }

  /**
   * Check if we have a usable pickaxe
   * @deprecated Use bot.toolHandler.hasTool('pickaxe') instead
   * @returns {boolean} True if pickaxe available
   * 
   * REFACTORED: Now uses ToolHandler as primary method with fallback.
   * See CHANGELOG.md v2.0.0 for details.
   */
  _hasPickaxe() {
    if (this.bot.toolHandler) {
      return this.bot.toolHandler.hasTool('pickaxe');
    }
    return this._getBestPickaxe() !== null;
  }

  /**
   * Check pickaxe durability and return if it needs replacement
   * @deprecated ToolHandler manages durability automatically
   * @returns {boolean} True if tool needs replacement
   * 
   * NOTE: This method is kept as fallback for when ToolHandler is unavailable.
   * When ToolHandler is active, durability is managed automatically.
   */
  _needsToolReplacement() {
    if (!this.currentPickaxe) return true;
    
    const item = this.bot.inventory.items().find(i => i && i.type === this.currentPickaxe.type);
    if (!item) return true;
    
    // Check durability if available
    if (item.durabilityUsed !== undefined && item.maxDurability !== undefined) {
      const remaining = item.maxDurability - item.durabilityUsed;
      return remaining < this.settings.toolMinDurability;
    }
    
    return false;
  }

  /**
   * Ensure we have a pickaxe equipped
   * @deprecated Use bot.toolHandler.equipBestTool(block) instead
   * @returns {Promise<boolean>} True if pickaxe equipped successfully
   * 
   * NOTE: This method is kept as fallback for when ToolHandler is unavailable.
   * ToolHandler.smartDig() handles equipping automatically.
   */
  async _ensurePickaxe() {
    if (this._hasPickaxe()) {
      const pick = this._getBestPickaxe();
      await this.bot.equip(pick, 'hand');
      this.currentPickaxe = pick;
      return true;
    }

    this._emitDebug('No pickaxe in inventory');
    // TODO: Try to get from tool chest (placeholder)
    return false;
  }

  // ============================================================================
  // INVENTORY MANAGEMENT
  // ============================================================================

  /**
   * Check if inventory is full or near threshold
   */
  _shouldDeposit() {
    try {
      const items = this.bot.inventory.items();
      const totalItems = items.reduce((sum, item) => sum + (item.count || 0), 0);
      return totalItems >= this.settings.depositThreshold;
    } catch (e) {
      return false;
    }
  }

  /**
   * Find or set deposit chest location
   */
  async _findDepositChest() {
    if (this.depositChestLocation) {
      return this.depositChestLocation;
    }

    // Check if we have a registered chest for mining materials
    if (this.bot.chestRegistry && typeof this.bot.chestRegistry.getChestByType === 'function') {
      const miningChest = this.bot.chestRegistry.getChestByType('mining');
      if (miningChest) {
        this.depositChestLocation = new Vec3(miningChest.x, miningChest.y, miningChest.z);
        this._emitDebug(`Found registered mining chest at ${this.depositChestLocation}`);
        return this.depositChestLocation;
      }
    }

    // Use mining start position as fallback
    if (this.miningStartPosition) {
      this.depositChestLocation = this.miningStartPosition.clone();
      this._emitDebug(`Using mining start position for deposits: ${this.depositChestLocation}`);
      return this.depositChestLocation;
    }

    return null;
  }

  /**
   * Deposit mined materials to chest
   * TODO: Implement courier handoff system
   */
  async _depositMaterials() {
    try {
      this._emitDebug('Depositing materials...');
      
      const depositPos = await this._findDepositChest();
      if (!depositPos) {
        this._emitDebug('No deposit location found - keeping materials');
        return;
      }

      // Navigate to deposit area
      await this._goto(depositPos, 20000, 'deposit');

      // Look for a chest near the deposit location
      let chestBlock = null;
      const searchRadius = 10;
      
      for (let x = -searchRadius; x <= searchRadius; x++) {
        for (let y = -3; y <= 3; y++) {
          for (let z = -searchRadius; z <= searchRadius; z++) {
            const checkPos = depositPos.offset(x, y, z);
            const block = this.bot.blockAt(checkPos);
            if (block && block.name === 'chest') {
              chestBlock = block;
              break;
            }
          }
          if (chestBlock) break;
        }
        if (chestBlock) break;
      }

      if (!chestBlock) {
        this._emitDebug('No chest found near deposit location - keeping materials');
        return;
      }

      // Open chest and deposit all items except tools
      const chest = await this.bot.openContainer(chestBlock);
      const items = this.bot.inventory.items();
      
      for (const item of items) {
        // Don't deposit tools
        if (item.name.includes('pickaxe') || 
            item.name.includes('shovel') || 
            item.name.includes('axe') ||
            item.name.includes('torch')) {
          continue;
        }
        
        try {
          await chest.deposit(item.type, null, item.count);
          this._emitDebug(`Deposited ${item.count} ${item.name}`);
        } catch (e) {
          this._emitDebug(`Failed to deposit ${item.name}:`, e.message);
        }
      }
      
      chest.close();
      this._emitDebug('Materials deposited successfully');
      
    } catch (e) {
      this._emitDebug('Failed to deposit materials:', e.message);
    }
  }

  // ============================================================================
  // MINING PLAN GENERATION
  // ============================================================================

  /**
   * Generate strip mining plan
   * Creates a main tunnel with side branches
   */
  _generateStripMiningPlan(startPos, direction, mainTunnelLength, numBranches) {
    this._emitDebug(`Generating strip mining plan: ${numBranches} branches, ${mainTunnelLength}m main tunnel`);
    
    const plan = [];
    const spacing = this.settings.stripBranchSpacing;
    
    // Determine direction vectors
    let dx = 0, dz = 0;
    switch (direction.toLowerCase()) {
      case 'north': dz = -1; break;
      case 'south': dz = 1; break;
      case 'east': dx = 1; break;
      case 'west': dx = -1; break;
      default: dx = 1; // default to east
    }
    
    // Generate main tunnel
    for (let i = 0; i < mainTunnelLength; i++) {
      const x = startPos.x + (dx * i);
      const z = startPos.z + (dz * i);
      
      // Add blocks for 2-high tunnel
      plan.push({
        position: new Vec3(x, startPos.y, z),
        action: 'dig',
        priority: 'main_tunnel'
      });
      plan.push({
        position: new Vec3(x, startPos.y + 1, z),
        action: 'dig',
        priority: 'main_tunnel'
      });
    }
    
    // Generate side branches (alternating left/right)
    for (let branch = 0; branch < numBranches; branch++) {
      const distanceAlongMain = (branch + 1) * spacing;
      if (distanceAlongMain >= mainTunnelLength) break;
      
      const branchStartX = startPos.x + (dx * distanceAlongMain);
      const branchStartZ = startPos.z + (dz * distanceAlongMain);
      
      // Alternate sides
      const side = (branch % 2 === 0) ? 1 : -1;
      const branchDx = -dz * side; // Perpendicular to main tunnel
      const branchDz = dx * side;
      
      // Generate branch tunnel
      for (let i = 1; i <= this.settings.stripBranchLength; i++) {
        const x = branchStartX + (branchDx * i);
        const z = branchStartZ + (branchDz * i);
        
        plan.push({
          position: new Vec3(x, startPos.y, z),
          action: 'dig',
          priority: 'branch'
        });
        plan.push({
          position: new Vec3(x, startPos.y + 1, z),
          action: 'dig',
          priority: 'branch'
        });
      }
    }
    
    this._emitDebug(`Generated ${plan.length} dig actions for strip mine`);
    return plan;
  }

  /**
   * Generate quarry mining plan
   * TODO: Implement layer-by-layer square excavation with stairway
   */
  _generateQuarryPlan(corner1, corner2, depthLayers) {
    this._emitDebug('Quarry plan generation - TODO: Not yet implemented');
    // Placeholder for future implementation
    return [];
  }

  /**
   * Generate tunnel mining plan
   * Creates a long directional tunnel
   */
  _generateTunnelPlan(startPos, direction, length) {
    this._emitDebug(`Generating tunnel plan: ${length}m ${direction}`);
    
    const plan = [];
    const height = this.settings.tunnelHeight;
    const width = this.settings.tunnelWidth;
    
    // Determine direction vector
    let dx = 0, dz = 0;
    switch (direction.toLowerCase()) {
      case 'north': dz = -1; break;
      case 'south': dz = 1; break;
      case 'east': dx = 1; break;
      case 'west': dx = -1; break;
      default: dx = 1;
    }
    
    // Generate tunnel blocks
    for (let i = 0; i < length; i++) {
      for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
          const x = startPos.x + (dx * i) + (dz * w);
          const y = startPos.y + h;
          const z = startPos.z + (dz * i) + (dx * w);
          
          plan.push({
            position: new Vec3(x, y, z),
            action: 'dig',
            priority: 'tunnel'
          });
        }
      }
    }
    
    this._emitDebug(`Generated ${plan.length} dig actions for tunnel`);
    return plan;
  }

  // ============================================================================
  // MINING EXECUTION
  // ============================================================================

  /**
   * Execute a single dig action from the plan
   * 
   * REFACTORED v2.0.0: Now uses ToolHandler.smartDig() for automatic tool selection.
   * - Automatically switches between pickaxe (stone) and shovel (dirt)
   * - Selects best available tool (diamond > iron > stone)
   * - Handles tool durability automatically
   * - Falls back to manual pickaxe method if ToolHandler unavailable
   * 
   * See CHANGELOG.md v2.0.0 for migration details.
   */
  async _executeDig(digAction) {
    if (!this.enabled || !this.isWorking) return false;
    
    const pos = digAction.position;
    const block = this.bot.blockAt(pos);
    
    // Skip if already air
    if (!block || block.type === 0) {
      return true;
    }
    
    try {
      // Navigate near the block
      const standPos = new Vec3(pos.x, pos.y, pos.z);
      await this._goto(standPos, 10000, 'mining');
      
      // Use ToolHandler for smart tool selection if available
      const blockToDig = this.bot.blockAt(pos);
      if (blockToDig && blockToDig.type !== 0) {
        if (this.bot.toolHandler) {
          // Smart dig - automatically selects and equips best tool
          await this.bot.toolHandler.smartDig(blockToDig);
        } else {
          // Fallback to manual pickaxe method
          await this._ensurePickaxe();
          
          // Check if we need to replace tool
          if (this._needsToolReplacement()) {
            this._emitDebug('Tool needs replacement');
            // TODO: Implement tool restocking
            return false;
          }
          
          await this.bot.dig(blockToDig);
        }
        
        this.blocksMinedThisSession++;
        
        // Small delay after digging
        await new Promise(r => setTimeout(r, 50));
      }
      
      return true;
      
    } catch (e) {
      this._emitDebug(`Failed to dig at ${pos}:`, e.message);
      return false;
    }
  }

  /**
   * Execute the current mining plan
   */
  async _executeMiningPlan() {
    this._emitDebug(`Executing mining plan: ${this.miningPlan.length} actions`);
    
    while (this.enabled && this.isWorking && this.currentPlanIndex < this.miningPlan.length) {
      // Check if inventory is full
      if (this.settings.returnOnFullInventory && this._shouldDeposit()) {
        this._emitDebug('Inventory full, depositing materials...');
        await this._depositMaterials();
      }
      
      // Execute next dig action
      const action = this.miningPlan[this.currentPlanIndex];
      const success = await this._executeDig(action);
      
      if (success) {
        this.currentPlanIndex++;
      } else {
        // If dig failed, skip it and continue
        this._emitDebug(`Skipping failed dig action at index ${this.currentPlanIndex}`);
        this.currentPlanIndex++;
      }
      
      // Periodic status update
      if (this.currentPlanIndex % 50 === 0) {
        const progress = ((this.currentPlanIndex / this.miningPlan.length) * 100).toFixed(1);
        this._emitDebug(`Mining progress: ${progress}% (${this.currentPlanIndex}/${this.miningPlan.length})`);
      }
    }
    
    this._emitDebug(`Mining plan completed. Mined ${this.blocksMinedThisSession} blocks this session`);
  }

  // ============================================================================
  // PUBLIC API - MINING MODES
  // ============================================================================

  /**
   * Start strip mining
   * @param {Vec3} startPos - Starting position
   * @param {string} direction - 'north', 'south', 'east', 'west'
   * @param {number} mainTunnelLength - Length of main tunnel
   * @param {number} numBranches - Number of side branches
   */
  async startStripMining(startPos, direction = 'east', mainTunnelLength = 100, numBranches = 10) {
    if (this.isWorking) {
      this._emitDebug('Already mining');
      return;
    }
    
    this.enabled = true;
    this.isWorking = true;
    this.currentMode = 'strip';
    this.miningStartPosition = startPos.clone();
    this.blocksMinedThisSession = 0;
    
    this._emitDebug(`Starting strip mining at ${startPos}`);
    
    try {
      // Generate mining plan
      this.miningPlan = this._generateStripMiningPlan(startPos, direction, mainTunnelLength, numBranches);
      this.currentPlanIndex = 0;
      
      // Execute plan
      await this._executeMiningPlan();
      
      // Final deposit
      if (this._shouldDeposit()) {
        await this._depositMaterials();
      }
      
    } catch (err) {
      this.logger.error(`[Mining][${this.bot.username}] Strip mining error: ${err.message || err}`);
    } finally {
      this.isWorking = false;
      this._emitDebug('Strip mining stopped');
    }
  }

  /**
   * Start quarry mining
   * TODO: Implement quarry mode
   */
  async startQuarry(corner1, corner2, depth) {
    this._emitDebug('Quarry mode - TODO: Not yet implemented');
    this.logger.warn('[Mining] Quarry mode not yet implemented');
  }

  /**
   * Start tunnel mining
   * @param {Vec3} startPos - Starting position
   * @param {string} direction - 'north', 'south', 'east', 'west'
   * @param {number} length - Length of tunnel
   */
  async startTunnel(startPos, direction = 'east', length = 100) {
    if (this.isWorking) {
      this._emitDebug('Already mining');
      return;
    }
    
    this.enabled = true;
    this.isWorking = true;
    this.currentMode = 'tunnel';
    this.miningStartPosition = startPos.clone();
    this.blocksMinedThisSession = 0;
    
    this._emitDebug(`Starting tunnel mining at ${startPos}`);
    
    try {
      // Generate mining plan
      this.miningPlan = this._generateTunnelPlan(startPos, direction, length);
      this.currentPlanIndex = 0;
      
      // Execute plan
      await this._executeMiningPlan();
      
      // Final deposit
      if (this._shouldDeposit()) {
        await this._depositMaterials();
      }
      
    } catch (err) {
      this.logger.error(`[Mining][${this.bot.username}] Tunnel mining error: ${err.message || err}`);
    } finally {
      this.isWorking = false;
      this._emitDebug('Tunnel mining stopped');
    }
  }

  /**
   * Stop current mining operation
   */
  stopMining() {
    this.isWorking = false;
    this.enabled = false;
    this._emitDebug('Mining operation stopped by user');
  }

  // ============================================================================
  // PLACEHOLDER FUNCTIONS - FUTURE IMPLEMENTATION
  // ============================================================================

  /**
   * TODO: Implement torch placement at intervals
   */
  async _placeTorch(position) {
    this._emitDebug('Torch placement - TODO: Not yet implemented');
    // Check if torch in inventory
    // Navigate to position
    // Place torch on appropriate wall
  }

  /**
   * TODO: Implement vein mining when ore is discovered
   */
  async _veinMine(orePosition) {
    this._emitDebug('Vein mining - TODO: Not yet implemented');
    // Detect ore type
    // Find all connected ore blocks
    // Mine them systematically
    // Return to original mining plan position
  }

  /**
   * TODO: Implement light level checking for safety
   */
  _checkLightLevel(position) {
    // Check if light level is adequate
    // Return true if safe, false if needs torch
    return true;
  }

  /**
   * TODO: Implement mob detection and avoidance
   */
  async _handleMobThreat() {
    this._emitDebug('Mob handling - TODO: Not yet implemented');
    // Detect nearby hostile mobs
    // Pause mining and retreat or fight
  }

  /**
   * TODO: Implement tool restocking from chest
   */
  async _restockTools() {
    this._emitDebug('Tool restocking - TODO: Not yet implemented');
    // Find tool chest
    // Navigate to it
    // Withdraw replacement pickaxe
    // Return to mining position
  }

  /**
   * TODO: Implement courier handoff system
   */
  async _handoffToCourier() {
    this._emitDebug('Courier handoff - TODO: Not yet implemented');
    // Request courier bot
    // Wait for courier arrival
    // Transfer inventory items
    // Resume mining
  }
}
