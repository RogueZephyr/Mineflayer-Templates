// src/modules/ChatCommandHandler.js
import chalk from 'chalk';
import Logger from './logger.js';

const cmdPrefix = '!'; // for public commands like !come, !stop, etc.

export default class ChatCommandHandler {
  constructor(bot, master) {
    this.bot = bot;
    this.master = master;
    this.logger = new Logger();
    this.commands = new Map(); // stores commandName -> handler function

    this.registerDefaultCommands();
    this.initListeners();
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
  }

  register(name, handler) {
    this.commands.set(name, handler);
  }
}
