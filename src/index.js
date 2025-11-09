import ConfigLoader from './core/ConfigLoader.js';
import BotController from './core/BotController.js';
import BotCoordinator from './core/BotCoordinator.js';
import MetricsAdapter from './utils/MetricsAdapter.js';
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
  .option('server', {
    alias: 's',
    describe: 'Select a server by alias or host (from data/servers.json)',
    type: 'string'
  })
  .option('add-server', {
    describe: 'Add a server to cache: --add-server --alias NAME --host HOST --port PORT [--version v]',
    type: 'boolean',
    default: false
  })
  .option('alias', { describe: 'Alias for server add/remove', type: 'string' })
  .option('host', { describe: 'Host for server add', type: 'string' })
  .option('port', { describe: 'Port for server add', type: 'number' })
  .option('version', { describe: 'Version for server add', type: 'string' })
  .option('remove-server', {
    describe: 'Remove server by alias',
    type: 'string'
  })
  .option('list-servers', {
    describe: 'List cached servers and exit',
    type: 'boolean',
    default: false
  })
  .help()
  .argv;

// Load server registry for overrides
import ServerRegistry from './utils/ServerRegistry.js';
const serverRegistry = new ServerRegistry();

if (argv['list-servers']) {
  const list = serverRegistry.list();
  console.log('=== Cached Servers ===');
  list.forEach((s, i) => console.log(`${i + 1}. ${s.alias} -> ${s.host}:${s.port} (${s.version})`));
  process.exit(0);
}

if (argv['add-server']) {
  const alias = argv.alias || argv.host;
  if (!alias || !argv.host || !argv.port) {
    console.error('Usage: --add-server --alias NAME --host HOST --port PORT [--version v]');
    process.exit(1);
  }
  serverRegistry.upsert({ alias, host: argv.host, port: argv.port, version: argv.version || 'auto' });
  console.log(`Saved server '${alias}' -> ${argv.host}:${argv.port} (${argv.version || 'auto'})`);
  process.exit(0);
}

if (argv['remove-server']) {
  const removed = serverRegistry.remove(argv['remove-server']);
  console.log(removed ? `Removed '${argv['remove-server']}'` : `No server '${argv['remove-server']}' found`);
  process.exit(0);
}

let serverOverride = null;
if (argv.server) {
  const entry = serverRegistry.get(argv.server);
  if (!entry) {
    console.error(`No cached server '${argv.server}' found. Use --add-server to add.`);
    process.exit(1);
  }
  serverOverride = { host: entry.host, port: entry.port, version: entry.version };
  serverRegistry.touch(entry.alias);
  console.log(`[Server] Selected: ${entry.alias} -> ${entry.host}:${entry.port} (${entry.version})`);
}

const configResult = await ConfigLoader.loadConfig('./src/config/config.json', serverOverride);

// Handle config loading errors
if (!configResult.success) {
  console.error(`[CONFIG] Failed to load configuration: ${configResult.error}`);
  process.exit(1);
}

const config = configResult.config;

// Create shared coordinator for multi-bot synchronization
// Global metrics adapter (can be expanded later or exported)
const globalMetrics = new MetricsAdapter();
const sharedCoordinator = new BotCoordinator({ metrics: globalMetrics });

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
  const botController = new BotController(config, null, sharedCoordinator, i);
  // Expose global metrics to each bot for ad-hoc instrumentation
  botController.metrics = globalMetrics;
      await botController.start(); // Wait for successful login
      // Update server cache lastUsed
      try {
        serverRegistry.upsert({
          alias: config.host,
          host: config.host,
          port: config.port,
          version: config.version,
          lastUsed: Date.now()
        });
      } catch (_) {}
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
