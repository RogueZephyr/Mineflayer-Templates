---

### 📄 **`TODO.md`**

```markdown
# Project TODO Checklist

This file breaks the roadmap into actionable development phases with clear tasks.

---

## ✅ Phase 0 — Foundation & Infrastructure (COMPLETED)
**Goal: Establish core bot framework, networking, and management tools.**

### Completed Tasks
- [x] **BotController.js** - Core bot lifecycle management
- [x] **BotCoordinator.js** - Multi-bot coordination framework
- [x] **ConfigLoader.js** - Configuration management with validation
- [x] **Multi-bot spawning** - Support for spawning multiple bots with delays
- [x] **Username rotation** - Automatic username assignment from pool
- [x] **Instance ID tracking** - Unique ID for each bot instance

### Network & Infrastructure
- [x] **ProxyManager.js** - SOCKS proxy support with rotation
  - [x] Proxy pool management with `data/proxies.json`
  - [x] Sequential and random rotation modes
  - [x] Per-instance proxy assignment (unique IP per bot)
  - [x] External IP verification via `!proxy ip` command
  - [x] Automatic IP logging on bot start
- [x] **ServerRegistry.js** - Server management system
  - [x] Server cache with `data/servers.json`
  - [x] CLI flags: `--server`, `--add-server`, `--list-servers`, `--remove-server`
  - [x] Automatic lastUsed timestamp updates
- [x] **WhitelistManager.js** - Player permission system
  - [x] Per-player command permissions
  - [x] Per-player bot access control

### Behavior Systems (Implemented)
- [x] **PathfinderBehavior** - A* pathfinding with mineflayer-pathfinder
- [x] **PathfindingUtil** - Centralized pathfinding utilities
- [x] **PathCache** - Path caching for optimization
- [x] **LookBehavior** - Natural head movement and entity tracking
- [x] **EatBehavior** - Automatic food consumption based on hunger
- [x] **SleepBehavior** - Automatic bed detection and sleeping
- [x] **InventoryBehavior** - Inventory management and monitoring
- [x] **ItemCollectorBehavior** - Automatic item pickup
- [x] **DepositBehavior** - Chest storage with location management
- [x] **HomeBehavior** - Home location setting and navigation
- [x] **FarmBehavior** - Crop farming (plant, harvest, replant)
- [x] **WoodCuttingBehavior** - Tree detection and harvesting
- [x] **MiningBehavior** - Strip mining and tunnel digging

### Tool & Resource Management
- [x] **ToolHandler.js** - Centralized tool management
  - [x] Smart tool selection (200+ block mappings)
  - [x] Durability protection and auto-switching
  - [x] Tool status reporting commands
- [x] **PillarBuilder.js** - Scaffold building for mining operations
- [x] **SaveChestLocation.js** - Chest location persistence

### Communication & Debugging
- [x] **ChatCommandHandler.js** - Command parsing and execution
  - [x] Console command support with isolation
  - [x] In-game command handling
  - [x] `!say` command for bot chat messages
  - [x] Extensive command library (movement, mining, farming, tools, etc.)
- [x] **ChatLogger.js** - Chat message logging
- [x] **ChatDebugLogger.js** - Advanced debug logging system
- [x] **DebugTools.js** - Debug utilities and helpers
- [x] **Logger.js** - Colored console logging with levels

### Data Storage
- [x] `data/proxies.json` - Proxy pool configuration
- [x] `data/servers.json` - Server cache
- [x] `data/botNames.json` - Username pool
- [x] `data/chestLocations.json` - Chest storage locations
- [x] `data/homeLocations.json` - Home position storage
- [x] `data/areas.json` - Area definitions for farming/woodcutting
- [x] `data/whitelist.json` - Player permissions
- [x] `data/chat_debug_log.json` - Chat debug history

### Configuration
- [x] `config/config.json` - Main bot configuration
- [x] `config/foodList.json` - Edible items database
- [x] `config/itemCategories.json` - Item classification system

---

## 🔄 Phase A — Bot Manager System (Core)
**Goal: Establish leadership, command routing, persistence, and advanced task execution.**

### Tasks
- [ ] Create enhanced `core/BotManager.js` (beyond BotCoordinator)
- [ ] Implement leader/follower assignment on spawn
- [ ] Implement persistence in `data/botManagerData.json`
- [ ] Build enhanced `CommandHandler.js` for parsing `!manager` commands
- [ ] Build `CommandReceiver.js` for structured task execution
- [ ] Implement advanced tasks:
  - [x] `goto <x> <y> <z>` (via PathfindingUtil)
  - [ ] `mine <block> <radius>` (basic mining exists, needs radius support)
  - [x] `collect <item>` (via ItemCollectorBehavior)
  - [x] `stop` (via command handler)
- [ ] Implement `!manager list`, `!manager status`, `!manager broadcast`
- [ ] Add health/error reporting from followers

### Notes
- Basic coordination exists via `BotCoordinator.js`
- Need to enhance with explicit leader/follower roles
- Task queue system needs implementation

---

## 🔄 Phase B — Bot Party System
**Goal: Add group coordination, roles, shared goals, and leader thinking loop.**

### Tasks
- [ ] Create `core/PartySystem.js`
- [ ] Create `core/PartyRoleManager.js`
- [ ] Implement `partyData.json` storage
- [ ] Add auto-join or create party on spawn
- [ ] Implement roles:
  - [ ] Leader role (planner, coordinator)
  - [ ] Follower role (executor, status reporter)
- [ ] Build shared task queue
- [ ] Implement leader coordination loop (5–10s)
- [ ] Implement follower lightweight behavior cycle
- [ ] Set up role-specific behavior modules in `behaviors/`

### Notes
- Foundation exists with BotCoordinator
- Need explicit party management system
- Role-based behavior needs implementation

---

---

## ⏳ Phase C — Bot Manager Fabric Mod
**Goal: Build client-side visual tools + packet bridge for interaction.**

### Tasks
- [ ] Implement Fabric mod structure in `integrations/fabric/`
- [ ] `BotManagerMod.java` with init, keybinds, packet hooks
- [ ] `BotDataManager.java` for incoming bot telemetry
- [ ] `BotOverlayRenderer.java` for:
  - [ ] Bot name
  - [ ] Role
  - [ ] Active task
  - [ ] Path visualization
- [ ] Add keybinds:
  - [ ] Set chest marker
  - [ ] Set mining region
  - [ ] Set waypoint
- [ ] Node-side packet listener for mod → bot commands
- [ ] Node-side 1s telemetry push bot → mod
- [ ] Build basic mod GUI (status + quick actions)

---

## ⏳ Phase D — Bot Manager App (Mobile / Remote)
**Goal: Provide external full-control interface for bots.**

### Tasks
- [ ] Choose framework (React Native / Flutter)
- [ ] Build server list → bot list UI
- [ ] Implement WebSocket live updates
- [ ] Implement remote command API
- [ ] Create quick-action controls
- [ ] Add live logs + history
- [ ] Add permission layers:
  - [ ] Owner
  - [ ] Operator
  - [ ] Viewer

---

## 🎯 High Priority Enhancements

### Anti-Detection & Humanization
- [ ] **BotHumanizer.js** - Human-like behavior patterns
  - [ ] Random login delays (500ms-2s)
  - [ ] Random spawn delays (2-5s)
  - [ ] Random head movements during idle
  - [ ] Client brand spoofing
  - [ ] Natural movement patterns
  - [ ] No auto-respawn delays

### Advanced Mining
- [ ] Quarry mode (layer-by-layer excavation)
- [ ] Vein mining for ore clusters
- [ ] Ore detection and priority targeting
- [ ] Mining statistics and progress tracking
- [ ] Multi-bot coordinated mining

### Advanced Farming
- [ ] Multiple crop type support in same area
- [ ] Automatic irrigation management
- [ ] Bone meal usage optimization
- [ ] Crop rotation strategies
- [ ] Multi-bot farm coordination

### Crafting System
- [ ] **CraftingBehavior.js** - Automated crafting
  - [ ] Recipe database integration
  - [ ] Ingredient gathering from chests
  - [ ] Crafting queue system
  - [ ] Tool auto-crafting when low durability
  - [ ] Batch crafting optimization

### Combat & Defense
- [ ] **CombatBehavior.js** - Self-defense system
  - [ ] Mob detection and threat assessment
  - [ ] Weapon selection (sword/bow/crossbow)
  - [ ] Tactical movement (strafe, retreat)
  - [ ] Creeper avoidance
  - [ ] Shield blocking
  - [ ] Health-based retreat logic

### Navigation & Exploration
- [ ] World mapping and memory
- [ ] Waypoint system with named locations
- [ ] Safe path calculation (avoid lava, cliffs)
- [ ] Chunk exploration tracking
- [ ] Return-to-base pathfinding

---

## 🔧 System Improvements

### Performance & Optimization
- [ ] Path caching improvements
- [ ] Chunk loading optimization
- [ ] Memory usage profiling
- [ ] Event listener cleanup on disconnect
- [ ] Async operation optimization

### Error Handling & Recovery
- [ ] Automatic reconnection on disconnect
- [ ] Task resumption after crash
- [ ] Stuck detection and recovery
- [ ] Fall damage prevention
- [ ] Drowning prevention
- [ ] Void detection and escape

### Logging & Monitoring
- [ ] Performance metrics dashboard
- [ ] Task completion statistics
- [ ] Resource gathering tracking
- [ ] Error rate monitoring
- [ ] Bot uptime tracking

### Configuration & Flexibility
- [ ] Per-bot configuration overrides
- [ ] Dynamic behavior toggling
- [ ] Runtime configuration updates
- [ ] Behavior priority system
- [ ] Custom command registration API

---

## 📚 Documentation Needed

### User Documentation
- [ ] Complete setup guide
- [ ] Command reference (expand existing)
- [ ] Configuration guide
- [ ] Troubleshooting guide
- [ ] Best practices guide

### Developer Documentation
- [ ] Architecture overview
- [ ] Behavior creation guide
- [ ] API reference
- [ ] Testing guide
- [ ] Contributing guidelines

---

## 🎨 Optional Enhancements

### Quality of Life
- [ ] Automatic bot crash recovery routines
- [ ] Party-to-party cooperation
- [ ] Shared global task market
- [ ] Long-term memory of explored areas
- [ ] Resource economy for parties (storage, supply, demand)
- [ ] Auto-sorting items in chests
- [ ] Smart item distribution across bots
- [ ] Scheduled tasks (cron-like)
- [ ] Weather-aware behaviors

### Advanced Features
- [ ] Machine learning for pathfinding optimization
- [ ] Predictive resource management
- [ ] Dynamic difficulty adjustment
- [ ] Multi-server bot network
- [ ] Cloud-based bot coordination
- [ ] Voice command integration
- [ ] Natural language processing for commands

---

## 📊 Current Statistics

### Lines of Code (Approximate)
- **Behaviors:** ~3,500 lines
- **Utilities:** ~2,800 lines
- **Core:** ~1,200 lines
- **Total:** ~7,500+ lines

### Features Implemented
- ✅ 12 Behavior modules
- ✅ 12 Utility modules
- ✅ 3 Core modules
- ✅ 50+ commands
- ✅ Proxy rotation system
- ✅ Server management
- ✅ Tool management
- ✅ Multi-bot support

---

**Last Updated:** November 8, 2025