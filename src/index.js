import ConfigLoader from './core/ConfigLoader.js';
import BotController from './core/BotController.js';

const config = ConfigLoader.loadConfig('./src/config.json');
const botController = new BotController(config);
botController.start();
