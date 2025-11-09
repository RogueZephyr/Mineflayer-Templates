// src/utils/SaveChestLocation.js
import fs from 'fs/promises';
import path from 'path';

export default class SaveChestLocation {
  constructor(bot) {
    this.bot = bot;
    // use data/ for runtime state so file-watcher won't restart the process on updates
    this.srcPath = path.join(process.cwd(), 'src', 'config', 'chestLocations.json');
    this.dataPath = path.join(process.cwd(), 'data', 'chestLocations.json');
    this.filePath = this.dataPath;
  }

  async _ensureDataFile() {
    try {
      await fs.access(this.dataPath);
      return;
    } catch (_e) {
      // migrate from src/config if present, otherwise create an empty file
      try {
        const raw = await fs.readFile(this.srcPath, 'utf8');
        await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
        await fs.writeFile(this.dataPath, raw, 'utf8');
        return;
      } catch (_err) {
        await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
        await fs.writeFile(this.dataPath, JSON.stringify({}, null, 2) + '\n', 'utf8');
      }
    }
  }

  // Accept Vec3 (with floored) or plain {x,y,z}
  _normalizePos(pos) {
    if (!pos) throw new Error('No position provided');
    // prefer explicit numeric coordinates (Vec3 also exposes x,y,z)
    if (
      typeof pos.x === 'number' &&
      typeof pos.y === 'number' &&
      typeof pos.z === 'number'
    ) {
      return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    }

    // array-like [x,y,z]
    if (Array.isArray(pos) && pos.length >= 3) {
      return { x: Math.floor(Number(pos[0])), y: Math.floor(Number(pos[1])), z: Math.floor(Number(pos[2])) };
    }

    // fallback: try to coerce from object-like with numeric-ish properties
    if (pos && (typeof pos.x !== 'undefined' || typeof pos[0] !== 'undefined')) {
      return {
        x: Math.floor(Number(pos.x ?? pos[0] ?? 0)),
        y: Math.floor(Number(pos.y ?? pos[1] ?? 0)),
        z: Math.floor(Number(pos.z ?? pos[2] ?? 0))
      };
    }

    throw new Error('Invalid position object');
  }

  async _readAll() {
    await this._ensureDataFile();
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async _writeAll(data) {
    const body = JSON.stringify(data, null, 2) + '\n';
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, body, 'utf8');
  }

  // set or update a chest location then persist to disk
  async setChest(category, pos) {
    if (!category) throw new Error('Category required');
    const p = this._normalizePos(pos);
    const all = await this._readAll();
    all[category] = { x: p.x, y: p.y, z: p.z };
    await this._writeAll(all);
    return all[category];
  }

  async getChest(category) {
    const all = await this._readAll();
    return all[category] || null;
  }

  async getAll() {
    return await this._readAll();
  }

  async getDiagnostics() {
    try {
      const all = await this._readAll();
      return { filePath: this.filePath, entries: Object.keys(all || {}).length, entriesDetail: Object.keys(all || {}) };
    } catch (e) {
      return { error: String(e) };
    }
  }
}
