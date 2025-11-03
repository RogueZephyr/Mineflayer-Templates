// src/behaviors/InventoryBehavior.js
import Logger from '../utils/logger.js';
import chalk from 'chalk';
import pkg from 'mineflayer-pathfinder';
const { Movements, goals } = pkg;
const { GoalNear } = goals;

const logLabel = chalk.green('[Inventory]');

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
        itemsToDrop = this.bot.inventory.items();
        break;
        case 'wood':
        itemsToDrop = this.bot.inventory.items().filter(i => i.name.endsWith('_log') || i.name.endsWith('_wood'));
        break;
        case 'ores':
        itemsToDrop = this.bot.inventory.items().filter(i =>
            ['raw_iron', 'raw_gold', 'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'raw_copper', 'nether_quartz'].includes(i.name)
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

    async depositToChest(chestPos, type = 'all') {
        if (!this.enabled) return false;
        if (!this.bot.pathfinder) {
            this.logger.warn('[Inventory] Pathfinder not available.');
            return false;
        }

        try {
            // Ensure proper movements
            const mcData = require('minecraft-data')(this.bot.version);
            const defaultMovements = new Movements(this.bot, mcData);
            this.bot.pathfinder.setMovements(defaultMovements);

            // Go near the chest
            const goal = new GoalNear(chestPos.x, chestPos.y, chestPos.z, 1);
            await this.bot.pathfinder.goto(goal);

            // Open chest
            const chestBlock = this.bot.blockAt(chestPos);
            if (!chestBlock) throw new Error('Chest not found at position!');

            const chest = await this.bot.openChest(chestBlock);

            // Determine items to deposit
            let itemsToDeposit = [];
            if (type === 'all') {
                itemsToDeposit = this.bot.inventory.items();
            } else if (type === 'wood') {
                itemsToDeposit = this.bot.inventory.items().filter(i => i.name.includes('log') || i.name.includes('wood'));
            } else if (type === 'ores') {
                itemsToDeposit = this.bot.inventory.items().filter(i =>
                    ['coal', 'iron', 'gold', 'diamond', 'emerald', 'lapis', 'redstone', 'netherite'].some(res => i.name.includes(res))
                );
            } else if (type === 'resources') {
                itemsToDeposit = this.bot.inventory.items().filter(i =>
                    ['raw', 'ingot', 'gem', 'diamond', 'emerald', 'lapis', 'redstone', 'netherite'].some(res => i.name.includes(res))
                );
            } else {
                // Specific item name
                itemsToDeposit = this.bot.inventory.items().filter(i => i.name === type);
            }

            for (const item of itemsToDeposit) {
                await chest.deposit(item.type, null, item.count);
                this.logger.info(`[Inventory] Deposited ${item.name} x${item.count}`);
            }

            chest.close();
            return true;
        } catch (err) {
            this.logger.error(`[Inventory] Failed to deposit: ${err}`);
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
            await this.bot.pathfinder.goto(new GoalNear(
                target.position.x,
                target.position.y,
                target.position.z,
                1
            ));
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
