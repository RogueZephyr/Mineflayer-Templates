# Change Recommendations — Mineflayer-Templates Project

This document lists **specific code changes and refactors** to apply per file based on the findings in the code review. Each recommendation includes a short explanation and example implementation notes.

---

## 🧩 Core Files

### **src/core/ConfigLoader.js**
**Issue:** Uses synchronous FS and lacks validation.

**Change:** Convert to async/await with schema validation.
```js
import fs from 'fs/promises';
import path from 'path';
import Ajv from 'ajv';

class ConfigLoader {
  static async loadConfig(filePath = './src/config/config.json') {
    const absolutePath = path.resolve(filePath);
    try {
      const data = await fs.readFile(absolutePath, 'utf8');
      const config = JSON.parse(data);

      // Validate structure
      const ajv = new Ajv();
      const validate = ajv.compile({
        type: 'object',
        required: ['host', 'port', 'version'],
        properties: {
          host: { type: 'string' },
          port: { type: 'number' },
          version: { type: 'string' }
        }
      });
      if (!validate(config)) throw new Error('Invalid configuration structure');

      console.log(`[CONFIG] Loaded successfully from ${absolutePath}`);
      return config;
    } catch (err) {
      console.error(`[CONFIG] Error loading config: ${err.message}`);
      process.exit(1);
    }
  }
}
export default ConfigLoader;
```

---

### **src/index.js**
**Issue:** Lacks non-interactive CLI mode and config flags.

**Change:** Add CLI arguments and `--bots` flag.
```js
import yargs from 'yargs';
const argv = yargs(process.argv.slice(2)).option('bots', {
  alias: 'b',
  describe: 'Number of bots to spawn',
  type: 'number',
  default: 1
}).help().argv;

const botCount = argv.bots || await promptBotCount();
```

Add `SIGINT` handler improvements:
```js
process.once('SIGINT', gracefulShutdown);
process.once('SIGTERM', gracefulShutdown);
```

---

### **src/core/BotCoordinator.js**
**Issue:** Possible race conditions and incomplete method.

**Change:** Use an `async-mutex` for shared Map mutations and finalize missing function.
```js
import { Mutex } from 'async-mutex';

class BotCoordinator {
  constructor() {
    this.mutex = new Mutex();
  }

  async claimBlock(botId, pos, task = 'generic') {
    const release = await this.mutex.acquire();
    try {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      const existing = this.claimedBlocks.get(key);
      if (existing && existing.botId !== botId && Date.now() - existing.timestamp < this.blockClaimDuration) return false;
      this.claimedBlocks.set(key, { botId, timestamp: Date.now(), task });
      return true;
    } finally {
      release();
    }
  }

  isBlockClaimed(pos, excludeBotId = null) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    const claim = this.claimedBlocks.get(key);
    return claim && claim.botId !== excludeBotId;
  }
}
```

---

### **src/utils/ChatCommandHandler.js**
**Issue:** Missing ACLs, help registry, and rate limiting.

**Change:**
1. Add `config.controllers` whitelist.
2. Add dynamic command registry.
3. Throttle per-user.
```js
handleMessage(username, message, isPrivate) {
  if (!this.whitelist.isAllowed(username)) return;
  if (this.isRateLimited(username)) return;
  // parse command
}

isRateLimited(username) {
  const now = Date.now();
  if (!this.rateLimits) this.rateLimits = new Map();
  const last = this.rateLimits.get(username) || 0;
  if (now - last < 1000) return true;
  this.rateLimits.set(username, now);
  return false;
}
```

---

## ⚙️ Utility Modules

### **src/utils/PathfindingUtil.js**
**Issue:** Incomplete goal cleanup and missing settle delay.

**Change:**
```js
try {
  await this.bot.pathfinder.goto(goal);
  await this._waitForSettle();
} finally {
  if (this.coordinator) this.coordinator.clearPathfindingGoal(this.bot.username);
}

async _waitForSettle() {
  return new Promise(r => setTimeout(r, 500));
}
```

---

### **src/utils/PathCache.js**
**Issue:** Missing world context and invalidation handling.

**Change:** Add dimension to key and limit size.
```js
_getCacheKey(start, end, dimension = 'overworld') {
  return `${dimension}:${Math.floor(start.x)},${Math.floor(start.y)},${Math.floor(start.z)}->${Math.floor(end.x)},${Math.floor(end.y)},${Math.floor(end.z)}`;
}
```

Add invalidation for repeated failures:
```js
invalidatePathsNear(pos, radius = 10) {
  for (const [key, data] of this.cache.entries()) {
    if (pos.distanceTo(data.start) < radius || pos.distanceTo(data.end) < radius) {
      this.cache.delete(key);
      this.stats.invalidations++;
    }
  }
}
```

---

### **src/utils/ToolHandler.js**
**Issue:** Hardcoded block lists.

**Change:** Generate from `minecraft-data` dynamically.
```js
_buildBlockToolMap() {
  const map = {};
  for (const [name, block] of Object.entries(this.mcData.blocksByName)) {
    if (!block.harvestTools) continue;
    const toolNames = Object.keys(block.harvestTools).map(id => this.mcData.items[id].name);
    const bestTool = this._getBestTool(toolNames);
    if (bestTool) map[name] = bestTool;
  }
  return map;
}
```

---

### **src/state/AreaRegistry.js**
**Issue:** Lacks validation, removal, and listing.

**Change:**
```js
async removeArea(type) {
  const all = await this._readAll();
  delete all[type];
  await this._writeAll(all);
}

async listAreas() {
  return Object.keys(await this._readAll());
}

_validateArea(area) {
  const { start, end } = area;
  if (!start || !end) throw new Error('Area incomplete');
  if (start.x > end.x || start.y > end.y || start.z > end.z) {
    throw new Error('Area coordinates inverted');
  }
}
```

---

## 🔐 Security & Permissions
- Add `controllers` array to `config.json`.
- Validate sender for every command.
- Add nonce or secret-based handshake for Fabric mod → bot communication.

---

## 🧾 Logging Standardization
Create a unified Logger API:
```js
class Logger {
  info(msg) { console.log(`\x1b[34m[INFO]\x1b[0m ${msg}`); }
  warn(msg) { console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`); }
  error(msg) { console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`); }
}
```
Replace all `console.*` and direct chalk calls with `Logger` usage.

---

## 🧪 Testing and Validation
**New folder:** `tests/`
- `test_chat_commands.js` → validate command parsing and whitelist.
- `test_path_cache.js` → ensure caching invalidates correctly.
- `test_coordinator.js` → simulate multiple bots claiming the same block.

Use **Vitest** or **Jest**:
```bash
npm install --save-dev vitest
```
Add script:
```json
"scripts": { "test": "vitest run" }
```

---

## 🚀 Summary
These edits will:
- Improve concurrency safety.
- Harden command and config security.
- Ensure graceful shutdowns.
- Make caching and area handling more reliable.
- Simplify maintenance for future versions of Minecraft and Mineflayer.

**Target version:** v1.0.3-pre  
**Maintainer:** RogueZ3phyr  
**Reviewed by:** ChatGPT (GPT-5)  
**Date:** 2025-11-07

