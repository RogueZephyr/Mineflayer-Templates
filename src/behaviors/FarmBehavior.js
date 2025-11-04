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
    this.logger.info(`[Farm][${this.bot.username}] Behavior enabled; look paused`);
  }

  disable() {
    this.enabled = false;
    this.isWorking = false;
    if (this.lookBehavior) this.lookBehavior.resume();
    this.logger.info(`[Farm][${this.bot.username}] Behavior disabled; look resumed`);
  }

  _emitDebug(...args) {
    // Format all arguments into a single string
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
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('farm')) {
        console.log('[DEBUG:Farm]', message);
        this.bot.debugTools.log('farm', message);
      }
    } catch (_) {}
  }

  // simple robust goto using pathfinder if available
  async _gotoBlock(pos, timeoutMs = 30000, task = 'farm') {
    if (!pos) throw new Error('_gotoBlock: pos required');

    // Use centralized pathfinding utility if available
    if (this.bot.pathfindingUtil) {
      try {
        await this.bot.pathfindingUtil.gotoBlock(pos, timeoutMs, task);
        return;
      } catch (e) {
        this._emitDebug('pathfindingUtil.gotoBlock failed:', e.message || e);
        throw e;
      }
    }

    // Fallback: Legacy pathfinding code for backwards compatibility
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

  // harvest single block: go, dig, replant immediately
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
      // harvest the crop
      await this.bot.dig(block);
      await new Promise(r => setTimeout(r, 150));

      // immediately replant if we have seeds
      const seed = this.bot.inventory.items().find(it => {
        if (!it || !it.name) return false;
        // Match only plantable items (seeds, carrot, potato - but NOT poisonous_potato)
        return it.name.endsWith('_seeds') || 
               it.name === 'wheat_seeds' || 
               it.name === 'carrot' || 
               it.name === 'potato' ||
               it.name === 'beetroot_seeds' ||
               it.name === 'melon_seeds' ||
               it.name === 'pumpkin_seeds';
      });
      if (seed) {
        // get the farmland block below where we just harvested
        const farmlandBlock = this.bot.blockAt(new Vec3(Math.floor(blockPos.x), Math.floor(blockPos.y) - 1, Math.floor(blockPos.z)));
        if (farmlandBlock && farmlandBlock.name && farmlandBlock.name.includes('farmland')) {
          try {
            // ensure seed is equipped (might be in off-hand already)
            const equippedHand = this.bot.heldItem;
            const equippedOffHand = this.bot.inventory.slots[45]; // off-hand slot
            
            const isPlantableEquipped = equippedHand && (
              equippedHand.name.endsWith('_seeds') || 
              equippedHand.name === 'wheat_seeds' ||
              equippedHand.name === 'carrot' || 
              equippedHand.name === 'potato'
            );
            
            if (!isPlantableEquipped) {
              // if seed isn't in main hand, equip it temporarily
              await this.bot.equip(seed, 'hand');
            }
            
            await this.bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
            this._emitDebug('Replanted at', blockPos);
            
            // re-equip hoe if we switched away from it
            const hoe = this.bot.inventory.items().find(i => i && i.name && i.name.includes('_hoe'));
            if (hoe && (!equippedHand || !equippedHand.name.includes('_hoe'))) {
              await this.bot.equip(hoe, 'hand');
            }
          } catch (e) {
            this._emitDebug('Failed to replant at', blockPos, e.message || e);
          }
        }
      }
      
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
    const seed = this.bot.inventory.items().find(it => {
      if (!it || !it.name) return false;
      // Match only plantable items (seeds, carrot, potato - but NOT poisonous_potato)
      return it.name.endsWith('_seeds') || 
             it.name === 'wheat_seeds' || 
             it.name === 'carrot' || 
             it.name === 'potato' ||
             it.name === 'beetroot_seeds' ||
             it.name === 'melon_seeds' ||
             it.name === 'pumpkin_seeds';
    });
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

    // Limit scan results to prevent overload
    const maxCrops = 50;
    let cropsFound = 0;

    for (let x = startX; x <= endX; x++) {
      if (cropsFound >= maxCrops) break;
      
      for (let z = startZ; z <= endZ; z++) {
        if (cropsFound >= maxCrops) break;
        
        for (let y = baseY + 1; y >= baseY - 2; y--) {
          const block = this.bot.blockAt(new Vec3(x, y, z));
          if (!block) continue;
          const name = block.name || '';
          // farmland detection for sowing
          if (name.includes('farmland')) {
            const above = this.bot.blockAt(new Vec3(x, y + 1, z));
            if (!above || above.type === 0) {
              sow.push({ x, y, z });
              cropsFound++;
            }
            break;
          }
          // crop detection
          if (/(wheat|carrot|potato|carrots|potatoes)/i.test(name)) {
            if (this._isFullyGrown(block)) {
              harvest.push({ x, y, z });
              cropsFound++;
            }
            break;
          }
        }
      }
    }

    return { harvest, sow };
  }

  // equip hoe in main hand and seeds in off-hand for efficient farming
  // collect dropped items in the farming area to prevent lag
  async _collectDroppedItems(area) {
    if (!area || !area.start || !area.end) return 0;
    if (!this.bot.entity || !this.bot.entity.position) return 0;

    const startX = Math.min(area.start.x, area.end.x);
    const endX = Math.max(area.start.x, area.end.x);
    const startY = Math.min(area.start.y || 60, area.end.y || 70);
    const endY = Math.max(area.start.y || 60, area.end.y || 70);
    const startZ = Math.min(area.start.z, area.end.z);
    const endZ = Math.max(area.start.z, area.end.z);

    // find all dropped items within the farming area
    const droppedItems = Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity.type !== 'object' || entity.name !== 'item') return false;
      if (!entity.position) return false;
      
      const pos = entity.position;
      return pos.x >= startX && pos.x <= endX &&
             pos.y >= startY - 2 && pos.y <= endY + 2 &&
             pos.z >= startZ && pos.z <= endZ;
    });

    if (droppedItems.length === 0) return 0;

    this._emitDebug(`Found ${droppedItems.length} dropped items in farming area`);
    let collected = 0;

    // collect each dropped item
    for (const itemEntity of droppedItems) {
      if (!this.enabled || !this.isWorking) break;
      
      try {
        // check if item still exists (might have been picked up or despawned)
        if (!this.bot.entities[itemEntity.id]) continue;
        
        const itemPos = itemEntity.position;
        await this._gotoBlock(itemPos, 10000);
        
        // wait a bit for auto-pickup to happen
        await new Promise(r => setTimeout(r, 500));
        collected++;
      } catch (e) {
        this._emitDebug('Failed to collect item:', e.message || e);
      }
    }

    if (collected > 0) {
      this._emitDebug(`Collected ${collected} dropped items`);
    }

    return collected;
  }

  // equip hoe in main hand and seeds in off-hand for efficient farming
  async _equipFarmingTools() {
    try {
      // equip hoe in main hand
      const hoe = this.bot.inventory.items().find(i => i && i.name && i.name.includes('_hoe'));
      if (hoe) {
        await this.bot.equip(hoe, 'hand');
        this._emitDebug('Equipped hoe in main hand');
      }
    } catch (e) {
      this._emitDebug('Failed to equip farming tools:', e.message || e);
    }
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
      this.logger.info(`[Farm][${this.bot.username}] No farming area provided`);
      this.isWorking = false;
      return;
    }

    // Assign work zone if coordinator is available
    let workArea = area;
    if (this.bot.coordinator) {
      // Get all active bots (regardless of position)
      const activeBots = this.bot.coordinator.getAllBotPositions();
      const botCount = activeBots.length;
      
      this._emitDebug(`Detected ${botCount} active bot(s)`);
      
      // Check if we already have a work zone assigned
      const existingZone = this.bot.coordinator.getWorkZone(this.bot.username, 'farm');
      
      if (botCount > 1) {
        // Multiple bots - need to divide area
        if (existingZone) {
          workArea = existingZone;
          this._emitDebug('Using existing work zone assignment');
        } else {
          // Get list of all bot IDs for stable zone assignment
          const botIds = activeBots.map(b => b.botId).sort(); // Sort for consistent ordering
          this._emitDebug(`Bot IDs: ${JSON.stringify(botIds)}, My ID: ${this.bot.username}`);
          
          const myIndex = botIds.indexOf(this.bot.username);
          this._emitDebug(`My index in sorted list: ${myIndex}`);
          
          if (myIndex >= 0) {
            // Divide area among all bots
            const zones = this.bot.coordinator.divideArea(area, botCount, this.bot.username);
            this._emitDebug(`Zones created: ${zones.length}`);
            if (myIndex < zones.length) {
              workArea = zones[myIndex];
              this.bot.coordinator.assignWorkZone(this.bot.username, 'farm', workArea);
              this._emitDebug(`Assigned to work zone ${myIndex + 1}/${botCount} - X: ${workArea.start.x}-${workArea.end.x}, Z: ${workArea.start.z}-${workArea.end.z}`);
            }
          }
        }
      } else {
        // Single bot - use full area
        this._emitDebug('Single bot mode - using full farming area');
      }
    }

    // Add staggered start delay to prevent all bots from working simultaneously
    if (this.bot.coordinator) {
      const activeBots = this.bot.coordinator.getAllBotPositions();
      const botIds = activeBots.map(b => b.botId).sort();
      const myIndex = botIds.indexOf(this.bot.username);
      
      if (myIndex > 0) {
        const delay = myIndex * 1500; // 1.5 second stagger per bot
        this._emitDebug(`Staggering start by ${delay}ms to reduce load`);
        await new Promise(r => setTimeout(r, delay));
      }
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

        // equip hoe in main hand for harvesting
        await this._equipFarmingTools();

        // do harvesting then sowing pass using a local scan like official script
        let didWork = false;

        // harvest pass - _harvestBlock now replants immediately after harvesting
        while (true) {
          // Check if still enabled/working before each iteration
          if (!this.enabled || !this.isWorking) break;
          
          const { harvest } = this._scanArea(workArea);
          if (!harvest || harvest.length === 0) break;
          
          // Find an unclaimed block to harvest
          let toHarvest = null;
          for (const block of harvest) {
            if (!this.bot.coordinator || !this.bot.coordinator.isBlockClaimed(block, this.bot.username)) {
              if (this.bot.coordinator) {
                if (this.bot.coordinator.claimBlock(this.bot.username, block, 'harvest')) {
                  toHarvest = block;
                  break;
                }
              } else {
                toHarvest = block;
                break;
              }
            }
          }
          
          if (!toHarvest) break; // No unclaimed blocks
          
          didWork = true;
          await this._harvestBlock(toHarvest);
          
          // Release claim after harvest
          if (this.bot.coordinator) {
            this.bot.coordinator.releaseBlock(toHarvest);
          }
          
          // Check again after harvest
          if (!this.enabled || !this.isWorking) break;
          
          // small delay between actions
          await new Promise(r => setTimeout(r, 250));
        }

        // manual sow pass for any remaining empty farmland
        // Check if still enabled before starting sow pass
        if (!this.enabled || !this.isWorking) {
          this._emitDebug('Stopping: disabled during harvest pass');
        } else {
          const { sow } = this._scanArea(workArea);
          if (sow && sow.length > 0) {
            // ensure seeds exist before trying to plant
            const seed = this.bot.inventory.items().find(it => it && it.name && (it.name.includes('seeds') || it.name.includes('wheat_seeds') || it.name.includes('carrot') || it.name.includes('potato')));
            if (seed) {
              this._emitDebug(`Found ${sow.length} empty farmland spots to plant`);
              for (const toSow of sow) {
                // Check if still enabled before each plant
                if (!this.enabled || !this.isWorking) break;
                
                // Check if block is claimed
                if (this.bot.coordinator && this.bot.coordinator.isBlockClaimed(toSow, this.bot.username)) {
                  continue; // Skip claimed blocks
                }
                
                // Claim block
                if (this.bot.coordinator) {
                  if (!this.bot.coordinator.claimBlock(this.bot.username, toSow, 'plant')) {
                    continue; // Failed to claim
                  }
                }
                
                didWork = true;
                await this._sowAt(toSow);
                
                // Release claim
                if (this.bot.coordinator) {
                  this.bot.coordinator.releaseBlock(toSow);
                }
                
                await new Promise(r => setTimeout(r, 200));
              }
            }
          }
        }

        // collect dropped items within 3 blocks but only within work zone (delegated to ItemCollectorBehavior)
        try {
          if (this.bot.itemCollector && typeof this.bot.itemCollector.collectOnce === 'function') {
            // Only collect items within 3 blocks of bot's current position AND within their work zone
            await this.bot.itemCollector.collectOnce({ radius: 3, workZone: workArea });
          } else if (typeof this._collectDroppedItems === 'function') {
            // fallback to local method if collector not available
            await this._collectDroppedItems(workArea);
          }
        } catch (e) {
          this._emitDebug('startFarming: item collection failed', e.message || e);
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
          const centerX = Math.floor((workArea.start.x + workArea.end.x) / 2);
          const centerZ = Math.floor((workArea.start.z + workArea.end.z) / 2);
          const preferredY = (this.bot.entity && this.bot.entity.position) ? Math.floor(this.bot.entity.position.y) : (workArea.start.y || 64);
        
          try {
            await this._gotoBlock(new Vec3(centerX + 0.5, preferredY, centerZ + 0.5), 15000);
          } catch (e) {
            this._emitDebug('startFarming: failed to move to center', e.message || e);
          }
          // sleep idle interval with randomization to prevent synchronization
          const waitTime = this.idleScanIntervalMs + Math.random() * 2000;
          await new Promise(r => setTimeout(r, waitTime));
        } else {
          // Brief pause between cycles even when working
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (err) {
      this.logger.error(`[Farm][${this.bot.username}] Error while farming: ${err.message || err}`);
    } finally {
      // return hoe to tools chest when done
      await this.returnHoeToChest();
      this.isWorking = false;
    }
  }

  _shouldDeposit() {
    try {
      // count only crops (wheat, carrots, potatoes) not tools or seeds
      const cropItems = this.bot.inventory.items().filter(it => {
        const name = it.name || '';
        return name.includes('wheat') && !name.includes('seeds') || 
               name.includes('carrot') || 
               name.includes('potato') && !name.includes('seeds');
      });
      const total = cropItems.reduce((s, it) => s + (it.count || 0), 0);
      return total > 50;
    } catch (e) {
      return false;
    }
  }

  // return hoe to tools chest when farming is disabled or complete
  async returnHoeToChest() {
    const hoe = this.bot.inventory.items().find(i => i && i.name && i.name.includes('_hoe'));
    if (!hoe) return;

    const chestEntry = await this.bot.chestRegistry?.getChest('tools').catch(() => null);
    if (!chestEntry) {
      this._emitDebug('returnHoe: no tools chest registered');
      return;
    }

    try {
      await this._gotoBlock(new Vec3(chestEntry.x + 0.5, chestEntry.y, chestEntry.z + 0.5), 30000);
      
      let container = null;
      if (this.bot.depositBehavior && typeof this.bot.depositBehavior.openChestSafe === 'function') {
        container = await this.bot.depositBehavior.openChestSafe(this.bot.blockAt(new Vec3(chestEntry.x, chestEntry.y, chestEntry.z)));
      } else if (typeof this.bot.openContainer === 'function') {
        container = await this.bot.openContainer(this.bot.blockAt(new Vec3(chestEntry.x, chestEntry.y, chestEntry.z)));
      } else if (typeof this.bot.openChest === 'function') {
        container = await this.bot.openChest(this.bot.blockAt(new Vec3(chestEntry.x, chestEntry.y, chestEntry.z)));
      }

      if (container) {
        await new Promise(r => setTimeout(r, 250));
        if (typeof container.deposit === 'function') {
          await container.deposit(hoe.type, null, hoe.count);
          this._emitDebug('Returned hoe to tools chest');
        }
        if (typeof container.close === 'function') container.close();
      }
    } catch (e) {
      this._emitDebug('Failed to return hoe to chest:', e.message || e);
    }
  }
}