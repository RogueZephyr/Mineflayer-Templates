// src/utils/PathCache.js
import { Vec3 } from 'vec3';

/**
 * PathCache - Caches successful pathfinding routes to reduce computation
 * Updates cache when obstacles are detected or better paths found
 */
export default class PathCache {
  constructor(bot, logger, config = {}) {
    this.bot = bot;
    this.logger = logger;
    
    // Cache structure: 'startX,startY,startZ->endX,endY,endZ' -> pathData
    this.cache = new Map();
    
    // Configuration (with defaults)
    this.maxCacheSize = config.maxCacheSize || 100; // Maximum cached paths
    this.pathValidityRadius = config.pathValidityRadius || 5; // Consider cached path valid if within this radius
    this.cacheExpiration = config.cacheExpiration || 300000; // 5 minutes before path considered stale
    this.minPathLength = config.minPathLength || 10; // Only cache paths longer than this
    
    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0,
      saves: 0
    };
    
    // Setup block update listeners for cache invalidation
    this._setupBlockListeners();
    
    // Track listener reference for cleanup
    this._blockUpdateHandler = null;
  }
  
  /**
   * Dispose of all listeners and cleanup resources
   * Called by BotController on shutdown to prevent memory leaks
   */
  dispose() {
    // Remove block update listener
    if (this._blockUpdateHandler) {
      this.bot.removeListener('blockUpdate', this._blockUpdateHandler);
      this._blockUpdateHandler = null;
    }
    
    // Clear cache
    this.cache.clear();
    
    if (this.logger) {
      this.logger.info('[PathCache] Disposed');
    }
  }

  /**
   * Generate cache key from start and end positions (includes dimension context)
   */
  _getCacheKey(start, end, dimension = null) {
    // Get dimension from bot if not provided
    if (!dimension && this.bot && this.bot.game && this.bot.game.dimension) {
      dimension = this.bot.game.dimension;
    }
    
    // Fallback to 'overworld' if dimension unknown
    dimension = dimension || 'overworld';
    
    const sx = Math.floor(start.x / this.pathValidityRadius) * this.pathValidityRadius;
    const sy = Math.floor(start.y / this.pathValidityRadius) * this.pathValidityRadius;
    const sz = Math.floor(start.z / this.pathValidityRadius) * this.pathValidityRadius;
    
    const ex = Math.floor(end.x / this.pathValidityRadius) * this.pathValidityRadius;
    const ey = Math.floor(end.y / this.pathValidityRadius) * this.pathValidityRadius;
    const ez = Math.floor(end.z / this.pathValidityRadius) * this.pathValidityRadius;
    
    return `${dimension}:${sx},${sy},${sz}->${ex},${ey},${ez}`;
  }

  /**
   * Get cached path if available and valid
   */
  getCachedPath(start, end) {
    const key = this._getCacheKey(start, end);
    const cached = this.cache.get(key);
    
    if (!cached) {
      this.stats.misses++;
      return null;
    }
    
    // Check if cache is stale
    const age = Date.now() - cached.timestamp;
    if (age > this.cacheExpiration) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Check if path is still valid (no blocks changed)
    if (!this._isPathValid(cached)) {
      this.cache.delete(key);
      this.stats.invalidations++;
      this.stats.misses++;
      return null;
    }
    
    this.stats.hits++;
    
    // Update last used time
    cached.lastUsed = Date.now();
    cached.useCount++;
    
    return cached;
  }

  /**
   * Cache a successful path
   */
  cachePath(start, end, pathData) {
    // Don't cache short paths
    if (!pathData || !pathData.path || pathData.path.length < this.minPathLength) {
      return;
    }
    
    const key = this._getCacheKey(start, end);
    
    // Check cache size limit
    if (this.cache.size >= this.maxCacheSize) {
      this._evictOldest();
    }
    
    // Store path with metadata
    this.cache.set(key, {
      start: new Vec3(start.x, start.y, start.z),
      end: new Vec3(end.x, end.y, end.z),
      path: pathData.path.map(p => new Vec3(p.x, p.y, p.z)),
      checkpoints: this._generateCheckpoints(pathData.path),
      timestamp: Date.now(),
      lastUsed: Date.now(),
      useCount: 1,
      cost: pathData.cost || pathData.path.length
    });
    
    this.stats.saves++;
  }

  /**
   * Generate checkpoints along path for validation
   * Only check key positions to reduce validation cost
   */
  _generateCheckpoints(path) {
    if (!path || path.length === 0) return [];
    
    const checkpoints = [];
    const interval = Math.max(5, Math.floor(path.length / 10)); // Max 10 checkpoints
    
    for (let i = 0; i < path.length; i += interval) {
      const pos = path[i];
      const block = this.bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
      
      checkpoints.push({
        position: new Vec3(pos.x, pos.y, pos.z),
        blockType: block ? block.type : 0,
        index: i
      });
    }
    
    // Always include end point
    if (path.length > 0) {
      const lastPos = path[path.length - 1];
      const lastBlock = this.bot.blockAt(new Vec3(lastPos.x, lastPos.y, lastPos.z));
      
      checkpoints.push({
        position: new Vec3(lastPos.x, lastPos.y, lastPos.z),
        blockType: lastBlock ? lastBlock.type : 0,
        index: path.length - 1
      });
    }
    
    return checkpoints;
  }

  /**
   * Validate that a cached path is still traversable
   */
  _isPathValid(cachedPath) {
    if (!cachedPath.checkpoints) return false;
    
    // Check a subset of checkpoints (not all to save time)
    const checkCount = Math.min(5, cachedPath.checkpoints.length);
    const step = Math.floor(cachedPath.checkpoints.length / checkCount);
    
    for (let i = 0; i < cachedPath.checkpoints.length; i += Math.max(1, step)) {
      const checkpoint = cachedPath.checkpoints[i];
      const currentBlock = this.bot.blockAt(checkpoint.position);
      
      // Check if block type changed
      if (!currentBlock || currentBlock.type !== checkpoint.blockType) {
        return false; // Path is blocked or changed
      }
    }
    
    return true;
  }

  /**
   * Invalidate paths that pass through a specific position
   */
  invalidatePathsNear(pos, radius = 5) {
    let invalidated = 0;
    
    for (const [key, cachedPath] of this.cache.entries()) {
      // Check if any checkpoint is near the changed position
      for (const checkpoint of cachedPath.checkpoints) {
        const dist = Math.sqrt(
          Math.pow(checkpoint.position.x - pos.x, 2) +
          Math.pow(checkpoint.position.y - pos.y, 2) +
          Math.pow(checkpoint.position.z - pos.z, 2)
        );
        
        if (dist <= radius) {
          this.cache.delete(key);
          invalidated++;
          break;
        }
      }
    }
    
    if (invalidated > 0) {
      this.stats.invalidations += invalidated;
    }
    
    return invalidated;
  }

  /**
   * Evict least recently used path
   */
  _evictOldest() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, cached] of this.cache.entries()) {
      if (cached.lastUsed < oldestTime) {
        oldestTime = cached.lastUsed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Setup listeners for block changes to invalidate affected paths
   */
  _setupBlockListeners() {
    // Listen for block updates
    this._blockUpdateHandler = (oldBlock, newBlock) => {
      if (oldBlock && newBlock) {
        // Only invalidate if block changed between solid/non-solid
        const oldSolid = oldBlock.boundingBox === 'block';
        const newSolid = newBlock.boundingBox === 'block';
        
        if (oldSolid !== newSolid) {
          this.invalidatePathsNear(newBlock.position, 3);
        }
      }
    };
    this.bot.on('blockUpdate', this._blockUpdateHandler);
  }

  /**
   * Clear all cached paths
   */
  clear() {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.invalidations = 0;
    this.stats.saves = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : 0;
    
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      invalidations: this.stats.invalidations,
      saves: this.stats.saves,
      hitRate: `${hitRate}%`,
      total: total
    };
  }

  /**
   * Get debug information
   */
  getDebugInfo() {
    const stats = this.getStats();
    const paths = [];
    
    for (const [key, cached] of this.cache.entries()) {
      paths.push({
        key: key,
        length: cached.path.length,
        age: Math.floor((Date.now() - cached.timestamp) / 1000),
        useCount: cached.useCount,
        checkpoints: cached.checkpoints.length
      });
    }
    
    return {
      stats,
      paths: paths.sort((a, b) => b.useCount - a.useCount).slice(0, 10) // Top 10
    };
  }
}
