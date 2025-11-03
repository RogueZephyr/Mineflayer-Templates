import mcDataLoader from 'minecraft-data';
import fs from 'fs';
import path from 'path';

const foodPath = path.resolve('./src/config/foodList.json');
const foodList = JSON.parse(fs.readFileSync(foodPath, 'utf-8'));


export default class EatBehavior {
  constructor(bot, logger, master) {
    this.bot = bot;
    this.logger = logger;
    this.mcData = null;
    this.hungerThreshold = 15;
    this.master = master

    if (this.bot.version) {
      this.mcData = mcDataLoader(this.bot.version);
    } else {
      this.bot.once('spawn', () => {
        this.mcData = mcDataLoader(this.bot.version);
      });
    }
  }

  async checkHunger() {
    if (!this.bot.food) {
      this.logger.warn('Cannot read hunger level yet (bot not spawned?)');
      return;
    }

    if (this.bot.food >= this.hungerThreshold) {
      //this.logger.info(`No need to eat tight now. ${this.bot.food}`);
      return;
    }

    const foodItem = this.findEdibleItem();

    if (!foodItem) {
      this.logger.warn('No edible food found in inventory!');
      this.bot.chat("I'm hungry, but I have no allowed food!");
      return;
    }

    try {
      this.logger.info(`Eating ${foodItem.name}...`);
      this.bot.chat(`Eating ${foodItem.name}...`)
      await this.bot.equip(foodItem, 'hand');
      await this.bot.consume();
      this.logger.success(`Finished eating ${foodItem.name}`);
    } catch (err) {
      this.logger.error(`Failed to eat: ${err}`);
    }
  }

  findEdibleItem() {
    const items = this.bot.inventory.items();
    const edible = items.filter(item => foodList.edible.includes(item.name));
    return edible.length > 0 ? edible[0] : null;
  }
}
