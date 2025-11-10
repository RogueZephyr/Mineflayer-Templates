# Electron Dashboard Design Document

## Overview

This document captures the target architecture for an Electron-based dashboard
that coordinates one or more Mineflayer bots. It summarizes dependencies,
modules, data flows, and code snippets to accelerate delivery of a robust MVP
and reduce rework when the dashboard grows into the broader Bot Management
System defined in `architecture.md`.

### MVP Scope Recap

The initial release should deliver:

1. **Command execution** – Send commands (e.g., `!say <message>`) to the bots.
2. **Console readout** – Stream combined or per-bot log output.
3. **Command discovery** – Provide auto-complete recommendations and argument
   descriptors.
4. **Bot selection** – Toggle between an aggregated console view and
   individual bot tabs.

Future iterations will layer richer task orchestration, metrics, and bot state
visualizations on top of this foundation.

## Dependencies and Tooling

| Category | Choice | Rationale |
| --- | --- | --- |
| Runtime | **Node.js 18+** | Matches repository baseline, unlocks native fetch and modern ECMAScript features. |
| Shell | **Electron 28+** | Stable Chromium/Node integration with maintained security patches. |
| UI | **React 18 + Vite** *(renderer)* | Rapid component iteration, strong community ecosystem, hot-module reload for faster UI feedback. |
| Styling | **Tailwind CSS** *(optional but recommended)* | Utility-first styling, reduces bespoke CSS maintenance. |
| State Mgmt | **Zustand** or **Redux Toolkit** | Manages dashboard state (logs, bots, commands) without prop-drilling. |
| IPC Schema | **Zod** | Runtime validation for IPC payloads prevents runtime crashes from malformed data. |
| Packaging | **electron-builder** | Single-command builds for dev/prod binaries. |
| Testing | **Vitest** (renderer) + **Jest** or **Node test runner** (main/preload) | Aligns with Vite & Node ecosystem for unit/contract tests. |
| Linting/Format | **ESLint + Prettier** | Maintain consistent code style, integrates with existing repo config. |
| Dev Quality | **Playwright** *(optional)* | End-to-end UI smoke tests ensure core flows stay green. |

### Repository Integration

* Add a new workspace (e.g., `dashboards/electron`) managed by the root
  `package.json` using npm workspaces to share dependencies.
* Reuse existing logging, command registration, and bot lifecycle modules via a
  dedicated bridge package (`src/ipc/dashboardBridge.ts`).

## High-Level Architecture

```
┌────────────────────────────┐        ┌─────────────────────────┐
│ Electron Main Process      │        │ Mineflayer Runtime      │
│ (Node context)             │<──────▶│ (existing src modules)  │
│                            │  IPC   │                         │
│  • Window lifecycle        │        │  • BotCoordinator        │
│  • IPC broker              │        │  • ChatCommandHandler    │
│  • Runtime supervisor      │        │  • Logger                │
└────────────▲───────────────┘        └────────────▲────────────┘
             │ IPC Renderer Bridge                   │ Event emitters
┌────────────┴───────────────┐        ┌─────────────┴───────────┐
│ Electron Renderer          │        │ IPC Bridge Layer        │
│ (React + Vite)             │        │ (new shared module)     │
│                            │        │                         │
│  • UI components           │        │  • Normalizes log events │
│  • State management        │        │  • Exposes command meta  │
│  • Command input           │        │  • Handles auth/context  │
└────────────────────────────┘        └─────────────────────────┘
```

### Process Separation

* **Runtime process** – Spawned by the Electron main process. Runs the existing
  Mineflayer bot orchestration code without UI baggage.
* **Main process** – Manages lifecycle of the runtime child process, funnels
  IPC traffic, and enforces security (e.g., context isolation, preload-only
  APIs).
* **Renderer** – Presents the dashboard UI, requests data, and sends commands
  via the preload bridge.

## Modules and Responsibilities

### `/dashboards/electron/main/main.ts`

* Boots the Electron app, ensures a single window, and spawns the bot runtime
  with environment flags (`DASHBOARD_IPC_PORT`, `BOT_CONFIG_PATH`, etc.).
* Registers IPC channels:
  * `runtime:ready`, `runtime:log`, `runtime:status` → forwarded to renderer.
  * `command:execute`, `command:list` → forwarded to runtime.
* Restarts runtime on exit codes ≠ 0 (configurable backoff).

```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { spawnRuntime } from './runtimeSupervisor';

let window: BrowserWindow | null = null;

async function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
  });

  await window.loadURL(VITE_DEV_SERVER_URL ?? `file://${join(__dirname, 'index.html')}`);
}

app.whenReady().then(() => {
  const runtime = spawnRuntime();
  wireRuntimeEvents(runtime);
  createWindow();
});
```

### `/dashboards/electron/main/runtimeSupervisor.ts`

* Spawns `node src/dashboard/runtimeEntry.js` inside the repo.
* Pipes STDOUT/STDERR to structured JSON via `readline`.
* Performs heartbeat checks; triggers `runtime:reconnect` on failure.

```ts
export function spawnRuntime(): ChildProcessWithoutNullStreams {
  const runtime = spawn(process.execPath, ['src/dashboard/runtimeEntry.js'], {
    env: {
      ...process.env,
      DASHBOARD_MODE: 'electron',
    },
  });

  runtime.stdout.on('data', buffer => {
    const event = JSON.parse(buffer.toString());
    mainWindow?.webContents.send(`runtime:${event.type}`, event.payload);
  });

  return runtime;
}
```

### `/dashboards/electron/preload/index.ts`

* Exposes a typed API surface (`dashboardAPI`) with methods `listCommands()`,
  `sendCommand(payload)`, `subscribeLogs(handler)`, `subscribeBots(handler)`.
* Validates renderer requests via Zod before forwarding to `ipcRenderer`.

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';

const executeSchema = z.object({ botId: z.string().optional(), command: z.string() });

contextBridge.exposeInMainWorld('dashboardAPI', {
  listCommands: () => ipcRenderer.invoke('command:list'),
  sendCommand: (payload) => {
    const parsed = executeSchema.parse(payload);
    ipcRenderer.send('command:execute', parsed);
  },
  onLog: (handler) => ipcRenderer.on('runtime:log', (_, event) => handler(event)),
});
```

### `/dashboards/electron/renderer/src/state/botStore.ts`

* Maintains normalized state: `{ botsById, logsByBotId, commandMeta }`.
* Provides selectors for combined logs and per-bot log feeds.

```ts
import create from 'zustand';

export const useBotStore = create((set) => ({
  bots: {},
  logs: {},
  commandMeta: [],
  appendLog(botId, entry) {
    set((state) => {
      const list = state.logs[botId] ?? [];
      return {
        logs: { ...state.logs, [botId]: [...list, entry].slice(-500) },
      };
    });
  },
}));
```

### `/src/dashboard/runtimeEntry.ts`

* Wraps the existing `BotCoordinator` and `ChatCommandHandler`.
* Emits structured events to STDOUT:
  * `log` – `{ botId, level, message, timestamp }`
  * `commandMeta` – `{ name, args: [{ name, hint }], description }`
  * `bots` – `{ botId, status, position, activeTask }`
* Consumes `command:execute` messages from STDIN.

```ts
import readline from 'node:readline';
import { coordinator } from '../src/index';

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'command:execute') {
    coordinator.executeCommand(message.payload);
  }
});

coordinator.on('log', (event) => emit({ type: 'log', payload: event }));
```

## IPC Contract

| Event | Direction | Payload |
| --- | --- | --- |
| `runtime:ready` | runtime → renderer | `{ bots: BotSummary[]; commands: CommandMeta[] }` |
| `runtime:log` | runtime → renderer | `{ botId?: string; level: 'info' \\| 'warn' \\| 'error'; message: string; ts: string }` |
| `runtime:bots` | runtime → renderer | `{ bots: BotStatus[] }` |
| `command:execute` | renderer → runtime | `{ botId?: string; command: string }` |
| `command:list` | renderer ↔ runtime | `CommandMeta[]` |

All payloads should be validated using shared Zod schemas (`packages/ipc-schemas`)
to guarantee symmetry between the runtime and renderer.

## Data Flow Walkthrough

1. **Startup**
   * Electron main spawns runtime and listens on its stdout.
   * Runtime bootstraps bots, fetches command metadata, and sends a
     `runtime:ready` payload.
   * Renderer hydrates its state from this payload and renders the dashboard.

2. **Command Execution**
   * User enters command → renderer validates → `command:execute` sent via
     preload → main forwards to runtime stdin → runtime routes through
     `ChatCommandHandler`.

3. **Logging**
   * Runtime emits `log` events whenever `Logger` writes.
   * Main process forwards to renderer; renderer stores per-bot logs and
     updates the combined stream.

4. **Bot Switching**
   * Renderer toggles between `logs['ALL']` and `logs[botId]` collections.
   * Optionally request snapshot via `ipcRenderer.invoke('bots:get')`.

## Quality Strategy

* **Unit tests**: Validate IPC schema parsing, state reducers, and runtime
  bridges (mocking `ChildProcess`).
* **Contract tests**: Shared fixtures ensure runtime emits expected events for a
  given command and renderer interprets them correctly.
* **End-to-end smoke**: Playwright script launches the packaged Electron app,
  issues `!say hello`, and asserts the log contains the response.
* **Type safety**: Enable TypeScript strict mode in all packages.
* **CI**: Extend GitHub Actions with `npm run lint`, `npm run test`, and an
  Electron packaging smoke job (`npm run electron:pack -- --dir`).

## Implementation Notes & Recommendations

* **Context isolation**: Keep `nodeIntegration` disabled and expose only the
  minimal preload API surface for security.
* **Log retention**: Cap logs per bot to prevent memory leaks (e.g., 500 lines
  with “Load more” pagination for future releases).
* **Command metadata**: Extend `ChatCommandHandler.register()` to accept
  descriptors:

  ```ts
  register('say', sayCommand, {
    description: 'Send chat message',
    args: [{ name: '<message>', hint: 'Text to broadcast' }],
  });
  ```

* **Bot grouping**: Use stable `botId` keys (`${serverHost}:${username}`) to
  avoid collisions when running multiple servers simultaneously.
* **Extensibility**: Define an interface (`DashboardRuntimeAdapter`) so other
  UIs (CLI, web) can reuse the same runtime event stream.

## Next Steps Checklist

1. Scaffold the Electron workspace with Vite + React template.
2. Implement the runtime bridge (`src/dashboard/runtimeEntry.ts`).
3. Add shared IPC schema package with Zod.
4. Build renderer components: log viewer, command palette, bot selector.
5. Write unit tests for IPC handlers and state store.
6. Wire CI scripts and documentation updates.
7. Iterate with real bots and capture edge cases for reconnects, command
   failures, and runtime crashes.