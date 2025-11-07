---


# Mineflayer Bot Platform — Architecture Overview

## Priority Stack
1. **Bot Manager System** (core leadership, task assignment, persistence)
2. **Bot Party System** (roles, coordination, group AI)
3. **Bot Manager Fabric Mod** (client-side visuals, markers, packet bridge)
4. **Bot Manager App** (external/mobile control dashboard)

---

## 1. Bot Manager System (Core Layer)
The foundation of the platform. One bot becomes **Leader** and distributes tasks to all **Followers**. Follows a command-channel and JSON persistence model.

### Responsibilities
- Track leader/followers
- Process `!manager` chat commands
- Assign tasks (goto, mine, collect, stop)
- Manage persistence in `data/botManagerData.json`
- Provide summaries for `!manager status` & `!manager list`

### Core Modules

core/ BotManager.js CommandHandler.js CommandReceiver.js

### Example Command Flow
```js
!manager task MinerBot1 goto 100 64 200
!manager broadcast mine diamond_ore 10
!manager status

Spawn Bootstrap

bot.on('spawn', async () => {
  await botManager.initialize();
  if (!botManager.leader) await botManager.setLeader(bot);
  else await botManager.addFollower(bot);
});


---

2. Bot Party System (BPS)

Builds on the Bot Manager System by supporting groups (“parties”) with leaders, roles, and shared goals.

Goals

Party-wide task queue

Role-based behavior profiles

Centralized leader “think loop”

Followers run lightweight logic

Persistent data in partyData.json


Modules

core/
  PartySystem.js
  PartyRoleManager.js
behaviors/
  leader/
  follower/

High-Level Flow

On spawn → join party or create new

Leader performs periodic planning (5–10s)

Followers listen for structured commands from leader

Tasks move from queue → active → completed



---

3. Bot Manager Fabric Mod

A client-side assistant that displays bot data visually and sends structured commands back to the bot system.

Provided Features

In-world bot overlays (name, role, task, path)

Keybind-based marker placement (for chests, mine areas, targets)

Packet channel bridge (botmanager:bot_data)

GUI panels (actions, debugging)


Modules (Client-side)

integrations/fabric/
  BotManagerMod.java
  BotDataManager.java
  BotOverlayRenderer.java
  KeyBindingHandler.java
  fabric.mod.json

Data Flow

Bot → Mod (telemetry)

bot._client.write('custom_payload', {
  channel: 'botmanager:bot_data',
  data: Buffer.from(JSON.stringify(snapshot(bot)))
});

Mod → Bot (commands)

const [action, ...params] = command.split(' ');
if (action === 'goto') bot.pathfinder.goto(new GoalNear(x, y, z, 2));

Goals for the Mod

Zero server-side footprint

No coordinate typing ever again

Assist debugging / positioning



---

4. Bot Manager App (Mobile/External)

A future addition allowing remote bot management outside the game.

Planned Features

Inspect connected bots

Issue commands (templates & chat-equivalents)

Live feed of what bots are doing

Account permissions (Owner/Operator/Viewer)


Proposed Stack

React Native or Flutter

WebSocket bridge → Bot API → Bots

Reuse existing command structure for full compatibility



---

Repository Structure Recommendation

Mineflayer-Templates/
├─ index.js
├─ config.json
├─ data/
│  ├─ botManagerData.json
│  └─ partyData.json
├─ core/
│  ├─ BotManager.js
│  ├─ CommandHandler.js
│  ├─ CommandReceiver.js
│  ├─ PartySystem.js
│  └─ PartyRoleManager.js
├─ behaviors/
│  ├─ leader/
│  ├─ follower/
│  └─ shared/
└─ integrations/
   └─ fabric/
      ├─ BotManagerMod.java
      ├─ BotDataManager.java
      ├─ BotOverlayRenderer.java
      ├─ KeyBindingHandler.java
      ├─ botmanager.mixins.json
      └─ fabric.mod.json


---

Design Principles

Leader does heavy computation; followers stay light.

Tasks are structured, not raw text commands.

Client mod only enhances UX, never required for function.

Mobile/app layer mirrors the same API as in-game commands.



---
