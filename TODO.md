---

### 📄 **`TODO.md`**

```markdown
# Project TODO Checklist

This file breaks the roadmap into actionable development phases with clear tasks.

---

## ✅ Phase A — Bot Manager System (Core)
**Goal: Establish leadership, command routing, persistence, and core tasks.**

### Tasks
- [ ] Create `core/BotManager.js`
- [ ] Implement leader/follower assignment on spawn
- [ ] Implement persistence in `data/botManagerData.json`
- [ ] Build `CommandHandler.js` for parsing `!manager` commands
- [ ] Build `CommandReceiver.js` for structured task execution
- [ ] Implement tasks:
  - [ ] `goto <x> <y> <z>`
  - [ ] `mine <block> <radius>`
  - [ ] `collect <item>`
  - [ ] `stop`
- [ ] Implement `!manager list`, `!manager status`, `!manager broadcast`
- [ ] Add health/error reporting from followers

---

## ✅ Phase B — Bot Party System
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

---

## ✅ Phase C — Bot Manager Fabric Mod
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

## ✅ Phase D — Bot Manager App (Mobile / Remote)
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

## ✅ Optional Enhancements
- [ ] Automatic bot crash recovery routines
- [ ] Party-to-party cooperation
- [ ] Shared global task market
- [ ] Long-term memory of explored areas
- [ ] Resource economy for parties (storage, supply, demand)