// src/behaviors/SleepBehavior.js
import pkg from 'mineflayer-pathfinder';
const { goals, Movements } = pkg;
const { GoalNear } = goals;
import BedRegistry from '../state/BedRegistry.js';

export default class SleepBehavior {
  constructor(bot, mcData, logger, config = {}, behaviors = {}) {
    this.bot = bot;
    this.mcData = mcData;
    this.logger = logger;
    this.enabled = true;
    this.sleeping = false;
    this.movingToBed = false;
    this.bedColor = config.bedColor || 'red';
    this.bedPos = null;
  this.claimedBedKey = null;
  this.fallbackAnyColor = !!config.fallbackAnyColor; // allow any bed if preferred color unavailable
  this.randomizeSelection = config.randomizeSelection !== false; // default true
  this.selectionSalt = Math.floor(Math.random() * 100000); // used for hashed rotation

    // Optional behaviors, e.g., LookBehavior
    this.behaviors = behaviors;
    this.lookBehavior = behaviors.look;
  }

  disable() { this.enabled = false; }
  enable() { this.enabled = true; }

  async sleep() {
    if (!this.enabled || this.sleeping || this.movingToBed) return;
    if (!this.bot.isAlive) return;

    this.movingToBed = true;

    let lookWasEnabled = false;
    if (this.lookBehavior && this.lookBehavior.enabled) {
      lookWasEnabled = true;
      this.lookBehavior.disable(); // disable LookBehavior while sleeping
    }

    try {
      this.bedPos = await this.findAvailableBed();
      if (!this.bedPos) {
        this.logger.warn(`[ManualSleep] No ${this.bedColor} bed available!`);
        return;
      }

      const bedBlock = this.bot.blockAt(this.bedPos);
      if (!bedBlock) throw new Error('Bed block no longer exists!');

      // Stop any ongoing movement
      if (this.bot.pathfindingUtil) {
        this.bot.pathfindingUtil.stop();
      } else if (this.bot.pathfinder) {
        this.bot.pathfinder.setGoal(null);
      }

      // Set proper movements
      const defaultMovements = new Movements(this.bot, this.mcData);
      this.bot.pathfinder.setMovements(defaultMovements);

      // Walk to bed
      if (this.bot.pathfindingUtil) {
        await this.bot.pathfindingUtil.gotoBlock(this.bedPos, 30000, 'sleep');
      } else {
        const goal = new GoalNear(this.bedPos.x, this.bedPos.y, this.bedPos.z, 1);
        await this.bot.pathfinder.goto(goal);
      }

      // Attempt to sleep
      await this.bot.sleep(bedBlock);
      this.sleeping = true;
      this.logger.success(`[ManualSleep] Bot is now sleeping at ${this.bedPos.x},${this.bedPos.y},${this.bedPos.z}`);

      // Handle wake
      this.bot.once('wake', () => this.onWake());
    } catch (err) {
      this.logger.error(`[ManualSleep] Failed to sleep: ${err.message}`);
      if (this.claimedBedKey) BedRegistry.release(this.claimedBedKey);
      this.bedPos = null;
      this.claimedBedKey = null;
    } finally {
      this.movingToBed = false;
      // Leave LookBehavior disabled while sleeping, will re-enable on wake
      if (!this.sleeping && lookWasEnabled) {
        this.lookBehavior.enable();
      }
    }
  }

  async findAvailableBed() {
    // Phase 1: gather candidate beds of requested color
    const targetRegex = new RegExp(`${this.bedColor}_bed$`);
    let candidates = this._listUniqueBeds(targetRegex);

    // Phase 2: optional fallback to any bed color if none of preferred
    if (candidates.length === 0 && this.fallbackAnyColor) {
      const anyRegex = /_bed$/;
      candidates = this._listUniqueBeds(anyRegex);
      if (candidates.length > 0) {
        this.logger.info(`[Sleep] Fallback: using any bed color (${candidates.length} beds)`);
      }
    }

    if (candidates.length === 0) return null;

    // Deterministic but distributed iteration order to reduce clustering
    const startIndex = this.randomizeSelection
      ? (this._hash(`${this.bot.username}:${this.selectionSalt}`) % candidates.length)
      : 0;

    for (let i = 0; i < candidates.length; i++) {
      const idx = (startIndex + i) % candidates.length;
      const bed = candidates[idx];
      if (BedRegistry.claim(bed.key)) {
        this.claimedBedKey = bed.key;
        this.logger.info(`[Sleep] Claimed bed ${bed.key}`);
        return bed.originalPos;
      }
    }
    return null; // all claimed
  }

  /**
   * Compute a canonical key for a bed so both head/foot halves map to the same key.
   * Falls back to the provided position when neighbor detection fails.
   */
  _canonicalizeBedKey(pos, bedRegex = null) {
    try {
      const base = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
      const here = this.bot.blockAt(base);
      const isBed = here && (bedRegex ? bedRegex.test(here.name) : /_bed$/.test(here?.name || ''));
      if (!isBed) return { key: BedRegistry.toKey(base), pos: base };

      const props = (here.properties || here.state || {});
      const partRaw = (props.part || props.PART || '').toString().toLowerCase();
      const facingRaw = (props.facing || props.FACING || '').toString().toLowerCase();

      const faceVec = (dir) => {
        switch (dir) {
          case 'north': return { x: 0, z: -1 };
          case 'south': return { x: 0, z: 1 };
          case 'west': return { x: -1, z: 0 };
          case 'east': return { x: 1, z: 0 };
          default: return null;
        }
      };
      const f = faceVec(facingRaw);

      if (f && (partRaw === 'head' || partRaw === 'foot')) {
        const head = (partRaw === 'head')
          ? base
          : { x: base.x + f.x, y: base.y, z: base.z + f.z };
        return { key: `bed:${head.x},${head.y},${head.z}`, pos: head };
      }

      // Fallback: neighbor match with same name but restrict to cardinal neighbors
      const offsets = [
        { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }
      ];
      for (const off of offsets) {
        const npos = { x: base.x + off.x, y: base.y, z: base.z + off.z };
        const nb = this.bot.blockAt(npos);
        if (nb && nb.name === here.name) {
          // Prefer the max/min ordering so both halves compute same canonical
          const headCandidate = (base.x > npos.x || (base.x === npos.x && base.z > npos.z)) ? base : npos;
          return { key: `bed:${headCandidate.x},${headCandidate.y},${headCandidate.z}`, pos: headCandidate };
        }
      }
      return { key: `bed:${base.x},${base.y},${base.z}`, pos: base };
    } catch (_) {
      return { key: BedRegistry.toKey(pos), pos };
    }
  }

  /**
   * Build a unique bed listing (canonical key + original position) for beds matching regex.
   */
  _listUniqueBeds(regex) {
    const blocks = this.bot.findBlocks({
      matching: (block) => regex.test(block.name),
      maxDistance: 48,
      count: 200
    });
    const seen = new Set();
    const out = [];
    for (const p of blocks) {
      const { key, pos } = this._canonicalizeBedKey(p, regex);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, canonicalPos: pos, originalPos: p });
    }
    return out;
  }

  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  onWake() {
    this.sleeping = false;
    if (this.bedPos) {
      if (this.claimedBedKey) {
        BedRegistry.release(this.claimedBedKey);
        this.logger.info(`[ManualSleep] Released bed ${this.claimedBedKey}`);
      }
      this.bedPos = null;
      this.claimedBedKey = null;
    }

    // Re-enable LookBehavior after waking
    if (this.lookBehavior) {
      this.lookBehavior.enable();
    }
  }
}
