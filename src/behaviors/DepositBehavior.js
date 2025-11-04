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

    // Use centralized pathfinding utility if available
    if (this.bot.pathfindingUtil) {
      try {
        await this.bot.pathfindingUtil.gotoBlock(pos, timeoutMs, 'deposit');
        return;
      } catch (err) {
        this.logger && this.logger.warn && this.logger.warn(`[Deposit] pathfindingUtil failed: ${err.message || err}`);
        throw err;
      }
    }

    // Fallback: Legacy pathfinding
    const target = new Vec3(Math.floor(pos.x) + 0.5, Math.floor(pos.y), Math.floor(pos.z) + 0.5);
    
    if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
      try {
        const goal = new goals.GoalNear(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), Math.max(near, 1));
        await this.bot.pathfinder.goto(goal);
        return;
      } catch (err) {
        this.logger && this.logger.warn && this.logger.warn(`[Deposit] pathfinder.goto failed: ${err.message || err}`);
        throw err;
      }
    }

    throw new Error('No pathfinder available on bot');
  }

  // depositAll - updated to use _gotoBlock and retry when path blocked
  async depositAll() {
    this._emitDebug('depositAll called');
    if (!this.bot.chestRegistry) {
      this.logger.info('[Deposit] No chestRegistry available on bot');
      return;
    }

    const invItems = this.bot.inventory.items().filter(Boolean);
    if (!invItems.length) {
      this.logger.info('[Deposit] Nothing to deposit');
      return;
    }

    // filter out items we want to keep (tools, seeds for farming)
    const itemsToDeposit = invItems.filter(it => {
      const name = it.name || '';
      // keep hoes for farming (don't deposit tools)
      if (name.includes('_hoe')) return false;
      // keep a stack of seeds for replanting
      if (name.includes('seeds') || name.includes('wheat_seeds') || name.includes('carrot') || name.includes('potato')) {
        // keep up to 64 seeds, deposit excess
        const seedCount = this.bot.inventory.items()
          .filter(i => i && (i.name.includes('seeds') || i.name.includes('wheat_seeds') || i.name.includes('carrot') || i.name.includes('potato')))
          .reduce((sum, i) => sum + i.count, 0);
        return seedCount > 64;
      }
      return true;
    });

    if (!itemsToDeposit.length) {
      this.logger.info('[Deposit] Nothing to deposit (keeping tools and seeds)');
      return;
    }

    // group items by category
    const groups = {};
    for (const it of itemsToDeposit) {
      const category = this._findCategoryForItem(it.name);
      groups[category] = groups[category] || [];
      groups[category].push(it);
    }

    for (const [category, items] of Object.entries(groups)) {
      const chestEntry = await this.bot.chestRegistry.getChest(category).catch(() => null);
      if (!chestEntry) {
        this.logger.info(`[Deposit] No chest registered for "${category}", skipping.`);
        continue;
      }

      const chestPos = new Vec3(chestEntry.x, chestEntry.y, chestEntry.z);

      try {
        await this._gotoBlock(chestPos, 20000, 2);
      } catch (err) {
        this.logger.warn(`[Deposit] Cannot reach chest for ${category}: ${err.message || err}`);
        continue;
      }

      const chestBlock = this.bot.blockAt(chestPos);
      if (!chestBlock) {
        this.logger.warn(`[Deposit] No chest block found at saved coords for ${category}`);
        continue;
      }

      // open container robustly
      let container = null;
      try {
        if (typeof this.openChestSafe === 'function') {
          container = await this.openChestSafe(chestBlock);
        } else if (typeof this.bot.openContainer === 'function') {
          container = await this.bot.openContainer(chestBlock);
        } else {
          container = await this.bot.openChest(chestBlock);
        }
      } catch (e) {
        this.logger.warn(`[Deposit] Failed to open container for ${category}: ${e.message || e}`);
        if (container && typeof container.close === 'function') try { container.close(); } catch (_) {}
        continue;
      }

      // ensure window populated
      await new Promise(r => setTimeout(r, 250));

      try {
        // deposit each matching inventory item into the opened container
        for (const item of items) {
          // validate item still exists in inventory
          const cur = this.bot.inventory.items().find(i => i && i.type === item.type);
          if (!cur) continue;

          const count = cur.count || 1;
          this._emitDebug(`[Deposit] Depositing ${count}x ${cur.name} -> ${category}`);

          if (container && typeof container.deposit === 'function') {
            // deposit(type, metadata/null, count)
            await container.deposit(cur.type, null, count);
          } else if (typeof this.bot.transfer === 'function' && container && container.window) {
            // fallback: try bot.transfer (some APIs expose transfer)
            try {
              await this.bot.transfer(cur.type, null, count, container.window);
            } catch (err) {
              this.logger.warn(`[Deposit] fallback transfer failed for ${cur.name}: ${err.message || err}`);
            }
          } else {
            this.logger.warn('[Deposit] No supported deposit API on container, skipping item', cur.name);
          }

          // small delay for inventory/container sync
          await new Promise(r => setTimeout(r, 150));
        }
      } catch (err) {
        this.logger.warn(`[Deposit] Error depositing to ${category}: ${err.message || err}`);
      } finally {
        try { if (container && typeof container.close === 'function') container.close(); } catch (_) {}
      }
    }

    this.logger.info('[Deposit] depositAll finished');
  }
}
