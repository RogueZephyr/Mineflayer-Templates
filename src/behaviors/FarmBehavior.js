import chalk from 'chalk';
import { Vec3 } from 'vec3';
import pkg from 'mineflayer-pathfinder';
import mcDataFactory from 'minecraft-data';
const { goals } = pkg;

export default class FarmBehavior {
  constructor(bot, logger, master) {
    this.bot = bot;
    this.logger = logger;
    this.master = master;
    this.enabled = false;
    this.farmingArea = null;
    this.toolsChestLocation = null;
    this.mcData = mcDataFactory(this.bot.version);
    this.isWorking = false;
    this.lookBehavior = null;

    // how long to wait between empty-area re-scans (ms)
    this.idleScanIntervalMs = 30000;
  }

  setLookBehavior(lookBehavior) {
    this.lookBehavior = lookBehavior;
  }

  enable() {
    this.enabled = true;
    if (this.lookBehavior) this.lookBehavior.pause();
    this.logger.info('[Farm] Behavior enabled; look paused');
  }

  disable() {
    this.enabled = false;
    this.isWorking = false;
    if (this.lookBehavior) this.lookBehavior.resume();
    this.logger.info('[Farm] Behavior disabled; look resumed');
  }

  _emitDebug(...args) {
    console.log('[DEBUG:Farm]', ...args);
    try { if (this.bot.debugTools) this.bot.debugTools.log('farm', ...args); } catch (_) {}
  }

  // simple robust goto using pathfinder if available
  async _gotoBlock(pos, timeoutMs = 30000) {
    if (!pos) throw new Error('_gotoBlock: pos required');

    // normalize pos to a Vec3-like object (numeric x,y,z) — avoid calling .floored()
    let v;
    try {
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
        // accept Vec3-like objects (this also covers Vec3 instances)
        v = new Vec3(pos.x, pos.y, pos.z);
      } else if (Array.isArray(pos) && pos.length >= 3) {
        v = new Vec3(pos[0], pos[1], pos[2]);
      } else if (pos && (typeof pos.x !== 'undefined' || typeof pos[0] !== 'undefined')) {
        // try best-effort coercion from objects or array-like
        v = new Vec3(Number(pos.x ?? pos[0] ?? 0), Number(pos.y ?? pos[1] ?? 0), Number(pos.z ?? pos[2] ?? 0));
      } else {
        // not coercible — log and fallback to origin to avoid throwing unexpected errors
        this._emitDebug('_gotoBlock: received uncoercible pos', pos);
        v = new Vec3(0, 0, 0);
      }
    } catch (e) {
      this._emitDebug('_gotoBlock: coercion error', e && e.stack ? e.stack : String(e));
      v = new Vec3(0, 0, 0);
    }

    // compute integer coords without calling .floored() to avoid runtime errors
    const floored = new Vec3(
      Math.floor(Number(v.x || 0)),
      Math.floor(Number(v.y || 0)),
      Math.floor(Number(v.z || 0))
    );
    const gx = floored.x;
    const gy = floored.y;
    const gz = floored.z;

    // prefer GoalNear for approach tolerance and use Vec3 coordinates
    if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
      try {
        const goal = new goals.GoalNear(gx, gy, gz, 1.5);
        await this.bot.pathfinder.goto(goal);
        return;
      } catch (e) {
        this._emitDebug('pathfinder.goto failed, falling back to setGoal:', e.message || e);
      }
    }

    // fallback: setGoal + poll (use GoalNear)
    if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
      try {
        this.bot.pathfinder.setGoal(new goals.GoalNear(gx, gy, gz, 1.5));
      } catch (e) {
        this._emitDebug('pathfinder.setGoal threw:', e.message || e);
      }

      const target = new Vec3(gx + 0.5, gy, gz + 0.5);
      const start = Date.now();
      return await new Promise((resolve, reject) => {
        const iv = setInterval(() => {
          try {
            const ent = this.bot.entity;
            if (!ent || !ent.position) return;
            const dx = ent.position.x - target.x;
            const dy = ent.position.y - target.y;
            const dz = ent.position.z - target.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < 1.6) {
              clearInterval(iv);
              try { if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') this.bot.pathfinder.setGoal(null); } catch(_) {}
              return resolve();
            }
            if (Date.now() - start > timeoutMs) {
              clearInterval(iv);
              try { if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') this.bot.pathfinder.setGoal(null); } catch(_) {}
              return reject(new Error('navigation timeout'));
            }
          } catch (err) {
            // ignore transient
          }
        }, 250);
      });
    }

    throw new Error('No pathfinder available on bot');
  }

  // Detect fully grown using version-agnostic check
  _isFullyGrown(block) {
    if (!block) return false;
    const name = block.name || '';
    if (!/(wheat|carrot|potato|carrots|potatoes)/i.test(name)) return false;

    // prefer properties/age
    const age =
      (block.properties && (block.properties.age || block.properties.AGE)) ||
      (block.state && (block.state.age || block.state.AGE)) ||
      (typeof block.metadata === 'number' ? block.metadata : undefined);
    if (age !== undefined) {
      const num = Number(age);
      if (!Number.isNaN(num)) return num >= 7;
    }

    // fallback: try mcData dictionary if available
    try {
      const def = this.mcData.blocksByName && this.mcData.blocksByName[name];
      if (def && def.properties) {
        const ageProp = def.properties.find(p => p.name === 'age' || p.name === 'AGE');
        if (ageProp && typeof ageProp.max === 'number') {
          const maxAge = ageProp.max || 7;
          if (typeof block.metadata === 'number') return block.metadata >= maxAge;
        }
      }
    } catch (_) {}

    return false;
  }

  // harvest single block: go, dig, wait
  async _harvestBlock(blockPos) {
    const pos = new Vec3(Math.floor(blockPos.x) + 0.5, Math.floor(blockPos.y), Math.floor(blockPos.z) + 0.5);
    try {
      await this._gotoBlock(pos, 20000);
    } catch (e) {
      this._emitDebug('Failed to goto harvest pos', pos, e.message || e);
      return false;
    }

    // ensure we pass a Vec3 to bot.blockAt() (some mineflayer versions expect a Vec3-like object)
    const block = this.bot.blockAt(new Vec3(Math.floor(blockPos.x), Math.floor(blockPos.y), Math.floor(blockPos.z)));
    if (!block) return false;

    try {
      await this.bot.dig(block);
      return true;
    } catch (e) {
      this._emitDebug('dig failed at', blockPos, e.message || e);
      return false;
    }
  }

  // sow single block: go to farmland block, equip seeds and place
  async _sowAt(farmlandPos) {
    const above = new Vec3(farmlandPos.x, farmlandPos.y + 1, farmlandPos.z);
    try {
      await this._gotoBlock(new Vec3(farmlandPos.x + 0.5, farmlandPos.y, farmlandPos.z + 0.5), 20000);
    } catch (e) {
      this._emitDebug('Failed to goto sow pos', farmlandPos, e.message || e);
      return false;
    }

    // find seed in inventory
    const seed = this.bot.inventory.items().find(it => it && it.name && (it.name.includes('seeds') || it.name.includes('wheat_seeds') || it.name.includes('carrot') || it.name.includes('potato')));
    if (!seed) {
      this._emitDebug('No seeds to sow');
      return false;
    }

    try {
      await this.bot.equip(seed, 'hand');
  // ensure we pass a Vec3 to bot.blockAt()
  const blockBelow = this.bot.blockAt(new Vec3(Math.floor(farmlandPos.x), Math.floor(farmlandPos.y), Math.floor(farmlandPos.z)));
      if (!blockBelow) return false;
      await this.bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
      return true;
    } catch (e) {
      this._emitDebug('Failed to plant at', farmlandPos, e.message || e);
      return false;
    }
  }

  // scan area for grown crops and empty farmland to plant
  _scanArea(area) {
    if (!area || !area.start || !area.end) return { harvest: [], sow: [] };

    const startX = Math.min(area.start.x, area.end.x);
    const endX = Math.max(area.start.x, area.end.x);
    const startZ = Math.min(area.start.z, area.end.z);
    const endZ = Math.max(area.start.z, area.end.z);

    const harvest = [];
    const sow = [];

    // estimate baseY near bot
    const baseY = Math.floor((this.bot.entity && this.bot.entity.position) ? this.bot.entity.position.y : 64);

    for (let x = startX; x <= endX; x++) {
      for (let z = startZ; z <= endZ; z++) {
        for (let y = baseY + 1; y >= baseY - 2; y--) {
          const block = this.bot.blockAt(new Vec3(x, y, z));
          if (!block) continue;
          const name = block.name || '';
          // farmland detection for sowing
          if (name.includes('farmland')) {
            const above = this.bot.blockAt(new Vec3(x, y + 1, z));
            if (!above || above.type === 0) sow.push({ x, y, z });
            break;
          }
          // crop detection
          if (/(wheat|carrot|potato|carrots|potatoes)/i.test(name)) {
            if (this._isFullyGrown(block)) harvest.push({ x, y, z });
            break;
          }
        }
      }
    }

    return { harvest, sow };
  }

  // getHoe - simplified: check inventory or tools chest using chestRegistry open container
  async getHoe() {
    this._emitDebug('getHoe: checking inventory');
    const inventory = this.bot.inventory.items();
    if (inventory.some(i => i && i.name && i.name.includes('_hoe'))) return true;

    const chestEntry = await this.bot.chestRegistry?.getChest('tools');
    if (!chestEntry) {
      this._emitDebug('getHoe: no tools chest registered');
      return false;
    }

    try {
      await this._gotoBlock(new Vec3(chestEntry.x + 0.5, chestEntry.y, chestEntry.z + 0.5), 30000);
    } catch (e) {
      this._emitDebug('getHoe: cannot reach tools chest', e.message || e);
      return false;
    }

    // try open container (robustly handled by DepositBehavior.openChestSafe if available)
    let container = null;
    try {
      if (this.bot.depositBehavior && typeof this.bot.depositBehavior.openChestSafe === 'function') {
        container = await this.bot.depositBehavior.openChestSafe(this.bot.blockAt(new Vec3(chestEntry.x, chestEntry.y, chestEntry.z)));
      } else if (typeof this.bot.openContainer === 'function') {
        container = await this.bot.openContainer(this.bot.blockAt(new Vec3(chestEntry.x, chestEntry.y, chestEntry.z)));
      } else if (typeof this.bot.openChest === 'function') {
        container = await this.bot.openChest(this.bot.blockAt(new Vec3(chestEntry.x, chestEntry.y, chestEntry.z)));
      }
    } catch (e) {
      this._emitDebug('getHoe: open chest failed', e.message || e);
    }

    if (!container) {
      this._emitDebug('getHoe: no container opened at tools chest');
      return false;
    }

    try {
      await new Promise(r => setTimeout(r, 300));
      const items = (typeof container.containerItems === 'function') ? container.containerItems() : (typeof container.items === 'function' ? container.items() : (container.window && Array.isArray(container.window.slots) ? container.window.slots.filter(Boolean) : []));
      this._emitDebug('getHoe: chest items', items.map(i => `${i?.name}(${i?.type})`));

      const hoeIds = [
        this.mcData?.itemsByName?.wooden_hoe?.id,
        this.mcData?.itemsByName?.stone_hoe?.id,
        this.mcData?.itemsByName?.iron_hoe?.id,
        this.mcData?.itemsByName?.golden_hoe?.id,
        this.mcData?.itemsByName?.diamond_hoe?.id,
        this.mcData?.itemsByName?.netherite_hoe?.id
      ].filter(Boolean);

      const hoeItem = items.find(it => it && (hoeIds.includes(it.type) || (it.name && it.name.includes('_hoe'))));
      if (!hoeItem) {
        this._emitDebug('getHoe: no hoe present in container');
        if (container && typeof container.close === 'function') container.close();
        return false;
      }

      // withdraw
      if (typeof container.withdraw === 'function') {
        await container.withdraw(hoeItem.type, null, 1);
      } else if (typeof container.take === 'function') {
        await container.take(hoeItem.type);
      }
      if (container && typeof container.close === 'function') container.close();
      await new Promise(r => setTimeout(r, 400));
      const got = this.bot.inventory.items().some(i => i && i.name && i.name.includes('_hoe'));
      this._emitDebug('getHoe: post-withdraw inventory has hoe?', got);
      return got;
    } catch (e) {
      this._emitDebug('getHoe: error during chest ops', e.message || e);
      try { if (container && typeof container.close === 'function') container.close(); } catch (_) {}
      return false;
    }
  }

  // main farming loop modelled after official example but scanning defined area
  async startFarming(area) {
    if (!this.enabled && typeof this.enable === 'function') this.enable();
    if (this.isWorking) return;
    this.isWorking = true;

    if (!area && this.farmingArea) area = this.farmingArea;
    if (!area) {
      this.logger.info('[Farm] No farming area provided');
      this.isWorking = false;
      return;
    }

    // loop until disabled
    try {
      while (this.enabled && this.isWorking) {
        // ensure hoe present
        if (!await this.getHoe()) {
          this._emitDebug('startFarming: no hoe available, aborting loop');
          this.isWorking = false;
          return;
        }

        // do harvesting then sowing pass using a local scan like official script
        let didWork = false;

        // harvest pass
        while (true) {
          const { harvest } = this._scanArea(area);
          if (!harvest || harvest.length === 0) break;
          didWork = true;
          // harvest first found (keeps it simple and similar to official loop)
          const toHarvest = harvest.shift();
          await this._harvestBlock(toHarvest);
          // small delay between actions
          await new Promise(r => setTimeout(r, 200));
        }

        // sow pass
        while (true) {
          const { sow } = this._scanArea(area);
          if (!sow || sow.length === 0) break;
          // ensure seeds exist before trying to plant
          const seed = this.bot.inventory.items().find(it => it && it.name && (it.name.includes('seeds') || it.name.includes('wheat_seeds') || it.name.includes('carrot') || it.name.includes('potato')));
          if (!seed) break;
          didWork = true;
          const toSow = sow.shift();
          await this._sowAt(toSow);
          await new Promise(r => setTimeout(r, 200));
        }

        // proactive deposit if inventory large or if we did any work and want to keep inventory tidy
        if ((this._shouldDeposit() || didWork) && this.bot.depositBehavior && typeof this.bot.depositBehavior.depositAll === 'function') {
          try {
            await this.bot.depositBehavior.depositAll();
          } catch (e) {
            this._emitDebug('startFarming: depositAll failed', e.message || e);
          }
        }

        if (!didWork) {
          // nothing to do: move center, wait, then retry (official script uses setTimeout loop)
          const centerX = Math.floor((area.start.x + area.end.x) / 2);
          const centerZ = Math.floor((area.start.z + area.end.z) / 2);
          const preferredY = (this.bot.entity && this.bot.entity.position) ? Math.floor(this.bot.entity.position.y) : (area.start.y || 64);
        
          try {
            await this._gotoBlock(new Vec3(centerX + 0.5, preferredY, centerZ + 0.5), 15000);
          } catch (e) {
            this._emitDebug('startFarming: failed to move to center', e.message || e);
          }
          // sleep idle interval
          await new Promise(r => setTimeout(r, this.idleScanIntervalMs));
        }
      }
    } catch (err) {
      this.logger.error(`[Farm] Error while farming: ${err.message || err}`);
    } finally {
      this.isWorking = false;
    }
  }

  _shouldDeposit() {
    try {
      const total = this.bot.inventory.items().reduce((s, it) => s + (it.count || 0), 0);
      return total > 50;
    } catch (e) {
      return false;
    }
  }
}