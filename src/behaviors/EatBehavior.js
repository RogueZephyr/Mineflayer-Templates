import mcDataLoader from 'minecraft-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Use absolute path from this file's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const foodPath = path.join(__dirname, '..', 'config', 'foodList.json');
const foodList = JSON.parse(fs.readFileSync(foodPath, 'utf-8'));

export default class EatBehavior {
  constructor(bot, logger, master) {
    this.bot = bot;
    this.logger = logger;
    this.master = master;
    this.hungerThreshold = 16;

    // ====== NEW: Add enable/disable flag ======
    this.enabled = true;

    this.mcData = null;
    if (this.bot.version) {
      this.mcData = mcDataLoader(this.bot.version);
    } else {
      this.bot.once('spawn', () => {
        this.mcData = mcDataLoader(this.bot.version);
      });
    }
  }

  // ====== NEW: Enable/disable functions ======
  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  async checkHunger() {
    if (!this.enabled || !this.bot.isAlive || !this.bot.entity) return;

    if (typeof this.bot.food !== 'number') {
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('eat')) {
        this.logger.warn('[Eat] Cannot read hunger level yet (bot not spawned?)');
      }
      return;
    }

    if (this.bot.food >= this.hungerThreshold) {
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('eat')) {
        this.logger.info(`[Eat] Hunger level okay: ${this.bot.food}`);
      }
      return;
    }

    const foodItem = this.findEdibleItem();
    if (!foodItem) {
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('eat')) {
        this.logger.warn('[Eat] No edible food found!');
      }
      if (this.master) this.bot.chat("I'm hungry, but I have no allowed food!");
      return;
    }

    try {
      await this.bot.equip(foodItem, 'hand').catch(err => {
        if (this.bot.debugTools && this.bot.debugTools.isEnabled('eat')) {
          this.logger.error(`[Eat] Failed to equip ${foodItem.name}: ${err.message}`);
        }
        return;
      });

      await this.bot.consume().catch(err => {
        if (this.bot.debugTools && this.bot.debugTools.isEnabled('eat')) {
          this.logger.error(`[Eat] Failed to consume ${foodItem.name}: ${err.message}`);
        }
      });

      if (this.bot.debugTools && this.bot.debugTools.isEnabled('eat')) {
        this.logger.success(`[Eat] Finished eating ${foodItem.name}`);
      }
    } catch (err) {
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('eat')) {
        this.logger.error(`[Eat] Unexpected error: ${err.message}`);
      }
    }
  }

  findEdibleItem() {
    // ====== NEW: Defensive check for inventory ======
    if (!this.bot.inventory) return null;
    const items = this.bot.inventory.items();
    const edible = items.filter(item => foodList.edible.includes(item.name));
    return edible.length > 0 ? edible[0] : null;
  }
}
