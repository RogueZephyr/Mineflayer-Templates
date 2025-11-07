# Mineflayer BasicBot - Documentation Overview

## Quick Start

### First Time Setup
1. Configure bot in `src/config/config.json` (server details, behaviors)
2. Add bot names to `data/botNames.json`
3. Set master player for admin commands
4. Run: `npm start`

### Essential Commands
```bash
!help                    # Show all commands
!ping                    # Test bot response
!come                    # Bring bot to you
!stop                    # Stop current task
```

See **[Command Reference](COMMAND_REFERENCE.md)** for complete command list.

---

## 📚 Documentation Index

### User Guides
Core features and how to use them:

- **[Command Reference](COMMAND_REFERENCE.md)** - Complete list of all bot commands with examples
- **[Mining Guide](MINING.md)** - Strip mining, tunneling, and quarry operations
- **[Woodcutting Guide](WOODCUTTING.md)** - Tree harvesting, replanting, and multi-bot coordination
- **[Pathfinding System](PATHFINDING.md)** - Navigation, collision avoidance, and path caching

### Technical Documentation
System internals and advanced features:

- **[Tool Handler](TOOLHANDLER.md)** - Automatic tool selection and durability management
- **[Whisper Patterns](WHISPER_PATTERNS.md)** - Custom server chat format configuration
- **[Performance Optimizations](PERFORMANCE_OPTIMIZATIONS.md)** - Multi-bot efficiency improvements

### Implementation Guides
For developers and contributors:

- **[Path Caching Implementation](PATH_CACHING_IMPLEMENTATION.md)** - Technical details of path caching system

---

## 🏗️ Architecture Overview

### Core Components
```
src/
├── core/
│   ├── BotController.js      # Main bot orchestrator
│   ├── BotCoordinator.js     # Multi-bot coordination
│   └── ConfigLoader.js       # Configuration management
├── behaviors/                 # Modular bot behaviors
│   ├── MiningBehavior.js     # Strip/tunnel/quarry mining
│   ├── WoodCuttingBehavior.js # Tree harvesting
│   ├── FarmBehavior.js       # Crop farming
│   └── ...
├── utils/                     # Shared utilities
│   ├── PathfindingUtil.js    # Centralized pathfinding
│   ├── PathCache.js          # Path caching system
│   ├── ToolHandler.js        # Tool management
│   └── ChatCommandHandler.js # Command parser
└── config/                    # Configuration files
```

### Behavior System
Behaviors are self-contained modules that:
- Receive `(bot, logger, master)` in constructor
- Implement `enable()` and `disable()` methods
- Register event handlers for bot events
- Maintain focused, single-purpose logic

### Configuration-Driven Design
All bot features are controlled via `src/config/config.json`:
```json
{
  "behaviors": {
    "mining": { "enabled": true, "settings": {...} },
    "woodcutting": { "enabled": true, "settings": {...} }
  }
}
```

---

## 🎯 Feature Highlights

### Mining
- **Strip Mining**: Main tunnel with alternating branches
- **Tunneling**: Directional tunnels with custom dimensions
- **Quarry**: Layer-by-layer rectangular excavation
- **Smart Deposit**: Multi-chest fallback system
- **Block Verification**: Ensures all blocks are actually broken
- **Obstacle Handling**: Auto-bridges holes, covers liquids

### Woodcutting
- **All Wood Types**: Vanilla + nether trees supported
- **Multi-Bot Zones**: Automatic area division
- **Opportunistic Mode**: Finds nearest trees
- **Auto-Replanting**: Matches saplings to tree types
- **Tree Claiming**: Prevents duplicate work

### Pathfinding
- **Collision Avoidance**: Bots never stack on same block
- **Path Caching**: 99% reduction in pathfinding overhead
- **Smart Invalidation**: Clears outdated paths automatically
- **Centralized Logic**: Consistent behavior across all features

### Tool Management
- **Auto-Selection**: Best tool for each block type
- **Durability Tracking**: Avoids breaking tools
- **Smart Switching**: Changes tools mid-task
- **200+ Block Mappings**: Comprehensive block-to-tool database

---

## 🔧 Common Configuration Tasks

### Adding Bot Names
Edit `data/botNames.json`:
```json
["BotName1", "BotName2", "BotName3"]
```

### Setting Master Player
Edit `src/config/config.json`:
```json
{
  "master": "YourMinecraftUsername"
}
```

### Configuring Mining
```json
{
  "behaviors": {
    "mining": {
      "enabled": true,
      "settings": {
        "defaultLength": 100,
        "branchSpacing": 3,
        "digVerifyDelayMs": 150,
        "keepBridgingTotal": 128,
        "keepFoodMin": 10
      }
    }
  }
}
```

### Enabling Debug Mode
```bash
# In-game commands
!debug enable mining
!debug enable wood
!debug enable pathfinding
!debug status
```

---

## 📊 Multi-Bot Coordination

### Work Zone Division
When multiple bots work in the same area:
- Coordinator automatically divides area into zones
- Each bot assigned exclusive zone
- Prevents duplicate work and collisions

### Block Claiming
- Trees, beds, and goals are claimed during use
- Other bots skip claimed resources
- Claims released after task completion

### Collision Avoidance
- All pathfinding checks for occupied positions
- Bots find alternative positions via spiral search
- Goals registered with coordinator

---

## 🛠️ Development

### Adding a New Behavior
1. Create file in `src/behaviors/YourBehavior.js`
2. Implement constructor with `(bot, logger, master)`
3. Add `enable()` and `disable()` methods
4. Register in `src/core/BotController.js`
5. Add configuration to `src/config/config.json`
6. Add commands in `src/utils/ChatCommandHandler.js`

### Configuration Files
```
src/config/
├── config.json           # Main configuration
├── foodList.json         # Edible items
├── itemCategories.json   # Item classification
└── items.js              # Item ID mappings

data/
├── botNames.json         # Bot username pool
├── chestLocations.json   # Storage locations
├── homeLocations.json    # Home positions
├── areas.json            # Work area boundaries
└── whitelist.json        # Whitelisted players
```

---

## 📖 Additional Resources

- **README.md** - Project overview and installation
- **CHANGELOG.md** - Version history and updates
- **changelogs/** - Detailed feature development logs

---

## 🤝 Contributing

When adding features:
1. Follow existing behavior patterns
2. Use centralized utilities (PathfindingUtil, ToolHandler)
3. Add configuration to `config.json`
4. Update relevant documentation
5. Test with single bot before multi-bot scenarios

---

*Last Updated: 2025*
