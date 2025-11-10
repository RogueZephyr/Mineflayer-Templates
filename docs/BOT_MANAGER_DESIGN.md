# Bot Manager System Design Document

## 1. Overview
The Bot Manager is a higher-level coordination layer that supervises multiple Mineflayer bot instances, elects a leader, tracks worker state, and (in future phases) distributes tasks, resources, and strategic directives. Phase A.1 focuses on foundational capabilities: worker registration, uptime tracking, leader election (longest uptime strategy), periodic status polling, and minimal command surface for inspection.

## 2. Goals
- Provide a single source of truth for multi-bot state (online/offline, uptime, health, hunger, inventory utilization, position snapshots).
- Elect and maintain a designated leader bot based on longest continuous uptime (configurable strategy later).
- Offer a lightweight event-driven API for future systems (TaskDistributor, ResourcePool, LeaderAI) to subscribe to bot lifecycle changes.
- Minimize overhead: polling is efficient, O(n) per cycle with cached references.
- Remain non-invasive: no hard coupling to behaviors; interacts only via BotController and exposed bot properties.

## 3. Non-Goals (Phase A.1)
- Task scheduling & distribution logic.
- Resource pooling or inventory balancing.
- Inter-bot chat/messaging protocol beyond emitted events.
- Formation/path coordination algorithms.
- Persistence of complex analytics or ML-based optimization.

## 4. Architecture Summary
```
+------------------+        emits events        +----------------------+ 
|  BotCoordinator  | -------------------------> |   BotManager         |
|  (spawns bots)   |                           |  (registry + leader) |
+----+-------------+                           +----------+-----------+
     | registerBot(name, controller)                     | leaderName
     v                                                   v
+-----------+   +-----------+   +-----------+   +-----------+
| Worker A  |   | Worker B  |   | Worker C  |   | Worker D  |
| BotController| BotController| BotController| BotController|
+-----------+   +-----------+   +-----------+   +-----------+
       ^
       | periodic polling (health, hunger, inventory, position)
       +---------------------------------------------------------
```

## 5. Core Components (Phase A.1)
| Component | Responsibility | Notes |
|-----------|----------------|-------|
| BotManager | Registry of workers, leader election, polling loop, event hub | Added under `core/` |
| BotCoordinator | Spawns bots, registers them with manager | Already exists; will call `manager.registerBot()` |
| BotController | Manages single bot lifecycle (spawn/end) | Emits `spawn` and `end` used by manager |

## 6. Data Structures
### Internal Worker Record
```ts
interface WorkerRecord {
  controller: BotController; // holds bot
  bot: Bot;                  // mineflayer instance
  online: boolean;           // currently has entity
  firstSpawnAt: number|null; // millis epoch when first spawn observed
  lastSeenAt: number|null;   // last poll timestamp
}
```
### Status Snapshot (Emission)
```ts
interface WorkerStatusSnapshot {
  name: string;
  online: boolean;
  uptimeSec: number; // derived (now - firstSpawnAt)
  health: number|null;
  hunger: number|null; // food level
  position: { x:number, y:number, z:number }|null;
  inventory: { used:number|null, total:number|null };
}
```

## 7. Leader Election Strategy (Current)
- Strategy key: `longest-uptime`
- Algorithm:
  1. Filter online workers.
  2. Compute uptimeSec per worker.
  3. Sort descending by uptime.
  4. Select top; if different from current leader, emit `leaderChanged`.
- Trigger points:
  - On worker spawn.
  - On worker end (if leader ended).
  - Manual call to `forceReelection()`.
  - Periodic poll may re-elect if leader went offline silently.

## 8. Events (Phase A.1)
| Event | Payload | Purpose |
|-------|---------|---------|
| `workerRegistered` | `{ name }` | New worker added |
| `workerUnregistered` | `{ name }` | Worker removed |
| `workerOnline` | `{ name }` | Bot spawned and entity available |
| `workerOffline` | `{ name }` | Bot ended/disconnected |
| `leaderChanged` | `{ previous:string|null, current:string|null, reason:string }` | Leadership transition |
| `statusUpdate` | `{ at:number, summaries: WorkerStatusSnapshot[] }` | Periodic poll state | 

Future events (Phase A.2+): `taskAssigned`, `taskProgress`, `resourceUpdated`, `zoneReserved`, `alertRaised`.

## 9. Public API (Initial)
```ts
class BotManager extends EventEmitter {
  registerBot(name: string, controller: BotController): void;
  unregisterBot(name: string): boolean;
  start(): void;
  stop(): void;
  getLeader(): { name: string } & WorkerRecord | null;
  getWorkers(): Array<{ name: string } & WorkerRecord>;
  getStatus(): { leader: string|null; workers: WorkerStatusSnapshot[] };
  forceReelection(): void;
}
```

## 10. Configuration
Located inline at construction (added later to `config.json` if needed):
```json
{
  "botManager": {
    "pollIntervalMs": 5000,
    "electionStrategy": "longest-uptime"
  }
}
```
Default if not set: pollInterval 5000ms, strategy `longest-uptime`.

## 11. Command Surface (Phase A.1)
- `!manager status` → leader + count online
- `!manager list` → each worker online/offline + uptime
- `!manager leader` → current leader
- `!manager elect` → force re-election

Future (Phase A.2+): `!manager assign`, `!manager recall`, `!manager scatter`, `!manager stop all`, `!manager leader <bot>`.

## 12. Sequence Flows
### Spawn Sequence
```
BotCoordinator.spawnBot() -> manager.registerBot(name, controller)
  -> attaches spawn/end listeners
Bot spawn event fires -> workerOnline -> _maybeElectLeader()
Leader elected (if none) -> emits leaderChanged
```
### Periodic Poll
```
Timer tick -> _pollOnce()
  -> iterate workers -> build WorkerStatusSnapshot[]
  -> emit statusUpdate
  -> (if leader offline) _maybeElectLeader()
```
### Leader Loss
```
Leader bot end -> workerOffline -> _maybeElectLeader(force)
  -> new leader selected or null -> leaderChanged
```

## 13. Error Handling
- Registration without valid `controller.bot` logs warning & aborts.
- Polling errors are caught and suppressed (robustness); future versions may increment error counters.
- Leader election with zero online workers sets leader to null.
- Missing fields (health, hunger) default to null—consumer must null-check.

## 14. Logging Strategy
- `info`: lifecycle (start/stop, leader election results)
- `debug`: registration, polling cycle, spawn/end events, reelection attempts
- `warn`: malformed registration attempt
- No verbose spam—poll log aggregated: "Polled N workers".

## 15. Security / Safety Considerations
- Commands should respect WhitelistManager—Phase A.1 can allow all; Phase A.2 restrict leader-sensitive operations.
- No remote code execution exposed.
- Future: rate-limit leadership changes, validate bot names.

## 16. Performance Considerations
- O(n) poll every `pollIntervalMs`; n expected small (< 20).
- Inventory slot counting uses simple length metrics; avoid deep item scanning.
- No heavy path computations here; defers to existing behaviors.

## 17. Roadmap
| Phase | Focus | Key Additions |
|-------|-------|---------------|
| A.1 | Foundations | Registry, uptime, leader election, status polling, basic commands |
| A.2 | Task Distribution | TaskDistributor, per-worker queues, assignment strategies |
| A.3 | Resource Coordination | Global inventory view, chest reservations, supply requests |
| A.4 | Communication Layer | Structured inter-bot messages, hazard and assistance signals |
| A.5 | Strategic AI | Formation movement, zone planning, cooperative mining |
| A.6 | Optimization & Learning | Performance metrics, adaptive assignment, predictive resource pre-fetch |

## 18. Acceptance Criteria (Phase A.1)
- Manager starts automatically with BotCoordinator.
- At least one worker registered logs leader election to console.
- `!manager status` returns JSON-like summary.
- `!manager elect` forces reelection (no crash).
- Poll emits `statusUpdate` event every interval with correct uptime increments.
- Removing leader causes immediate reelection (or null if no workers online).

## 19. Testing Plan (Phase A.1)
| Test | Method | Expected Result |
|------|--------|----------------|
| Register single bot | spawn -> check getWorkers() | length=1, leader=bot |
| Multiple bots staggered spawns | spawn B after A | leader=A (longer uptime) |
| Force reelection | call forceReelection() | leader unchanged if online set stable |
| Leader disconnect | end event | leaderChanged emitted, new leader chosen |
| Status polling fields | inspect statusUpdate payload | health/hunger numbers or null, position object |
| Uptime increments | compare snapshots >5s apart | uptimeSec grows appropriately |
| Commands output | issue !manager status/list/leader/elect | Non-error textual summaries |

## 20. Future Extension Hooks
- TaskDistributor listens to `statusUpdate` to rebalance tasks.
- ResourcePool updates on inventory delta events (emitted in A.2+).
- LeaderAI loop triggered on interval separate from poll for strategic decisions.

## 21. Open Questions
- Should leader election persist across restarts? (Future: persist firstSpawnAt baseline).
- Should offline workers remain registered for a grace period? (Maybe with lastSeenAt aging out.)
- How to handle network partitions vs genuine disconnect? (Heartbeat vs entity presence.)

## 22. Implementation Notes
- File location: `src/core/BotManager.js`
- Added property on `BotCoordinator` -> `manager`
- Each bot optionally receives reference `bot.manager` for command access.
- Keep external API minimal to enable refactor without breaking consumers.

---
End of Phase A.1 design document.
