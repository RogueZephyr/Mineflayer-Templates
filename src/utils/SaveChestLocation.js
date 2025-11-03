// src/utils/SaveChestLocation.js
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import Logger from './logger.js';

const chestFilePath = path.resolve('src/config/chestLocations.json');

export default class SaveChestLocation {
  constructor(bot) {
    this.bot = bot;
    this.logger = new Logger();
    this.chestData = this.loadChests();
  }

  loadChests() {
    try {
      if (!fs.existsSync(chestFilePath)) {
        fs.writeFileSync(chestFilePath, JSON.stringify({}, null, 2));
      }
      const data = fs.readFileSync(chestFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      this.logger.error(`Failed to load chest locations: ${err}`);
      return {};
    }
  }

  saveChests() {
    try {
      fs.writeFileSync(chestFilePath, JSON.stringify(this.chestData, null, 2));
      this.logger.info(`${chalk.green('[ChestRegistry]')} Chest data saved successfully.`);
    } catch (err) {
      this.logger.error(`Error saving chest data: ${err}`);
    }
  }

  setChest(category, position) {
    this.chestData[category] = position;
    this.saveChests();
  }

  getChest(category) {
    return this.chestData[category] || null;
  }

  findNearestChest(maxDistance = 6) {
    const chests = Object.entries(this.chestData);
    let nearest = null;
    let minDist = Infinity;

    for (const [category, pos] of chests) {
      const distance = this.bot.entity.position.distanceTo(pos);
      if (distance < minDist && distance <= maxDistance) {
        minDist = distance;
        nearest = { category, pos };
      }
    }

    return nearest;
  }
}
