// New debug manager used by ChatCommandHandler and behaviors
import fs from 'fs/promises';
import path from 'path';

export default class DebugTools {
  constructor(bot, logger, behaviors = {}, helpers = {}) {
    this.bot = bot;
    this.logger = logger;
    this.behaviors = behaviors; // map of behavior instances keyed by name
    this.helpers = helpers; // additional helpers like chestRegistry, depositBehavior
    this.flags = new Map(); // per-module boolean flags
    this.global = false;
    this.dataDir = path.join(process.cwd(), 'data');
    this.diagnosticsFile = path.join(this.dataDir, 'diagnostics.json');
  }

  enable(moduleName = 'all') {
    if (moduleName === 'all') {
      this.global = true;
      return;
    }
    this.flags.set(moduleName, true);
  }

  disable(moduleName = 'all') {
    if (moduleName === 'all') {
      this.global = false;
      this.flags.clear();
      return;
    }
    this.flags.set(moduleName, false);
  }

  isEnabled(moduleName) {
    if (this.global) return true;
    return !!this.flags.get(moduleName);
  }

  // simple conditional logger
  log(moduleName, ...args) {
    if (!this.isEnabled(moduleName)) return;
    const prefix = `[DEBUG:${moduleName}]`;
    
    // Format arguments properly
    const message = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`${prefix} ${message}`);
    } else {
      console.log(prefix, message);
    }
  }

  // collect diagnostics for requested module (calls getDiagnostics() on module if available)
  async getDiagnostics(moduleName) {
    const out = { timestamp: new Date().toISOString(), module: moduleName };
    try {
      // global runtime info
      out.bot = {
        username: this.bot && this.bot.username,
        position: this.bot && this.bot.entity && this.bot.entity.position ? {
          x: Number(this.bot.entity.position.x.toFixed(3)),
          y: Number(this.bot.entity.position.y.toFixed(3)),
          z: Number(this.bot.entity.position.z.toFixed(3))
        } : null,
        inventoryCount: Array.isArray(this.bot.inventory?.items?.()) ? this.bot.inventory.items().length : (this.bot.inventory?.items?.().length || 0)
      };

      // behavior diagnostics
      if (moduleName === 'all') {
        out.behaviors = {};
        for (const [k, v] of Object.entries(this.behaviors || {})) {
          try {
            out.behaviors[k] = typeof v.getDiagnostics === 'function' ? await v.getDiagnostics() : { hasGetDiagnostics: false, enabled: !!v.enabled };
          } catch (e) {
            out.behaviors[k] = { error: String(e) };
          }
        }
      } else {
        const beh = (this.behaviors && this.behaviors[moduleName]) || (this.helpers && this.helpers[moduleName]);
        if (beh && typeof beh.getDiagnostics === 'function') {
          out.details = await beh.getDiagnostics();
        } else if (beh) {
          out.details = { hasGetDiagnostics: false, enabled: !!beh.enabled };
        } else {
          out.details = { present: false };
        }
      }

      // chestRegistry diagnostics if present
      if (this.helpers && this.helpers.chestRegistry && typeof this.helpers.chestRegistry.getAll === 'function') {
        try {
          out.chestRegistryCount = Object.keys(await this.helpers.chestRegistry.getAll() || {}).length;
        } catch (e) {
          out.chestRegistryError = String(e);
        }
      }

      // pathfinder presence
      out.pathfinder = {
        present: !!this.bot.pathfinder,
        methods: this.bot.pathfinder ? Object.keys(this.bot.pathfinder).slice(0, 30) : []
      };
    } catch (e) {
      out.error = String(e);
    }
    return out;
  }

  // write human-readable JSON of diagnostics to data/diagnostics-<module>-ts.json and append to diagnostics.json list
  async snapshot(moduleName = 'all') {
    await fs.mkdir(this.dataDir, { recursive: true });
    const diag = await this.getDiagnostics(moduleName);
    const filename = path.join(this.dataDir, `diagnostics-${moduleName}-${Date.now()}.json`);
    await fs.writeFile(filename, JSON.stringify(diag, null, 2) + '\n', 'utf8');

    // append to main diagnostics.json (array); keep small append-friendly structure
    let list = [];
    try {
      const raw = await fs.readFile(this.diagnosticsFile, 'utf8');
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch (e) {
      list = [];
    }
    list.push({ file: filename, timestamp: new Date().toISOString(), module: moduleName });
    await fs.writeFile(this.diagnosticsFile, JSON.stringify(list.slice(-200), null, 2) + '\n', 'utf8');
    return { snapshotFile: filename, indexFile: this.diagnosticsFile };
  }
}