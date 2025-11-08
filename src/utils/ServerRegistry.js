// src/utils/ServerRegistry.js
import fs from 'fs';
import path from 'path';

export default class ServerRegistry {
  constructor(logger) {
    this.logger = logger;
    this.filePath = path.join(process.cwd(), 'data', 'servers.json');
    this.data = { servers: [] };
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this._save();
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
      if (!Array.isArray(this.data.servers)) this.data.servers = [];
    } catch (e) {
      this.logger?.warn?.(`[ServerRegistry] Failed to load servers.json: ${e.message}`);
      this.data = { servers: [] };
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (e) {
      this.logger?.error?.(`[ServerRegistry] Failed to save servers.json: ${e.message}`);
    }
  }

  list() {
    return this.data.servers.slice().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  }

  get(aliasOrHost) {
    const key = (aliasOrHost || '').toLowerCase();
    return this.data.servers.find(s => s.alias?.toLowerCase() === key || s.host?.toLowerCase() === key) || null;
  }

  upsert(entry) {
    if (!entry || !entry.host) throw new Error('host required');
    const alias = entry.alias || entry.host;
    const existingIdx = this.data.servers.findIndex(s => s.alias?.toLowerCase() === alias.toLowerCase());
    const sanitized = {
      alias,
      host: entry.host,
      port: Number(entry.port) || 25565,
      version: entry.version && entry.version.toLowerCase() !== 'auto' ? entry.version : '1.21.1',
      lastUsed: entry.lastUsed || Date.now()
    };
    if (existingIdx >= 0) this.data.servers[existingIdx] = { ...this.data.servers[existingIdx], ...sanitized };
    else this.data.servers.push(sanitized);
    this._save();
    return sanitized;
  }

  remove(aliasOrHost) {
    const key = (aliasOrHost || '').toLowerCase();
    const before = this.data.servers.length;
    this.data.servers = this.data.servers.filter(s => s.alias?.toLowerCase() !== key && s.host?.toLowerCase() !== key);
    if (this.data.servers.length !== before) this._save();
    return before !== this.data.servers.length;
  }

  touch(aliasOrHost) {
    const s = this.get(aliasOrHost);
    if (s) {
      s.lastUsed = Date.now();
      this._save();
    }
  }
}
