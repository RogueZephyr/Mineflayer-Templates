# Code Review — Mineflayer-Templates

## Executive Summary
The project ships with a rich multi-bot feature set and a cohesive architecture, but several blocking and medium-risk issues remain around process lifecycle control, resource cleanup, and long-term maintainability. Most problems stem from synchronous file access in hot paths, missing teardown logic for global listeners, and hard-coded data tables that will quickly diverge from upstream Minecraft versions. Addressing these areas will make the codebase significantly more testable, robust in production, and easier to evolve.

### Highlights
- ✅ Strong modular design: behaviours, utilities, and shared coordination are well-separated and already leverage dependency injection hooks.
- ✅ Security awareness: the whitelist manager and command gating provide a solid baseline for bot access control.
- ⚠️ Observed gaps: unbounded listeners, blocking I/O inside constructors, and manual data tables that invite drift.
- 🚀 Opportunity: formalize tooling (lint/tests), cache expensive validators, and adopt dynamic data lookups to keep pace with game updates.

---

## Key Findings
| Severity | Area | Issue | Recommendation |
| --- | --- | --- | --- |
| **High** | Lifecycle management | `ChatCommandHandler` and `PathCache` attach listeners (`chat`, `blockUpdate`, readline) but never remove them on bot shutdown, so repeated reconnects leak handlers and duplicate events.【F:src/utils/ChatCommandHandler.js†L160-L198】【F:src/utils/PathCache.js†L236-L249】 | Add `dispose()`/`teardown()` hooks that `BotController` calls from its `onEnd`/`gracefulShutdown`, unregistering Mineflayer and readline listeners.
| **High** | CLI resilience | Multiple CLI flows exit the process directly (`process.exit`) from library code (config loader, server registry operations), preventing reuse inside tests or embedding scenarios.【F:src/core/ConfigLoader.js†L41-L44】【F:src/index.js†L52-L74】 | Replace hard exits with thrown errors and let `index.js` be the sole owner of exit codes; surface structured errors for consumers.
| **Medium** | Startup performance | `BotController.loadUsernameList()` and `WhitelistManager.loadWhitelist()` perform synchronous disk reads during construction, blocking the event loop when many bots start at once.【F:src/core/BotController.js†L35-L52】【F:src/utils/WhitelistManager.js†L15-L24】 | Switch to async `fs/promises`, load once at startup, and reuse cached state across controllers.
| **Medium** | Validation cost | `ConfigLoader` instantiates Ajv and recompiles the schema every time a config is loaded, and hard exits on validation failure, making hot reloads costly and tests brittle.【F:src/core/ConfigLoader.js†L19-L44】 | Hoist Ajv and compiled schema to module scope, return structured validation errors, and allow callers to decide how to handle invalid configs.
| **Medium** | Retry flow | The login timeout in `BotController.start` never clears its `setTimeout`, so a resolved promise still fires a rejection later, surfacing as an unhandled rejection in some runtimes.【F:src/core/BotController.js†L170-L209】 | Store the timeout handle and clear it once the bot logs in or errors.
| **Medium** | Command UX | Several chat command handlers answer in global chat even when triggered via private whispers, exposing command responses to public chat.【F:src/utils/ChatCommandHandler.js†L624-L637】 | Route responses through `reply()` to respect private contexts and reduce spam risks.
| **Medium** | Data maintainability | `ToolHandler` hard-codes long block lists, which will diverge whenever Mojang adds or renames blocks.【F:src/utils/ToolHandler.js†L18-L187】 | Generate mappings from `minecraft-data` (block diggable tool metadata) at runtime or during initialization.
| **Low** | Global state | `ChatCommandHandler` uses a static `_consoleInitialized` flag shared across bots, preventing console control when multiple coordinators run in the same process (e.g., unit tests).【F:src/utils/ChatCommandHandler.js†L73-L142】 | Scope console listeners per process or expose an opt-in flag so tests can instantiate handlers without hijacking stdin.
| **Low** | Observability | `ProxyManager` logs detailed proxy metadata but lacks metrics or structured logging, making production triage harder.【F:src/utils/ProxyManager.js†L120-L235】 | Emit structured events (e.g., via pino or Winston) and expose counters for pool utilization.

---

## Optimization Opportunities
1. **Async data loading** — Cache the results of `botNames.json`, `whitelist.json`, and proxy pool reads using async I/O so spawning N bots scales linearly instead of blocking on synchronous reads.【F:src/core/BotController.js†L35-L52】【F:src/utils/WhitelistManager.js†L15-L24】【F:src/utils/ProxyManager.js†L28-L45】
2. **Schema reuse** — Hoist and reuse Ajv validators for configs and runtime data to avoid repeated compilation and make it easier to extend schemas for other JSON stores.【F:src/core/ConfigLoader.js†L19-L36】
3. **Path cache hygiene** — Provide TTL-based cleanup and listener teardown so cached paths don’t accumulate across worlds; consider persisting hit/miss stats for diagnostics.【F:src/utils/PathCache.js†L60-L123】【F:src/utils/PathCache.js†L236-L249】
4. **Command throttling** — Extend the simple per-user rate limiter with exponential backoff or bucket-based throttling to guard against targeted spam on busy servers.【F:src/utils/ChatCommandHandler.js†L29-L155】
5. **Login pipeline** — Wrap the Mineflayer login retries in a promise queue (e.g., p-limit) when spawning many bots to avoid simultaneous proxy requests overwhelming the upstream server.【F:src/index.js†L129-L166】【F:src/core/BotController.js†L92-L209】

---

## Suggested Add-ons & Tooling
| Category | Recommendation | Benefit |
| --- | --- | --- |
| Module | `mineflayer-collectblock` | Replace custom item collection loops and lean on a well-tested gatherer (less maintenance). |
| Module | `mineflayer-tool` | Provides auto tool selection so `ToolHandler` can focus on orchestration rather than block tables. |
| Module | `mineflayer-armor-manager` | Ready-made armor and combat support to complement existing farming/mining behaviors. |
| Module | `prom-client` + `/metrics` endpoint | Export coordinator statistics for Grafana/Prometheus, enabling live monitoring of multi-bot fleets.【F:src/core/BotCoordinator.js†L10-L116】【F:src/core/BotCoordinator.js†L340-L412】 |
| Tooling | ESLint + Prettier | Enforce consistent style (e.g., indentation drift near ItemCollector setup) and catch unused imports early.【F:src/core/BotController.js†L214-L237】 |
| Tooling | Vitest/Jest | Unit-test permission gating (`WhitelistManager`), command parsing, and coordinator claim logic. |
| Tooling | TypeScript (incremental) | Strong typing around config/behavior contracts to avoid runtime key typos and improve editor support. |
| Tooling | `p-limit` / `bullmq` | Queue and schedule long-running behavior tasks to avoid starvation when many commands arrive simultaneously.【F:src/utils/ChatCommandHandler.js†L416-L483】 |

---

## Quick Wins Checklist
- [ ] Extract listener teardown hooks and call them from `BotController.onEnd()`.
- [ ] Replace synchronous disk reads with async equivalents and memoize shared data.
- [ ] Cache Ajv validators and surface structured validation errors instead of exiting.
- [ ] Clear login timeout handles once the bot authenticates.
- [ ] Rework `ToolHandler` to derive mappings from `minecraft-data` metadata.
- [ ] Introduce lint/test scripts in `package.json` for CI visibility.
- [ ] Normalize command replies to respect private/public context.
- [ ] Add optional metrics/logging adapters for coordinator and proxy subsystems.

---

**Reviewer:** ChatGPT (gpt-5-codex)  
**Date:** 2025-01-15  
**Repository Snapshot:** `mineflayer_basicbot@1.0.3`