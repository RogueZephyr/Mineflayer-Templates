// src/state/AreaRegistry.js
import fs from 'fs/promises';
import path from 'path';

/**
 * AreaRegistry - Modular area management for different bot behaviors
 * Supports setting rectangular areas for farming, mining, wood chopping, etc.
 */
export default class AreaRegistry {
  constructor(bot) {
    this.bot = bot;
    this.dataPath = path.join(process.cwd(), 'data', 'areas.json');
    this.areas = {};
    this.pendingAreas = {}; // temp storage for areas being defined
  }

  async _ensureDataFile() {
    try {
      await fs.access(this.dataPath);
      return;
    } catch (e) {
      await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
      await fs.writeFile(this.dataPath, JSON.stringify({}, null, 2) + '\n', 'utf8');
    }
  }

  async _readAll() {
    await this._ensureDataFile();
    try {
      const raw = await fs.readFile(this.dataPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async _writeAll(data) {
    const body = JSON.stringify(data, null, 2) + '\n';
    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fs.writeFile(this.dataPath, body, 'utf8');
  }

  /**
   * Normalize position to plain object with integer coords
   */
  _normalizePos(pos) {
    if (!pos) throw new Error('No position provided');
    
    if (typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
      return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    }
    
    if (Array.isArray(pos) && pos.length >= 3) {
      return { x: Math.floor(Number(pos[0])), y: Math.floor(Number(pos[1])), z: Math.floor(Number(pos[2])) };
    }
    
    if (pos && (typeof pos.x !== 'undefined' || typeof pos[0] !== 'undefined')) {
      return {
        x: Math.floor(Number(pos.x ?? pos[0] ?? 0)),
        y: Math.floor(Number(pos.y ?? pos[1] ?? 0)),
        z: Math.floor(Number(pos.z ?? pos[2] ?? 0))
      };
    }
    
    throw new Error('Invalid position object');
  }

  /**
   * Set a corner for an area (start or end)
   * @param {string} type - Area type (farm, quarry, lumber, etc.)
   * @param {string} corner - 'start' or 'end'
   * @param {object} pos - Position {x, y, z}
   */
  async setCorner(type, corner, pos) {
    if (!type) throw new Error('Area type required');
    if (!corner || !['start', 'end'].includes(corner)) throw new Error('Corner must be "start" or "end"');
    
    const normalized = this._normalizePos(pos);
    
    // Initialize pending area if it doesn't exist
    if (!this.pendingAreas[type]) {
      this.pendingAreas[type] = {};
    }
    
    this.pendingAreas[type][corner] = normalized;
    
    // If both corners are set, save to disk
    if (this.pendingAreas[type].start && this.pendingAreas[type].end) {
      const area = this.pendingAreas[type];
      const all = await this._readAll();
      all[type] = area;
      await this._writeAll(all);
      
      // Update in-memory cache
      this.areas[type] = area;
      
      // Clear pending
      delete this.pendingAreas[type];
      
      return { completed: true, area };
    }
    
    return { completed: false, pending: this.pendingAreas[type] };
  }

  /**
   * Set an entire area at once
   * @param {string} type - Area type
   * @param {object} start - Start position {x, y, z}
   * @param {object} end - End position {x, y, z}
   */
  async setArea(type, start, end) {
    if (!type) throw new Error('Area type required');
    
    const normalizedStart = this._normalizePos(start);
    const normalizedEnd = this._normalizePos(end);
    
    const area = {
      start: normalizedStart,
      end: normalizedEnd
    };

    // Validate and normalize area coordinates
    const validatedArea = this._validateArea(area);
    
    const all = await this._readAll();
    all[type] = validatedArea;
    await this._writeAll(all);
    
    // Update in-memory cache
    this.areas[type] = validatedArea;
    
    return validatedArea;
  }

  /**
   * Get an area by type
   * @param {string} type - Area type
   * @returns {object|null} Area object with start/end or null
   */
  async getArea(type) {
    // Check cache first
    if (this.areas[type]) return this.areas[type];
    
    // Load from disk
    const all = await this._readAll();
    const area = all[type] || null;
    
    if (area) {
      this.areas[type] = area;
    }
    
    return area;
  }

  /**
   * Delete an area
   * @param {string} type - Area type to delete
   */
  async deleteArea(type) {
    const all = await this._readAll();
    delete all[type];
    await this._writeAll(all);
    
    delete this.areas[type];
    delete this.pendingAreas[type];
    
    return true;
  }

  /**
   * Remove an area (alias for deleteArea)
   * @param {string} type - Area type to remove
   */
  async removeArea(type) {
    return this.deleteArea(type);
  }

  /**
   * List all area types
   * @returns {string[]} Array of area type names
   */
  async listAreas() {
    const all = await this._readAll();
    return Object.keys(all || {});
  }

  /**
   * Validate area coordinates (checks for inverted bounds)
   * @param {object} area - Area with start/end
   * @throws {Error} If area is invalid
   */
  _validateArea(area) {
    if (!area || !area.start || !area.end) {
      throw new Error('Area incomplete: missing start or end coordinates');
    }

    const { start, end } = area;

    // Normalize coordinates (swap if inverted)
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    // Return normalized area
    return {
      start: { x: minX, y: minY, z: minZ },
      end: { x: maxX, y: maxY, z: maxZ }
    };
  }

  /**
   * Get all areas
   * @returns {object} All areas
   */
  async getAll() {
    return await this._readAll();
  }

  /**
   * Get pending area (one corner set, waiting for second)
   * @param {string} type - Area type
   * @returns {object|null} Pending area or null
   */
  getPending(type) {
    return this.pendingAreas[type] || null;
  }

  /**
   * Calculate area dimensions
   * @param {object} area - Area with start/end
   * @returns {object} Dimensions {width, height, depth, volume}
   */
  calculateDimensions(area) {
    if (!area || !area.start || !area.end) return null;
    
    const width = Math.abs(area.end.x - area.start.x) + 1;
    const height = Math.abs(area.end.y - area.start.y) + 1;
    const depth = Math.abs(area.end.z - area.start.z) + 1;
    
    return {
      width,
      height,
      depth,
      volume: width * height * depth
    };
  }

  /**
   * Get diagnostics for debug
   */
  async getDiagnostics() {
    try {
      const all = await this._readAll();
      return {
        filePath: this.dataPath,
        areas: Object.keys(all || {}).length,
        areaTypes: Object.keys(all || {}),
        pending: Object.keys(this.pendingAreas || {}),
        details: all
      };
    } catch (e) {
      return { error: String(e) };
    }
  }
}
