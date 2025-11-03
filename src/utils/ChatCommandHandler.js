// src/utils/ChatCommandHandler.js
import chalk from 'chalk';
import Logger from './logger.js';
import { PathfinderBehavior } from '../behaviors/PathfinderBehavior.js';
import SaveChestLocation from '../utils/SaveChestLocation.js';

const cmdPrefix = '!'; // for public commands like !come, !stop, etc.

export default class ChatCommandHandler {
  constructor(bot, master, behaviors = {}) {
    this.bot = bot;
    this.master = master;
    this.behaviors = behaviors;
    this.logger = new Logger();
    this.commands = new Map(); // stores commandName -> handler function

    this.registerDefaultCommands();
    this.initListeners();

    this.pathfinder = new PathfinderBehavior(this.bot);
    this.pathfinder.initialize();

    this.chestRegistry = new SaveChestLocation(this.bot);
  }

  initListeners() {
    // Public chat commands
    this.bot.on('chat', (username, message) => {
      this.handleMessage(username, message, false);
    });

    // Private messages via /msg or /tell
    this.bot.on('whisper', (username, message) => {
      this.handleMessage(username, message, true);
    });
  }

  handleMessage(username, message, isPrivate) {
    // Ignore our own messages
    if (username === this.bot.username) return;

    // Master can always issue commands
    const isMaster = username === this.master;

    // Only allow others to issue commands if permitted (optional)
    if (!isMaster && isPrivate) {
      this.bot.whisper(username, "Sorry, I only take orders from my master.");
      return;
    }

    // Check if message starts with prefix or if private
    if (!isPrivate && !message.startsWith(cmdPrefix)) return;

    // Strip prefix if necessary
    const parts = message.replace(cmdPrefix, '').trim().split(/\s+/);
    const commandName = parts.shift().toLowerCase();
    const args = parts;

    if (this.commands.has(commandName)) {
      this.logger.info(`${chalk.green('[ChatCommand]')} ${username} issued command: ${commandName}`);
      try {
        this.commands.get(commandName)(username, args, isPrivate);
      } catch (err) {
        this.logger.error(`${chalk.red(`Error executing ${commandName}: ${err}`)}`);
      }
    } else {
      this.bot.whisper(username, `Unknown command: ${commandName}`);
    }
  }

  registerDefaultCommands() {
    this.register('ping', (username, args, isPrivate) => {
      const reply = 'Pong!';
      if (isPrivate) this.bot.whisper(username, reply);
      else this.bot.chat(reply);
    });

    this.register('say', (username, args) => {
      const message = args.join(' ');
      if (message.length > 0) this.bot.chat(message);
    });

    // 🧭 Movement Commands
    this.register('come', (username) => {
        this.pathfinder.comeTo(username);
    });

    this.register('goto', (username, args) => {
        if (args.length < 3) {
        this.bot.chat('Usage: !goto <x> <y> <z>');
        return;
        }
        const [x, y, z] = args.map(Number);
        this.pathfinder.goTo(x, y, z);
    });

    this.register('follow', (username, args) => {
        if (!args[0]) {
        this.bot.chat('Usage: !follow <playerName>');
        return;
        }
        this.pathfinder.followPlayer(args[0]);
    });

    this.register('stop', () => {
        this.pathfinder.stop();
    });

    this.register('eat', async (username) => {
        if (!this.behaviors?.eat) {
            this.bot.chat("Eat behavior not available.");
            return;
        }
        try {
            await this.behaviors.eat.checkHunger();
        } catch (err) {
            this.logger.error(`Error eating: ${err}`);
        }
    });

    this.register('sleep', async (username) => {
      if (!this.behaviors.sleep) return;
      await this.behaviors.sleep.sleep();
    });

    this.register('loginv', (username) => {
        if (!this.behaviors.inventory) return;
        this.behaviors.inventory.logInventory();
    });

    this.register('drop', async (username, args) => {
      if (!this.behaviors.inventory) return;

      if (!args[0]) {
        this.bot.chat("Usage: !drop <wood|ores|resources|itemName>");
        return;
      }

      const type = args[0].toLowerCase();
      const success = await this.behaviors.inventory.dropItem(type);
      if (success) this.bot.chat(`Dropped all ${type}`);
      else this.bot.chat(`No ${type} found to drop`);
    });

    this.register('deposit', async (username, args) => {
      if (!this.behaviors.inventory) {
        this.bot.chat("Inventory behavior not available.");
        return;
      }

      if (args.length < 3) {
        this.bot.chat("Usage: !deposit <x> <y> <z> [all|wood|ores|resources|itemName]");
        return;
      }

      const [xStr, yStr, zStr, typeArg] = args;
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      const z = parseInt(zStr, 10);
      const type = typeArg || 'all';

      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        this.bot.chat("Invalid coordinates. Usage: !deposit <x> <y> <z> [all|wood|ores|resources|itemName]");
        return;
      }

      this.bot.chat(`Depositing ${type} to chest at (${x}, ${y}, ${z})...`);
      try {
        const success = await this.behaviors.inventory.depositToChest({ x, y, z }, type);
        if (success) this.bot.chat(`✅ Successfully deposited ${type} items.`);
        else this.bot.chat(`⚠️ No items deposited.`);
      } catch (err) {
        this.bot.chat(`❌ Failed to deposit items: ${err.message}`);
      }
    });

    this.register('depositall', async (username, args) => {
      if (!this.behaviors.deposit) {
        this.bot.chat("Deposit behavior not available.");
        return;
      }

      this.bot.chat(`Depositing all categorized items...`);
      try {
        await this.behaviors.deposit.depositAllCategorized();
        this.bot.chat(`✅ All categorized items deposited successfully.`);
      } catch (err) {
        this.bot.chat(`❌ Failed to deposit all: ${err.message}`);
      }
    });

    this.register('depositnearest', async (username, args) => {
      if (!this.behaviors.inventory) {
        this.bot.chat("Inventory behavior not available.");
        return;
      }

      const type = args[0] || 'all';
      this.bot.chat(`Depositing ${type} items into nearest chest...`);
      try {
        const success = await this.behaviors.inventory.depositNearest(type);
        if (success) this.bot.chat(`✅ Successfully deposited ${type} items.`);
        else this.bot.chat(`⚠️ No items deposited or no nearby chest found.`);
      } catch (err) {
        this.bot.chat(`❌ Deposit failed: ${err.message}`);
      }
    });

    this.register('setchest', async (username, args) => {
      if (!this.behaviors.deposit) {
        this.bot.chat("Deposit behavior not available.");
        return;
      }

      if (!args[0]) {
        this.bot.chat("Usage: !setchest <category>");
        return;
      }

      const category = args[0].toLowerCase();

      try {
        // Try to get the block the bot is looking at
        const block = this.bot.blockAtCursor(5);
        let chestPos = null;

        // Prefer the block in view
        if (block && block.name.includes('chest')) {
          chestPos = block.position;
        } else {
          // Otherwise, find the nearest chest in 5 blocks radius
          const nearestChest = this.bot.findBlock({
            matching: blk => blk.name.includes('chest'),
            maxDistance: 5
          });
          if (nearestChest) chestPos = nearestChest.position;
        }

        if (!chestPos) {
          this.bot.chat("❌ No chest found nearby or in view.");
          return;
        }

        await this.behaviors.deposit.saveChestLocation(category, chestPos);
        this.bot.chat(`✅ ${category} chest set at (${chestPos.x}, ${chestPos.y}, ${chestPos.z})`);
      } catch (err) {
        this.bot.chat(`❌ Failed to set chest: ${err.message}`);
      }
    });

    // 📍 Manual Chest Configuration
    this.register('setchestmanual', async (username, args) => {
      if (!this.behaviors.deposit) {
        this.bot.chat("Deposit behavior not available.");
        return;
      }

      if (args.length < 4) {
        this.bot.chat("Usage: !setchestmanual <category> <x> <y> <z>");
        return;
      }

      const [category, xStr, yStr, zStr] = args;
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      const z = parseInt(zStr, 10);

      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        this.bot.chat("Invalid coordinates. Usage: !setchestmanual <category> <x> <y> <z>");
        return;
      }

      try {
        await this.behaviors.deposit.saveChestLocation(category.toLowerCase(), { x, y, z });
        this.bot.chat(`✅ Manually set ${category} chest at (${x}, ${y}, ${z})`);
      } catch (err) {
        this.bot.chat(`❌ Failed to save chest: ${err.message}`);
      }
    });

    this.register('look', (username, args) => {
        const lookBehavior = this.behaviors.look;
        if (!lookBehavior) {
            this.bot.chat("LookBehavior is not available.");
            return;
        }

        // toggle or explicitly enable/disable
        if (args[0]) {
            const action = args[0].toLowerCase();
            if (action === 'on') {
            lookBehavior.enable();
            this.bot.chat("LookBehavior enabled.");
            } else if (action === 'off') {
            lookBehavior.disable();
            this.bot.chat("LookBehavior disabled.");
            } else {
            this.bot.chat("Usage: !look <on|off>");
            }
        } else {
            // toggle automatically if no argument
            if (lookBehavior.enabled) {
            lookBehavior.disable();
            this.bot.chat("LookBehavior disabled.");
            } else {
            lookBehavior.enable();
            this.bot.chat("LookBehavior enabled.");
            }
        }
    });

  }

  register(name, handler) {
    this.commands.set(name, handler);
  }
}
