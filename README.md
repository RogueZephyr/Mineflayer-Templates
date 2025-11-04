# 🪓 Mineflayer BasicBot

A modular and extensible **Mineflayer-based Minecraft bot** built with **modern ES Modules (ESM)**.  
Designed for long-term development, maintainability, and experimentation with AI, automation, and web integration.

---

## 🚀 Features

- 🌐 **Mineflayer Core Integration** — Connects to any Minecraft server with full control.
- ⚙️ **Configurable Settings** — Easily edit your `config.json` for login info, version, and behavior.
- 🧱 **Behavior System** — Modular behaviors for scalable AI control.
- 🤖 **Multiple Behaviors** — Includes Look, Chat Logging, Eating, Sleeping, Inventory Management, Depositing, and Farming.
- 🧭 **Bot Controller** — Handles events, lifecycle management, and setup.
- 🛤️ **Pathfinding** — Integrated pathfinder for navigation.
- 💬 **Chat Commands** — Command handler for in-game bot control.
- 🎨 **Console Flair** — Uses Chalk + Figlet for stylish console output.
- 🧰 **ESM Ready** — All modules use modern `import/export` syntax for easier maintenance and future updates.

---

## 📦 Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/RogueZephyr/Mineflayer-Templates.git
   cd Mineflayer-Templates
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

---

## 🎮 Usage

1. **Configure your bot:**
   - Edit `src/config/config.json` with your server details:
   ```json
   {
     "host": "your-server-address.com",
     "port": 25565,
     "version": "1.21.1",
     "debug": true,
     "enabledBehaviors": ["look", "eat", "sleep"]
   }
   ```

2. **Run the bot:**
   ```bash
   npm start
   ```

   The bot will connect to your configured server and start running enabled behaviors.

---

## 📁 Project Structure

```
src/
│
├── index.js                    # Main entry point (creates bot instance)
│
├── config/
│   ├── config.json            # Server and bot configuration
│   ├── foodList.json          # List of food items
│   ├── itemCategories.json    # Item categorization
│   └── items.js               # Item utilities
│
├── core/
│   ├── BotController.js       # Handles bot setup, login, events, and lifecycle
│   └── ConfigLoader.js        # Loads configuration files
│
├── behaviors/
│   ├── ChatLogger.js          # Logs chat messages
│   ├── DepositBehavior.js     # Deposits items in chests
│   ├── EatBehavior.js         # Manages eating when hungry
│   ├── FarmBehavior.js        # Automated farming behavior
│   ├── InventoryBehavior.js   # Inventory management
│   ├── LookBehavior.js        # Look at nearby players
│   ├── PathfinderBehavior.js  # Navigation and pathfinding
│   └── SleepBehavior.js       # Sleep when night falls
│
├── state/
│   └── BedRegistry.js         # Tracks bed locations
│
└── utils/
    ├── ChatCommandHandler.js  # Handles in-game commands
    ├── DebugTools.js          # Debug utilities
    ├── SaveChestLocation.js   # Saves chest locations
    └── logger.js              # Logging utilities
```

---
