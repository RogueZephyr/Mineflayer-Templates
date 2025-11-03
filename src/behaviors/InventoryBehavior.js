// src/behaviors/InventoryBehavior.js
import Logger from '../utils/logger.js';
import chalk from 'chalk';
import pkg from 'mineflayer-pathfinder';
const { Movements, goals } = pkg;
const { GoalNear } = goals;
import fs from 'fs';
import path from 'path';

import { Vec3 } from 'vec3';

const logLabel = chalk.green('[Inventory]');

const categoriesPath = path.resolve('./src/config/itemCategories.json');
const itemCategories = JSON.parse(fs.readFileSync(categoriesPath, 'utf-8'));

export default class InventoryBehavior {
/** 
 * @param {object} chestPos - { x, y, z } of the chest
 * @param {string} type - 'all', exact item name, or category ('wood', 'ores', 'resources')
*/
  constructor(bot, logger = new Logger()) {
    this.bot = bot;
    this.logger = logger;
    this.enabled = true;

    // Bind functions if needed
    this.getItemCount = this.getItemCount.bind(this);
    this.equipItem = this.equipItem.bind(this);
    this.moveItem = this.moveItem.bind(this);
    this.dropItem = this.dropItem.bind(this);
    this.pickupItem = this.pickupItem.bind(this);
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  // Count total items by name
  getItemCount(itemName) {
    if (!this.enabled) return 0;
    return this.bot.inventory.items().reduce((count, item) => {
      if (item.name === itemName) return count + item.count;
      return count;
    }, 0);
  }

  // Equip an item in hand (tools, weapons)
  async equipItem(itemName, destination = 'hand') {
    if (!this.enabled) return false;

    try {
      const item = this.bot.inventory.items().find(i => i.name === itemName);
      if (!item) {
        this.logger.warn(`${logLabel} No ${itemName} in inventory`);
        return false;
      }

      await this.bot.equip(item, destination);
      this.logger.info(`${logLabel} Equipped ${itemName} in ${destination}`);
      return true;
    } catch (err) {
      this.logger.error(`${logLabel} Failed to equip ${itemName}: ${err}`);
      return false;
    }
  }

  // Move an item from one slot to another
  async moveItem(fromSlot, toSlot) {
    if (!this.enabled) return false;
    try {
      await this.bot.transferSlot(fromSlot, toSlot, 64);
      this.logger.info(`${logLabel} Moved item from slot ${fromSlot} to ${toSlot}`);
      return true;
    } catch (err) {
      this.logger.error(`${logLabel} Failed to move item: ${err}`);
      return false;
    }
  }

  // Drop a specific item
  async dropItem(type) {
    if (!this.enabled) return false;

    let itemsToDrop = [];

    switch(type.toLowerCase()) {
        case 'all':
        // drop everything in inventory including armor and off-hand
        itemsToDrop = this.bot.inventory.items();
        // also unequip armor
        try {
          const armorSlots = ['head', 'torso', 'legs', 'feet', 'off-hand'];
          for (const slot of armorSlots) {
            const equipped = this.bot.inventory.slots[this.bot.getEquipmentDestSlot(slot)];
            if (equipped) {
              await this.bot.unequip(slot);
            }
          }
        } catch (err) {
          this.logger.warn(`[Inventory] Failed to unequip armor: ${err}`);
        }
        // refresh item list after unequipping
        itemsToDrop = this.bot.inventory.items();
        break;
        case 'wood':
        itemsToDrop = this.bot.inventory.items().filter(i => i.name.endsWith('_log') || i.name.endsWith('_wood'));
        break;
        case 'ores':
        itemsToDrop = this.bot.inventory.items().filter(i =>
            (itemCategories.ores || []).includes(i.name)
        );
        break;
        case 'resources':
        itemsToDrop = this.bot.inventory.items().filter(i =>
            ['iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'copper_ingot', 'coal', 'charcoal'].includes(i.name)
        );
        break;
        default:
        itemsToDrop = this.bot.inventory.items().filter(i => i.name === type);
    }

    if (itemsToDrop.length === 0) {
        this.logger.warn(`[Inventory] No items matching "${type}" to drop`);
        return false;
    }

    for (const item of itemsToDrop) {
        try {
        await this.bot.tossStack(item);
        this.logger.info(`[Inventory] Dropped ${item.count} x ${item.name}`);
        } catch (err) {
        this.logger.error(`[Inventory] Failed to drop ${item.name}: ${err}`);
        }
    }

        return true;
    }
    async depositNearest(type = 'all', searchRadius = 15) {
        if (!this.enabled) return false;
        if (!this.bot.pathfinder) {
            this.logger.warn('[Inventory] Pathfinder not available.');
            return false;
        }

        try {
            const mcData = (await import('minecraft-data')).default(this.bot.version);
            const defaultMovements = new Movements(this.bot, mcData);
            this.bot.pathfinder.setMovements(defaultMovements);

            // Find nearest chest/barrel/shulker
            const chestBlocks = this.bot.findBlocks({
            matching: block => {
                const name = block.name;
                return (
                name.includes('chest') ||
                name.includes('barrel') ||
                name.includes('shulker_box')
                );
            },
            maxDistance: searchRadius,
            count: 10,
            });

            if (!chestBlocks.length) {
            this.logger.warn(`[Inventory] No container found within ${searchRadius} blocks.`);
            return false;
            }

            // Pick nearest container
            const nearest = chestBlocks
            .map(pos => ({
                pos,
                distance: this.bot.entity.position.distanceTo(pos),
            }))
            .sort((a, b) => a.distance - b.distance)[0];

            this.logger.info(`[Inventory] Nearest container found at ${nearest.pos}`);

            // Move to chest
            const goal = new GoalNear(nearest.pos.x, nearest.pos.y, nearest.pos.z, 1);
            await this.bot.pathfinder.goto(goal);

            // Open chest
            const chestBlock = this.bot.blockAt(nearest.pos);
            if (!chestBlock) throw new Error('Chest not found at detected position.');

            const chest = await this.bot.openContainer(chestBlock);

            // Determine what to deposit
            let itemsToDeposit = [];
            const items = this.bot.inventory.items();

            if (type === 'all') itemsToDeposit = items;
            else if (type === 'wood') itemsToDeposit = items.filter(i => i.name.includes('log') || i.name.includes('wood'));
            else if (type === 'ores')
            itemsToDeposit = items.filter(i =>
                ['coal', 'iron', 'gold', 'diamond', 'emerald', 'lapis', 'redstone', 'netherite'].some(res =>
                i.name.includes(res)
                )
            );
            else if (type === 'resources')
            itemsToDeposit = items.filter(i =>
                ['raw', 'ingot', 'gem', 'diamond', 'emerald', 'lapis', 'redstone', 'netherite'].some(res =>
                i.name.includes(res)
                )
            );
            else itemsToDeposit = items.filter(i => i.name === type);

            if (itemsToDeposit.length === 0) {
            this.logger.warn(`[Inventory] No items to deposit for type "${type}"`);
            chest.close();
            return false;
            }

            for (const item of itemsToDeposit) {
            try {
                await chest.deposit(item.type, null, item.count);
                this.logger.info(`[Inventory] Deposited ${item.count}x ${item.name}`);
            } catch (err) {
                this.logger.error(`[Inventory] Could not deposit ${item.name}: ${err.message}`);
            }
            }

            chest.close();
            return true;
        } catch (err) {
            this.logger.error(`[Inventory] depositNearest() failed: ${err}`);
            return false;
        }
        }


    async depositToChest(chestPos, type = 'all') {
        if (!this.enabled) return false;
        if (!this.bot.pathfinder) {
            this.logger.warn('[Inventory] Pathfinder not available.');
            return false;
        }

        try {
            // Dynamic import for minecraft-data (ESM-safe)
            const mcData = await import('minecraft-data').then(m => m.default(this.bot.version));

            // Create Movements and set them
            const defaultMovements = new Movements(this.bot, mcData);
            this.bot.pathfinder.setMovements(defaultMovements);

            // Ensure we have a Vec3-like point (object with numeric x,y,z)
            const Vec3Module = await import('vec3').then(m => m.default || m);
            const point = new Vec3Module(Math.floor(chestPos.x), Math.floor(chestPos.y), Math.floor(chestPos.z));

            // Find an actual chest block near the provided point (within 5 blocks)
            const targetChest = this.bot.findBlock({
            matching: b => b && b.name && b.name.includes('chest'),
            maxDistance: 5,
            point
            });

            if (!targetChest) {
            throw new Error('No chest found near provided coordinates.');
            }

            // If already near enough, skip pathfinding
            const dist = this.bot.entity.position.distanceTo(targetChest.position);
            if (dist > 2.2) {
            this.logger.info(`[Inventory] Moving ${dist.toFixed(1)} blocks to chest...`);
            const goal = new GoalNear(targetChest.position.x, targetChest.position.y, targetChest.position.z, 1);
            await this.bot.pathfinder.goto(goal);
            } else {
            this.logger.info('[Inventory] Already near chest, skipping movement.');
            }

            // Open the chest container
            const chestWindow = await this.bot.openChest(targetChest);
            if (!chestWindow) throw new Error('Failed to open chest.');

            // Choose items to deposit
            const items = this.bot.inventory.items();
            let itemsToDeposit = [];

            switch ((type || 'all').toLowerCase()) {
            case 'all':
                itemsToDeposit = items.slice(); // copy
                break;
            case 'wood':
                itemsToDeposit = items.filter(i => i.name.includes('log') || i.name.includes('wood'));
                break;
            case 'ores':
                itemsToDeposit = items.filter(i =>
                ['coal', 'iron', 'gold', 'diamond', 'emerald', 'lapis', 'redstone', 'netherite', 'copper'].some(res => i.name.includes(res))
                );
                break;
            case 'resources':
                itemsToDeposit = items.filter(i =>
                ['raw', 'ingot', 'gem', 'diamond', 'emerald', 'lapis', 'redstone', 'netherite', 'coal'].some(res => i.name.includes(res))
                );
                break;
            default:
                itemsToDeposit = items.filter(i => i.name === type);
            }

            if (itemsToDeposit.length === 0) {
            this.logger.warn(`[Inventory] No items found matching type: ${type}`);
            chestWindow.close();
            return false;
            }

            // Deposit with a small delay between each operation to prevent desyncs
            for (const item of itemsToDeposit) {
            try {
                await chestWindow.deposit(item.type, null, item.count);
                this.logger.info(`[Inventory] Deposited ${item.name} x${item.count}`);
                // small delay
                await new Promise(res => setTimeout(res, 200));
            } catch (err) {
                this.logger.error(`[Inventory] Failed to deposit ${item.name}: ${err.message || err}`);
            }
            }

            chestWindow.close();
            this.logger.success('[Inventory] Finished depositing successfully!');
            return true;
        } catch (err) {
            this.logger.error(`[Inventory] Failed to deposit: ${err.message || err}`);
            return false;
        }
        }



    // Pickup item from the ground (simplified)
    async pickupItem(itemName, maxDistance = 5) {
        if (!this.enabled) return false;

        const target = Object.values(this.bot.entities)
            .filter(e => e.itemStack && e.itemStack.name === itemName)
            .sort((a, b) => a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position))[0];

        if (!target) {
            this.logger.warn(`${logLabel} No ${itemName} nearby to pick up`);
            return false;
        }

        try {
            const pickupPos = new Vec3(target.position.x, target.position.y, target.position.z);
            await this.bot.pathfinder.goto(new GoalNear(pickupPos.x, pickupPos.y, pickupPos.z, 1));
            await this.bot.collectBlock.collect(target);
            this.logger.info(`${logLabel} Picked up ${itemName}`);
            return true;
        } catch (err) {
            this.logger.error(`${logLabel} Failed to pick up ${itemName}: ${err}`);
            return false;
        }
    }

    // Print a simple inventory summary
    logInventory() {
        const items = this.bot.inventory.items();
        if (items.length === 0) {
            this.logger.info(`${logLabel} Inventory is empty`);
        } else {
            this.logger.info(`${logLabel} Inventory:`);
            items.forEach(i => this.logger.info(` - ${i.name} x${i.count}`));
        }
    }
}
