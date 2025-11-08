# MineFlayer Bot — Feature Roadmap & Design Document

**Last updated:** November 8, 2025

---

## 📊 Implementation Status Overview

### ✅ Completed (Phase 0 - Foundation)
- **Core Engine:** BotController, BotCoordinator, ConfigLoader
- **Pathfinding:** PathfinderBehavior, PathfindingUtil, PathCache
- **Behaviors:** 12 modules (Farming, Mining, Woodcutting, Eating, Sleeping, etc.)
- **Tool Management:** ToolHandler with 200+ block mappings
- **Inventory Management:** DepositBehavior, InventoryBehavior, chest location tracking
- **Network:** ProxyManager with rotation, ServerRegistry with CLI
- **Communication:** ChatCommandHandler with 50+ commands, console isolation
- **Utilities:** Logger, DebugTools, WhitelistManager, ChatDebugLogger

### 🔄 In Progress (Phase 1)
- Advanced mining patterns (strip-mining ✅, quarry pending, vein-mining pending)
- Multi-bot coordination framework (basic ✅, advanced pending)
- Crafting system (planned)

### ⏳ Planned (Phase 2+)
- Combat & defense system
- GOAP/BT/FSM hybrid reasoning
- Task queue broker (Redis)
- Web dashboard
- Fabric mod integration

---

## 1. Executive summary

This document captures a practical, modular roadmap to evolve the current MineFlayer bot into a multi-bot system capable of mining, farming, crafting, woodcutting, combat, and cross-bot cooperation. It focuses on maintainability, incremental delivery, clear APIs, and predictable behavior in vanilla and modded servers where possible.

Goals:

* ✅ Stable, testable modules for core tasks (pathfinding, farming, inventory management).
* 🔄 Add advanced task modules (mining ✅, woodcutting ✅, crafting ⏳, combat ⏳).
* ⏳ Introduce hybrid decision-making (State Machines for micro-control, Behavior Trees for actions, GOAP for high-level planning).
* 🔄 Build multi-bot cooperation and a task/transport pipeline.
* 🔄 Ensure easy debugging, metrics, and deterministic replay for testing.

Assumptions & constraints:

* Primary target: Minecraft Java Edition with MineFlayer.
* No mods required on servers you don't control; plugin/mods allowed for test servers.
* Bots run on the same machine (or accessible network) and can use a shared database/queue (MySQL/Redis recommended).
* Player safety and non-destructive defaults: bots will not grief unless explicitly configured.

---

## 2. High-level architecture

**Layers** (✅ = Implemented, 🔄 = Partial, ⏳ = Planned)

1. ✅ **Core Engine** — BotController (mineflayer wrapper), BotCoordinator (multi-bot), ConfigLoader (validation), networking, chunk management, event emitter, safety checks.
2. 🔄 **Perception & World Model** — Basic chest/inventory tracking (✅), area registry (✅), full world model (⏳).
3. ✅ **Utilities** — PathfindingUtil with A* (✅), PathCache (✅), ToolHandler (✅), chest manager (✅), recipe database (⏳).
4. 🔄 **Task Modules** — Farming (✅), Mining (✅), Woodcutting (✅), ItemCollector (✅), Crafting (⏳), Combat (⏳), Courier (⏳).
5. ⏳ **Reasoning & Planner** — GOAP for high-level goals (⏳), Behavior Tree (BT) for mid-level actions (⏳), FSM for micro-control (⏳).
6. 🔄 **Coordination Layer** — BotCoordinator basic framework (✅), task queue (⏳), pub/sub (⏳), job broker (⏳).
7. 🔄 **Persistence & Telemetry** — JSON file storage for configs/data (✅), ChatDebugLogger (✅), DB for job states (⏳), metrics dashboard (⏳).

**Communication** (Status)

* ✅ Console command interface via ChatCommandHandler (50+ commands).
* ✅ In-game chat command handling with WhitelistManager permissions.
* ✅ ProxyManager with SOCKS proxy rotation for network isolation.
* ✅ ServerRegistry for multi-server management.
* ⏳ Local IPC / Redis pubsub for message passing between bots.
* ⏳ REST or WebSocket admin API for manual commands & monitoring.
* ⏳ Centralized job store (Redis list / MySQL queue) for durable tasks.

**Implemented Infrastructure:**
- ✅ Multi-bot spawning with instance IDs and username rotation
- ✅ Proxy rotation system (sequential/random) for unique IPs per bot
- ✅ Server caching and CLI-based server selection
- ✅ Console command isolation (console replies don't leak to in-game)
- ✅ Whitelist-based permission system
- ✅ Chat debug logging with JSON persistence
- ✅ Comprehensive tool management (200+ block-to-tool mappings)

---

## 3. Core Systems (detailed)

### 3.1 Pathfinding ✅ IMPLEMENTED

**Goal:** Robust A* with fallback behaviors for dynamic environments.

**Status:** Core implementation complete via PathfinderBehavior, PathfindingUtil, and PathCache.

**Implemented features:**

* ✅ **Grid resolution:** block-cell graph with 3D nodes + agent height (via mineflayer-pathfinder).
* ✅ **Cost model:** block walkable, block breaking cost, dangerous blocks (lava), water penalty.
* ✅ **Heuristics:** Euclidean or Manhattan 3D with tie-breaking.
* ✅ **Path caching:** PathCache for fragment caching, local smoothing to reduce micro-turning.
* ✅ **Movement APIs:** goto(x, y, z), follow(entity), gotoPlayer(username), stop().
* 🔄 **Dynamic replanning:** Basic recompute on failure, D* Lite for long journeys (pending).
* 🔄 **Safety wrappers:** Pre-check for fall risk, mob density (partial implementation).

**Implemented modules:**
- `PathfinderBehavior.js` - Core pathfinding integration with mineflayer-pathfinder
- `PathfindingUtil.js` - Centralized pathfinding utilities with high-level APIs
- `PathCache.js` - Path caching and optimization for repeated routes

Implementation notes:

* ✅ Using mineflayer-pathfinder as baseline with custom cost functions.
* ✅ "Move to block but break if needed" semantics working in mining/woodcutting.
* ⏳ D* Lite for dynamic environments planned for future optimization.

### 3.2 Perception & World Model 🔄 PARTIAL

**Goal:** Small, queryable memory for fast decisions and offline replay.

**Status:** Basic tracking implemented, full world model pending.

**Implemented:**
* ✅ Chest locations tracked via SaveChestLocation utility
* ✅ Area definitions via AreaRegistry (farming/woodcutting zones)
* ✅ Bed locations via BedRegistry
* ✅ Home locations via HomeBehavior
* ✅ Tool status and inventory tracking via InventoryBehavior
* ⏳ Block memory with timestamps (pending)
* ⏳ Entity tracking with TTL (pending)
* ⏳ Full chunk scanning and persistence (pending)

**Planned APIs:**

* ⏳ `world.findNearestBlock(filter, maxDistance)`
* ⏳ `world.queryChests(filter)`
* ⏳ `world.getEntityById(id)`

Replication for multi-bot:

* Each bot keeps local memory; central index (Redis hash) holds authoritative chest & depot locations and global task registry.

### 3.3 Inventory & Chest Management ✅ IMPLEMENTED

**Goal:** Deterministic deposit/withdraw flows, stack merging, and chest reservation.

**Status:** Core functionality implemented via DepositBehavior and InventoryBehavior.

**Implemented features:**

* ✅ Chest location tracking and persistence (`SaveChestLocation`, `data/chestLocations.json`)
* ✅ Deposit behavior with nearest chest selection
* ✅ Inventory monitoring and status reporting
* ✅ Tool durability tracking via ToolHandler
* ✅ Automatic tool switching when durability low
* ⏳ Chest metadata (capacity, reserved_by, last_used_at) - pending
* ⏳ Lease/retry pattern for chest access - pending
* ⏳ Priority levels for items - pending
* ⏳ `pullRecipeItems` for crafting - pending

**Implemented modules:**
- `DepositBehavior.js` - Automatic item deposit to chests
- `InventoryBehavior.js` - Inventory monitoring and management
- `SaveChestLocation.js` - Chest position tracking and commands
- `ToolHandler.js` - Tool management with durability protection

APIs & Behaviors:

* ✅ `depositToNearest()` with basic retry support
* ⏳ `pullRecipeItems(recipe, chestFilter)` - planned for crafting
* ✅ Auto-equip tools when needed (via ToolHandler)

Consistency & edge cases:

* 🔄 Watch for desynced inventories (server lag) — partial validation implemented

### 3.4 Farming ✅ IMPLEMENTED

**Goal:** Reliable crop lifecycle operations (plant, hydrate, harvest, replant). Works with wheat, carrots, potatoes, beetroot, pumpkins, melons, sugarcane, and tree saplings (for wood module tie-in).

**Status:** Fully implemented via FarmBehavior with area-based farming.

**Implemented features:**
* ✅ Scanning farmland for growth stage via block states
* ✅ Harvest and replant logic
* ✅ Area definition via `!setarea farm start/end`
* ✅ Seed buffer management
* ✅ Commands: `!farm start`, `!farm stop`
* 🔄 Irrigation awareness - basic (needs enhancement)
* ⏳ Auto-deposit to chest - pending
* ⏳ Torch placement for night operations - pending

**Implemented module:**
- `FarmBehavior.js` - Complete farming cycle implementation

Core behavior:

* ✅ Scanning farmland chunk for growth stage via block states.
* 🔄 Irrigation awareness: track water blocks nearby for hydration (basic).
* 🔄 Replant rules: maintain minimum seed buffer.
* ⏳ Auto-produce: deposit harvested items to configured chest (planned).

Optimization:

* 🔄 Work in rows (basic pathfinding).
* ⏳ Maintain torch placement for nocturnal operations (planned).
* 🔄 Chunk-based scheduling to avoid path thrash (basic).

### 3.5 Mining (Strip-mining, Quarry, Tunneler) 🔄 PARTIAL

**Goal:** Modular mining strategies with inventory-aware stopping and chest dropoff.

**Status:** Strip-mining and tunnel digging implemented, quarry mode pending.

**Implemented modes:**

* ✅ **Strip-mining:** Tunnel with configurable side branches via `!mine strip <dir> <length> <branches>`
* ✅ **Tunneler:** Directional long tunnel via `!mine tunnel <dir> <length> [width] [height]`
* ⏳ **Quarry:** Square-area excavation, layer-by-layer (planned)

**Implemented features:**

* ✅ Tool-aware block-breaking via ToolHandler integration
* ✅ Auto tool selection and durability management
* ✅ Torch placement at intervals via PillarBuilder
* ✅ Commands: `!mine strip/tunnel`, `!mine stop`, `!mine status`
* ✅ Progress tracking and reporting
* 🔄 Inventory full behavior (basic, needs enhancement)
* ⏳ Vein-mining for ore clusters (planned)
* ⏳ Ore detection and priority targeting (planned)

**Implemented modules:**
- `MiningBehavior.js` - Strip mining and tunnel digging with ToolHandler integration
- `PillarBuilder.js` - Scaffold building and torch placement

Implementation details:

* ✅ Mining plan as sequence of coordinates with direction
* ✅ Pathfinder with block-breaking support
* 🔄 Safety: light level checks (basic), mob-avoidance (pending)

### 3.6 Wood Cutting & Tree Handling ✅ IMPLEMENTED

**Goal:** Fully harvest trees and replant saplings while being careful about tree types and chunk boundaries.

**Status:** Fully implemented via WoodCuttingBehavior with area-based operations.

**Implemented features:**
* ✅ Tree detection (log block + leaves signature)
* ✅ Full tree harvesting via ToolHandler
* ✅ Sapling collection
* ✅ Area-based woodcutting via `!setarea wood start/end`
* ✅ Commands: `!wood start`, `!wood stop`
* ✅ Automatic tree scanning and targeting
* ⏳ Sapling replanting (planned)
* ⏳ Giant tree detection (2×2 trunks) (planned)

**Implemented module:**
- `WoodCuttingBehavior.js` - Tree detection and harvesting with ToolHandler integration

Flow:

1. Detect target tree (log block + leaves signature).
2. Decide cut order (top-down best to avoid leaving floating logs if trunk-destroying behavior is simulated) or leave natural break rules—prefer top-down removal.
3. Collect saplings and replant on valid soil within a planting radius.
4. Batch wood into chests or hand off to courier.

Edge cases:

* Giant trees (2×2 or modded types): special analyzer to detect trunk size.
* Player-built structures: require an allowlist for areas to not touch.

### 3.7 Crafting

**Goal:** Local and bulk crafting using nearby chest inventories and a recipe planner.

Features:

* Local crafting queue that can call `pullRecipeItems` to gather components.
* Batch craft optimization: craft N items per run minimizing chest trips.
* Fallback: If crafting components missing, create a request task for courier or miner.

Recipe DB:

* Minimal recipe set baked into the bot: tools, torches, furnace, chest, workbench crafts.
* Allow external recipe extension (JSON) for modded items.

APIs:

* `craft(recipeId, amount, options)` returns success/failure plus missing items.

### 3.8 Self-defense / Combat

**Goal:** Smart combat agent that protects self and others, uses tactics (dodge arrows, keep distance for creepers, hit-and-run), and integrates with team combat roles.

Behavior layers:

* **Tactical FSM (micro):** strafing, backward steps, jump, block (shield), bow draw & release.
* **Tactical BT node:** sequences for `engage(entity)`, `retreatAndHeal()`, `kite(entity)`.
* **Weapon & ammo management:** auto-swap to bow/sword, tracking arrow counts.

Special behaviors:

* **Creeper handling:** detect fuse start, move away to safe distance, or use ranged to stop approach, then return.
* **Arrow dodging:** on incoming projectile detection, move laterally to break line-of-fire.
* **Group combat:** nearest healer/taunter/initiator role assignment using pub/sub.

Safety & rules:

* Non-PvP mode option to avoid attacking players.

### 3.9 Reasoning: State Machine vs Behavior Tree vs GOAP

**Recommendation (hybrid):**

* **GOAP** for high-level goal selection and resource-aware planning (e.g., "mine 128 cobblestone", "craft 3 pickaxes"). GOAP generates plans (sequence of abstract actions) based on available resources and goals.
* **Behavior Tree (BT)** for mid-level action execution with reactive capabilities and clear success/fail/interrupt semantics.
* **Finite State Machine (FSM)** for micro-control (combat micro-behaviors, tool-retry loops, low-level mobility states).

Why hybrid?

* GOAP excels at large, resource-dependent plans and can re-plan when preconditions change.
* BTs are better for reactive control (handling interrupts, partial successes) and composability.
* FSMs are simple and efficient for tight loops where overhead matters (e.g., combat micro-decisions).

Integration pattern:

* GOAP outputs a sequence like `[Gather Tools] -> [Move To Mining Zone] -> [Start Strip Mine Plan]`.
* For each GOAP action, a BT handles the concrete steps (pathing, place torch, break block). If BT fails, it reports failure and GOAP can re-plan.
* FSMs live inside BT leaf nodes where rapid, deterministic micro-actions are required.

### 3.10 Multi-bot Cooperation & Pipelines

Design principles:

* **Loose coupling:** bots communicate via tasks in a brokered queue; avoid tight sync requiring instant availability.
* **Job types:** `Collect`, `Deposit`, `Craft`, `Refill`, `Escort`, `Transport`.
* **Resource leasing:** chests, furnaces, and items use lightweight leases to avoid race conditions.

Coordination approach:

* **Central Task Broker (recommended):** Redis list(s) for jobs + Redis pubsub for notifications. Each job has metadata (priority, required items, assigned_to, status).
* **Peer negotiation:** bots can propose tasks and other bots can accept or counter-offer (for load balancing).

Example flow: Miner finds ore -> deposits into Smelter chest -> Smelter bot picks up ores and smelts -> Crafter bot requests ingots from Smelter chest -> Crafter crafts -> Courier picks up crafted goods to Warehouse.

Message/job schema (JSON):

```
{
  "id": "job-uuid",
  "type": "deposit",
  "sourceBot": "miner-01",
  "targetChest": {
    "coords": {"x": 100, "y": 64, "z": -32},
    "id": "chest-100-64--32"
  },
  "items": [{"id":"minecraft:iron_ore", "count":16}],
  "priority": 50,
  "status": "pending"
}
```

Coordination patterns:

* **Handoff**: Miner deposits and publishes `done` event. Smelter listens and claims job.
* **Courier pooling**: Many couriers subscribe to `delivery` jobs; first-come claim.
* **Supervisor**: optionally, a `supervisor` process checks for stuck jobs and requeues older ones.

## 4. Data models & APIs

Key models:

* `BotStatus { id, role, pos, inventorySummary, currentJob, uptime, health }`
* `Chest { id, coords, contentsSummary, reservedBy, lastSeen }`
* `Job { id, type, payload, assignedTo, priority, createdAt, updatedAt, attempts }`

APIs:

* **Admin REST**: `/bots`, `/jobs`, `/chests`, `/recipes`, `/logs` — for monitoring & manual override.
* **Bot SDK**: small exportable package with helpers: `claimJob()`, `reserveChest()`, `pullItems()`, `reportProgress()`.

## 5. Persistence, telemetry & testing

Persistence:

* Redis for ephemeral jobs & pubsub.
* MySQL (or SQLite for local dev) for long-term logs (job history, inventory snapshots, recipe changes).

Telemetry:

* Log every job transition with timestamps.
* Save `replay` segments for failed missions (to reproduce and debug).
* Metrics: jobs completed/hour, average job latency, path retry count, death count.

Testing:

* Unit test for small modules (pathfinder cost function, recipe planner).
* Integration tests using a local test server and scripted world state (e.g., pre-placed chests, ores).
* Fuzz tests: random spawn mobs while mining to test combat reaction.

## 6. Implementation roadmap & milestones

**Phase 0 — Stabilize & Refactor (1–2 sprints)**

* Clean up current modules: pathfinding, farming, inventory.
* Add robust world model and chest reservation system.
* Add telemetry & job logging.

**Phase 1 — Mining & Woodcutting (2–3 sprints)**

* Implement mining modes: tunneler, strip-miner, quarry planner.
* Implement tree detection and full-tree harvest + replanting.
* Integrate mining/wood modules with inventory manager and auto-deposit.

**Phase 2 — Crafting & Tool Management (1–2 sprints)**

* Recipe DB and `craft()` API.
* Auto-restock cycle: detect low tools -> craft/withdraw -> equip.

**Phase 3 — Combat & Safety (2 sprints)**

* Combat FSM/BT nodes, creeper handling, projectile dodge.
* Group combat roles & basic group tactics.

**Phase 4 — Reasoning & Planner (2–3 sprints)**

* Integrate GOAP for high-level goals.
* BT library for action execution.
* Attach replay & plan debugging UI.

**Phase 5 — Multi-bot Cooperation (2–4 sprints)**

* Task broker (Redis), job types, lease & supervisor.
* Courier & smelter chains, load balancing, failure recovery.

**Phase 6 — Polish & Advanced features (ongoing)**

* Advanced mine pattern optimization, modded-block support, GUI dashboard, role/permission system.

> Each sprint = 1–2 weeks depending on availability (adjust for your schedule). Prioritize Phase 0 & 1 early since they enable other features.

## 7. Coding patterns, best practices & libraries

* **Single Responsibility Modules:** keep perception, planning, and actuation separate.
* **Event-Driven:** rely on events rather than blocking calls where possible.
* **Retries & Idempotency:** make all job handlers idempotent to handle requeues.
* **Simulate before applying:** preview plan (e.g., mining path) and simulate cost to avoid tool starvation.
* **Use existing libs:** `mineflayer-pathfinder`, `vec3`, and utility libs; extend rather than reinvent.
* **Tools:** Node.js (current project), Redis + MySQL, optional Docker for test server.

## 8. Example: Mining task lifecycle (detailed)

1. **Plan generation** (Planner): generate strip-mining job for area A with expected ore estimate.
2. **Claiming** (Broker): miner-01 claims job `job-123`.
3. **Preconditions**: miner checks for torch supply, pickaxe durability, inventory space. If missing, generate `refill` job.
4. **Execution**: miner traverses to start, executes digAction list using pathfinder and place-torch strategy. On ore discovery, dynamically vein-mine and update job progress.
5. **Inventory full**: deposit to nearest assigned chest, or send `delivery` job for courier.
6. **Completion**: mark job done and publish `job.completed` event with summary.
7. **Supervisor checks**: if job stuck for `> 3x expectedTime`, requeue or notify operator.

## 9. Example data & job JSON (quick reference)

See the `coordination` section above for a `deposit` job. Other job types: `mine`, `tree_harvest`, `craft`, `deliver`, `smelt`.

## 10. Risks & mitigation

* **Server anti-cheat / chunk behavior:** Keep human-like timing and avoid unnatural micro-movements. Test on target servers carefully.
* **Race conditions on chests/furnaces:** implement leases and supervisor reclaims after TTL.
* **Tool starvation:** simulate plan consumption and preemptively craft or request supplies.
* **Mob-combat deaths:** implement auto-respawn handlers and job rollback.

## 11. Monitoring & debugging tools

* Web dashboard (simple Express + socket) to list bots, jobs, chest states.
* Replay viewer: store last N minutes of actions (path nodes & job transitions) to step through failures.
* In-game chat commands for quick manual overrides: `/bot stop`, `/bot claim job-123`, `/bot goto x y z`.

## 12. Next steps & immediate tasks (first 2 weeks)

1. Add chest lease/reserve logic and test with two bots competing for same chest.
2. Add mining plan representation and implement a simple 2×1 tunneler that returns when inventory full.
3. Add `pullRecipeItems` and a `craft` stub to handle tool restock.
4. Add basic Redis-based job queue and a `claimJob()` utility.
5. Add telemetry logging for job lifecycle and path retries.

---

## Appendix: Useful pseudo-code snippets

**Reserve chest (pseudo)**

```
function reserveChest(chestId, botId, ttl=5000) {
  if redis.hsetnx(`chest:${chestId}:reserved`, 'owner', botId) == 1 {
    redis.pexpire(`chest:${chestId}:reserved`, ttl)
    return true
  }
  return false
}
```

**Simple GOAP action (gather torches)**

```
Action: GatherTorches
Pre: hasWorkbench
Post: have >= 64 torches
Cost: estimated time to get sticks + coal
Execute: pullRecipeItems(torches, nearbyChests) -> craft('torch', 64)
```

**Mining plan node**

```
{ x, y, z, action: 'break', expectedTool: 'iron_pickaxe', placeTorch: false }
```
---

# Web Dashboard & Block Data Storage System

## Overview
Add a real-time web dashboard for monitoring bot activities, block data visualization, and bot management. This will provide both historical data tracking and live monitoring capabilities.

## Architecture Design

### 1. Data Storage Layer
```javascript
// core/WorldDataManager.js
class WorldDataManager {
    constructor() {
        this.blockData = new Map(); // chunkKey -> BlockData
        this.botStates = new Map(); // botName -> BotState
        this.history = {
            blockChanges: [],
            botMovements: [],
            tasks: []
        };
    }

    // Chunk-based block storage for efficiency
    setBlock(pos, block) {
        const chunkKey = this.getChunkKey(pos);
        if (!this.blockData.has(chunkKey)) {
            this.blockData.set(chunkKey, new Map());
        }
        const blockKey = this.getBlockKey(pos);
        this.blockData.get(chunkKey).set(blockKey, {
            type: block.name,
            position: pos,
            metadata: block.metadata,
            lastUpdated: Date.now()
        });
    }

    getChunkKey(pos) {
        return `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`;
    }

    getBlockKey(pos) {
        return `${pos.x},${pos.y},${pos.z}`;
    }
}
```

### 2. Web Server & API
```javascript
// dashboard/WebServer.js
const express = require('express');
const WebSocket = require('ws');
const http = require('http');

class WebServer {
    constructor(botManager, port = 3000) {
        this.botManager = botManager;
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.setupRoutes();
        this.setupWebSocket();
    }

    setupRoutes() {
        this.app.use(express.static('public')); // Dashboard frontend
        this.app.use(express.json());

        // REST API endpoints
        this.app.get('/api/bots', (req, res) => {
            res.json(this.botManager.getBotStatuses());
        });

        this.app.get('/api/blocks/:chunk', (req, res) => {
            const chunk = req.params.chunk;
            res.json(this.botManager.worldData.getChunkBlocks(chunk));
        });

        this.app.post('/api/bots/:name/task', (req, res) => {
            const task = req.body.task;
            this.botManager.assignTask(req.params.name, task);
            res.json({ success: true });
        });
    }

    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('Dashboard connected');
            
            // Send initial state
            ws.send(JSON.stringify({
                type: 'INITIAL_STATE',
                data: this.botManager.getFullState()
            }));

            // Handle commands from dashboard
            ws.on('message', (message) => {
                this.handleCommand(JSON.parse(message));
            });
        });

        // Broadcast updates to all connected dashboards
        setInterval(() => {
            this.broadcastUpdate();
        }, 1000);
    }

    broadcastUpdate() {
        const update = {
            type: 'UPDATE',
            data: this.botManager.getLiveData()
        };
        
        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(update));
            }
        });
    }
}
```

### 3. Enhanced Bot State Tracking
```javascript
// core/BotStateTracker.js
class BotStateTracker {
    constructor(bot) {
        this.bot = bot;
        this.state = {
            name: bot.username,
            position: bot.entity.position,
            health: bot.health,
            food: bot.food,
            inventory: [],
            currentTask: 'Idle',
            taskProgress: 0,
            lastUpdated: Date.now()
        };
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.bot.on('health', () => this.updateHealth());
        this.bot.on('food', () => this.updateFood());
        this.bot.on('position', () => this.updatePosition());
        this.bot.on('windowUpdate', () => this.updateInventory());
        
        // Task events
        this.bot.on('taskStarted', (task) => this.updateTask(task, 'started'));
        this.bot.on('taskProgress', (task, progress) => this.updateTaskProgress(task, progress));
        this.bot.on('taskCompleted', (task) => this.updateTask(task, 'completed'));
    }

    updateHealth() {
        this.state.health = this.bot.health;
        this.state.lastUpdated = Date.now();
    }

    updateInventory() {
        this.state.inventory = this.bot.inventory.items().map(item => ({
            name: item.name,
            count: item.count,
            slot: item.slot
        }));
    }

    getState() {
        return { ...this.state };
    }
}
```

## Frontend Dashboard

### Directory Structure
```
public/
├── index.html
├── css/
│   ├── dashboard.css
│   └── map.css
├── js/
│   ├── app.js
│   ├── map.js
│   ├── botPanel.js
│   └── charts.js
└── assets/
    └── icons/
```

### Main Dashboard HTML
```html
<!DOCTYPE html>
<html>
<head>
    <title>Minecraft Bot Dashboard</title>
    <link rel="stylesheet" href="css/dashboard.css">
    <link rel="stylesheet" href="css/map.css">
</head>
<body>
    <div class="dashboard">
        <!-- Header -->
        <header class="header">
            <h1>Minecraft Bot Control Center</h1>
            <div class="status-indicators">
                <span id="connection-status" class="status connected">Connected</span>
                <span id="bot-count">Bots: 0</span>
            </div>
        </header>

        <!-- Main Content -->
        <div class="main-content">
            <!-- Left Panel: Bot List -->
            <div class="bot-panel">
                <h2>Bots</h2>
                <div id="bot-list" class="bot-list"></div>
                <div class="bot-controls">
                    <button id="add-bot">Add Bot</button>
                    <button id="emergency-stop">Emergency Stop</button>
                </div>
            </div>

            <!-- Center Panel: World Map -->
            <div class="map-panel">
                <h2>World Map</h2>
                <div class="map-controls">
                    <button id="toggle-blocks">Show Blocks</button>
                    <button id="toggle-paths">Show Paths</button>
                    <select id="layer-select">
                        <option value="surface">Surface</option>
                        <option value="underground">Underground</option>
                        <option value="resources">Resources</option>
                    </select>
                </div>
                <canvas id="world-map" width="800" height="600"></canvas>
            </div>

            <!-- Right Panel: Bot Details -->
            <div class="detail-panel">
                <div id="bot-details" class="bot-details">
                    <h3>Select a Bot</h3>
                    <div class="placeholder">Click on a bot to view details</div>
                </div>
            </div>
        </div>

        <!-- Bottom Panel: Task Manager -->
        <div class="task-panel">
            <h3>Task Manager</h3>
            <div id="task-queue" class="task-queue"></div>
            <div class="task-controls">
                <select id="task-type">
                    <option value="mine">Mine</option>
                    <option value="chop">Chop Trees</option>
                    <option value="farm">Farm</option>
                    <option value="craft">Craft</option>
                </select>
                <button id="assign-task">Assign Task</button>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script src="js/app.js"></script>
    <script src="js/map.js"></script>
    <script src="js/botPanel.js"></script>
    <script src="js/charts.js"></script>
</body>
</html>
```

### Frontend JavaScript
```javascript
// public/js/app.js
class DashboardApp {
    constructor() {
        this.socket = io();
        this.bots = new Map();
        this.selectedBot = null;
        this.worldData = new WorldMap('world-map');
        
        this.initializeEventListeners();
        this.setupSocketHandlers();
    }

    setupSocketHandlers() {
        this.socket.on('INITIAL_STATE', (data) => {
            this.handleInitialState(data);
        });

        this.socket.on('UPDATE', (data) => {
            this.handleUpdate(data);
        });

        this.socket.on('BOT_ADDED', (data) => {
            this.addBot(data.bot);
        });

        this.socket.on('BOT_REMOVED', (data) => {
            this.removeBot(data.botName);
        });
    }

    handleInitialState(data) {
        // Initialize bots
        data.bots.forEach(bot => this.addBot(bot));
        
        // Initialize world data
        this.worldData.initialize(data.worldData);
        
        // Update task queue
        this.updateTaskQueue(data.tasks);
    }

    handleUpdate(data) {
        // Update bot states
        data.bots.forEach(botUpdate => {
            this.updateBot(botUpdate);
        });

        // Update world map
        this.worldData.update(data.worldChanges);
    }

    addBot(botData) {
        const botElement = this.createBotElement(botData);
        document.getElementById('bot-list').appendChild(botElement);
        this.bots.set(botData.name, botData);
        this.worldMap.addBotMarker(botData);
    }

    createBotElement(botData) {
        const div = document.createElement('div');
        div.className = `bot-item ${botData.status}`;
        div.innerHTML = `
            <div class="bot-header">
                <span class="bot-name">${botData.name}</span>
                <span class="bot-status">${botData.status}</span>
            </div>
            <div class="bot-info">
                <span>HP: ${botData.health}</span>
                <span>Food: ${botData.food}</span>
            </div>
        `;
        
        div.addEventListener('click', () => this.selectBot(botData.name));
        return div;
    }

    selectBot(botName) {
        this.selectedBot = botName;
        this.showBotDetails(this.bots.get(botName));
        this.highlightBotOnMap(botName);
    }

    showBotDetails(botData) {
        const detailsPanel = document.getElementById('bot-details');
        detailsPanel.innerHTML = `
            <h3>${botData.name}</h3>
            <div class="bot-stats">
                <div class="stat">
                    <label>Health:</label>
                    <div class="health-bar">
                        <div class="health-fill" style="width: ${botData.health}%"></div>
                    </div>
                    <span>${botData.health}/20</span>
                </div>
                <div class="stat">
                    <label>Food:</label>
                    <div class="food-bar">
                        <div class="food-fill" style="width: ${botData.food * 5}%"></div>
                    </div>
                    <span>${botData.food}/20</span>
                </div>
                <div class="stat">
                    <label>Position:</label>
                    <span>${Math.floor(botData.position.x)}, ${Math.floor(botData.position.y)}, ${Math.floor(botData.position.z)}</span>
                </div>
                <div class="stat">
                    <label>Current Task:</label>
                    <span>${botData.currentTask}</span>
                </div>
                <div class="stat">
                    <label>Progress:</label>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${botData.taskProgress}%"></div>
                    </div>
                </div>
            </div>
            <div class="inventory">
                <h4>Inventory</h4>
                <div class="inventory-grid">
                    ${botData.inventory.map(item => `
                        <div class="inventory-slot" title="${item.name}">
                            <img src="assets/icons/${item.name}.png" alt="${item.name}">
                            <span class="item-count">${item.count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="bot-actions">
                <button class="btn-stop" onclick="app.stopBot('${botData.name}')">Stop</button>
                <button class="btn-return" onclick="app.returnToBase('${botData.name}')">Return to Base</button>
            </div>
        `;
    }
}

// Initialize app when page loads
const app = new DashboardApp();
```

## Integration with Existing System

### 1. Enhanced Main Bot Manager
```javascript
// core/BotManager.js
class BotManager {
    constructor() {
        this.bots = new Map();
        this.worldData = new WorldDataManager();
        this.webDashboard = new WebServer(this, 3000);
        this.taskQueue = new TaskQueue();
    }

    addBot(botConfig) {
        const bot = new MinecraftBot(botConfig);
        const stateTracker = new BotStateTracker(bot);
        
        this.bots.set(botConfig.name, {
            instance: bot,
            state: stateTracker,
            tasks: []
        });

        // Setup block tracking
        bot.on('blockUpdate', (oldBlock, newBlock) => {
            this.worldData.setBlock(newBlock.position, newBlock);
        });

        // Notify dashboard
        this.webDashboard.broadcast({
            type: 'BOT_ADDED',
            bot: stateTracker.getState()
        });
    }

    getBotStatuses() {
        const statuses = [];
        for (const [name, botData] of this.bots) {
            statuses.push(botData.state.getState());
        }
        return statuses;
    }

    getFullState() {
        return {
            bots: this.getBotStatuses(),
            worldData: this.worldData.getSummary(),
            tasks: this.taskQueue.getQueue()
        };
    }

    getLiveData() {
        return {
            bots: this.getBotStatuses(),
            worldChanges: this.worldData.getRecentChanges(),
            taskUpdates: this.taskQueue.getUpdates()
        };
    }
}
```

### 2. Block Event Tracking
```javascript
// utils/BlockTracker.js
class BlockTracker {
    constructor(bot, worldData) {
        this.bot = bot;
        this.worldData = worldData;
        this.setupBlockTracking();
    }

    setupBlockTracking() {
        // Track block breaks
        this.bot.on('blockBreakProgressObserved', (block) => {
            this.worldData.setBlock(block.position, { 
                type: 'broken', 
                progress: block.destroyStage 
            });
        });

        // Track block placements
        this.bot.on('blockPlaced', (block) => {
            this.worldData.setBlock(block.position, block);
        });

        // Track explored chunks
        this.bot.on('chunkColumnLoad', (point) => {
            this.scanChunk(point);
        });
    }

    async scanChunk(chunkPoint) {
        // Scan entire chunk for blocks
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                for (let y = 0; y < 256; y++) {
                    const pos = new Vec3(
                        chunkPoint.x * 16 + x,
                        y,
                        chunkPoint.z * 16 + z
                    );
                    const block = this.bot.blockAt(pos);
                    if (block && this.isInterestingBlock(block)) {
                        this.worldData.setBlock(pos, block);
                    }
                }
            }
        }
    }

    isInterestingBlock(block) {
        const interestingTypes = [
            'ore', 'log', 'chest', 'furnace', 'crafting_table',
            'diamond', 'iron', 'gold', 'coal', 'redstone'
        ];
        return interestingTypes.some(type => block.name.includes(type));
    }
}
```

## Configuration

### Dashboard Config
```json
{
  "dashboard": {
    "port": 3000,
    "updateInterval": 1000,
    "historyRetention": "7d",
    "map": {
      "renderDistance": 5,
      "showUnderground": false,
      "highlightResources": true
    }
  },
  "blockTracking": {
    "enabled": true,
    "trackOres": true,
    "trackChests": true,
    "trackCrops": true,
    "maxHistory": 10000
  }
}
```

## Implementation Phases

### Phase 1: Basic Dashboard (Week 1-2)
- [ ] Web server setup with Express
- [ ] Basic bot state tracking
- [ ] Simple HTML dashboard
- [ ] WebSocket real-time updates

### Phase 2: World Visualization (Week 3-4)
- [ ] Block data storage system
- [ ] Canvas-based world map
- [ ] Chunk loading and rendering
- [ ] Bot position tracking on map

### Phase 3: Advanced Features (Week 5-6)
- [ ] Interactive task assignment
- [ ] Inventory management UI
- [ ] Historical data charts
- [ ] Multi-bot coordination view

### Phase 4: Polish & Optimization (Week 7-8)
- [ ] Performance optimization
- [ ] Mobile-responsive design
- [ ] Data persistence
- [ ] Advanced filtering and search

## Benefits

1. **Real-time Monitoring**: Live view of all bot activities
2. **Historical Analysis**: Track efficiency and identify issues
3. **Remote Control**: Manage bots without in-game commands
4. **Debugging Tool**: Visualize pathfinding and block interactions
5. **Multi-bot Coordination**: See how bots work together
6. **Resource Planning**: Identify resource-rich areas

This dashboard will transform your bot system from a black box into a fully transparent, manageable system with rich visualization and control capabilities.

---

## 📊 Current Implementation Summary (November 2025)

### Completed Features (v2.1.0)

#### Core Infrastructure ✅
- **BotController** - Bot lifecycle management with multi-bot support
- **BotCoordinator** - Basic multi-bot coordination framework
- **ConfigLoader** - Configuration loading with JSON schema validation
- **Multi-bot spawning** - Sequential spawn with configurable delays
- **Instance tracking** - Unique IDs for each bot with username rotation

#### Network & Proxy System ✅
- **ProxyManager** - Complete SOCKS proxy support
  - Proxy pool management with `data/proxies.json`
  - Sequential and random rotation modes
  - Per-instance proxy assignment (unique IP per bot)
  - External IP verification via `!proxy ip` command
  - Auto IP logging on bot start (`proxy.ipCheckOnStart`)
- **ServerRegistry** - Server management with CLI
  - Server cache in `data/servers.json`
  - Flags: `--server`, `--add-server`, `--list-servers`, `--remove-server`
  - Auto-update lastUsed timestamps

#### Behavior Modules (12 total) ✅
1. **PathfinderBehavior** - A* pathfinding with mineflayer-pathfinder
2. **PathfindingUtil** - Centralized navigation APIs
3. **LookBehavior** - Natural head movement
4. **EatBehavior** - Auto food consumption
5. **SleepBehavior** - Auto bed detection and sleeping
6. **InventoryBehavior** - Inventory monitoring
7. **ItemCollectorBehavior** - Auto item pickup
8. **DepositBehavior** - Chest storage management
9. **HomeBehavior** - Home location system
10. **FarmBehavior** - Crop farming (plant, harvest, replant)
11. **WoodCuttingBehavior** - Tree detection and harvesting
12. **MiningBehavior** - Strip mining and tunnel digging

#### Utility Systems ✅
- **ToolHandler** - Centralized tool management
  - 200+ block-to-tool mappings
  - Smart tool selection and auto-switching
  - Durability protection
  - Tool status commands
- **PathCache** - Path optimization and caching
- **PillarBuilder** - Scaffold building for mining
- **SaveChestLocation** - Chest location persistence
- **WhitelistManager** - Player permission system
- **ChatDebugLogger** - Advanced debug logging

#### Communication ✅
- **ChatCommandHandler** - 50+ commands
  - Console command support with isolation
  - In-game command handling
  - Movement: come, goto, follow, stop
  - Mining: mine strip/tunnel, status
  - Farming: farm start/stop
  - Tools: status, report, check, equip
  - Home: sethome, home, ishome
  - Utility: eat, sleep, drop, deposit
  - Debug: debug on/off, loginv
  - Admin: whitelist, proxy, say
- **ChatLogger** - Chat message logging
- **Logger** - Colored console output

#### Data Storage ✅
- `data/proxies.json` - Proxy pool config
- `data/servers.json` - Server cache
- `data/botNames.json` - Username pool
- `data/chestLocations.json` - Chest storage
- `data/homeLocations.json` - Home positions
- `data/areas.json` - Farming/woodcutting zones
- `data/whitelist.json` - Player permissions
- `data/chat_debug_log.json` - Debug history

### Statistics
- **Total Lines of Code:** ~7,500+
- **Modules:** 27 (12 behaviors + 12 utilities + 3 core)
- **Commands:** 50+
- **Supported Proxy Types:** SOCKS4, SOCKS5
- **Supported Activities:** Mining, Farming, Woodcutting, Navigation, Inventory Management

### Next Priority Features
1. **Crafting System** - Automated crafting with recipe management
2. **Combat Behavior** - Self-defense and mob combat
3. **Vein Mining** - Ore cluster detection and mining
4. **Task Queue Broker** - Redis-based multi-bot job system
5. **Web Dashboard** - Real-time monitoring and control
6. **GOAP Planner** - High-level goal planning

---

**Document Version:** 2.0  
**Last Updated:** November 8, 2025  
**Project Status:** Active Development - Phase 1 Complete