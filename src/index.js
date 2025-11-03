import ConfigLoader from './core/ConfigLoader.js';
import BotController from './core/BotController.js';

const config = ConfigLoader.loadConfig('./src/config.json');
const bot1 = new BotController(config);
const bot2 = new BotController(config);
const bot3 = new BotController(config);
bot1.start();
