// src/utils/PathfindingUtil.js
import { Vec3 } from 'vec3';
import pkg from 'mineflayer-pathfinder';
import PathCache from './PathCache.js';
const { goals } = pkg;

/**
 * Centralized pathfinding utility with collision avoidance and path caching
 * All pathfinding operations should use this utility to prevent bot stacking
 */
export default class PathfindingUtil {
  constructor(bot, coordinator = null, logger = null, config = {}) {
    this.bot = bot;
    this.coordinator = coordinator;
    this.logger = logger;
    this.pathCache = new PathCache(bot, logger, config.pathCache || {});
  }

  /**
   * Log debug messages
   */
  _log(message) {
    if (this.logger) {
      this.logger.info(`[Pathfinding][${this.bot.username}] ${message}`);
    }
  }

  /**
   * Enhanced goto with collision avoidance
   * @param {Vec3|Object} pos - Target position
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {string} task - Task description for debugging
   * @param {number} range - Acceptable distance from target (default 1.5)
   * @returns {Promise<void>}
   */
  async goto(pos, timeoutMs = 30000, task = 'generic', range = 1.5) {
    if (!pos) throw new Error('goto: pos required');

    // Normalize position
    let targetPos = this._normalizePosition(pos);
    
    // Check if coordinator is available and if target is occupied
    if (this.coordinator) {
      // Check if another bot is already targeting this position
      if (this.coordinator.isGoalOccupied(targetPos, this.bot.username, 1)) {
        this._log(`Target ${targetPos} occupied, finding alternative...`);
        
        // Find alternative position
        const altPos = this.coordinator.findAlternativeGoal(targetPos, this.bot.username, 3);
        if (altPos) {
          this._log(`Using alternative: ${altPos}`);
          targetPos = altPos;
        }
      }
      
      // Register our pathfinding goal
      this.coordinator.registerPathfindingGoal(this.bot.username, targetPos, task);
    }
    
    if (!this.bot.pathfinder) {
      if (this.coordinator) {
        this.coordinator.clearPathfindingGoal(this.bot.username);
      }
      throw new Error('Pathfinder not available');
    }

    try {
      // Check cache first
      const startPos = this.bot.entity.position;
      const cachedPath = this.pathCache.getCachedPath(startPos, targetPos);
      
      if (cachedPath) {
        this._log(`Using cached path (${cachedPath.path.length} nodes, used ${cachedPath.useCount} times)`);
        
        // Use cached path
        const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, range);
        
        try {
          await this.bot.pathfinder.goto(goal);
          
          // Successfully used cached path - keep it
          if (this.coordinator) {
            this.coordinator.clearPathfindingGoal(this.bot.username);
          }
          return;
        } catch (e) {
          // Cached path failed - invalidate and recalculate
          this._log(`Cached path failed: ${e.message}, recalculating...`);
          this.pathCache.invalidatePathsNear(startPos, 10);
        }
      }
      
      // No cache or cache failed - calculate new path
      const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, range);
      
      // Store path calculation start time
      const pathStart = Date.now();
      
      await this.bot.pathfinder.goto(goal);
      
      const pathTime = Date.now() - pathStart;
      
      // Cache the successful path if it took significant time (> 500ms)
      if (pathTime > 500 && this.bot.pathfinder.path) {
        this._log(`Caching new path (${this.bot.pathfinder.path.length} nodes, took ${pathTime}ms)`);
        this.pathCache.cachePath(startPos, targetPos, {
          path: this.bot.pathfinder.path,
          cost: pathTime
        });
      }
      
      // Clear goal after successful pathfinding
      if (this.coordinator) {
        this.coordinator.clearPathfindingGoal(this.bot.username);
      }
    } catch (e) {
      // Clear goal on error
      if (this.coordinator) {
        this.coordinator.clearPathfindingGoal(this.bot.username);
      }
      throw e;
    }
  }

  /**
   * Go to a block position with collision avoidance
   * @param {Vec3|Object} pos - Target block position
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {string} task - Task description
   * @returns {Promise<void>}
   */
  async gotoBlock(pos, timeoutMs = 30000, task = 'generic') {
    return this.goto(pos, timeoutMs, task, 1.5);
  }

  /**
   * Go to a player with collision avoidance
   * @param {string} username - Player username
   * @param {number} range - Distance to maintain from player
   * @returns {Promise<void>}
   */
  async gotoPlayer(username, range = 3) {
    if (!username) throw new Error('gotoPlayer: username required');
    
    const player = this.bot.players[username];
    if (!player || !player.entity) {
      throw new Error(`Player ${username} not found or not visible`);
    }

    const targetPos = player.entity.position;
    return this.goto(targetPos, 30000, `follow_${username}`, range);
  }

  /**
   * Follow a player continuously with collision avoidance
   * @param {string} username - Player username
   * @param {number} range - Distance to maintain
   * @returns {Function} Stop function to cancel following
   */
  followPlayer(username, range = 3) {
    if (!username) throw new Error('followPlayer: username required');
    
    let following = true;
    let currentGoal = null;

    const updateGoal = () => {
      if (!following) return;
      
      const player = this.bot.players[username];
      if (!player || !player.entity) {
        this._log(`Lost sight of ${username}, stopping follow`);
        following = false;
        return;
      }

      const targetPos = player.entity.position;
      
      // Check distance - only update if player moved significantly
      if (this.bot.entity) {
        const dist = this.bot.entity.position.distanceTo(targetPos);
        if (dist < range + 2) {
          // Close enough, don't spam pathfinding
          return;
        }
      }

      // Use coordinator to check if position is occupied
      let actualTarget = targetPos;
      if (this.coordinator && this.coordinator.isGoalOccupied(targetPos, this.bot.username, range)) {
        const altPos = this.coordinator.findAlternativeGoal(targetPos, this.bot.username, 3);
        if (altPos) {
          actualTarget = altPos;
        }
      }

      // Register goal
      if (this.coordinator) {
        this.coordinator.registerPathfindingGoal(this.bot.username, actualTarget, `follow_${username}`);
      }

      // Set pathfinder goal
      try {
        currentGoal = new goals.GoalFollow(player.entity, range);
        if (this.bot.pathfinder) {
          this.bot.pathfinder.setGoal(currentGoal, true);
        }
      } catch (e) {
        this._log(`Follow error: ${e.message}`);
      }
    };

    // Update goal periodically
    updateGoal();
    const interval = setInterval(updateGoal, 1000);

    // Return stop function
    return () => {
      following = false;
      clearInterval(interval);
      if (this.bot.pathfinder) {
        this.bot.pathfinder.setGoal(null);
      }
      if (this.coordinator) {
        this.coordinator.clearPathfindingGoal(this.bot.username);
      }
    };
  }

  /**
   * Stop all pathfinding
   */
  stop() {
    if (this.bot.pathfinder) {
      this.bot.pathfinder.setGoal(null);
    }
    if (this.coordinator) {
      this.coordinator.clearPathfindingGoal(this.bot.username);
    }
  }

  /**
   * Get path cache statistics
   */
  getCacheStats() {
    return this.pathCache.getStats();
  }

  /**
   * Get detailed cache debug info
   */
  getCacheDebugInfo() {
    return this.pathCache.getDebugInfo();
  }

  /**
   * Clear path cache
   */
  clearCache() {
    this.pathCache.clear();
    this._log('Path cache cleared');
  }

  /**
   * Invalidate paths near a position
   */
  invalidatePathsNear(pos, radius = 5) {
    const count = this.pathCache.invalidatePathsNear(pos, radius);
    if (count > 0) {
      this._log(`Invalidated ${count} cached paths near ${pos}`);
    }
  }

  /**
   * Normalize position to Vec3
   */
  _normalizePosition(pos) {
    try {
      if (pos instanceof Vec3) {
        return new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
      }
      
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
        return new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
      }
      
      if (Array.isArray(pos) && pos.length >= 3) {
        return new Vec3(Math.floor(pos[0]), Math.floor(pos[1]), Math.floor(pos[2]));
      }
      
      throw new Error('Invalid position format');
    } catch (e) {
      throw new Error(`Failed to normalize position: ${e.message}`);
    }
  }
}
