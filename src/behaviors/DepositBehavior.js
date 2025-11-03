import fs from 'fs';
import path from 'path';

const categoriesPath = path.resolve('./src/config/itemCategories.json');
const chestLocationsPath = path.resolve('./src/config/chestLocations.json');

const itemCategories = JSON.parse(fs.readFileSync(categoriesPath, 'utf-8'));
const chestLocations = JSON.parse(fs.readFileSync(chestLocationsPath, 'utf-8'));

export default class DepositBehavior {
  constructor(bot, logger) {
    this.bot = bot;
    this.logger = logger;
  }

  // 🔍 Find what category an item belongs to
  getItemCategory(itemName) {
    for (const [category, items] of Object.entries(itemCategories)) {
      if (items.includes(itemName)) return category;
    }
    return null;
  }

  // 📦 Deposit all categorized items into their respective chests
  async depositAllCategorized() {
    const items = this.bot.inventory.items();

    for (const item of items) {
      const category = this.getItemCategory(item.name);
      if (!category) {
        this.logger.info(`[Deposit] Skipping uncategorized item: ${item.name}`);
        continue;
      }

      const chestPos = chestLocations[category];
      if (!chestPos) {
        this.logger.warn(`[Deposit] No chest location set for category: ${category}`);
        continue;
      }

      try {
        const block = this.bot.blockAt(chestPos);
        if (!block || !this.bot.openChest) {
          this.logger.error(`[Deposit] No chest found at ${JSON.stringify(chestPos)}`);
          continue;
        }

        const chest = await this.bot.openChest(block);
        const toDeposit = this.bot.inventory.items().filter(i => i.name === item.name);

        for (const stack of toDeposit) {
          await chest.deposit(stack.type, null, stack.count);
          this.logger.success(`[Deposit] Deposited ${stack.count}x ${stack.name} into ${category} chest`);
        }

        await chest.close();
      } catch (err) {
        this.logger.error(`[Deposit] Failed to deposit ${item.name}: ${err}`);
      }
    }

    this.logger.info('[Deposit] Finished depositing all categorized items.');
  }
}
