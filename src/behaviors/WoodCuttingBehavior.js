// src/behaviors/WoodCuttingBehavior.js
import { Vec3 } from 'vec3';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;
import PillarBuilder from '../utils/PillarBuilder.js';

export default class WoodCuttingBehavior {
  constructor(bot, logger, master) {
    this.bot = bot;
    this.logger = logger;
    this.master = master;
    this.enabled = false;
    this.isWorking = false;
    this.woodcuttingArea = null;
    this.lookBehavior = null;
    
    // Settings (can be overridden via bot.config.behaviors.woodcutting)
    const cfg = (bot && bot.config && bot.config.behaviors && bot.config.behaviors.woodcutting) || {};
    this.settings = {
      scaffoldBlocks: Array.isArray(cfg.scaffoldBlocks) && cfg.scaffoldBlocks.length > 0 ? cfg.scaffoldBlocks : ['dirt', 'cobblestone'],
      cleanupScaffold: (typeof cfg.cleanupScaffold === 'boolean') ? cfg.cleanupScaffold : true,
      maxTrunkHeight: Number.isFinite(cfg.maxTrunkHeight) ? cfg.maxTrunkHeight : 32,
      // Timing settings for pillar placement (adjust for server latency/performance)
      pillarPreDelayMs: Number.isFinite(cfg.pillarPreDelayMs) ? cfg.pillarPreDelayMs : 150,
      pillarJumpDelayMs: Number.isFinite(cfg.pillarJumpDelayMs) ? cfg.pillarJumpDelayMs : 100,
      pillarPlaceDelayMs: Number.isFinite(cfg.pillarPlaceDelayMs) ? cfg.pillarPlaceDelayMs : 100,
      pillarMoveDelayMs: Number.isFinite(cfg.pillarMoveDelayMs) ? cfg.pillarMoveDelayMs : 80,
      baseBreakDelayMs: Number.isFinite(cfg.baseBreakDelayMs) ? cfg.baseBreakDelayMs : 250,
      logBreakDelayMs: Number.isFinite(cfg.logBreakDelayMs) ? cfg.logBreakDelayMs : 100,
      cleanupDigDelayMs: Number.isFinite(cfg.cleanupDigDelayMs) ? cfg.cleanupDigDelayMs : 80
    };

    // Tree types and their corresponding saplings
    this.treeTypes = {
      'oak_log': 'oak_sapling',
      'spruce_log': 'spruce_sapling',
      'birch_log': 'birch_sapling',
      'jungle_log': 'jungle_sapling',
      'acacia_log': 'acacia_sapling',
      'dark_oak_log': 'dark_oak_sapling',
      'cherry_log': 'cherry_sapling',
      'mangrove_log': 'mangrove_propagule',
      'crimson_stem': 'crimson_fungus',
      'warped_stem': 'warped_fungus'
    };

    this.leafTypes = [
      'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
      'acacia_leaves', 'dark_oak_leaves', 'cherry_leaves', 'mangrove_leaves',
      'azalea_leaves', 'flowering_azalea_leaves'
    ];

    // Axe types (best to worst)
    this.axeTypes = [
      'netherite_axe',
      'diamond_axe',
      'iron_axe',
      'golden_axe',
      'stone_axe',
      'wooden_axe'
    ];

    this.currentAxe = null;
    this.toolChestLocation = null;
    this.depositChestLocation = null;
  }

  setLookBehavior(lookBehavior) {
    this.lookBehavior = lookBehavior;
  }

  enable() {
    this.enabled = true;
    if (this.lookBehavior) this.lookBehavior.pause();
    this.logger.info(`[Wood][${this.bot.username}] Behavior enabled; look paused`);
  }

  disable() {
    this.enabled = false;
    this.isWorking = false;
    if (this.lookBehavior) this.lookBehavior.resume();
    this.logger.info(`[Wood][${this.bot.username}] Behavior disabled; look resumed`);
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
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('wood')) {
        console.log('[DEBUG:Wood]', `[${botName}]`, message);
        this.bot.debugTools.log('wood', `[${botName}] ${message}`);
      }
    } catch (_) {}
  }

  async _goto(pos, timeoutMs = 30000, task = 'generic') {
    if (!pos) throw new Error('_goto: pos required');

    // Use centralized pathfinding utility if available
    if (this.bot.pathfindingUtil) {
      await this.bot.pathfindingUtil.goto(pos, timeoutMs, task, 1.5);
      return;
    }

    // Fallback to direct pathfinder (legacy support)
    const targetPos = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    
    if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
      try {
        const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1.5);
        await this.bot.pathfinder.goto(goal);
        return;
      } catch (e) {
        this._emitDebug('pathfinder.goto failed:', e.message || e);
        throw e;
      }
    }

    throw new Error('No pathfinder available');
  }

  /**
   * Get the best axe from inventory
   */
  _getBestAxe() {
    for (const axeType of this.axeTypes) {
      const axe = this.bot.inventory.items().find(item => item && item.name === axeType);
      if (axe) {
        this._emitDebug(`Found ${axeType} in inventory`);
        return axe;
      }
    }
    return null;
  }

  /**
   * Check if we have a usable axe
   */
  _hasAxe() {
    return this._getBestAxe() !== null;
  }

  /**
   * Find nearby tool chest
   */
  async _findToolChest() {
    if (this.toolChestLocation) {
      return this.toolChestLocation;
    }

    // Check if chestRegistry has a tools chest
    if (this.bot.chestRegistry && typeof this.bot.chestRegistry.getChestByType === 'function') {
      const toolsChest = this.bot.chestRegistry.getChestByType('tools');
      if (toolsChest) {
        this.toolChestLocation = new Vec3(toolsChest.x, toolsChest.y, toolsChest.z);
        this._emitDebug(`Found registered tools chest at ${this.toolChestLocation}`);
        return this.toolChestLocation;
      }
    }

    // Search for nearby chests
    const chests = Object.values(this.bot.entities).filter(entity => {
      return entity && entity.name === 'chest' && entity.position;
    });

    if (chests.length > 0) {
      // Use closest chest
      const sorted = chests.sort((a, b) => {
        const distA = this.bot.entity.position.distanceTo(a.position);
        const distB = this.bot.entity.position.distanceTo(b.position);
        return distA - distB;
      });
      
      this.toolChestLocation = sorted[0].position.clone();
      this._emitDebug(`Found nearby chest at ${this.toolChestLocation}`);
      return this.toolChestLocation;
    }

    return null;
  }

  /**
   * Get axe from tool chest
   */
  async _getAxeFromChest() {
    const chestPos = await this._findToolChest();
    if (!chestPos) {
      this._emitDebug('No tool chest found');
      return false;
    }

    try {
      await this._goto(chestPos, 15000, 'tool_chest');
      
      const chestBlock = this.bot.blockAt(chestPos);
      if (!chestBlock || chestBlock.name !== 'chest') {
        this._emitDebug('Block is not a chest');
        return false;
      }

      const chest = await this.bot.openContainer(chestBlock);
      
      // Look for best axe in chest
      for (const axeType of this.axeTypes) {
        const axe = chest.containerItems().find(item => item && item.name === axeType);
        if (axe) {
          await chest.withdraw(axe.type, null, axe.count);
          this._emitDebug(`Retrieved ${axeType} from chest`);
          chest.close();
          return true;
        }
      }
      
      chest.close();
      this._emitDebug('No axes found in tool chest');
      return false;
    } catch (e) {
      this._emitDebug('Failed to get axe from chest:', e.message);
      return false;
    }
  }

  /**
   * Ensure we have an axe equipped
   */
  async _ensureAxe() {
    // Check if we already have an axe
    if (this._hasAxe()) {
      const axe = this._getBestAxe();
      await this.bot.equip(axe, 'hand');
      this.currentAxe = axe;
      return true;
    }

    // Try to get from tool chest
    this._emitDebug('No axe in inventory, checking tool chest...');
    const retrieved = await this._getAxeFromChest();
    
    if (retrieved && this._hasAxe()) {
      const axe = this._getBestAxe();
      await this.bot.equip(axe, 'hand');
      this.currentAxe = axe;
      return true;
    }

    // No axe available - will chop manually
    this._emitDebug('No axe available - will harvest manually (slower)');
    return false;
  }

  /**
   * Find or set deposit chest location
   */
  async _findDepositChest() {
    if (this.depositChestLocation) {
      return this.depositChestLocation;
    }

    // Check if we have a registered chest for logs
    if (this.bot.chestRegistry && typeof this.bot.chestRegistry.getChestByType === 'function') {
      const logChest = this.bot.chestRegistry.getChestByType('logs');
      if (logChest) {
        this.depositChestLocation = new Vec3(logChest.x, logChest.y, logChest.z);
        this._emitDebug(`Found registered logs chest at ${this.depositChestLocation}`);
        return this.depositChestLocation;
      }
    }

    // Use spawn point or bot's starting position
    if (this.bot.homeBehavior && this.bot.homeBehavior.homePosition) {
      this.depositChestLocation = this.bot.homeBehavior.homePosition.clone();
      this._emitDebug(`Using home position for deposits: ${this.depositChestLocation}`);
      return this.depositChestLocation;
    }

    // Use current position as fallback
    if (this.bot.entity && this.bot.entity.position) {
      this.depositChestLocation = this.bot.entity.position.clone();
      this._emitDebug(`Using current position for deposits: ${this.depositChestLocation}`);
      return this.depositChestLocation;
    }

    return null;
  }

  /**
   * Check if a block is a log
   */
  _isLog(block) {
    if (!block || !block.name) return false;
    return Object.keys(this.treeTypes).some(logType => block.name === logType);
  }

  /**
   * Check if a block is leaves
   */
  _isLeaves(block) {
    if (!block || !block.name) return false;
    return this.leafTypes.includes(block.name);
  }

  /**
   * Find the base of a tree (the lowest log block)
   */
  _findTreeBase(logPos) {
    let baseY = logPos.y;
    
    // Scan downward to find the lowest log
    for (let y = logPos.y - 1; y >= logPos.y - 10; y--) {
      const block = this.bot.blockAt(new Vec3(logPos.x, y, logPos.z));
      if (block && this._isLog(block)) {
        baseY = y;
      } else {
        break;
      }
    }
    
    return new Vec3(logPos.x, baseY, logPos.z);
  }

  /**
   * Find the top of a tree (the highest log block)
   */
  _findTreeTop(logPos) {
    let topY = logPos.y;
    
    // Scan upward to find the highest log
    for (let y = logPos.y + 1; y <= logPos.y + 30; y++) {
      const block = this.bot.blockAt(new Vec3(logPos.x, y, logPos.z));
      if (block && this._isLog(block)) {
        topY = y;
      } else {
        break;
      }
    }
    
    return new Vec3(logPos.x, topY, logPos.z);
  }

  /**
   * Build a trunk path from base upward, allowing slight horizontal shifts (e.g., acacia)
   */
  _buildTrunkPath(basePos) {
    const path = [];
    let current = basePos.clone();
    const visited = new Set();
    const maxSteps = this.settings.maxTrunkHeight;

    for (let step = 0; step < maxSteps; step++) {
      // Look at level one above current (next trunk segment)
      let next = null;
      let found = false;
      const y = current.y + 1;
      let bestDist = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const p = new Vec3(current.x + dx, y, current.z + dz);
          const k = `${p.x},${p.y},${p.z}`;
          if (visited.has(k)) continue;
          const b = this.bot.blockAt(p);
          if (b && this._isLog(b)) {
            const d = Math.abs(dx) + Math.abs(dz); // Manhattan to prefer straighter
            if (d < bestDist) {
              bestDist = d;
              next = p;
              found = true;
            }
          }
        }
      }

      if (!found) break;
      path.push(next.clone());
      visited.add(`${next.x},${next.y},${next.z}`);
      current = next;
    }
    return path;
  }

  /**
   * Get all log blocks in a tree starting from a position
   */
  _getTreeLogs(startPos, maxLogs = 100) {
    const logs = [];
    const visited = new Set();
    const queue = [startPos];
    
    while (queue.length > 0 && logs.length < maxLogs) {
      const pos = queue.shift();
      const key = `${pos.x},${pos.y},${pos.z}`;
      
      if (visited.has(key)) continue;
      visited.add(key);
      
      const block = this.bot.blockAt(pos);
      if (!block || !this._isLog(block)) continue;
      
      logs.push(pos.clone());
      
      // Check adjacent blocks (including diagonals for branches)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            queue.push(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz));
          }
        }
      }
    }
    
    return logs;
  }

  /**
   * Check if there's ground suitable for replanting
   */
  _canPlantSapling(pos) {
    const groundBlock = this.bot.blockAt(new Vec3(pos.x, pos.y - 1, pos.z));
    if (!groundBlock) return false;
    
    const validGround = ['dirt', 'grass_block', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt'];
    return validGround.includes(groundBlock.name);
  }

  /**
   * Utility: is a position empty/air
   */
  _isAir(pos) {
    const b = this.bot.blockAt(pos);
    return !b || b.type === 0;
  }

  /**
   * Select a direction (+X, -X, +Z, -Z) to build step pillar next to trunk
   */
  _selectPillarDirection(basePos) {
    const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
    for (const d of dirs) {
      const stepPos = new Vec3(basePos.x + d.x, basePos.y, basePos.z + d.z);
      const ground = this.bot.blockAt(new Vec3(stepPos.x, basePos.y - 1, stepPos.z));
      const stepFree = this._isAir(stepPos);
      const groundSolid = ground && ground.boundingBox === 'block';
      if (stepFree && groundSolid) return d;
    }
    return dirs[0];
  }

  /**
   * Choose a scaffold item to place as steps (dirt/cobble/planks/logs fallback)
   */
  _getScaffoldItem() {
    const allowed = this.settings.scaffoldBlocks || [];
    const items = this.bot.inventory.items();
    for (const name of allowed) {
      const it = items.find(i => i && i.name === name && i.count > 0);
      if (it) return it;
    }
    return null; // do not place if none of the configured blocks are available
  }

  /**
   * Harvest a tree from top to bottom
   */
  async _harvestTree(basePos) {
    if (!this.enabled || !this.isWorking) return false;

    this._emitDebug(`Starting harvest at ${basePos.x}, ${basePos.y}, ${basePos.z}`);
    
    // Ensure we have an axe equipped (or accept manual harvesting)
    const hasAxe = await this._ensureAxe();
    if (!hasAxe) {
      this._emitDebug('Proceeding with manual harvesting (no axe available)');
    }
    
  // Determine trunk from base to top (dynamic path to handle bends)
  const baseY = basePos.y;
  const trunkPath = this._buildTrunkPath(basePos);
  const topY = trunkPath.length ? trunkPath[trunkPath.length - 1].y : baseY;
    
    // Remember the log type for replanting
    const baseBlock = this.bot.blockAt(basePos);
    const logType = baseBlock ? baseBlock.name : null;
    const saplingType = logType ? this.treeTypes[logType] : null;

    // Center-pillar approach using PillarBuilder utility
    const pillarX = basePos.x;
    const pillarZ = basePos.z;
    let pillarTopY = baseY - 1; // start from ground below base log
    
    // Initialize pillar builder with woodcutting timing settings
    const pillarBuilder = new PillarBuilder(this.bot, this.logger, {
      allowedBlocks: this.settings.scaffoldBlocks,
      preDelayMs: this.settings.pillarPreDelayMs,
      jumpDelayMs: this.settings.pillarJumpDelayMs,
      placeDelayMs: this.settings.pillarPlaceDelayMs,
      moveDelayMs: this.settings.pillarMoveDelayMs,
      maxConsecutiveFailures: 5,
      failureRetryDelayMs: 250
    });

    // Helper: break any reachable remaining trunk logs from current position
    const breakReachableLogs = async () => {
      let brokeAny = false;
      for (const p of trunkPath) {
        const b = this.bot.blockAt(p);
        if (!b || !this._isLog(b)) continue;
        const dist = this.bot.entity.position.distanceTo(p);
        if (dist <= 4.9) {
          try {
            // Use ToolHandler for smart tool selection if available
            if (this.bot.toolHandler) {
              await this.bot.toolHandler.smartDig(b);
            } else {
              // Fallback to manual axe method
              if (hasAxe && this.currentAxe) await this.bot.equip(this.currentAxe, 'hand');
              await this.bot.dig(b);
            }
            harvestedCount++;
            brokeAny = true;
            await new Promise(r => setTimeout(r, this.settings.logBreakDelayMs));
          } catch (e) {
            // ignore per-block failures
          }
        }
      }
      return brokeAny;
    };

    let harvestedCount = 0;

    try {
      // Move near base
      await this._goto(basePos, 12000, 'wood_base');

      // 1) Break base log from the side
      const baseLog = this.bot.blockAt(basePos);
      if (baseLog && this._isLog(baseLog)) {
        // Use ToolHandler for smart tool selection if available
        if (this.bot.toolHandler) {
          await this.bot.toolHandler.smartDig(baseLog);
        } else {
          // Fallback to manual axe method
          if (hasAxe && this.currentAxe) await this.bot.equip(this.currentAxe, 'hand');
          await this.bot.dig(baseLog);
        }
        harvestedCount++;
        await new Promise(r => setTimeout(r, this.settings.baseBreakDelayMs));
      }

      // 2) Break the first 5 logs (base already broken counts as first)
      const firstFiveTargets = trunkPath.filter(p => p.y >= baseY && p.y <= baseY + 4);
      for (const p of firstFiveTargets) {
        const b = this.bot.blockAt(p);
        if (!b || !this._isLog(b)) continue;
        const dist = this.bot.entity.position.distanceTo(p);
        if (dist > 4.9) {
          // reposition near base to improve reach without placing steps
          await this._goto(new Vec3(basePos.x, basePos.y + 1, basePos.z), 6000, 'reposition_base');
        }
        const blockNow = this.bot.blockAt(p);
        if (blockNow && this._isLog(blockNow)) {
          try {
            // Use ToolHandler for smart tool selection if available
            if (this.bot.toolHandler) {
              await this.bot.toolHandler.smartDig(blockNow);
            } else {
              // Fallback to manual axe method
              if (hasAxe && this.currentAxe) await this.bot.equip(this.currentAxe, 'hand');
              await this.bot.dig(blockNow);
            }
            harvestedCount++;
            await new Promise(r => setTimeout(r, this.settings.logBreakDelayMs));
          } catch (_) {}
        }
      }

      // 3) If tree taller than 5 logs, move to base column, pillar up 3 at a time, and attempt to finish
      const remainingExists = () => trunkPath.some(p => {
        const b = this.bot.blockAt(p);
        return b && this._isLog(b);
      });

      if (remainingExists()) {
        // Ensure we're centered on the trunk column
        await this._goto(new Vec3(pillarX, pillarTopY + 1, pillarZ), 8000, 'center_on_trunk');
        // small settle delay before starting pillar
        try { await new Promise(r => setTimeout(r, this.settings.pillarPreDelayMs)); } catch {}
      }

      // Repeat: break reachable, then climb 3, until no logs left
      while (this.enabled && this.isWorking && remainingExists()) {
        await breakReachableLogs();
        if (!remainingExists()) break;

        // Use pillar builder to climb 3 steps
        const pillarColumn = new Vec3(pillarX, 0, pillarZ);
        const result = await pillarBuilder.buildUp(pillarColumn, pillarTopY, 3);
        
        if (result.success) {
          pillarTopY = result.finalY;
          this._emitDebug(`Climbed ${result.stepsPlaced} steps, now at Y=${pillarTopY}`);
        } else {
          this._emitDebug('Failed to build pillar steps');
        }
      }
    } catch (e) {
      this._emitDebug('Harvest loop error:', e.message);
    }

    this._emitDebug(`Harvested ${harvestedCount} logs (bottom-up)`);
    
    // Optional: cleanup placed steps using pillar builder
    if (this.settings.cleanupScaffold) {
      await pillarBuilder.cleanup(this.settings.cleanupDigDelayMs);
    }

    // Replant only after entire tree and cleanup
    if (saplingType && this._canPlantSapling(basePos)) {
      await this._replantSapling(basePos, saplingType);
    }

    // Collect dropped items
    await this._collectNearbyItems(basePos, 6);
    
    return harvestedCount > 0;
  }

  /**
   * Replant a sapling at the tree base
   */
  async _replantSapling(basePos, saplingType) {
    if (!this.enabled || !this.isWorking) return;
    
    // Find sapling in inventory
    const sapling = this.bot.inventory.items().find(item => item && item.name === saplingType);
    if (!sapling) {
      this._emitDebug(`No ${saplingType} in inventory for replanting`);
      return;
    }
    
    try {
      // Navigate to the base position
      await this._goto(basePos, 10000, 'replant');
      
      // Check if the spot is clear
      const aboveBlock = this.bot.blockAt(new Vec3(basePos.x, basePos.y, basePos.z));
      if (aboveBlock && aboveBlock.type !== 0) {
        this._emitDebug('Cannot replant: space is occupied');
        return;
      }
      
      // Equip sapling
      await this.bot.equip(sapling, 'hand');
      
      // Place sapling
      const groundBlock = this.bot.blockAt(new Vec3(basePos.x, basePos.y - 1, basePos.z));
      if (groundBlock) {
        await this.bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
        this._emitDebug(`Replanted ${saplingType} at ${basePos.x}, ${basePos.y}, ${basePos.z}`);
      }
    } catch (e) {
      this._emitDebug('Failed to replant sapling:', e.message);
    }
  }

  /**
   * Collect dropped items near a position
   */
  async _collectNearbyItems(centerPos, radius = 5) {
    if (!this.bot.itemCollector) return;
    
    try {
      await this.bot.itemCollector.collectOnce({ radius: radius });
    } catch (e) {
      this._emitDebug('Failed to collect items:', e.message);
    }
  }

  /**
   * Find the nearest tree within range (optimized with spiral search)
   */
  _findNearestTree(maxDistance = 50) {
    if (!this.bot.entity || !this.bot.entity.position) return null;
    
    const botPos = this.bot.entity.position;
    
    // Use spiral search pattern for better early exit
    // Only scan Y levels near bot position
    const minY = Math.floor(botPos.y - 5);
    const maxY = Math.floor(botPos.y + 15);
    
    // Spiral outward from bot position
    for (let radius = 3; radius <= maxDistance; radius += 3) {
      for (let x = -radius; x <= radius; x += 2) {
        for (let z = -radius; z <= radius; z += 2) {
          // Skip if not on the edge of current radius (optimize scan)
          if (Math.abs(x) < radius - 2 && Math.abs(z) < radius - 2) continue;
          
          const checkX = Math.floor(botPos.x + x);
          const checkZ = Math.floor(botPos.z + z);
          
          for (let y = minY; y <= maxY; y++) {
            const block = this.bot.blockAt(new Vec3(checkX, y, checkZ));
            if (block && this._isLog(block)) {
              // Found a tree, return immediately
              return this._findTreeBase(block.position);
            }
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Scan area for trees to harvest (optimized with sampling)
   */
  _scanAreaForTrees(area, maxTrees = 10) {
    if (!area || !area.start || !area.end) return [];
    
    const startX = Math.min(area.start.x, area.end.x);
    const endX = Math.max(area.start.x, area.end.x);
    const startY = Math.min(area.start.y || 60, area.end.y || 100);
    const endY = Math.max(area.start.y || 60, area.end.y || 100);
    const startZ = Math.min(area.start.z, area.end.z);
    const endZ = Math.max(area.start.z, area.end.z);
    
    const treeBases = new Set();
    const trees = [];
    
    // Sample every 2-3 blocks instead of every block for performance
    const stepSize = 2;
    
    // Find log blocks in area (optimized scan)
    for (let x = startX; x <= endX; x += stepSize) {
      for (let z = startZ; z <= endZ; z += stepSize) {
        // Early exit if we have enough trees
        if (trees.length >= maxTrees) break;
        
        for (let y = startY; y <= endY; y += stepSize) {
          const block = this.bot.blockAt(new Vec3(x, y, z));
          if (block && this._isLog(block)) {
            // Find the base of this tree
            const base = this._findTreeBase(block.position);
            const baseKey = `${Math.floor(base.x)},${Math.floor(base.z)}`;
            
            if (!treeBases.has(baseKey)) {
              treeBases.add(baseKey);
              trees.push(base);
              
              if (trees.length >= maxTrees) break;
            }
          }
        }
        if (trees.length >= maxTrees) break;
      }
      if (trees.length >= maxTrees) break;
    }
    
    this._emitDebug(`Found ${trees.length} trees in area`);
    return trees;
  }

  /**
   * Main woodcutting loop
   */
  async startWoodcutting(area = null) {
    if (!this.enabled && typeof this.enable === 'function') this.enable();
    if (this.isWorking) return;
    this.isWorking = true;

    if (!area && this.woodcuttingArea) area = this.woodcuttingArea;

    this._emitDebug('Starting woodcutting behavior');

    // Initialize deposit chest location (save starting position as reference)
    if (!this.depositChestLocation && this.bot.entity && this.bot.entity.position) {
      this.depositChestLocation = this.bot.entity.position.clone();
      this._emitDebug(`Set deposit area to starting position: ${this.depositChestLocation}`);
    }

    // Check for tool availability at start
    if (!this._hasAxe()) {
      this._emitDebug('No axe in inventory, will attempt to retrieve from tool chest when needed');
    }

    // Assign work zone if coordinator is available and area is set
    let workArea = area;
    if (area && this.bot.coordinator) {
      const activeBots = this.bot.coordinator.getAllBotPositions();
      const botCount = activeBots.length;
      
      this._emitDebug(`Detected ${botCount} active bot(s)`);
      
      if (botCount > 1) {
        const existingZone = this.bot.coordinator.getWorkZone(this.bot.username, 'woodcutting');
        
        if (existingZone) {
          workArea = existingZone;
          this._emitDebug('Using existing work zone assignment');
        } else {
          const botIds = activeBots.map(b => b.botId).sort();
          const myIndex = botIds.indexOf(this.bot.username);
          
          if (myIndex >= 0) {
            const zones = this.bot.coordinator.divideArea(area, botCount, this.bot.username);
            if (myIndex < zones.length) {
              workArea = zones[myIndex];
              this.bot.coordinator.assignWorkZone(this.bot.username, 'woodcutting', workArea);
              this._emitDebug(`Assigned to work zone ${myIndex + 1}/${botCount}`);
            }
          }
        }
      }
    }

    // Add staggered start delay to prevent all bots from scanning simultaneously
    if (this.bot.coordinator) {
      const activeBots = this.bot.coordinator.getAllBotPositions();
      const botIds = activeBots.map(b => b.botId).sort();
      const myIndex = botIds.indexOf(this.bot.username);
      
      if (myIndex > 0) {
        const delay = myIndex * 2000; // 2 second stagger per bot
        this._emitDebug(`Staggering start by ${delay}ms to reduce load`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    try {
      while (this.enabled && this.isWorking) {
        let didWork = false;

        if (workArea) {
          // Area-based woodcutting
          const trees = this._scanAreaForTrees(workArea, 5); // Limit to 5 trees per scan
          
          if (trees.length > 0) {
            for (const treeBase of trees) {
              if (!this.enabled || !this.isWorking) break;
              
              // Check if tree is claimed
              if (this.bot.coordinator && this.bot.coordinator.isBlockClaimed(treeBase, this.bot.username)) {
                continue;
              }
              
              // Claim the tree base
              if (this.bot.coordinator) {
                if (!this.bot.coordinator.claimBlock(this.bot.username, treeBase, 'tree')) {
                  continue;
                }
              }
              
              try {
                const harvested = await this._harvestTree(treeBase);
                if (harvested) {
                  didWork = true;
                }
                
                // Add small delay between trees to prevent overload
                await new Promise(r => setTimeout(r, 500));
              } finally {
                // Release tree claim
                if (this.bot.coordinator) {
                  this.bot.coordinator.releaseBlock(treeBase);
                }
              }
              
              // Check inventory and deposit if needed
              if (this._shouldDeposit()) {
                await this._depositLogs();
              }
            }
          }
        } else {
          // Opportunistic mode - find nearest tree
          this._emitDebug('Opportunistic mode: searching for nearest tree');
          
          const nearestTree = this._findNearestTree(50);
          if (nearestTree) {
            const treeBase = nearestTree; // Already returns base from optimized search
            
            // Claim the tree
            if (this.bot.coordinator) {
              if (!this.bot.coordinator.claimBlock(this.bot.username, treeBase, 'tree')) {
                this._emitDebug('Tree already claimed by another bot');
                await new Promise(r => setTimeout(r, 5000));
                continue;
              }
            }
            
            try {
              const harvested = await this._harvestTree(treeBase);
              if (harvested) {
                didWork = true;
              }
            } finally {
              if (this.bot.coordinator) {
                this.bot.coordinator.releaseBlock(treeBase);
              }
            }
            
            // Check inventory and deposit if needed
            if (this._shouldDeposit()) {
              await this._depositLogs();
            }
          }
        }

        if (!didWork) {
          // No trees found, wait before retrying (with randomization to prevent sync)
          const waitTime = 8000 + Math.random() * 4000; // 8-12 seconds
          this._emitDebug(`No trees found, waiting ${Math.floor(waitTime/1000)}s...`);
          await new Promise(r => setTimeout(r, waitTime));
        } else {
          // Brief pause between successful harvests to spread out load
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } catch (err) {
      this.logger.error(`[Wood][${this.bot.username}] Error: ${err.message || err}`);
    } finally {
      this.isWorking = false;
      this._emitDebug('Woodcutting stopped');
    }
  }

  /**
   * Check if inventory should be deposited
   */
  _shouldDeposit() {
    try {
      const logItems = this.bot.inventory.items().filter(item => {
        return item && item.name && Object.keys(this.treeTypes).includes(item.name);
      });
      
      const totalLogs = logItems.reduce((sum, item) => sum + (item.count || 0), 0);
      return totalLogs > 128; // Deposit when we have 2+ stacks
    } catch (e) {
      return false;
    }
  }

  /**
   * Deposit logs to chest
   */
  async _depositLogs() {
    try {
      this._emitDebug('Depositing logs...');
      
      // Get log items from inventory
      const logItems = this.bot.inventory.items().filter(item => {
        return item && item.name && Object.keys(this.treeTypes).includes(item.name);
      });

      if (logItems.length === 0) {
        this._emitDebug('No logs to deposit');
        return;
      }

      // Find deposit chest location
      const depositPos = await this._findDepositChest();
      if (!depositPos) {
        this._emitDebug('No deposit location found - keeping logs');
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
        this._emitDebug('No chest found near deposit location - keeping logs');
        return;
      }

      // Open chest and deposit logs
      const chest = await this.bot.openContainer(chestBlock);
      
      for (const logItem of logItems) {
        try {
          await chest.deposit(logItem.type, null, logItem.count);
          this._emitDebug(`Deposited ${logItem.count} ${logItem.name}`);
        } catch (e) {
          this._emitDebug(`Failed to deposit ${logItem.name}:`, e.message);
        }
      }
      
      chest.close();
      this._emitDebug('Logs deposited successfully');
      
    } catch (e) {
      this._emitDebug('Failed to deposit logs:', e.message);
    }
  }
}
