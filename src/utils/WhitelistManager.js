// src/utils/WhitelistManager.js
import fs from 'fs'; // retained for existsSync fallback (rare)
import fsp from 'fs/promises';
import path from 'path';

export default class WhitelistManager {
  constructor(masterPlayer) {
    this.masterPlayer = masterPlayer;
    this.whitelistPath = path.join(process.cwd(), 'data', 'whitelist.json');
    this.whitelist = {}; // will be populated asynchronously
    this._loaded = false;
    this._loadingPromise = null;
  }

  /**
   * Load whitelist from disk
   */
  async loadWhitelist() {
    if (this._loaded) return this.whitelist;
    if (this._loadingPromise) return this._loadingPromise;
    this._loadingPromise = (async () => {
      try {
        // Prefer async read; fall back if file missing
        const raw = await fsp.readFile(this.whitelistPath, 'utf8').catch(() => null);
        if (raw) {
          const data = JSON.parse(raw);
          this.whitelist = data.players || {};
        } else {
          if (fs.existsSync(this.whitelistPath)) { // rare race: exists but read failed
            const data = JSON.parse(fs.readFileSync(this.whitelistPath, 'utf8'));
            this.whitelist = data.players || {};
          } else {
            this.whitelist = {};
          }
        }
      } catch (e) {
        console.warn('[Whitelist] Failed to load whitelist.json asynchronously:', e.message);
        this.whitelist = {};
      } finally {
        this._loaded = true;
      }
      return this.whitelist;
    })();
    return this._loadingPromise;
  }

  /**
   * Reload whitelist from disk
   */
  async reload() {
    this._loaded = false;
    this.whitelist = {};
    this._loadingPromise = null;
    await this.loadWhitelist();
    return Object.keys(this.whitelist).length;
  }

  /**
   * Check if a player can command a specific bot
   * @param {string} playerName - The player's username
   * @param {string} botName - The bot's username
   * @returns {boolean}
   */
  canCommandBot(playerName, botName) {
    // Master always has access
    if (playerName === this.masterPlayer) {
      return true;
    }

    const playerConfig = this.whitelist[playerName];
    if (!playerConfig) {
      return false;
    }

    const allowedBots = playerConfig.allowedBots || [];
    
    // Check for wildcard
    if (allowedBots.includes('*')) {
      return true;
    }

    // Check if bot is in allowed list
    return allowedBots.includes(botName);
  }

  /**
   * Check if a player can use a specific command on a bot
   * @param {string} playerName - The player's username
   * @param {string} botName - The bot's username
   * @param {string} commandName - The command to check
   * @returns {boolean}
   */
  canUseCommand(playerName, botName, commandName) {
    // Master always has access
    if (playerName === this.masterPlayer) {
      return true;
    }

    // Must be able to command the bot first
    if (!this.canCommandBot(playerName, botName)) {
      return false;
    }

    const playerConfig = this.whitelist[playerName];
    const allowedCommands = playerConfig.allowedCommands || [];

    // Check for wildcard
    if (allowedCommands.includes('*')) {
      return true;
    }

    // Check if command is in allowed list
    return allowedCommands.includes(commandName);
  }

  /**
   * Get list of bots a player can command
   * @param {string} playerName
   * @returns {string[]}
   */
  getAllowedBots(playerName) {
    if (playerName === this.masterPlayer) {
      return ['*'];
    }

    const playerConfig = this.whitelist[playerName];
    if (!playerConfig) {
      return [];
    }

    return playerConfig.allowedBots || [];
  }

  /**
   * Get list of commands a player can use
   * @param {string} playerName
   * @returns {string[]}
   */
  getAllowedCommands(playerName) {
    if (playerName === this.masterPlayer) {
      return ['*'];
    }

    const playerConfig = this.whitelist[playerName];
    if (!playerConfig) {
      return [];
    }

    return playerConfig.allowedCommands || [];
  }

  /**
   * Check if player is whitelisted at all
   * @param {string} playerName
   * @returns {boolean}
   */
  isWhitelisted(playerName) {
    return playerName === this.masterPlayer || !!this.whitelist[playerName];
  }

  /**
   * Get whitelist info for a player
   * @param {string} playerName
   * @returns {object|null}
   */
  getPlayerInfo(playerName) {
    if (playerName === this.masterPlayer) {
      return {
        allowedBots: ['*'],
        allowedCommands: ['*'],
        description: 'Master player - full access'
      };
    }

    return this.whitelist[playerName] || null;
  }
}
