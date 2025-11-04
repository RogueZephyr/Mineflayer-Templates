import ConfigLoader from './core/ConfigLoader.js';
import BotController from './core/BotController.js';
import BotCoordinator from './core/BotCoordinator.js';
import readline from 'readline';

const config = ConfigLoader.loadConfig('./src/config/config.json');

// Create shared coordinator for multi-bot synchronization
const sharedCoordinator = new BotCoordinator();

// Clean up expired claims every 30 seconds
setInterval(() => {
  sharedCoordinator.cleanup();
}, 30000);

// Interactive prompt for number of bots
async function promptBotCount() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('How many bots to spawn? (default: 1): ', (answer) => {
      rl.close();
      const count = parseInt(answer, 10);
      resolve(isNaN(count) || count < 1 ? 1 : count);
    });

    // Auto-resolve after 10 seconds if no input
    setTimeout(() => {
      rl.close();
      console.log('\nNo input detected, defaulting to 1 bot...');
      resolve(1);
    }, 10000);
  });
}

// Spawn bots with delay
async function spawnBots(count) {
  const bots = [];
  const spawnDelay = 10000; // 10 seconds between spawns

  console.log(`\nSpawning ${count} bot(s) with ${spawnDelay / 1000}s delay between each...\n`);

  for (let i = 0; i < count; i++) {
    if (i > 0) {
      console.log(`Waiting ${spawnDelay / 1000}s before spawning bot ${i + 1}...`);
      await new Promise(resolve => setTimeout(resolve, spawnDelay));
    }

    console.log(`Starting bot ${i + 1}/${count}...`);
    const bot = new BotController(config, null, sharedCoordinator);
    bot.start();
    bots.push(bot);
  }

  console.log(`\nAll ${count} bot(s) started successfully!\n`);
  return bots;
}

// Main execution
const botCount = await promptBotCount();
const activeBots = await spawnBots(botCount);

// Graceful shutdown handler for Ctrl+C
let isShuttingDown = false;

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n\n🛑 Shutting down gracefully...');
  console.log('Sending all bots home and disconnecting...\n');

  const shutdownPromises = activeBots.map(async (botController, index) => {
    try {
      const bot = botController.bot;
      const botName = bot.username || `Bot ${index + 1}`;
      
      console.log(`[${botName}] Initiating graceful logout...`);
      
      if (bot.homeBehavior && typeof bot.homeBehavior.gracefulLogout === 'function') {
        await bot.homeBehavior.gracefulLogout(30000); // 30 second timeout per bot
      } else {
        // Fallback: just quit
        console.log(`[${botName}] Home behavior not available, disconnecting...`);
        bot.quit();
      }
      
      console.log(`[${botName}] Disconnected successfully`);
    } catch (err) {
      console.error(`Error during shutdown: ${err.message || err}`);
    }
  });

  // Wait for all bots to finish, with overall timeout
  await Promise.race([
    Promise.all(shutdownPromises),
    new Promise(resolve => setTimeout(resolve, 60000)) // 60 second max
  ]);

  console.log('\n✅ All bots disconnected. Goodbye!\n');
  process.exit(0);
}

// Register Ctrl+C handler
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

console.log('\n💡 Press Ctrl+C to send all bots home and shutdown gracefully\n');
