import ConfigLoader from './core/ConfigLoader.js';
import BotController from './core/BotController.js';
import BotCoordinator from './core/BotCoordinator.js';
import readline from 'readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Parse CLI arguments
const argv = yargs(hideBin(process.argv))
  .option('bots', {
    alias: 'b',
    describe: 'Number of bots to spawn',
    type: 'number',
    default: null
  })
  .option('non-interactive', {
    alias: 'n',
    describe: 'Run in non-interactive mode (no prompts)',
    type: 'boolean',
    default: false
  })
  .help()
  .argv;

const config = await ConfigLoader.loadConfig('./src/config/config.json');

// Create shared coordinator for multi-bot synchronization
const sharedCoordinator = new BotCoordinator();

// Clean up expired claims every 30 seconds
setInterval(() => {
  sharedCoordinator.cleanup();
}, 30000);

// Interactive prompt for number of bots
async function promptBotCount() {
  // Non-interactive mode: use CLI arg or default
  if (argv['non-interactive'] || argv.bots !== null) {
    const count = argv.bots || 1;
    console.log(`Non-interactive mode: spawning ${count} bot(s)`);
    return count;
  }

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
    console.log(`Starting bot ${i + 1}/${count}...`);
    
    try {
      const botController = new BotController(config, null, sharedCoordinator);
      await botController.start(); // Wait for successful login
      bots.push(botController);
      console.log(`✅ Bot ${i + 1}/${count} logged in successfully!\n`);
      
      // Wait before spawning next bot (only if not the last bot)
      if (i < count - 1) {
        console.log(`Waiting ${spawnDelay / 1000}s before spawning next bot...\n`);
        await new Promise(resolve => setTimeout(resolve, spawnDelay));
      }
    } catch (err) {
      console.error(`❌ Bot ${i + 1}/${count} failed to login: ${err.message}`);
      console.error(`Skipping to next bot...\n`);
    }
  }

  console.log(`\n✅ Successfully started ${bots.length}/${count} bot(s)!\n`);
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

// Register shutdown handlers
process.once('SIGINT', gracefulShutdown);
process.once('SIGTERM', gracefulShutdown);

console.log('\n💡 Press Ctrl+C to send all bots home and shutdown gracefully\n');
