import ConfigLoader from './core/ConfigLoader.js';
import BotController from './core/BotController.js';

const config = ConfigLoader.loadConfig('./src/config/config.json');
const bot = new BotController(config);
bot.start();
