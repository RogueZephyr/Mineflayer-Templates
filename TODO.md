---

### 📄 **`TODO.md`**

```markdown
# Project TODO Checklist

This file breaks the roadmap into actionable development phases with clear tasks.

**Last Updated:** January 2025  
**Project Version:** 2.3.0 (Task Queue Update)  
**Status:** Active Development - Phase 1 In Progress

---

## 📈 Project Progress Summary

### Overall Completion: ~72%

| Phase | Status | Progress | Key Achievements |
|-------|--------|----------|------------------|
| **Phase 0 - Foundation** | ✅ Complete | 100% | All core systems operational |
| **Phase 1 - Mining & Tasks** | 🔄 In Progress | 90% | 4 mining modes (strip/tunnel/quarry/vein), task queue, obstacle handling, smart inventory |
| **Phase 2 - Crafting** | ⏳ Planned | 0% | Design ready, implementation pending |
| **Critical Fixes** | 🚨 Urgent | 0% | Memory leaks, lifecycle issues need attention |
| **Phase A - Bot Manager** | ⏳ Deferred | 0% | Waiting for stability (See design: docs/BOT_MANAGER_DESIGN.md) |
| **Phase B - Party System** | ⏳ Deferred | 0% | Waiting for Phase A |

### Recent Achievements
- ✅ **Dynamic multi-bot group management** - Runtime add/remove for farm, woodcutting, and quarry (leader-only)
- ✅ **Quarry plan reassignment** - Bots regenerate quarry plan on zone change without stopping
- ✅ **Group summary commands** - `farm group`, `wood group`, `mine quarry group` for real-time membership
- ✅ **Group-update payload** - Machine-readable events with zone assignments for future dashboard use
- ✅ **Task queue system** - Priority-based sequential task execution with events (470 lines)
- ✅ **Task management commands** - 7 commands for queue control (!task status/list/stats/pause/resume/clear/remove)
- ✅ **Fluent task builder API** - Elegant task creation with TaskBuilder class
- ✅ **Vein mining system** - Complete ore vein detection and automated mining
- ✅ **OreScanner utility** - Reusable flood-fill based ore scanning (370+ lines)
- ✅ **Vein mining commands** - `!mine vein` and `!mine scan` with coordinates
- ✅ **Integration with all mining modes** - Automatic vein detection during strip/tunnel/quarry
- ✅ **Optimal mining order** - Nearest-neighbor path optimization for veins
- ✅ **Configurable ore whitelist** - Support for vanilla and modded ores
- ✅ **Quarry mining mode** - Complete layer-by-layer excavation
- ✅ **Obstacle handling system** - Water/lava covering, gap bridging
- ✅ **43+ commands** - Comprehensive command library
- ✅ **Advanced diagnostics** - Full system health monitoring

### Immediate Priorities
1. 🔴 **Fix memory leaks** - Event listener cleanup on disconnect
2. 🔴 **Fix login timeout** - Clear timeout handle after success
3. 🟡 **Async I/O migration** - Non-blocking file reads on startup
4. 🟢 **Crafting system** - Recipe management and auto-crafting
5. 🟢 **Zone introspection** - Rich `group zones` command (per-bot bounds) and dashboard consumption
6. 🟢 **Dynamic reassignment for strip/tunnel** - Adaptive segmentation when group changes mid-run

---

## ✅ Phase 0 — Foundation & Infrastructure (COMPLETED)
**Goal: Establish core bot framework, networking, and management tools.**
**Status:** ✅ Complete - All foundational systems operational

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
  - [x] Automatic tool switching when mining
- [x] **OreScanner.js** - Ore vein detection and analysis
  - [x] Flood-fill algorithm for connected ore blocks
  - [x] Configurable whitelist from itemCategories.json
  - [x] Custom/modded ore support
  - [x] Optimal mining order calculation
  - [x] Mining time estimation
  - [x] Standalone and integrated usage
- [x] **TaskQueue.js** - Sequential task execution system
  - [x] Priority-based task ordering
  - [x] Task cancellation and queue management
  - [x] Timeout support for long-running tasks
  - [x] Event system (taskStarted, taskCompleted, taskFailed, etc.)
  - [x] Statistics tracking (completion rate, execution time)
  - [x] Fluent API via TaskBuilder
  - [x] Pause/resume/stop queue control
- [x] **PillarBuilder.js** - Scaffold building for mining operations
- [x] **ScaffoldingUtil.js** - Advanced scaffolding system for bridging gaps
- [x] **SaveChestLocation.js** - Chest location persistence
- [x] **DepositUtil.js** - Enhanced deposit utilities

### Communication & Debugging
- [x] **ChatCommandHandler.js** - Command parsing and execution (35+ commands)
  - [x] Console command support with isolation
  - [x] In-game command handling (public chat and whispers)
  - [x] Custom whisper pattern detection for various server plugins
  - [x] Targeted bot commands (direct specific bot by name)
  - [x] Rate limiting to prevent spam
  - [x] `!say` command for bot chat messages
  - [x] Extensive command library:
    - **Basic:** ping, help, whoami, whitelist, say
    - **Movement:** come, goto, follow, stop
    - **Home:** sethome, home, ishome
    - **Actions:** eat, sleep, drop, look
    - **Inventory:** deposit, depositall, depositnearest, collect, setchest
    - **Areas:** setarea (farm/wood start/end)
    - **Farming:** farm start/stop
    - **Woodcutting:** wood start/stop
    - **Mining:** mine strip/tunnel/quarry/vein/scan/stop/status
    - **Task Queue:** task status/list/stats/pause/resume/clear/remove
    - **Tools:** tools status/check/list
    - **Debug:** debug, diag, testgoto, coordstatus, cache, loginv
    - **Chat:** whisper, chatdebug
    - **Proxy:** proxy status/test/validate/ip
- [x] **ChatLogger.js** - Chat message logging
- [x] **ChatDebugLogger.js** - Advanced debug logging system with JSON persistence
- [x] **DebugTools.js** - Debug utilities and diagnostic helpers
- [x] **Logger.js** - Colored console logging with levels
- [x] **MetricsAdapter.js** - Performance metrics tracking

### Data Storage
- [x] `data/proxies.json` - Proxy pool configuration
- [x] `data/servers.json` - Server cache
- [x] `data/botNames.json` - Username pool
- [x] `data/chestLocations.json` - Chest storage locations
- [x] `data/homeLocations.json` - Home position storage
- [x] `data/areas.json` - Area definitions for farming/woodcutting
- [x] `data/whitelist.json` - Player permissions
- [x] `data/chat_debug_log.json` - Chat debug history
- [x] `data/diagnostics.json` - System diagnostics and error tracking

### Configuration
- [x] `config/config.json` - Main bot configuration
- [x] `config/foodList.json` - Edible items database
- [x] `config/itemCategories.json` - Item classification system

---

## 🔄 Phase 1 — Advanced Mining & Task Execution (IN PROGRESS)
**Goal: Expand mining capabilities, improve tool management, and add crafting system.**
**Status:** 🔄 85% Complete - All mining modes complete including vein mining, crafting pending

### ✅ Completed Tasks
- [x] **Strip Mining** - Directional mining with side branches (`!mine strip`)
- [x] **Tunnel Digging** - Straight tunnels with configurable dimensions (`!mine tunnel`)
- [x] **Quarry Mode** - Layer-by-layer area excavation (`!mine quarry`)
- [x] **Vein Mining** - Ore cluster detection and efficient mining (`!mine vein`, `!mine scan`)
- [x] **ToolHandler Integration** - Smart tool selection with 200+ block mappings
- [x] **Torch Placement** - Automatic lighting via PillarBuilder
- [x] **Mining Progress Tracking** - Real-time status reporting
- [x] **Obstacle Handling** - Water/lava covering, gap bridging
- [x] **Scaffolding System** - Advanced bridging and scaffolding via ScaffoldingUtil
- [x] **Smart Inventory Management** - Auto-deposit with item type detection
- [x] **Mining Statistics** - Block count tracking per session
- [x] **OreScanner Utility** - Reusable ore vein detection system
- [x] **TaskQueue System** - Sequential task execution with priority, events, and control commands

### 🔄 In Progress Tasks
- [ ] **Enhanced Inventory Management**
  - [x] Auto-deposit when inventory full (implemented)
  - [x] Smart chest selection based on item type (implemented)
  - [ ] Chest reservation system for multi-bot scenarios
  - [x] Priority item retention during deposit (implemented)
  - [ ] Multi-bot deposit coordination using coordinator to avoid chest contention
- [ ] **Zone Introspection & Visualization**
  - [ ] `group zones` command
  - [ ] Include zone dimensions & volume per bot
  - [ ] Optional JSON export for dashboard
- [ ] **Adaptive Mining Segments**
  - [ ] Recompute strip/tunnel regions when add/remove occurs
  - [ ] Resume from nearest segment boundary

### ⏳ Planned Tasks
- [ ] **Ore Detection System**
  - [ ] Priority targeting for valuable ores
  - [ ] Ore statistics tracking
  - [ ] Configurable ore preferences
- [ ] **Mining Optimization**
  - [x] Path caching for repeated mining runs (PathCache implemented)
  - [x] Multi-bot coordinated mining zones (groups + dynamic reassignment baseline complete)
  - [ ] Adaptive segmentation for strip/tunnel (pending)
  - [x] Mining efficiency metrics (basic tracking implemented)
- [ ] **Safety Enhancements**
  - [x] Lava detection and avoidance (implemented via obstacle handling)
  - [x] Fall prevention during mining (implemented via bridging)
  - [x] Gravel/sand handling (implemented)
  - [ ] Mob detection in tunnels

---

## 🎯 Phase 2 — Crafting & Resource Management (NEXT)
**Goal: Implement automated crafting and intelligent resource management.**
**Status:** ⏳ Planned - Design documents ready

### Core Crafting System
- [ ] **CraftingBehavior.js** - Main crafting module
  - [ ] Recipe database integration (minecraft-data)
  - [ ] Recipe planner with dependency resolution
  - [ ] Crafting table detection and usage
  - [ ] Furnace support for smelting
  - [ ] Commands: `!craft <item> [amount]`
- [ ] **Recipe Management**
  - [ ] Dynamic recipe loading from minecraft-data
  - [ ] Custom recipe support for modded servers
  - [ ] Recipe caching for performance
  - [ ] Missing ingredient detection
- [ ] **Resource Gathering Integration**
  - [ ] `pullRecipeItems()` - Gather ingredients from chests
  - [ ] Automatic tool crafting when durability low
  - [ ] Batch crafting optimization
  - [ ] Ingredient priority system

### Advanced Resource Management
- [ ] **Enhanced Chest System**
  - [x] Chest metadata (basic - location tracking implemented)
  - [ ] Chest metadata (capacity, reserved_by, last_used_at)
  - [ ] Lease/retry pattern for chest access
  - [x] Item categorization and smart storage (basic via itemCategories.json)
  - [ ] Chest network visualization
- [ ] **Auto-Restocking**
  - [x] Monitor tool durability (ToolHandler implemented)
  - [ ] Automatic crafting requests
  - [ ] Resource pool management
  - [ ] Supply chain coordination

---

## 🎨 Additional Features Implemented (Unplanned)

### Advanced State Management
- [x] **AreaRegistry.js** - Area definition system for farming/woodcutting zones
  - [x] Start/end position tracking
  - [x] Persistence to `data/areas.json`
  - [x] Commands: `!setarea <type> start/end`
- [x] **BedRegistry.js** - Bed location tracking system
  - [x] Auto-detect nearby beds
  - [x] Distance-based bed selection
  - [x] Multi-bot bed coordination

### Advanced Communication
- [x] **Custom Whisper Detection** - Support for various server plugin formats
  - [x] Parse non-standard whisper patterns
  - [x] Raw packet message parsing
  - [x] Fallback whisper detection
- [x] **Targeted Bot Commands** - Direct commands to specific bots
  - [x] Syntax: `!<command> <botname> <args>`
  - [x] Multi-bot coordination support
  - [x] Broadcast vs targeted command distinction
- ✅ **Leader-Based Group Commands** - Dynamic add/remove for farm/wood/quarry
  - [x] Commands: `farm add/remove/group`, `wood add/remove/group`, `mine quarry add/remove/group`
  - [x] Confirmation broadcast & machine-readable `group-update` events

### Advanced Mining Features  
- [x] **Vein Mining System** - Comprehensive ore vein detection and mining
  - [x] Flood-fill based ore scanning (BFS algorithm)
  - [x] Configurable search radius and max blocks
  - [x] Automatic detection during any mining mode
  - [x] Standalone vein mining at cursor or coordinates
  - [x] Vein scanning without mining
  - [x] Integration with all mining modes (strip, tunnel, quarry)
  - [x] Optimal mining order (nearest-neighbor)
  - [x] Mining time estimation
  - [x] Commands: `!mine vein [x y z]`, `!mine scan [x y z]`
- [x] **Obstacle Handling System** - Comprehensive environment management
  - [x] Water detection and covering
  - [x] Lava detection and covering
  - [x] Gap bridging with smart block selection
  - [x] Gravel/sand falling block handling
  - [x] Configurable bridging materials
  - [x] Look-ahead scanning for hazards
- [x] **Mining Modes** - Three complete mining strategies
  - [x] Strip mining with configurable branch spacing
  - [x] Quarry mode with layer-by-layer excavation
  - [x] Tunnel mode with custom width/height
- [x] **Smart Tool Management** - Integrated with mining
  - [x] Auto tool selection per block type
  - [x] Durability monitoring during mining
  - [x] Tool switching when durability low
  - [x] Fallback behavior when tools break

### Proxy & Network Features
- [x] **External IP Verification** - Check bot's public IP via proxy
  - [x] HTTP request through proxy
  - [x] Command: `!proxy ip`
  - [x] Auto IP logging on bot start
- [x] **Proxy Configuration Validation** - Validate proxy settings
  - [x] Format checking
  - [x] Connection testing
  - [x] Commands: `!proxy validate`, `!proxy test`

### Diagnostics & Debugging
- [x] **Comprehensive Diagnostic System** - Real-time bot health monitoring
  - [x] Performance metrics tracking
  - [x] Error rate monitoring
  - [x] Memory usage tracking
  - [x] Command: `!diag` for full system report
- [x] **Path Cache Statistics** - Monitor pathfinding efficiency
  - [x] Hit/miss ratio tracking
  - [x] Cache size monitoring
  - [x] Command: `!cache stats`
- [x] **Coordinate Status** - Detailed position information
  - [x] Current position
  - [x] Dimension detection
  - [x] Biome information
  - [x] Command: `!coordstatus`

### Quality of Life Improvements
- [x] **Console Command Isolation** - Prevent console replies from appearing in-game
  - [x] Intercept bot.chat during console commands
  - [x] Route output to console only
  - [x] Clean separation of console vs in-game communication
- [x] **Whisper-to-Whisper Reply** - Smart reply context preservation
  - [x] Detect if command came via whisper
  - [x] Reply via whisper for privacy
  - [x] Public chat for public commands
- [x] **Rate Limiting** - Prevent command spam
  - [x] Per-user cooldown tracking
  - [x] Configurable cooldown period
  - [x] Silent ignore when rate limited
- ✅ **Leader Confirmation Messages** - Short broadcast after group changes reduces ambiguity & spam

---

## ⚠️ Critical Fixes & Technical Debt (HIGH PRIORITY)
**Goal: Address blocking issues from code review before expanding features.**
**Status:** 🚨 Urgent - Affects stability and scalability

### High Priority Fixes
- [ ] **Lifecycle Management** 🔴 BLOCKING
  - [ ] Add `dispose()`/`teardown()` hooks to ChatCommandHandler
  - [ ] Add `dispose()` to PathCache for listener cleanup
  - [ ] Implement proper cleanup in BotController.onEnd()
  - [ ] Clear all Mineflayer event listeners on disconnect
  - **Issue:** Memory leaks on reconnect, duplicate event handling
  - **Impact:** Production stability, multi-bot scenarios
  
- [ ] **Login Timeout Cleanup** 🔴 BLOCKING
  - [ ] Clear setTimeout handle in BotController.start()
  - [ ] Prevent unhandled promise rejections
  - **Issue:** Timeout fires even after successful login
  - **Impact:** Runtime errors, potential crashes

- [ ] **Process Exit Control** 🟡 MEDIUM
  - [ ] Remove `process.exit()` from ConfigLoader
  - [ ] Remove `process.exit()` from ServerRegistry operations
  - [ ] Return structured errors instead
  - [ ] Let index.js handle all exit codes
  - **Issue:** Cannot test or embed library code
  - **Impact:** Testability, reusability

### Medium Priority Improvements
- [ ] **Async I/O Migration** 🟡 MEDIUM
  - [ ] Convert BotController.loadUsernameList() to async
  - [ ] Convert WhitelistManager.loadWhitelist() to async
  - [ ] Convert ProxyManager file reads to async
  - [ ] Implement shared cache for username/whitelist data
  - **Issue:** Blocking event loop on startup with multiple bots
  - **Impact:** Performance, scalability

- [ ] **Config Validation Optimization** 🟡 MEDIUM
  - [ ] Hoist Ajv instance to module scope in ConfigLoader
  - [ ] Cache compiled schemas
  - [ ] Return structured errors instead of exiting
  - [ ] Allow hot reload without process restart
  - **Issue:** Repeated schema compilation, hard exits
  - **Impact:** Development speed, testing

- [ ] **ToolHandler Data Source** 🟡 MEDIUM
  - [ ] Generate block-to-tool mappings from minecraft-data
  - [ ] Remove hard-coded block lists
  - [ ] Support dynamic updates for new blocks
  - [ ] Add fallback for custom/modded blocks
  - **Issue:** Manual data table will diverge from game updates
  - **Impact:** Maintainability, mod support

### Low Priority Refinements
- [ ] **Console Handler Scope** 🟢 LOW
  - [ ] Make ChatCommandHandler console listeners per-instance
  - [ ] Remove static `_consoleInitialized` flag
  - [ ] Add opt-in flag for test environments
  - **Issue:** Global state prevents multiple coordinators
  - **Impact:** Unit testing, advanced scenarios

- [ ] **Command Reply Context** 🟢 LOW
  - [ ] Route all command responses through `reply()` helper
  - [ ] Respect private whisper context
  - [ ] Avoid leaking sensitive data to public chat
  - **Issue:** Whisper responses appear in global chat
  - **Impact:** User experience, security

- [ ] **Structured Logging** 🟢 LOW
  - [ ] Add pino or Winston for structured logs
  - [ ] Emit events from ProxyManager for metrics
  - [ ] Add counters for pool utilization
  - [ ] Create observability dashboard
  - **Issue:** Text logs hard to analyze in production
  - **Impact:** Debugging, monitoring

---

## 🔄 Phase A — Bot Manager System (FUTURE)
**Goal: Establish leadership, command routing, and advanced task execution.**
**Status:** ⏳ Deferred - Focus on core stability first

### Tasks
- [ ] Create enhanced `core/BotManager.js` (beyond BotCoordinator)
- [ ] Implement leader/follower assignment on spawn
- [ ] Implement persistence in `data/botManagerData.json`
- [ ] Build enhanced `CommandHandler.js` for parsing `!manager` commands
- [ ] Build `CommandReceiver.js` for structured task execution
- [ ] Implement advanced tasks:
  - [x] `goto <x> <y> <z>` (via PathfindingUtil)
  - [x] `mine tunnel/strip` (via MiningBehavior)
  - [x] `collect <item>` (via ItemCollectorBehavior)
  - [x] `stop` (via command handler)
  - [ ] `mine <block> <radius>` (needs radius-based search)
- [ ] Implement `!manager list`, `!manager status`, `!manager broadcast`
- [ ] Add health/error reporting from followers

### Notes
- Basic coordination exists via `BotCoordinator.js`
- Need to enhance with explicit leader/follower roles
- Task queue system needs implementation
- **Defer until Phase 1 and Critical Fixes are complete**

---

## 🔄 Phase B — Bot Party System (FUTURE)
**Goal: Add group coordination, roles, shared goals, and leader thinking loop.**
**Status:** ⏳ Deferred - Requires stable foundation

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
- **Defer until Phase A complete**

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
- [x] Quarry mode (layer-by-layer excavation) ✅ COMPLETED
- [x] Vein mining for ore clusters ✅ COMPLETED
- [x] Ore detection and priority targeting ✅ COMPLETED
- [x] Mining statistics and progress tracking ✅ COMPLETED
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
- [x] World mapping and memory (basic via PathCache) ✅ PARTIAL
- [x] Waypoint system with named locations (via HomeBehavior) ✅ COMPLETED
- [x] Safe path calculation (via PathfindingUtil with cost functions) ✅ COMPLETED
- [ ] Chunk exploration tracking
- [x] Return-to-base pathfinding (via home commands) ✅ COMPLETED

---

## 🔧 System Improvements

### Performance & Optimization
- [x] Path caching improvements ✅ COMPLETED (PathCache implemented)
- [ ] Chunk loading optimization
- [ ] Memory usage profiling
- [x] Event listener cleanup on disconnect ⚠️ NEEDS FIX (see Critical Fixes)
- [ ] Async operation optimization

### Error Handling & Recovery
- [ ] Automatic reconnection on disconnect
- [x] Task resumption after crash ✅ COMPLETED (TaskQueue persists on failure)
- [ ] Stuck detection and recovery
- [x] Fall damage prevention ✅ COMPLETED (via bridging system)
- [x] Drowning prevention (basic via pathfinding) ✅ PARTIAL
- [ ] Void detection and escape

### Logging & Monitoring
- [x] Performance metrics dashboard (basic via MetricsAdapter) ✅ PARTIAL
- [x] Task completion statistics ✅ COMPLETED (TaskQueue.stats())
- [x] Resource gathering tracking (mining session stats) ✅ PARTIAL
- [x] Error rate monitoring (via diagnostics) ✅ COMPLETED
- [x] Bot uptime tracking ✅ COMPLETED

### Configuration & Flexibility
- [ ] Per-bot configuration overrides
- [ ] Dynamic behavior toggling
- [ ] Runtime configuration updates
- [ ] Behavior priority system
- [x] Custom command registration API ✅ COMPLETED (register method)

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
- [x] Automatic bot crash recovery routines (basic error handling) ✅ PARTIAL
- [ ] Party-to-party cooperation
- [ ] Shared global task market
- [x] Long-term memory of explored areas (via PathCache) ✅ PARTIAL
- [ ] Resource economy for parties (storage, supply, demand)
- [ ] Auto-sorting items in chests
- [ ] Smart item distribution across bots
- [x] Task scheduling system ✅ COMPLETED (TaskQueue with priority and ordering)
- [ ] Weather-aware behaviors

### Advanced Features
- [x] Task queue with event system ✅ COMPLETED (TaskQueue)
- [ ] Machine learning for pathfinding optimization
- [ ] Predictive resource management
- [ ] Dynamic difficulty adjustment
- [ ] Multi-server bot network
- [ ] Cloud-based bot coordination
- [ ] Voice command integration
- [ ] Natural language processing for commands

---

## 🧪 Testing & Quality Assurance

### Testing Status
- [ ] **Unit Tests** - Not implemented
  - [ ] ConfigLoader validation tests
  - [ ] WhitelistManager permission tests
  - [ ] Command parsing tests
  - [ ] Path caching tests
- [ ] **Integration Tests** - Not implemented
  - [ ] Multi-bot coordination tests
  - [ ] Mining behavior tests
  - [ ] Pathfinding tests
- [ ] **Performance Tests** - Not implemented
  - [ ] Memory leak detection
  - [ ] Event listener accumulation
  - [ ] Concurrent bot spawn tests

### Known Issues
- 🔴 **HIGH:** Memory leaks on bot reconnect (event listeners not removed)
- 🔴 **HIGH:** Login timeout fires after successful login (unhandled rejection)
- 🟡 **MEDIUM:** Synchronous file reads block event loop on multi-bot startup
- 🟡 **MEDIUM:** Ajv schema recompiled on every config load
- 🟡 **MEDIUM:** ToolHandler block mappings hardcoded (will diverge from game updates)
- 🟡 **MEDIUM:** Whisper responses sometimes leak to public chat
- 🟢 **LOW:** Console listeners use global static flag (prevents multiple coordinators)
- 🟢 **LOW:** ProxyManager lacks structured logging and metrics

### Testing Tools Needed
- [ ] ESLint + Prettier for code quality
- [ ] Vitest or Jest for unit testing
- [ ] Test Minecraft server for integration tests
- [ ] Performance monitoring tools (prom-client)
- [ ] Memory profiler for leak detection

---

## 📊 Current Statistics (Updated)

### Lines of Code (Approximate)
- **Behaviors:** ~4,200 lines (12 modules)
- **Utilities:** ~4,300 lines (16 modules)
- **Core:** ~1,500 lines (3 modules)
- **State:** ~400 lines (2 modules)
- **Total:** ~10,900+ lines

### Module Count
- **Behaviors:** 12 modules
  - PathfinderBehavior, LookBehavior, EatBehavior, SleepBehavior
  - InventoryBehavior, ItemCollectorBehavior, DepositBehavior, HomeBehavior
  - FarmBehavior, WoodCuttingBehavior, MiningBehavior, ChatLogger
- **Utilities:** 17 modules
  - ChatCommandHandler, ChatDebugLogger, DebugTools, DepositUtil
  - Logger, MetricsAdapter, PathCache, PathfindingUtil
  - PillarBuilder, ProxyManager, SaveChestLocation, ScaffoldingUtil
  - ServerRegistry, ToolHandler, WhitelistManager, OreScanner, **TaskQueue**
- **Core:** 3 modules
  - BotController, BotCoordinator, ConfigLoader
- **State:** 2 modules
  - AreaRegistry, BedRegistry

### Features Implemented
- ✅ 12 Behavior modules
- ✅ 17 Utility modules (added OreScanner, TaskQueue)
- ✅ 3 Core modules
- ✅ 2 State management modules
- ✅ 43+ commands (added vein, scan, task with 7 sub-commands)
- ✅ 4 mining modes (strip, quarry, tunnel, vein)
- ✅ Task queue system with priority and events
- ✅ Proxy rotation system with validation
- ✅ Server management with caching
- ✅ Tool management with 200+ block mappings
- ✅ Multi-bot support with coordination
- ✅ Advanced obstacle handling (water, lava, gaps)
- ✅ Area-based farming and woodcutting
- ✅ Comprehensive diagnostics system
- ✅ Path caching and optimization
- ✅ Ore vein detection and mining

### Data Storage Files
- 9 JSON configuration/data files in `data/`
- 3 JSON configuration files in `config/`

### Command Categories
- **Basic:** 5 commands (ping, help, whoami, whitelist, say)
- **Movement:** 4 commands (come, goto, follow, stop)
- **Home System:** 3 commands (sethome, home, ishome)
- **Actions:** 4 commands (eat, sleep, drop, look)
- **Inventory:** 5 commands (deposit, depositall, depositnearest, collect, setchest)
- **Resource Gathering:** 8 commands (setarea, farm, wood, mine + sub-commands: strip, tunnel, quarry, vein, scan, deposit, stop, status)
- **Task Queue:** 1 command with 7 sub-commands (status, list, stats, pause, resume, clear, remove)
- **Tools:** 1 command with 3 sub-commands (status, check, list)
- **Debug:** 8 commands (debug, diag, testgoto, coordstatus, cache, loginv, whisper, chatdebug)
- **Networking:** 1 command with 4 sub-commands (status, test, validate, ip)

---

**Last Updated:** November 8, 2025  
**Project Version:** 2.2.0 (Vein Mining Update)
**Total Commits:** [Check git log]  
**Active Development Since:** 2024