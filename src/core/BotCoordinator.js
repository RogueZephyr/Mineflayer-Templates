// src/core/BotCoordinator.js
import { Vec3 } from 'vec3';

/**
 * BotCoordinator - Shared state manager for multi-bot coordination
 * Prevents bots from doing the same tasks and colliding with each other
 */
export default class BotCoordinator {
  constructor() {
    this.bots = new Map(); // botId -> { bot, lastUpdate, position }
    this.claimedBlocks = new Map(); // 'x,y,z' -> { botId, timestamp, task }
    this.claimedAreas = new Map(); // areaId -> { botId, timestamp, bounds }
    this.taskQueue = new Map(); // taskType -> [taskData]
    this.pathfindingGoals = new Map(); // botId -> { target: Vec3, timestamp, task }
    this.blockClaimDuration = 30000; // 30 seconds
    this.areaClaimDuration = 300000; // 5 minutes
    this.goalClaimDuration = 15000; // 15 seconds for pathfinding goals
  }

  /**
   * Register a bot with the coordinator
   */
  registerBot(bot) {
    if (!bot || !bot.username) return false;
    
    const botId = bot.username;
    this.bots.set(botId, {
      bot,
      lastUpdate: Date.now(),
      position: bot.entity?.position || null
    });
    
    // Update position periodically
    const updateInterval = setInterval(() => {
      if (!this.bots.has(botId)) {
        clearInterval(updateInterval);
        return;
      }
      
      const entry = this.bots.get(botId);
      entry.lastUpdate = Date.now();
      entry.position = bot.entity?.position || null;
    }, 1000);
    
    return true;
  }

  /**
   * Unregister a bot (on disconnect)
   */
  unregisterBot(botId) {
    this.bots.delete(botId);
    
    // Clean up claimed blocks
    for (const [key, claim] of this.claimedBlocks.entries()) {
      if (claim.botId === botId) {
        this.claimedBlocks.delete(key);
      }
    }
    
    // Clean up claimed areas
    for (const [key, claim] of this.claimedAreas.entries()) {
      if (claim.botId === botId) {
        this.claimedAreas.delete(key);
      }
    }
  }

  /**
   * Get all active bot positions
   */
  getAllBotPositions() {
    const positions = [];
    const now = Date.now();
    
    for (const [botId, data] of this.bots.entries()) {
      // Only include bots updated in last 5 seconds
      if (now - data.lastUpdate < 5000 && data.position) {
        positions.push({
          botId,
          position: data.position
        });
      }
    }
    
    return positions;
  }

  /**
   * Check if another bot is near a position
   */
  isPositionOccupied(pos, radius = 2, excludeBotId = null) {
    if (!pos) return false;
    
    const positions = this.getAllBotPositions();
    for (const { botId, position } of positions) {
      if (excludeBotId && botId === excludeBotId) continue;
      
      const dist = Math.sqrt(
        Math.pow(position.x - pos.x, 2) +
        Math.pow(position.y - pos.y, 2) +
        Math.pow(position.z - pos.z, 2)
      );
      
      if (dist <= radius) return true;
    }
    
    return false;
  }

  /**
   * Claim a block for a specific task (harvesting, mining, etc.)
   */
  claimBlock(botId, pos, task = 'generic') {
    if (!pos) return false;
    
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    const existing = this.claimedBlocks.get(key);
    
    // Check if already claimed by another bot
    if (existing && existing.botId !== botId) {
      const age = Date.now() - existing.timestamp;
      if (age < this.blockClaimDuration) {
        return false; // Still claimed
      }
    }
    
    // Claim the block
    this.claimedBlocks.set(key, {
      botId,
      timestamp: Date.now(),
      task
    });
    
    return true;
  }

  /**
   * Release a claimed block
   */
  releaseBlock(pos) {
    if (!pos) return;
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    this.claimedBlocks.delete(key);
  }

  /**
   * Check if a block is claimed by another bot
   */
  isBlockClaimed(pos, excludeBotId = null) {
    if (!pos) return false;
    
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    const claim = this.claimedBlocks.get(key);
    
    if (!claim) return false;
    if (excludeBotId && claim.botId === excludeBotId) return false;
    
    const age = Date.now() - claim.timestamp;
    if (age > this.blockClaimDuration) {
      this.claimedBlocks.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Divide an area into work zones for multiple bots
   */
  divideArea(area, botCount, botName = 'Unknown') {
    if (!area || !area.start || !area.end) {
      console.log(`[Coordinator][${botName}] divideArea: invalid area`, area);
      return [];
    }
    if (botCount < 1) return [area];
    
    const minX = Math.min(area.start.x, area.end.x);
    const maxX = Math.max(area.start.x, area.end.x);
    const minY = Math.min(area.start.y, area.end.y);
    const maxY = Math.max(area.start.y, area.end.y);
    const minZ = Math.min(area.start.z, area.end.z);
    const maxZ = Math.max(area.start.z, area.end.z);
    
    const width = maxX - minX + 1;
    const depth = maxZ - minZ + 1;
    
    console.log(`[Coordinator][${botName}] Dividing area: ${width}x${depth} for ${botCount} bots`);
    
    const zones = [];
    
    // Divide along the longer axis
    if (width >= depth) {
      // Divide by X
      const zoneWidth = Math.ceil(width / botCount);
      console.log(`[Coordinator][${botName}] Dividing by X axis: ${zoneWidth} blocks per zone`);
      for (let i = 0; i < botCount; i++) {
        const zoneMinX = minX + (i * zoneWidth);
        const zoneMaxX = Math.min(zoneMinX + zoneWidth - 1, maxX);
        
        if (zoneMinX <= maxX) {
          const zone = {
            start: { x: zoneMinX, y: minY, z: minZ },
            end: { x: zoneMaxX, y: maxY, z: maxZ }
          };
          zones.push(zone);
          console.log(`[Coordinator][${botName}] Zone ${i + 1}: X ${zoneMinX} to ${zoneMaxX}`);
        }
      }
    } else {
      // Divide by Z
      const zoneDepth = Math.ceil(depth / botCount);
      console.log(`[Coordinator][${botName}] Dividing by Z axis: ${zoneDepth} blocks per zone`);
      for (let i = 0; i < botCount; i++) {
        const zoneMinZ = minZ + (i * zoneDepth);
        const zoneMaxZ = Math.min(zoneMinZ + zoneDepth - 1, maxZ);
        
        if (zoneMinZ <= maxZ) {
          const zone = {
            start: { x: minX, y: minY, z: zoneMinZ },
            end: { x: maxX, y: maxY, z: zoneMaxZ }
          };
          zones.push(zone);
          console.log(`[Coordinator][${botName}] Zone ${i + 1}: Z ${zoneMinZ} to ${zoneMaxZ}`);
        }
      }
    }
    
    return zones;
  }

  /**
   * Assign a work zone to a bot
   */
  assignWorkZone(botId, areaType, zone) {
    const zoneId = `${areaType}_${botId}`;
    this.claimedAreas.set(zoneId, {
      botId,
      timestamp: Date.now(),
      bounds: zone
    });
    return zone;
  }

  /**
   * Get assigned work zone for a bot
   */
  getWorkZone(botId, areaType) {
    const zoneId = `${areaType}_${botId}`;
    const claim = this.claimedAreas.get(zoneId);
    
    if (!claim) return null;
    
    const age = Date.now() - claim.timestamp;
    if (age > this.areaClaimDuration) {
      this.claimedAreas.delete(zoneId);
      return null;
    }
    
    return claim.bounds;
  }

  /**
   * Register a pathfinding goal to prevent bot stacking
   */
  registerPathfindingGoal(botId, targetPos, task = 'generic') {
    if (!botId || !targetPos) return;
    
    this.pathfindingGoals.set(botId, {
      target: new Vec3(Math.floor(targetPos.x), Math.floor(targetPos.y), Math.floor(targetPos.z)),
      timestamp: Date.now(),
      task
    });
  }

  /**
   * Clear pathfinding goal for a bot
   */
  clearPathfindingGoal(botId) {
    if (!botId) return;
    this.pathfindingGoals.delete(botId);
  }

  /**
   * Check if a position is targeted by another bot's pathfinding
   */
  isGoalOccupied(targetPos, excludeBotId = null, radius = 1) {
    if (!targetPos) return false;
    
    const now = Date.now();
    const targetVec = new Vec3(Math.floor(targetPos.x), Math.floor(targetPos.y), Math.floor(targetPos.z));
    
    for (const [botId, goal] of this.pathfindingGoals.entries()) {
      if (excludeBotId && botId === excludeBotId) continue;
      
      // Check if goal is still valid (not expired)
      if (now - goal.timestamp > this.goalClaimDuration) {
        this.pathfindingGoals.delete(botId);
        continue;
      }
      
      // Check distance to target
      const dist = Math.sqrt(
        Math.pow(goal.target.x - targetVec.x, 2) +
        Math.pow(goal.target.y - targetVec.y, 2) +
        Math.pow(goal.target.z - targetVec.z, 2)
      );
      
      if (dist <= radius) return true;
    }
    
    return false;
  }

  /**
   * Find an alternative position near the desired target
   */
  findAlternativeGoal(desiredPos, excludeBotId = null, searchRadius = 3) {
    if (!desiredPos) return null;
    
    // Try positions in a spiral pattern around desired location
    const baseX = Math.floor(desiredPos.x);
    const baseY = Math.floor(desiredPos.y);
    const baseZ = Math.floor(desiredPos.z);
    
    // First check if desired position is free
    if (!this.isGoalOccupied(desiredPos, excludeBotId, 1)) {
      return new Vec3(baseX, baseY, baseZ);
    }
    
    // Spiral outward to find free position
    for (let radius = 1; radius <= searchRadius; radius++) {
      const positions = [];
      
      // Generate positions at current radius
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          // Only check perimeter of current radius
          if (Math.abs(x) === radius || Math.abs(z) === radius) {
            positions.push(new Vec3(baseX + x, baseY, baseZ + z));
          }
        }
      }
      
      // Shuffle to add randomness
      positions.sort(() => Math.random() - 0.5);
      
      // Check each position
      for (const pos of positions) {
        if (!this.isGoalOccupied(pos, excludeBotId, 1)) {
          return pos;
        }
      }
    }
    
    // If all positions occupied, return original with offset
    return new Vec3(baseX + Math.floor(Math.random() * 4) - 2, baseY, baseZ + Math.floor(Math.random() * 4) - 2);
  }

  /**
   * Clean up expired claims
   */
  cleanup() {
    const now = Date.now();
    
    // Clean blocks
    for (const [key, claim] of this.claimedBlocks.entries()) {
      if (now - claim.timestamp > this.blockClaimDuration) {
        this.claimedBlocks.delete(key);
      }
    }
    
    // Clean areas
    for (const [key, claim] of this.claimedAreas.entries()) {
      if (now - claim.timestamp > this.areaClaimDuration) {
        this.claimedAreas.delete(key);
      }
    }
    
    // Clean pathfinding goals
    for (const [botId, goal] of this.pathfindingGoals.entries()) {
      if (now - goal.timestamp > this.goalClaimDuration) {
        this.pathfindingGoals.delete(botId);
      }
    }
  }

  /**
   * Get diagnostics for debugging
   */
  getDiagnostics() {
    return {
      activeBots: this.bots.size,
      claimedBlocks: this.claimedBlocks.size,
      claimedAreas: this.claimedAreas.size,
      pathfindingGoals: this.pathfindingGoals.size,
      bots: Array.from(this.bots.keys()),
      positions: this.getAllBotPositions(),
      goals: Array.from(this.pathfindingGoals.entries()).map(([botId, goal]) => ({
        botId,
        target: goal.target,
        task: goal.task
      }))
    };
  }
}
