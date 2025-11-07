// src/behaviors/MiningBehavior.js
import { Vec3 } from 'vec3';
import fs from 'fs';
import path from 'path';

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
      tunnelHeight: Number.isFinite(cfg.tunnelHeight) ? cfg.tunnelHeight : 3,
      tunnelWidth: Number.isFinite(cfg.tunnelWidth) ? cfg.tunnelWidth : 3,
      
      // Torch settings (placeholder for future implementation)
      torchInterval: Number.isFinite(cfg.torchInterval) ? cfg.torchInterval : 8,
      autoPlaceTorches: typeof cfg.autoPlaceTorches === 'boolean' ? cfg.autoPlaceTorches : false,
      
      // Tool management
      toolMinDurability: Number.isFinite(cfg.toolMinDurability) ? cfg.toolMinDurability : 10,
      
      // Obstacle handling settings
      handleObstacles: typeof cfg.handleObstacles === 'boolean' ? cfg.handleObstacles : true,
      bridgeGaps: typeof cfg.bridgeGaps === 'boolean' ? cfg.bridgeGaps : true,
      coverWater: typeof cfg.coverWater === 'boolean' ? cfg.coverWater : true,
      coverLava: typeof cfg.coverLava === 'boolean' ? cfg.coverLava : true,
      bridgingMaterials: Array.isArray(cfg.bridgingMaterials) ? cfg.bridgingMaterials : 
        ['cobblestone', 'cobbled_deepslate', 'dirt', 'andesite', 'diorite', 'granite', 'netherrack'],
      maxBridgeDistance: Number.isFinite(cfg.maxBridgeDistance) ? cfg.maxBridgeDistance : 5,
      lookAheadDistance: Number.isFinite(cfg.lookAheadDistance) ? cfg.lookAheadDistance : 12,
    // Digging/approach behavior
    digApproachRange: Number.isFinite(cfg.digApproachRange) ? cfg.digApproachRange : 3.5,
    // Max block breaking reach distance (vanilla ~5 blocks)
    digReachDistance: Number.isFinite(cfg.digReachDistance) ? cfg.digReachDistance : 5,
    // Dig retry behavior
    digRetryLimit: Number.isFinite(cfg.digRetryLimit) ? cfg.digRetryLimit : 3,
    // Delay between dig attempt and verification read (ms)
    digVerifyDelayMs: Number.isFinite(cfg.digVerifyDelayMs) ? cfg.digVerifyDelayMs : 150,
      
    // Deposit keep quotas
    keepBridgingTotal: Number.isFinite(cfg.keepBridgingTotal) ? cfg.keepBridgingTotal : 64,
    keepFoodMin: Number.isFinite(cfg.keepFoodMin) ? cfg.keepFoodMin : 16,
      
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
    // Track blocks placed by this bot (bridging/covering) to avoid re-scanning before breaking them
    this.placedBlocks = new Set();
    // Track current tunnel dimensions for obstacle scanning
    this.currentTunnelWidth = null;
    this.currentTunnelHeight = null;

    // Deposit behavior
    this.depositAfterCompletion = false;

    // Preload food list (shared with EatBehavior) for keep rules
    try {
      const foodPath = path.resolve('./src/config/foodList.json');
      const raw = fs.readFileSync(foodPath, 'utf-8');
      this._foodList = JSON.parse(raw);
    } catch (_) {
      this._foodList = { edible: [] };
    }
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

  async _goto(pos, timeoutMs = 30000, task = 'mining', range = 3) {
    if (!pos) throw new Error('_goto: pos required');

    if (this.bot.pathfindingUtil) {
      await this.bot.pathfindingUtil.goto(pos, timeoutMs, task, range);
      return;
    }

    if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
      try {
        const goal = new this.bot.pathfinder.goals.GoalNear(
          Math.floor(pos.x), 
          Math.floor(pos.y), 
          Math.floor(pos.z), 
          range
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
   * Find all chests near a given position
   * @param {Vec3} centerPos - Center position to search from
   * @param {number} radius - Search radius (default 15)
   * @returns {Array<Block>} Array of chest blocks found
   */
  _findNearbyChests(centerPos, radius = 15) {
    const chests = [];
    const searchRadius = Math.max(5, radius);
    
    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let y = -5; y <= 5; y++) {
        for (let z = -searchRadius; z <= searchRadius; z++) {
          const checkPos = centerPos.offset(x, y, z);
          const block = this.bot.blockAt(checkPos);
          if (block && block.name === 'chest') {
            chests.push(block);
          }
        }
      }
    }
    
    this._emitDebug(`Found ${chests.length} chest(s) within ${searchRadius} blocks of ${centerPos}`);
    return chests;
  }

  /**
   * Deposit mined materials to chest
   * Tries multiple chests if the first one is full
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

      // Find all nearby chests
      const chests = this._findNearbyChests(depositPos, 15);
      
      if (chests.length === 0) {
        this._emitDebug('No chest found near deposit location - keeping materials');
        return;
      }

      // Try each chest until we successfully deposit everything
      let deposited = false;
      for (const chestBlock of chests) {
        try {
          // Move closer to this specific chest
          const chestDist = this.bot.entity.position.distanceTo(chestBlock.position);
          if (chestDist > 4) {
            await this._goto(chestBlock.position, 5000, 'chest_approach', 3);
          }
          
          // Open chest and try to deposit
          const chest = await this.bot.openContainer(chestBlock);
          const itemsBefore = this.bot.inventory.items().length;
          
          await this._depositWithKeepRules(chest, { 
            keepBridgingTotal: this.settings.keepBridgingTotal, 
            keepFoodMin: this.settings.keepFoodMin 
          });
          
          chest.close();
          
          const itemsAfter = this.bot.inventory.items().length;
          
          // Check if we still have items to deposit (excluding tools/essentials)
          const hasMoreToDeposit = this._shouldDeposit();
          
          if (!hasMoreToDeposit || itemsAfter < itemsBefore) {
            this._emitDebug(`Materials deposited to chest at ${chestBlock.position}`);
            deposited = true;
            
            // If we still have items to deposit, try next chest
            if (hasMoreToDeposit) {
              this._emitDebug('Chest full, trying next chest...');
              continue;
            }
            break;
          }
        } catch (e) {
          this._emitDebug(`Failed to deposit to chest at ${chestBlock.position}: ${e.message}`);
          // Try next chest
          continue;
        }
      }
      
      if (deposited) {
        this._emitDebug('Materials deposited successfully');
      } else {
        this._emitDebug('All nearby chests are full or inaccessible - keeping materials');
      }
      
    } catch (e) {
      this._emitDebug('Failed to deposit materials:', e.message);
    }
  }

  /**
   * Deposit inventory to a chest while keeping essentials.
   * Keeps:
   * - Tools (pickaxe/shovel/axe/sword/hoe/shears) and torches
   * - Up to keepBridgingTotal total blocks from settings.bridgingMaterials
   * - At least keepFoodMin edible items (from foodList.json)
   */
  async _depositWithKeepRules(chest, { keepBridgingTotal = 64, keepFoodMin = 16 } = {}) {
    const items = this.bot.inventory.items();

    const isToolOrTorch = (name) => {
      const n = name.toLowerCase();
      return n.includes('pickaxe') || n.includes('shovel') || n.includes('axe') || n.includes('sword') || n.includes('hoe') || n.includes('shears') || n.includes('torch');
    };
    const isBridging = (name) => this.settings.bridgingMaterials.includes(name);
    const edibleList = Array.isArray(this._foodList?.edible) ? this._foodList.edible : [];
    const isFood = (name) => edibleList.includes(name);

    // Allocate keep quotas
    let bridgingRemain = Math.max(0, keepBridgingTotal);
    let foodRemain = Math.max(0, keepFoodMin);

    // First pass: determine deposit counts per item
    for (const item of items) {
      try {
        // Skip if nothing to deposit
        if (!item || !item.count) continue;

        // Always keep tools/torches entirely
        if (isToolOrTorch(item.name)) continue;

        // Bridging materials: keep up to bridgingRemain in total
        if (isBridging(item.name)) {
          const keep = Math.min(item.count, bridgingRemain);
          const toDeposit = item.count - keep;
          bridgingRemain -= keep;
          if (toDeposit > 0) {
            await chest.deposit(item.type, null, toDeposit).catch(e => this._emitDebug(`Deposit fail (bridging ${item.name}): ${e.message}`));
            this._emitDebug(`Deposited ${toDeposit} ${item.name} (kept ${keep})`);
          }
          continue;
        }

        // Food: keep up to foodRemain in total edible count
        if (isFood(item.name)) {
          const keep = Math.min(item.count, foodRemain);
          const toDeposit = item.count - keep;
          foodRemain -= keep;
          if (toDeposit > 0) {
            await chest.deposit(item.type, null, toDeposit).catch(e => this._emitDebug(`Deposit fail (food ${item.name}): ${e.message}`));
            this._emitDebug(`Deposited ${toDeposit} ${item.name} (kept ${keep})`);
          }
          continue;
        }

        // Everything else: deposit all
        await chest.deposit(item.type, null, item.count).catch(e => this._emitDebug(`Deposit fail (${item.name}): ${e.message}`));
        this._emitDebug(`Deposited ${item.count} ${item.name}`);
      } catch (e) {
        // Continue on individual failures
      }
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
   * Creates a rectangular excavation going downward in horizontal layers
   * @param {Vec3} corner1 - First corner of the quarry area
   * @param {Vec3} corner2 - Opposite corner of the quarry area
   * @param {number} depth - How many layers deep to excavate
   * @returns {Array} Mining plan with dig actions organized by layer
   */
  _generateQuarryPlan(corner1, corner2, depth) {
    // Normalize corners to get min/max bounds
    const minX = Math.min(Math.floor(corner1.x), Math.floor(corner2.x));
    const maxX = Math.max(Math.floor(corner1.x), Math.floor(corner2.x));
    const minZ = Math.min(Math.floor(corner1.z), Math.floor(corner2.z));
    const maxZ = Math.max(Math.floor(corner1.z), Math.floor(corner2.z));
    const startY = Math.max(Math.floor(corner1.y), Math.floor(corner2.y)); // Start from higher Y
    
    const width = maxX - minX + 1;
    const length = maxZ - minZ + 1;
    const layers = Math.max(1, depth);
    
    this._emitDebug(`Generating quarry plan: ${width}x${length} area, ${layers} layers deep from Y=${startY}`);
    
    const plan = [];
    
    // Generate plan layer by layer, going downward
    for (let layer = 0; layer < layers; layer++) {
      const y = startY - layer;
      
      // For each layer, dig in a pattern (e.g., rows)
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          plan.push({
            position: new Vec3(x, y, z),
            action: 'dig',
            priority: 'quarry',
            layer: layer
          });
        }
      }
    }
    
    this._emitDebug(`Generated ${plan.length} dig actions for ${width}x${length}x${layers} quarry`);
    return plan;
  }

  /**
   * Generate tunnel mining plan
   * Creates a long directional tunnel with configurable dimensions
   */
  _generateTunnelPlan(startPos, direction, length, width = null, height = null) {
    const tunnelWidth = width !== null ? width : this.settings.tunnelWidth;
    const tunnelHeight = height !== null ? height : this.settings.tunnelHeight;
    
    this._emitDebug(`Generating tunnel plan: ${length}m ${direction} (${tunnelWidth}x${tunnelHeight})`);
    
    const plan = [];
    
    // Determine direction vector
    let dx = 0, dz = 0;
    switch (direction.toLowerCase()) {
      case 'north': dz = -1; break;
      case 'south': dz = 1; break;
      case 'east': dx = 1; break;
      case 'west': dx = -1; break;
      default: dx = 1;
    }
    
    // Precompute lateral offsets (handles even/odd widths)
    const lateralOffsets = this._getLateralOffsets(tunnelWidth);

    // Generate tunnel blocks in vertical slices (for each forward step, mine full width x height)
    for (let i = 0; i < length; i++) {
      for (let h = 0; h < tunnelHeight; h++) {
        const y = startPos.y + h;
        for (const w of lateralOffsets) {
          const x = startPos.x + (dx * i) + (-dz * w);
          const z = startPos.z + (dz * i) + (dx * w);

          plan.push({
            position: new Vec3(x, y, z),
            action: 'dig',
            priority: 'tunnel'
          });
        }
      }
    }
    
    this._emitDebug(`Generated ${plan.length} dig actions for ${tunnelWidth}x${tunnelHeight} tunnel`);
    return plan;
  }

  // ============================================================================
  // OBSTACLE DETECTION & HANDLING
  // ============================================================================

  /**
   * Generate a stable string key for a position (floored)
   */
  _posKey(pos) {
    const p = pos.floored ? pos.floored() : new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    return `${p.x},${p.y},${p.z}`;
  }

  _markPlaced(pos) {
    try { this.placedBlocks.add(this._posKey(pos)); } catch (_) {}
  }

  _wasPlacedByBot(pos) {
    try { return this.placedBlocks.has(this._posKey(pos)); } catch (_) { return false; }
  }

  /**
   * Check if a position is a hole/gap (air or void)
   * @param {Vec3} pos - Position to check
   * @returns {boolean} True if hole detected
   */
  _isHole(pos) {
    const block = this.bot.blockAt(pos);
    if (!block) return true;
    
    // Air or void
    return block.type === 0 || block.name === 'air' || block.name === 'cave_air';
  }

  /**
   * Check if a position contains water
   * @param {Vec3} pos - Position to check
   * @returns {boolean} True if water detected
   */
  _isWater(pos) {
    const block = this.bot.blockAt(pos);
    if (!block) return false;
    return block.name === 'water' || block.name === 'flowing_water';
  }

  /**
   * Check if a position contains lava
   * @param {Vec3} pos - Position to check
   * @returns {boolean} True if lava detected
   */
  _isLava(pos) {
    const block = this.bot.blockAt(pos);
    if (!block) return false;
    return block.name === 'lava' || block.name === 'flowing_lava';
  }

  /**
   * Check for obstacles in the path (holes, water, lava)
   * @param {Vec3} pos - Position to check
   * @returns {Object} Obstacle info: {type: 'none'|'hole'|'water'|'lava', position: Vec3}
   */
  _detectObstacle(pos) {
    // Check the floor position (one block below)
    const floorPos = pos.offset(0, -1, 0);
    
    if (this._isLava(pos) || this._isLava(floorPos)) {
      return { type: 'lava', position: this._isLava(pos) ? pos : floorPos };
    }
    
    if (this._isWater(pos) || this._isWater(floorPos)) {
      return { type: 'water', position: this._isWater(pos) ? pos : floorPos };
    }
    
    if (this._isHole(floorPos)) {
      return { type: 'hole', position: floorPos };
    }
    
    return { type: 'none', position: null };
  }

  /**
   * Get bridging material from inventory
   * @returns {Item|null} Best bridging material or null
   */
  _getBridgingMaterial() {
    const items = this.bot.inventory.items();
    
    // Try to find preferred bridging materials
    for (const matName of this.settings.bridgingMaterials) {
      const item = items.find(i => i && i.name === matName);
      if (item && item.count > 0) {
        this._emitDebug(`Found bridging material: ${item.name} (${item.count})`);
        return item;
      }
    }
    
    // Fallback: any solid block that's not a tool or valuable
    const excludeNames = ['diamond', 'emerald', 'gold', 'iron_ore', 'coal', 
                          'pickaxe', 'shovel', 'axe', 'sword', 'torch'];
    const fallbackItem = items.find(i => {
      if (!i || i.count === 0) return false;
      const name = i.name.toLowerCase();
      return !excludeNames.some(excl => name.includes(excl));
    });
    
    if (fallbackItem) {
      this._emitDebug(`Using fallback bridging material: ${fallbackItem.name}`);
    }
    
    return fallbackItem || null;
  }

  /**
   * Place a block at the specified position
   * @param {Vec3} pos - Position to place block
   * @param {Item} material - Material to place
   * @returns {Promise<boolean>} True if successful
   */
  async _placeBlock(pos, material) {
    try {
      // Get the block at position
      const targetBlock = this.bot.blockAt(pos);
      if (!targetBlock) {
        this._emitDebug(`Cannot place block at ${pos} - block not found`);
        return false;
      }

      // If block is solid, no need to place
      if (targetBlock.type !== 0 && targetBlock.name !== 'water' && targetBlock.name !== 'lava') {
        this._emitDebug(`Block at ${pos} is already solid: ${targetBlock.name}`);
        return true;
      }

      // Find a reference block to place against
      const referenceBlock = this.bot.blockAt(pos.offset(0, -1, 0)) || // Below
                             this.bot.blockAt(pos.offset(1, 0, 0)) ||  // East
                             this.bot.blockAt(pos.offset(-1, 0, 0)) || // West
                             this.bot.blockAt(pos.offset(0, 0, 1)) ||  // South
                             this.bot.blockAt(pos.offset(0, 0, -1));   // North

      if (!referenceBlock || referenceBlock.type === 0) {
        this._emitDebug(`No reference block found for placing at ${pos}`);
        return false;
      }

      // Equip the material
      await this.bot.equip(material, 'hand');
      
      // Calculate face vector (which face of reference block to place on)
      const dx = pos.x - referenceBlock.position.x;
      const dy = pos.y - referenceBlock.position.y;
      const dz = pos.z - referenceBlock.position.z;
      const faceVec = new Vec3(dx, dy, dz);

      // Place the block
      await this.bot.placeBlock(referenceBlock, faceVec);
      this._emitDebug(`Placed ${material.name} at ${pos}`);
      // Mark this block as placed by the bot (for later skip/scan decisions)
      this._markPlaced(pos);
      
      return true;
      
    } catch (e) {
      this._emitDebug(`Failed to place block at ${pos}: ${e.message}`);
      return false;
    }
  }

  /**
   * Bridge a gap by placing blocks
   * @param {Vec3} pos - Position of the gap
   * @returns {Promise<boolean>} True if successfully bridged
   */
  async _bridgeGap(pos) {
    if (!this.settings.bridgeGaps) return false;
    
    this._emitDebug(`Bridging gap at ${pos}`);
    
    // In tunnel mode, always bridge at the planned tunnel floor plane
    if (this.currentMode === 'tunnel') {
      const desiredY = this._getDesiredFloorY();
      if (pos.y !== desiredY) pos = new Vec3(pos.x, desiredY, pos.z);
    } else if (this.currentMode === 'quarry') {
      // In quarry mode, only place safety platforms two blocks below the bot
      try {
        const feetY = Math.floor(this.bot.entity.position.y);
        const safetyY = feetY - 2;
        if (pos.y !== safetyY) pos = new Vec3(pos.x, safetyY, pos.z);
      } catch (_) {}
    }

    const material = this._getBridgingMaterial();
    if (!material) {
      this._emitDebug('No bridging material available');
      return false;
    }
    
    // Place block to fill the gap
    return await this._placeBlock(pos, material);
  }

  /**
   * Cover water by placing blocks on top
   * @param {Vec3} pos - Position of water
   * @returns {Promise<boolean>} True if successfully covered
   */
  async _coverWater(pos) {
    if (!this.settings.coverWater) return false;
    
    this._emitDebug(`Covering water at ${pos}`);
    
    const material = this._getBridgingMaterial();
    if (!material) {
      this._emitDebug('No material available to cover water');
      return false;
    }
    
    // Place block on top of water
    return await this._placeBlock(pos, material);
  }

  /**
   * Cover lava by placing blocks on top
   * @param {Vec3} pos - Position of lava
   * @returns {Promise<boolean>} True if successfully covered
   */
  async _coverLava(pos) {
    if (!this.settings.coverLava) return false;
    
    this._emitDebug(`Covering lava at ${pos}`);
    
    const material = this._getBridgingMaterial();
    if (!material) {
      this._emitDebug('No material available to cover lava');
      return false;
    }
    
    // Place block on top of lava
    return await this._placeBlock(pos, material);
  }

  /**
   * Handle any obstacle encountered during mining
   * @param {Object} obstacle - Obstacle info from _detectObstacle
   * @returns {Promise<boolean>} True if obstacle was handled
   */
  async _handleObstacle(obstacle) {
    if (!this.settings.handleObstacles || obstacle.type === 'none') {
      return true;
    }
    
    this._emitDebug(`Handling ${obstacle.type} obstacle at ${obstacle.position}`);
    
    try {
      switch (obstacle.type) {
        case 'hole':
          return await this._bridgeGap(obstacle.position);
          
        case 'water':
          return await this._coverWater(obstacle.position);
          
        case 'lava':
          return await this._coverLava(obstacle.position);
          
        default:
          return true;
      }
    } catch (e) {
      this._emitDebug(`Failed to handle ${obstacle.type} obstacle: ${e.message}`);
      return false;
    }
  }

  /**
   * Get the nearest cardinal forward direction based on bot yaw
   * @returns {{dx:number, dz:number}} Unit step in X/Z for forward direction
   */
  _getForwardDir() {
    try {
      const yaw = this.bot?.entity?.yaw ?? 0;
      // Convert yaw to unit vector and snap to nearest cardinal
      const sx = Math.round(Math.sin(yaw));
      const sz = Math.round(Math.cos(yaw));
      // Normalize to one of (-1,0,1)
      const dx = Math.max(-1, Math.min(1, sx));
      const dz = Math.max(-1, Math.min(1, sz));
      // Avoid (0,0)
      if (dx === 0 && dz === 0) return { dx: 0, dz: 1 };
      return { dx, dz };
    } catch (_) {
      return { dx: 0, dz: 1 };
    }
  }

  /**
   * Get the left/right direction vector perpendicular to forward
   * @returns {{dx:number, dz:number}} Unit step for sideways (left is -dz, dx)
   */
  _getSideDir() {
    const { dx, dz } = this._getForwardDir();
    // Left vector perpendicular to forward
    return { dx: -dz, dz: dx };
  }

  /**
   * Build lateral offsets for a given width centered on the path.
   * Odd widths are symmetric [-k..k]. Even widths bias one to the +side: [-(k-1)..k].
   */
  _getLateralOffsets(width) {
    const offsets = [];
    if (width <= 0) return offsets;
    if (width % 2 === 1) {
      const k = (width - 1) / 2;
      for (let w = -k; w <= k; w++) offsets.push(w);
    } else {
      const k = width / 2;
      for (let w = -(k - 1); w <= k; w++) offsets.push(w);
    }
    return offsets;
  }

  /**
   * Get the desired floor Y level for placement/bridging.
   * - In tunnel mode, anchor to the planned tunnel floor (start Y - 1)
   * - Otherwise, use the bot's current feet Y - 1
   */
  _getDesiredFloorY() {
    try {
      if (this.currentMode === 'tunnel' && this.miningStartPosition) {
        return this.miningStartPosition.y - 1;
      }
    } catch (_) {}
    return Math.floor(this.bot.entity.position.y - 1);
  }

  /**
   * Scan ahead for obstacles and secure the path on the current Y level
   * Checks up to `distance` blocks in front of the bot and bridges/covers hazards.
   * @param {number} distance - How many blocks ahead to scan (default from settings)
   */
  async _scanAheadAndSecure(distance = 12) {
    if (!this.settings.handleObstacles) return;

    const { dx, dz } = this._getForwardDir();
    const basePos = this.bot.entity.position.floored();
    const floorY = this._getDesiredFloorY(); // anchor to desired floor plane

    for (let step = 1; step <= distance; step++) {
      const floorPos = new Vec3(basePos.x + dx * step, floorY, basePos.z + dz * step);
      // Pass the position just above the floor to _detectObstacle so its internal
      // floor check hits the intended block.
      const posAboveFloor = floorPos.offset(0, 1, 0);
      const obstacle = this._detectObstacle(posAboveFloor);
      if (obstacle.type === 'none') continue;

      // Move near the obstacle but do not step into it; stand just before it
      const standPos = posAboveFloor.offset(-dx, 0, -dz);
      try {
        await this._goto(standPos, 8000, 'obstacle');
      } catch (e) {
        this._emitDebug(`Could not reach obstacle stand position at ${standPos}: ${e.message}`);
        // If we can't reach, try to handle from here (may fail due to range)
      }

      const handled = await this._handleObstacle({ type: obstacle.type, position: floorPos });
      if (!handled) {
        this._emitDebug(`Failed to secure obstacle (${obstacle.type}) at ${floorPos}`);
        // Best effort: continue scanning remaining steps
      } else {
        this._emitDebug(`Secured obstacle (${obstacle.type}) at ${floorPos}`);
      }
    }
  }

  /**
   * Scan multiple slices ahead: step through configurable-wide x configurable-tall slices while advancing.
   * Only handles hazards (holes, water, lava) that are OUTSIDE the planned tunnel area or on the floor.
   * Does NOT fill in blocks within the tunnel volume that will be mined anyway.
   * opts:
   *  - base: starting Vec3 (floored)
   *  - forwardDir: {dx,dz} direction to scan
   *  - maxSteps: number of slices to scan (default 3)
   *  - width: tunnel width in blocks (default from tunnelWidth setting)
   *  - height: tunnel height in blocks (default from tunnelHeight setting)
   */
  async _scanSliceAheadAndSecure(opts = {}) {
    if (!this.settings.handleObstacles) return;

    const base0 = (opts.base && opts.base.floored ? opts.base.floored() : opts.base) || this.bot.entity.position.floored();
    const forwardDir = opts.forwardDir || this._getForwardDir();
    const dx = forwardDir.dx;
    const dz = forwardDir.dz;
    // Derive sideways vector from provided forward (avoid yaw drift)
    const sdx = -dz;
    const sdz = dx;

    const maxSteps = Number.isFinite(opts.maxSteps) ? Math.max(1, opts.maxSteps) : 3;
    const width = Number.isFinite(opts.width) ? opts.width : this.settings.tunnelWidth;
    const height = Number.isFinite(opts.height) ? opts.height : this.settings.tunnelHeight;

  // Keep a constant floorY to maintain Y-level (anchor to planned tunnel plane if available)
  const floorY = this._getDesiredFloorY();

    // Calculate lateral offsets based on width (handles even/odd)
    const lateralOffsets = this._getLateralOffsets(width);

    // Advance slice-by-slice
    for (let step = 1; step <= maxSteps; step++) {
      // This slice is 'step' blocks ahead
      // Center of this slice
      const sliceCenterX = base0.x + dx * step;
      const sliceCenterZ = base0.z + dz * step;

      // ALWAYS check and secure the floor - this is where the bot walks
      for (const w of lateralOffsets) {
        const floorPos = new Vec3(
          sliceCenterX + sdx * w,
          floorY,
          sliceCenterZ + sdz * w
        );
        const posAboveFloor = floorPos.offset(0, 1, 0);

        if (!this._wasPlacedByBot(floorPos)) {
          const floorObstacle = this._detectObstacle(posAboveFloor);
          // Only handle floor if it's a hole/water/lava that could harm the bot
          if (floorObstacle.type !== 'none') {
            const standPos = new Vec3(
              base0.x + dx * (step - 1) + sdx * w,
              base0.y,
              base0.z + dz * (step - 1) + sdz * w
            );
            const distToStand = this.bot.entity.position.distanceTo(standPos);
            if (distToStand > 4.5) {
              try { await this._goto(standPos, 3000, 'obstacle'); } catch {}
            }
            const handled = await this._handleObstacle({ type: floorObstacle.type, position: floorPos });
            if (!handled) this._emitDebug(`Failed securing floor ${floorObstacle.type} at ${floorPos}`);
          }
        }
      }

      // For the vertical scan, ONLY handle water/lava in the tunnel area
      // Do NOT bridge holes in the tunnel - those are blocks we're about to mine anyway!
      for (const w of lateralOffsets) {
        for (let h = 0; h < height; h++) {
          const cellPos = new Vec3(
            sliceCenterX + sdx * w,
            base0.y + h,
            sliceCenterZ + sdz * w
          );
          if (this._wasPlacedByBot(cellPos)) continue;

          // Check what's at this position
          const block = this.bot.blockAt(cellPos);
          if (!block) continue;

          // ONLY handle water and lava within the tunnel volume
          // Ignore holes/air - we're going to mine through them anyway
          const isWater = block.name === 'water' || block.name === 'flowing_water';
          const isLava = block.name === 'lava' || block.name === 'flowing_lava';
          
          if (isWater || isLava) {
            const standPos = new Vec3(
              base0.x + dx * (step - 1) + sdx * w,
              base0.y,
              base0.z + dz * (step - 1) + sdz * w
            );
            const distToStand = this.bot.entity.position.distanceTo(standPos);
            if (distToStand > 4.5) {
              try { await this._goto(standPos, 3000, 'obstacle'); } catch {}
            }

            const obstacleType = isLava ? 'lava' : 'water';
            const handled = await this._handleObstacle({ type: obstacleType, position: cellPos });
            if (!handled) this._emitDebug(`Failed securing ${obstacleType} at ${cellPos}`);
          }
        }
      }
    }
  }

  /**
   * Perform a final cleanup pass over the tunnel volume to remove any missed blocks.
   * Scans the entire planned tunnel area and digs any remaining non-air blocks.
   * Caches missed blocks and only counts them as cleared when actually broken.
   * @param {Array} miningPlan - The original mining plan with all positions
   * @returns {Promise<number>} Number of blocks cleaned up
   */
  async _cleanupTunnelPass(miningPlan) {
    if (!miningPlan || miningPlan.length === 0) return 0;
    
    this._emitDebug('Starting final cleanup pass for tunnel...');
    
    // Collect all unique positions from the plan
    const positions = [];
    const seenKeys = new Set();
    
    for (const action of miningPlan) {
      if (!action || !action.position) continue;
      const key = this._posKey(action.position);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        positions.push(action.position);
      }
    }
    
    this._emitDebug(`Cleanup pass scanning ${positions.length} positions`);
    
    // Build cache of missed blocks with their keys
    const missedBlocksMap = new Map(); // key -> { position, action, priority }
    
    // First pass: identify missed blocks and cache them
    for (const pos of positions) {
      const block = this.bot.blockAt(pos);
      if (block && block.type !== 0 && block.name !== 'air' && block.name !== 'cave_air') {
        const key = this._posKey(pos);
        missedBlocksMap.set(key, { position: pos, action: 'dig', priority: 'cleanup' });
      }
    }
    
    if (missedBlocksMap.size === 0) {
      this._emitDebug('No missed blocks found - tunnel is clean!');
      return 0;
    }
    
    this._emitDebug(`Found ${missedBlocksMap.size} missed blocks to clean up`);
    
    let cleaned = 0;
    const missedBlocks = Array.from(missedBlocksMap.values());
    const maxRetries = 2; // Allow retries per block during cleanup
    
    // Second pass: clean up missed blocks using the verification helper
    for (const digAction of missedBlocks) {
      if (!this.enabled || !this.isWorking) break;
      
      const key = this._posKey(digAction.position);
      
      // Skip if already removed from cache (verified as cleared)
      if (!missedBlocksMap.has(key)) continue;
      
      // Check inventory and deposit if needed
      if (this.settings.returnOnFullInventory && this._shouldDeposit()) {
        this._emitDebug('Inventory full during cleanup, depositing materials...');
        await this._depositMaterials();
      }
      
      const success = await this._breakAndConfirm(digAction, { maxRetries, waitMs: this.settings.digVerifyDelayMs, approachOnRetry: true });
      if (success) {
        missedBlocksMap.delete(key);
        cleaned++;
      } else {
        const still = this.bot.blockAt(digAction.position);
        if (still) this._emitDebug(`Block at ${digAction.position} persisted through cleanup (${still.name})`);
      }
    }
    
    const remaining = missedBlocksMap.size;
    if (remaining > 0) {
      this._emitDebug(`Cleanup pass completed: removed ${cleaned} blocks, ${remaining} remaining`);
    } else {
      this._emitDebug(`Cleanup pass completed: removed ${cleaned} blocks - tunnel is clean!`);
    }
    
    return cleaned;
  }

  // ============================================================================
  // MINING EXECUTION
  // ============================================================================

  /**
   * Helper: ensure a block is actually broken before continuing.
   * Re-attempts digging and verifies the target becomes air/cave_air within retry budget.
   * @param {{position: Vec3, action?: string, priority?: string}} digAction
   * @param {{ maxRetries?: number, waitMs?: number, approachOnRetry?: boolean }} opts
   * @returns {Promise<boolean>} true if cleared; false if still present after retries or aborted
   */
  async _breakAndConfirm(digAction, opts = {}) {
    if (!digAction || !digAction.position) return false;
    if (!this.enabled || !this.isWorking) return false;

    const pos = digAction.position;
    const maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : (this.settings.digRetryLimit || 3);
    const verifyDelay = Number.isFinite(opts.waitMs) ? opts.waitMs : (this.settings.digVerifyDelayMs || 150);
    const approachOnRetry = opts.approachOnRetry !== undefined ? !!opts.approachOnRetry : true;

    for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt++) {
      // Early-out if already cleared
      const pre = this.bot.blockAt(pos);
      if (!pre || pre.type === 0 || pre.name === 'air' || pre.name === 'cave_air') return true;

      // On subsequent attempts, optionally move a bit closer/tighter
      if (attempt > 1 && approachOnRetry) {
        try {
          const reach = Number.isFinite(this.settings.digReachDistance) ? this.settings.digReachDistance : 5;
          const closeRange = Math.max(0.8, Math.min(1.5, reach - 0.25));
          await this._goto(pos, 8000, 'mining_retry', closeRange);
          await new Promise(r => setTimeout(r, 100));
        } catch (_) {}
      }

      const didAttempt = await this._executeDig(digAction);
      if (!didAttempt && attempt >= maxRetries) {
        // If we didn't even attempt (e.g., aborted), bail out early
        return false;
      }

      // Give the world a tick to update, then verify
      if (verifyDelay > 0) await new Promise(r => setTimeout(r, verifyDelay));
      const post = this.bot.blockAt(pos);
      const cleared = !post || post.type === 0 || post.name === 'air' || post.name === 'cave_air';
      if (cleared) return true;

      // Not cleared yet; try again next loop
      if (attempt < maxRetries) {
        this._emitDebug(`Block still present at ${pos} after attempt ${attempt}; retrying`);
      }
    }

    // All attempts exhausted
    this._emitDebug(`Failed to clear block at ${digAction.position} after ${maxRetries} attempts`);
    return false;
  }

  /**
   * Execute a single dig action from the plan
   * 
   * REFACTORED v2.0.0: Now uses ToolHandler.smartDig() for automatic tool selection.
   * - Automatically switches between pickaxe (stone) and shovel (dirt)
   * - Selects best available tool (diamond > iron > stone)
   * - Handles tool durability automatically
   * - Falls back to manual pickaxe method if ToolHandler unavailable
   * 
   * ENHANCED v2.0.1: Added obstacle detection and handling
   * - Detects holes, water pockets, and lava pockets
   * - Automatically bridges gaps to maintain Y level
   * - Covers water and lava sources before proceeding
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
      // Navigate only if outside of breaking reach; otherwise try digging from here
      const distToTarget = this.bot.entity.position.distanceTo(pos);
      const reach = Number.isFinite(this.settings.digReachDistance) ? this.settings.digReachDistance : 6;
      if (!(Number.isFinite(distToTarget) && distToTarget <= reach)) {
        const approachRange = Math.max(1.0, Math.min(this.settings.digApproachRange, reach));
        await this._goto(pos, 10000, 'mining', approachRange);
      }

      const desiredFloorY = this._getDesiredFloorY();

      // Right before breaking: if this block was NOT placed by the bot, scan the slice ahead
      if (!this._wasPlacedByBot(pos)) {
        const botPos = this.bot.entity.position.floored();
        // Derive forward from bot -> target to avoid yaw drift
        let fdx = Math.sign(Math.floor(pos.x) - botPos.x);
        let fdz = Math.sign(Math.floor(pos.z) - botPos.z);
        if (fdx === 0 && fdz === 0) {
          const d = this._getForwardDir();
          fdx = d.dx; fdz = d.dz;
        }
        
        // Use current tunnel dimensions if available (for tunnel mode), otherwise use defaults
        const scanWidth = this.currentTunnelWidth || this.settings.tunnelWidth;
        const scanHeight = this.currentTunnelHeight || this.settings.tunnelHeight;
        
        await this._scanSliceAheadAndSecure({ 
          base: botPos, 
          forwardDir: { dx: fdx, dz: fdz }, 
          maxSteps: Math.min(3, this.settings.lookAheadDistance),
          width: scanWidth,
          height: scanHeight
        });
      }
      
      // Check for liquids BEFORE digging (avoid flooding/lava)
      const preDigObstacle = this._detectObstacle(pos);
      if (preDigObstacle.type === 'water' || preDigObstacle.type === 'lava') {
        this._emitDebug(`Detected ${preDigObstacle.type} before digging at ${pos}`);
        const handled = await this._handleObstacle(preDigObstacle);
        if (!handled) {
          this._emitDebug(`Failed to handle pre-dig obstacle, skipping this block`);
          return false;
        }
      }
      
      // Use ToolHandler for smart tool selection if available
      const blockToDig = this.bot.blockAt(pos);
      if (blockToDig && blockToDig.type !== 0) {
        try {
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
        } catch (digErr) {
          // If we failed likely due to distance/angle, move a bit closer and retry once
          const msg = (digErr && digErr.message) ? digErr.message.toLowerCase() : '';
          const maybeDistanceIssue = msg.includes('out of range') || msg.includes('too far') || msg.includes('reach');
          if (maybeDistanceIssue) {
            try {
              const reach = Number.isFinite(this.settings.digReachDistance) ? this.settings.digReachDistance : 5;
              const closeRange = Math.max(0.8, Math.min(1.5, reach - 0.25));
              await this._goto(pos, 6000, 'mining', closeRange);
              // Retry once
              if (this.bot.toolHandler) {
                await this.bot.toolHandler.smartDig(this.bot.blockAt(pos));
              } else {
                await this._ensurePickaxe();
                if (this._needsToolReplacement()) return false;
                await this.bot.dig(this.bot.blockAt(pos));
              }
            } catch (retryErr) {
              this._emitDebug(`Retry dig failed at ${pos}: ${retryErr.message || retryErr}`);
              return false;
            }
          } else {
            this._emitDebug(`Dig failed at ${pos}: ${digErr.message || digErr}`);
            return false;
          }
        }
        
        this.blocksMinedThisSession++;
        
        // Small delay after digging
        await new Promise(r => setTimeout(r, 50));
      }
      
      // Check for liquids AFTER digging (holes are expected inside tunnel, ignore)
      const postDigObstacle = this._detectObstacle(pos);
      if (postDigObstacle.type === 'water' || postDigObstacle.type === 'lava') {
        this._emitDebug(`Detected ${postDigObstacle.type} after digging at ${pos}`);
        const handled = await this._handleObstacle(postDigObstacle);
        if (!handled) {
          this._emitDebug(`Failed to handle post-dig liquid, but continuing`);
          // Continue anyway - we've already mined the block
        }
      }
      
      // Check the floor where we're standing to maintain Y level
      // Anchor under-feet check to desired tunnel floor plane when tunneling
      const floorPos = new Vec3(
        Math.floor(this.bot.entity.position.x),
        desiredFloorY,
        Math.floor(this.bot.entity.position.z)
      );
      // _detectObstacle expects the position ABOVE the floor, so add +1y
      const posAboveFloor = floorPos.offset(0, 1, 0);
      const floorObstacle = this._detectObstacle(posAboveFloor);
      if (floorObstacle.type !== 'none') {
        this._emitDebug(`Detected ${floorObstacle.type} under bot at ${floorPos}`);
        const handled = await this._handleObstacle(floorObstacle);
        if (!handled) {
          this._emitDebug(`Warning: Failed to secure footing, but continuing carefully`);
        }
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

    const total = this.miningPlan.length;
    let completed = 0;

    // If tunneling, preserve vertical slice order by executing the plan as ordered
    if (this.currentMode === 'tunnel') {
      const queue = this.miningPlan.slice();
      const retryCounts = new Map();
      this._emitDebug(`Processing tunnel plan in vertical slices (${queue.length} actions)`);

      while (this.enabled && this.isWorking && queue.length > 0) {
        // Deposit if needed
        if (this.settings.returnOnFullInventory && this._shouldDeposit()) {
          this._emitDebug('Inventory full, depositing materials...');
          await this._depositMaterials();
        }

  const action = queue.shift();
  const success = await this._breakAndConfirm(action);

        if (success) {
          completed++;
          this.currentPlanIndex = completed; // Update real-time progress
        } else {
          const key = this._posKey(action.position);
          const tries = (retryCounts.get(key) || 0) + 1;
          if (tries < this.settings.digRetryLimit) {
            retryCounts.set(key, tries);
            queue.push(action);
            this._emitDebug(`Re-queue dig at ${key} (retry ${tries}/${this.settings.digRetryLimit - 1})`);
          } else {
            this._emitDebug(`Giving up on ${key} after ${tries} attempts`);
            completed++;
            this.currentPlanIndex = completed; // Update even on failures
          }
        }

        if (completed % 50 === 0) {
          const progress = ((completed / total) * 100).toFixed(1);
          this._emitDebug(`Mining progress: ${progress}% (${completed}/${total})`);
        }
      }
    } else {
      // Default: group by Y layer to avoid gravel/sand falls and simplify reach
      const layerMap = new Map(); // y -> action[]
      for (const action of this.miningPlan) {
        const y = action.position.y;
        if (!layerMap.has(y)) layerMap.set(y, []);
        layerMap.get(y).push(action);
      }
      const layers = Array.from(layerMap.entries()).sort((a, b) => a[0] - b[0]);

      for (const [layerY, actions] of layers) {
        // Build a queue for this layer
        const queue = actions.slice();
        const retryCounts = new Map(); // posKey -> count
        this._emitDebug(`Processing layer Y=${layerY} (${queue.length} actions)`);

        while (this.enabled && this.isWorking && queue.length > 0) {
        // Deposit if needed
        if (this.settings.returnOnFullInventory && this._shouldDeposit()) {
          this._emitDebug('Inventory full, depositing materials...');
          await this._depositMaterials();
        }

  const action = queue.shift();
  const success = await this._breakAndConfirm(action);

        if (success) {
          completed++;
          this.currentPlanIndex = completed; // Update real-time progress
        } else {
          const key = this._posKey(action.position);
          const tries = (retryCounts.get(key) || 0) + 1;
          if (tries < this.settings.digRetryLimit) {
            retryCounts.set(key, tries);
            queue.push(action); // requeue to try later in the same layer
            this._emitDebug(`Re-queue dig at ${key} (retry ${tries}/${this.settings.digRetryLimit - 1})`);
          } else {
            // Give up on this block after max retries
            this._emitDebug(`Giving up on ${key} after ${tries} attempts`);
            completed++;
            this.currentPlanIndex = completed; // Update even on failures
          }
        }

        // Periodic status update
        if (completed % 50 === 0) {
          const progress = ((completed / total) * 100).toFixed(1);
          this._emitDebug(`Mining progress: ${progress}% (${completed}/${total})`);
        }
        }
      }
    }

    // Sync index for any external consumers
    this.currentPlanIndex = completed;
    this._emitDebug(`Mining plan completed. Mined ${this.blocksMinedThisSession} blocks this session`);

    // Optional post-completion deposit with keep rules
    if (this.depositAfterCompletion) {
      try {
        this._emitDebug('Post-completion deposit requested. Depositing with keep rules...');
        const depositPos = await this._findDepositChest();
        if (depositPos) {
          await this._goto(depositPos, 20000, 'deposit');
          // Find a chest near the deposit location
          let chestBlock = null;
          const searchRadius = 10;
          for (let x = -searchRadius; x <= searchRadius && !chestBlock; x++) {
            for (let y = -3; y <= 3 && !chestBlock; y++) {
              for (let z = -searchRadius; z <= searchRadius; z++) {
                const checkPos = depositPos.offset(x, y, z);
                const block = this.bot.blockAt(checkPos);
                if (block && block.name === 'chest') { chestBlock = block; break; }
              }
            }
          }
          if (chestBlock) {
            const chest = await this.bot.openContainer(chestBlock);
            await this._depositWithKeepRules(chest, { keepBridgingTotal: this.settings.keepBridgingTotal, keepFoodMin: this.settings.keepFoodMin });
            chest.close();
            this._emitDebug('Post-completion deposit done.');
          } else {
            this._emitDebug('No chest found near deposit location for post-completion deposit.');
          }
        } else {
          this._emitDebug('No deposit position set; skipping post-completion deposit.');
        }
      } catch (e) {
        this._emitDebug(`Post-completion deposit failed: ${e.message || e}`);
      } finally {
        this.depositAfterCompletion = false; // reset flag
      }
    }
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
   * Start quarry mining operation
   * Digs a rectangular area downward in horizontal slices
   * Deposits when inventory is ~80% full (uses existing depositThreshold setting)
   */
  async startQuarry(corner1, corner2, depth) {
    if (this.currentMode) {
      this._emitDebug(`Cannot start quarry - already in ${this.currentMode} mode`);
      return;
    }

    try {
      // Enable mining state
      this.enabled = true;
      this.isWorking = true;
      this.currentMode = 'quarry';
      this.miningStartPosition = this.bot.entity.position.clone();
      this.miningPlan = [];
      this.blocksMinedThisSession = 0;

      this._emitDebug(`Starting quarry from ${corner1} to ${corner2}, depth: ${depth}`);

      // Generate quarry plan (horizontal layers going down)
      const plan = this._generateQuarryPlan(corner1, corner2, depth);
      this.miningPlan = plan;

      if (plan.length === 0) {
        this._emitDebug('No blocks to mine in quarry plan');
        return;
      }

      // NOTE: Conservative pathfinding is NOT used for quarry mode
      // The bot needs to freely dig and navigate within the quarry area
      // Conservative pathfinding would prevent proper navigation during excavation

      // Execute quarry layer by layer
      let lastLayer = -1;
      let processedCount = 0;
      let itemCollectorWasRunning = false;
      
      // Disable item collection during quarry to prevent interruptions
      if (this.bot.itemCollector && this.bot.itemCollector.isRunning) {
        itemCollectorWasRunning = true;
        this.bot.itemCollector.stopAuto();
        this._emitDebug('Paused item collection for quarry operation');
      }
      
      for (const digAction of plan) {
        // Check if we should stop
        if (!this.enabled || !this.bot.isAlive || this.currentMode !== 'quarry') {
          this._emitDebug('Quarry operation interrupted');
          break;
        }

        // When starting a new layer, collect items from the previous layer
        if (digAction.layer !== lastLayer) {
          // If this isn't the first layer, do a collection sweep
          if (lastLayer >= 0 && this.bot.itemCollector) {
            this._emitDebug(`Layer ${lastLayer + 1} complete - collecting dropped items...`);
            try {
              const collected = await this.bot.itemCollector.collectOnce({ radius: 16 });
              if (collected > 0) {
                this._emitDebug(`Collected ${collected} items from layer ${lastLayer + 1}`);
              }
            } catch (e) {
              this._emitDebug(`Failed to collect items: ${e.message}`);
            }
          }
          
          this._emitDebug(`Mining layer ${digAction.layer + 1} of ${depth}`);
          lastLayer = digAction.layer;
        }

        // Check inventory and deposit if needed (80% threshold)
        if (this._shouldDeposit()) {
          this._emitDebug('Inventory ~80% full, depositing...');
          await this._depositMaterials();
        }

        // Execute this dig action with verification
        const pos = digAction.position;
        const block = this.bot.blockAt(pos);
        
        this._emitDebug(`[Quarry] Processing block ${processedCount + 1}/${plan.length} at ${pos.x},${pos.y},${pos.z} - blockType: ${block ? block.name : 'null'}`);
        
        if (!block || block.name === 'air') {
          this._emitDebug(`[Quarry] Block already air, skipping`);
          processedCount++;
          this.currentPlanIndex = processedCount;
          continue; // Already mined or air
        }

        const success = await this._breakAndConfirm(digAction, { maxRetries: this.settings.digRetryLimit, waitMs: this.settings.digVerifyDelayMs, approachOnRetry: true });
        
        if (success) {
          processedCount++;
          this.currentPlanIndex = processedCount;
          this._emitDebug(`[Quarry] Successfully mined block ${processedCount}/${plan.length}`);
        } else {
          this._emitDebug(`[Quarry] Failed to mine block at ${pos} after verification retries`);
          processedCount++; // Still count it to avoid infinite loop
          this.currentPlanIndex = processedCount;
        }

        // Small delay between blocks
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Final collection sweep after last layer
      if (this.bot.itemCollector) {
        this._emitDebug('Final collection sweep after quarry completion...');
        try {
          const collected = await this.bot.itemCollector.collectOnce({ radius: 20 });
          if (collected > 0) {
            this._emitDebug(`Collected ${collected} items in final sweep`);
          }
        } catch (e) {
          this._emitDebug(`Failed final collection: ${e.message}`);
        }
      }

      // Final deposit after quarry complete
      if (this._shouldDeposit()) {
        this._emitDebug('Final deposit after quarry completion');
        await this._depositMaterials();
      }

      // Cleanup pass to catch any missed blocks
      this._emitDebug('Running cleanup pass for missed blocks...');
      await this._cleanupTunnelPass(plan); // Reuse tunnel cleanup logic

      this._emitDebug(`Quarry complete! Mined ${this.blocksMinedThisSession} blocks`);

    } catch (e) {
      this._emitDebug('Quarry operation failed:', e.message);
      this.bot.chat(`Quarry failed: ${e.message}`);
    } finally {
      // Reset state
      this.isWorking = false;
      this.currentMode = null;
      this.miningPlan = [];
      
      // Re-enable item collection if it was running before quarry
      if (itemCollectorWasRunning && this.bot.itemCollector) {
        this.bot.itemCollector.startAuto({ radius: 8, intervalMs: 10000 });
        this._emitDebug('Resumed item collection after quarry');
      }
      
      // No need to pop digging bias - we don't use conservative pathfinding for quarry
    }
  }

  /**
   * Start tunnel mining
   * @param {Vec3} startPos - Starting position (should be at the bot's feet level)
   * @param {string} direction - 'north', 'south', 'east', 'west'
   * @param {number} length - Length of tunnel
   * @param {number} width - Width of tunnel (optional, default from config)
   * @param {number} height - Height of tunnel (optional, default from config)
   */
  async startTunnel(startPos, direction = 'east', length = 100, width = null, height = null) {
    if (this.isWorking) {
      this._emitDebug('Already mining');
      return;
    }
    
    // Use provided dimensions or fall back to config
    const tunnelWidth = width !== null ? width : this.settings.tunnelWidth;
    const tunnelHeight = height !== null ? height : this.settings.tunnelHeight;
    
    this.enabled = true;
    this.isWorking = true;
    this.currentMode = 'tunnel';
    // We'll apply conservative digging after we compute the full plan so we can restrict digging to planned blocks
    let conservativeApplied = false;
    
    // The floor block is one block below the bot's feet
    const floorY = Math.floor(this.bot.entity.position.y - 1);
    // The tunnel starts at the bot's feet level (one block above the floor)
    const tunnelStartY = floorY + 1;
    const adjustedStartPos = new Vec3(Math.floor(startPos.x), tunnelStartY, Math.floor(startPos.z));
    
    this.miningStartPosition = adjustedStartPos.clone();
    this.blocksMinedThisSession = 0;
    
    // Store current tunnel dimensions for obstacle scanning
    this.currentTunnelWidth = tunnelWidth;
    this.currentTunnelHeight = tunnelHeight;
    
    this._emitDebug(`Starting ${tunnelWidth}x${tunnelHeight} tunnel mining at ${adjustedStartPos} (floor Y: ${floorY}, tunnel starts at Y: ${tunnelStartY})`);
    
    try {
      // Generate mining plan with custom dimensions
      this.miningPlan = this._generateTunnelPlan(adjustedStartPos, direction, length, tunnelWidth, tunnelHeight);
      this.currentPlanIndex = 0;

      // Build a set of allowed dig positions (entire planned tunnel volume)
      const allowedSet = new Set();
      for (const action of this.miningPlan) {
        if (action && action.position) {
          const p = action.position;
          allowedSet.add(`${p.x},${p.y},${p.z}`);
        }
      }
      // Apply conservative digging constrained to planned blocks only
      try {
        if (this.bot.pathfindingUtil && typeof this.bot.pathfindingUtil.pushConservativeDigging === 'function') {
          const pred = (block) => {
            if (!block || !block.position) return false;
            const bp = block.position;
            return allowedSet.has(`${bp.x},${bp.y},${bp.z}`);
          };
          conservativeApplied = this.bot.pathfindingUtil.pushConservativeDigging({ digCost: 120, canDigPredicate: pred });
        }
      } catch (_) { /* ignore */ }
      
      // Execute plan
      await this._executeMiningPlan();
      
      // Final cleanup pass to catch any missed blocks
      if (this.enabled && this.isWorking) {
        const cleanedCount = await this._cleanupTunnelPass(this.miningPlan);
        if (cleanedCount > 0) {
          this._emitDebug(`Final cleanup pass removed ${cleanedCount} missed block(s)`);
          this.blocksMinedThisSession += cleanedCount;
        }
      }
      
      // Final deposit
      if (this._shouldDeposit()) {
        await this._depositMaterials();
      }
      
    } catch (err) {
      this.logger.error(`[Mining][${this.bot.username}] Tunnel mining error: ${err.message || err}`);
    } finally {
      this.isWorking = false;
      this.currentTunnelWidth = null;
      this.currentTunnelHeight = null;
      // Restore normal pathfinding dig behavior after tunneling
      try { if (conservativeApplied && this.bot.pathfindingUtil && typeof this.bot.pathfindingUtil.popDiggingBias === 'function') this.bot.pathfindingUtil.popDiggingBias(); } catch (_) {}
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
