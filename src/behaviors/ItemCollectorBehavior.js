// src/behaviors/ItemCollectorBehavior.js
import { Vec3 } from 'vec3';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

export default class ItemCollectorBehavior {
  constructor(bot, logger, areaRegistry = null) {
    this.bot = bot;
    this.logger = logger;
    this.areaRegistry = areaRegistry || bot.areaRegistry || null;
    this.enabled = true;
    this.isRunning = false;
    this._interval = null;
    this.idleDelayMs = 500; // wait after reaching an item
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; this.stopAuto(); }

  _emitDebug(...args) {
    const botName = this.bot.username || 'Unknown';
    try { if (this.bot.debugTools) this.bot.debugTools.log('itemCollector', `[${botName}]`, ...args); } catch (_) {}
  }

  _isItemEntity(entity) {
    // mineflayer item entities typically appear as { type: 'object', name: 'item' }
    return !!(entity && entity.name === 'item');
  }

  async _goto(pos, timeoutMs = 15000) {
    if (!pos) return false;
    const v = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    if (!this.bot.pathfinder || typeof this.bot.pathfinder.goto !== 'function') return false;
    try {
      const goal = new goals.GoalNear(v.x, v.y, v.z, 1.5);
      await this.bot.pathfinder.goto(goal);
      return true;
    } catch (e) {
      this._emitDebug('goto failed', e.message || e);
      return false;
    }
  }

  _getAreaBounds(area) {
    if (!area || !area.start || !area.end) return null;
    const minX = Math.min(area.start.x, area.end.x);
    const maxX = Math.max(area.start.x, area.end.x);
    const minY = Math.min(area.start.y || 0, area.end.y || 255);
    const maxY = Math.max(area.start.y || 0, area.end.y || 255);
    const minZ = Math.min(area.start.z, area.end.z);
    const maxZ = Math.max(area.start.z, area.end.z);
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }

  _itemsInArea(area) {
    const b = this._getAreaBounds(area);
    if (!b) return [];
    const list = Object.values(this.bot.entities).filter(e => this._isItemEntity(e) && e.position);
    return list.filter(e => e.position.x >= b.minX && e.position.x <= b.maxX &&
                            e.position.y >= b.minY - 2 && e.position.y <= b.maxY + 2 &&
                            e.position.z >= b.minZ && e.position.z <= b.maxZ);
  }

  _itemsNearby(radius = 8, constrainToArea = null) {
    const center = this.bot.entity?.position;
    if (!center) return [];
    const r = Math.max(1, Number(radius) || 8);
    const list = Object.values(this.bot.entities).filter(e => this._isItemEntity(e) && e.position);
    let filtered = list.filter(e => e.position.distanceTo(center) <= r);
    
    // If constrainToArea is provided, also check if item is within that area
    if (constrainToArea) {
      const bounds = this._getAreaBounds(constrainToArea);
      if (bounds) {
        filtered = filtered.filter(e => 
          e.position.x >= bounds.minX && e.position.x <= bounds.maxX &&
          e.position.y >= bounds.minY - 2 && e.position.y <= bounds.maxY + 2 &&
          e.position.z >= bounds.minZ && e.position.z <= bounds.maxZ
        );
      }
    }
    
    return filtered;
  }

  async collectOnce(opts = {}) {
    if (!this.enabled) return 0;
    const { area, type, radius, workZone } = opts || {};
    let targets = [];

    try {
      if (area && area.start && area.end) {
        targets = this._itemsInArea(area);
      } else if (type && this.areaRegistry) {
        const ar = await this.areaRegistry.getArea(type).catch(() => null);
        if (ar && ar.start && ar.end) targets = this._itemsInArea(ar);
      }
    } catch (_) {}

    if (!targets.length) {
      // Use workZone to constrain the radius collection if provided
      targets = this._itemsNearby(radius || 8, workZone);
    }
    if (!targets.length) return 0;

    let collected = 0;
    for (const ent of targets) {
      if (!this.enabled) break;
      if (!this.bot.entities[ent.id]) continue; // already gone
      try {
        await this._goto(ent.position, 10000);
        await new Promise(r => setTimeout(r, this.idleDelayMs));
        // entity might despawn or be collected asynchronously
        collected++;
      } catch (e) {
        this._emitDebug('collectOnce: failed to reach item', e.message || e);
      }
    }
    if (collected) this._emitDebug(`collectOnce: collected ${collected} items`);
    return collected;
  }

  startAuto({ type = 'farm', intervalMs = 10000, radius = 8 } = {}) {
    if (this._interval) this.stopAuto();
    this.isRunning = true;
    const tick = async () => {
      if (!this.enabled) return;
      try {
        await this.collectOnce({ type, radius });
      } catch (e) {
        this._emitDebug('startAuto tick error', e.message || e);
      }
    };
    // run immediately, then at interval
    tick();
    this._interval = setInterval(tick, Math.max(2000, intervalMs));
  }

  stopAuto() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this.isRunning = false;
  }
}
