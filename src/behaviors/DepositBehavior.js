import fs from 'fs/promises';
import path from 'path';
import { Vec3 } from 'vec3';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

export default class DepositBehavior {
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
    } catch (err) {
      this.logger && this.logger.warn && this.logger.warn('[Deposit] Failed to load itemCategories.json, falling back to empty mapping.');
      this.itemCategories = {};
    }
  }

  // Helper: run an async operation with timeout
  _withTimeout(promiseOrValue, ms) {
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('operation timed out')), ms);
    });
    // Ensure we always work with a Promise (handles synchronous return values)
    const p = Promise.resolve(promiseOrValue);
    return Promise.race([p.finally(() => clearTimeout(timeout)), timeoutPromise]);
  }

  // Helper: retry an async factory function up to attempts times with small delay, each attempt bounded by timeoutMs
  async _withRetry(factoryFn, attempts = 3, timeoutMs = 5000, delayMs = 500) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this._withTimeout(factoryFn(), timeoutMs);
        return res;
      } catch (err) {
        lastErr = err;
        this.logger && this.logger.warn && this.logger.warn(`[Deposit] Attempt ${i + 1} failed: ${err.message || err}`);
        if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }

  // Exposed helper for other behaviors to open a chest safely
  async openChestSafe(chestBlock, attempts = 3, timeoutMs = 5000) {
    return await this._withRetry(() => this.bot.openChest(chestBlock), attempts, timeoutMs);
  }

  // Map an item name to a category by scanning itemCategories.json
  _findCategoryForItem(itemName) {
    if (!itemName) return null;
    for (const [category, names] of Object.entries(this.itemCategories)) {
      if (!Array.isArray(names)) continue;
      if (names.includes(itemName)) return category;
    }
    // fallback heuristics
    if (itemName.includes('log') || itemName.includes('plank') || itemName.includes('wood')) return 'wood';
    if (itemName.includes('ore') || itemName.includes('ingot') || itemName.includes('raw_')) return 'ores';
    if (itemName.includes('seed') || itemName.includes('carrot') || itemName.includes('potato')) return 'crops';
    if (itemName.includes('food') || itemName.includes('bread') || itemName.includes('apple') || itemName.includes('beef')) return 'food';
    return 'resources';
  }

  async getDiagnostics() {
    try {
      const chestCount = this.bot.chestRegistry ? Object.keys(await this.bot.chestRegistry.getAll() || {}).length : 0;
      return {
        itemCategoriesLoaded: Object.keys(this.itemCategories || {}).length,
        chestCount,
        hasOpenChestMethod: typeof this.bot.openChest === 'function'
      };
    } catch (e) {
      return { error: String(e) };
    }
  }

  // helper debug log
  _emitDebug(...args) {
    try { this.bot.debugTools && this.bot.debugTools.log('deposit', ...args); } catch (_) {}
  }

  // Robust navigation helper (used by depositAll and other methods)
  async _gotoBlock(pos, timeoutMs = 30000, near = 1.5) {
    if (!pos) throw new Error('_gotoBlock: pos required');
    const target = new Vec3(Math.floor(pos.x) + 0.5, Math.floor(pos.y), Math.floor(pos.z) + 0.5);

    // prefer promise-style goto if available
    if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
      try {
        // prefer GoalNear to allow approaching adjacent to chest
        const goal = new goals.GoalNear(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), Math.max(near, 1));
        await this.bot.pathfinder.goto(goal);
        return;
      } catch (err) {
        this.logger && this.logger.warn && this.logger.warn(`[Deposit] pathfinder.goto failed, will fallback: ${err.message || err}`);
      }
    }

    // fallback to setGoal + poll pattern
    if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
      // try GoalNear first
      const goal = new goals.GoalNear(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), Math.max(near, 1));
      try {
        this.bot.pathfinder.setGoal(goal);
      } catch (e) {
        this.logger && this.logger.warn && this.logger.warn(`[Deposit] setGoal threw: ${e.message || e}`);
      }

      return await new Promise((resolve, reject) => {
        const start = Date.now();
        const iv = setInterval(() => {
          try {
            const ent = this.bot.entity;
            if (!ent || !ent.position) return;
            const dx = ent.position.x - target.x;
            const dy = ent.position.y - target.y;
            const dz = ent.position.z - target.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < Math.max(near, 1.6)) {
              clearInterval(iv);
              return resolve();
            }
            if (Date.now() - start > timeoutMs) {
              clearInterval(iv);
              try { this.bot.pathfinder.setGoal(null); } catch (_) {}
              return reject(new Error('navigation timeout'));
            }
          } catch (e) {
            // ignore transient errors
          }
        }, 250);
      });
    }

    throw new Error('No pathfinder available on bot');
  }

  // depositAll - updated to use _gotoBlock and retry when path blocked
  async depositAll() {
    this._emitDebug('depositAll called, inventory size', this.bot.inventory.items().length);
    if (!this.bot.chestRegistry) throw new Error('No chestRegistry available on bot');
    const items = this.bot.inventory.items();
    if (!items || items.length === 0) {
      this.logger && this.logger.info && this.logger.info('[Deposit] Nothing to deposit');
      return;
    }

    // group by category -> { category: [{ item, count }, ...] }
    const groups = {};
    for (const it of items) {
      const name = it.name || '';
      const category = this._findCategoryForItem(name);
      if (!groups[category]) groups[category] = [];
      groups[category].push(it);
    }

    // determine chests to use: one per category, prioritized by existing deposits
    const chestsToUse = [];
    for (const [category, itemList] of Object.entries(groups)) {
      const chestEntry = await this.bot.chestRegistry.getChest(category);
      if (chestEntry) {
        chestsToUse.push({ category, chestPos: new Vec3(chestEntry.x, chestEntry.y, chestEntry.z), itemList });
      } else {
        this.logger && this.logger.info && this.logger.info(`[Deposit] No chest registered for "${category}", skipping.`);
      }
    }

    // sort chestsToUse by distance to player (nearest first)
    chestsToUse.sort((a, b) => {
      const aDist = this.bot.entity.position.distanceTo(a.chestPos);
      const bDist = this.bot.entity.position.distanceTo(b.chestPos);
      return aDist - bDist;
    });

    for (const { category, chestPos, itemList } of chestsToUse) {
      try {
        this.logger.info(`[Deposit] Depositing to category ${category} at ${chestPos.x},${chestPos.y},${chestPos.z}`);
        // try to navigate with retries and searchRadius bump on failure
        try {
          await this._gotoBlock(chestPos, 20000, 2);
        } catch (err) {
          this.logger.warn(`[Deposit] Direct navigation failed (${err.message}). Increasing searchRadius and retrying.`);
          // bump search radius and retry once
          try {
            if (this.bot.pathfinder && typeof this.bot.pathfinder.searchRadius === 'number') {
              this.bot.pathfinder.searchRadius = Math.max(this.bot.pathfinder.searchRadius, 128);
            }
            // try again using GoalNear
            await this._gotoBlock(chestPos, 20000, 2.5);
          } catch (err2) {
            this.logger.error(`[Deposit] Failed to reach chest after retry: ${err2.message || err2}`);
            // skip this chest and continue with next category
            continue;
          }
        }

        // fetch chest record (may include block data)
        const chestRecord = await this.bot.chestRegistry.getChest(category);
        if (!chestRecord) {
          this.logger.warn(`[Deposit] No chest found for category ${category}`);
          continue;
        }

        let chestWindow = null;
        try {
          // open chest safely (uses retry/timeout)
          chestWindow = await this.openChestSafe(chestRecord);
          // deposit items - rely on existing bot.depositItem API or behavior
          for (const item of itemList) {
            try {
              if (typeof this.bot.depositItem === 'function') {
                await this.bot.depositItem(item);
              } else if (chestWindow && typeof chestWindow.deposit === 'function') {
                // if chest window exposes deposit (some plugins), use it
                await chestWindow.deposit(item);
              } else {
                // best-effort: try bot.deposit with type/count if available
                if (typeof this.bot.deposit === 'function') {
                  await this.bot.deposit(item.type, null, item.count);
                } else {
                  this.logger && this.logger.warn && this.logger.warn('[Deposit] No supported deposit API available for item', item.name);
                }
              }
            } catch (innerErr) {
              this.logger && this.logger.warn && this.logger.warn(`[Deposit] Failed to deposit ${item.name}: ${innerErr.message || innerErr}`);
            }
          }
        } catch (err) {
          this.logger.error(`[Deposit] Failed to open/deposit into chest: ${err.message || err}`);
        } finally {
          // attempt to close chest/window if open
          try {
            if (chestWindow && typeof chestWindow.close === 'function') {
              chestWindow.close();
            } else if (typeof this.bot.closeChest === 'function') {
              await this.bot.closeChest();
            } else if (typeof this.bot.closeWindow === 'function') {
              await this.bot.closeWindow();
            }
          } catch (closeErr) {
            // non-fatal
          }
        }
      } catch (e) {
        this.logger && this.logger.error && this.logger.error(`[Deposit] Unexpected error during deposit for category ${category}: ${e.message || e}`);
      }
    }
  }
}
