// src/core/BotLoginCache.js
// Utility to manage per-bot login passwords and per-server registration state.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export default class BotLoginCache {
  constructor(logger, options = {}) {
    this.logger = logger || console;
    this.cacheFilePath = options.cacheFilePath || path.resolve(process.cwd(), 'src', 'config', 'botLoginCache.json');

    this._cache = { version: 1, bots: {} };
    this._dirty = false;
    this._saveTimeout = null;
  }

  init() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
        if (raw.trim().length > 0) {
          const data = JSON.parse(raw);
          if (data && typeof data === 'object') {
            this._cache = {
              version: data.version || 1,
              bots: data.bots || {}
            };
          }
        }
      } else {
        // Persist initial empty cache structure
        this._scheduleSave();
      }
    } catch (err) {
      this.logger.error('[BotLoginCache] Failed to load cache:', err);
    }
  }

  /**
   * Get existing credentials or create a new password entry for this username.
   * @param {string} username
   * @returns {{ username: string, password: string, createdAt: string, lastUsedAt: string }}
   */
  getOrCreateCredentials(username) {
    if (!username || typeof username !== 'string') {
      throw new Error('BotLoginCache.getOrCreateCredentials: username is required');
    }

    const nowIso = new Date().toISOString();
    let entry = this._cache.bots[username];

    if (entry && entry.password) {
      entry.lastUsedAt = nowIso;
      this._markDirty();
      return {
        username,
        password: entry.password,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt
      };
    }

    const password = this._generatePassword();
    entry = {
      password,
      createdAt: nowIso,
      lastUsedAt: nowIso,
      servers: {}
    };

    this._cache.bots[username] = entry;
    this.logger.info(`[BotLoginCache] Generated new password for bot "${username}".`);
    this._markDirty();

    return {
      username,
      password,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt
    };
  }

  /**
   * Check if this bot has already registered on the given server.
   * @param {string} username
   * @param {string} serverKey host:port
   * @returns {boolean}
   */
  hasServerRegistration(username, serverKey) {
    const entry = this._cache.bots[username];
    if (!entry || !entry.servers) return false;
    return Boolean(entry.servers[serverKey]);
  }

  /**
   * Mark that this bot has registered on the given server.
   * @param {string} username
   * @param {string} serverKey host:port
   */
  markServerRegistration(username, serverKey) {
    const entry = this._cache.bots[username];
    if (!entry) return;

    if (!entry.servers) entry.servers = {};

    const nowIso = new Date().toISOString();
    if (!entry.servers[serverKey]) {
      entry.servers[serverKey] = {
        registeredAt: nowIso,
        lastSeenAt: nowIso
      };
    } else {
      entry.servers[serverKey].lastSeenAt = nowIso;
    }

    this.logger.info(
      `[BotLoginCache] Marked server registration for "${username}" on ${serverKey}.`
    );
    this._markDirty();
  }

  /**
   * Optional helper: validate password for a username.
   * @param {string} username
   * @param {string} password
   * @returns {boolean}
   */
  validatePassword(username, password) {
    const entry = this._cache.bots[username];
    if (!entry) return false;
    return entry.password === password;
  }

  _generatePassword(length = 24) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const bytes = crypto.randomBytes(length);
    let password = '';
    for (let i = 0; i < length; i++) {
      password += alphabet[bytes[i] % alphabet.length];
    }
    return password;
  }

  _markDirty() {
    this._dirty = true;
    this._scheduleSave();
  }

  _scheduleSave() {
    if (this._saveTimeout) return;
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
      this._saveToDisk();
    }, 500);
  }

  _saveToDisk() {
    if (!this._dirty) return;
    this._dirty = false;

    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(this._cache, null, 2), 'utf8');
    } catch (err) {
      this.logger.error('[BotLoginCache] Failed to save cache:', err);
    }
  }
}
