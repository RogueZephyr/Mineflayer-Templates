# Quick Installation Guide

## Prerequisites
- Node.js 16+ installed
- npm (comes with Node.js)

## Installation

### Option 1: Using the install script (Recommended)
```bash
node install.js
```

### Option 2: Manual installation
```bash
npm install
```

## Configuration

1. Edit `src/config/config.json`:
   - Set your Minecraft server details (host, port, version)
   - Configure bot username/password if needed

2. Configure chest locations in-game:
   ```
   !setchest tools [x y z]    # Tools chest location
   !setchest crops [x y z]    # Crops storage
   !setchest ores [x y z]     # Ores storage
   !setchest wood [x y z]     # Wood storage
   ```

3. Set farming area (stand at corners):
   ```
   !setarea farm start    # First corner
   !setarea farm end      # Opposite corner
   ```

## Running the Bot

### Development mode (auto-restart on changes)
```bash
npm start
```

### Production mode (single run)
```bash
npm run dev
```

## Quick Start - Farming

1. Place a hoe in the tools chest
2. Ensure you have seeds/crops to plant
3. Set the farming area boundaries
4. Start farming:
   ```
   !farm start
   ```
5. Stop farming:
   ```
   !farm stop
   ```

## Available Commands

### Chest Management
- `!setchest <category> [x y z]` - Register chest location
- `!deposit [category]` - Deposit items by category
- `!depositall` - Deposit all items to categorized chests

### Area Management
- `!setarea <type> start [x y z]` - Set start corner (stand at position or provide coords)
- `!setarea <type> end [x y z]` - Set end corner
- `!setarea <type> clear` - Clear saved area
- Area types: `farm`, `quarry`, `lumber` (more coming soon)

### Farming
- `!farm start` - Begin automated farming
- `!farm stop` - Stop farming

### Movement
- `!come` - Come to your position
- `!goto <x> <y> <z>` - Go to coordinates
- `!follow <player>` - Follow a player
- `!stop` - Stop current action

### Inventory
- `!drop <all|wood|ores|resources|item>` - Drop items
- `!eat` - Eat food

### Debug
- `!debug <module> on/off` - Toggle debug output
- `!diag [module]` - Get diagnostics

## Troubleshooting

### Bot doesn't move
- Check pathfinder is loaded: `!diag`
- Ensure area is accessible
- Try `!testgoto <x> <y> <z>`

### Chest operations fail
- Verify chest coordinates: check `data/chestLocations.json`
- Ensure chest is accessible
- Check container is not open by another player

### Farming doesn't work
- Ensure hoe is in tools chest
- Check farming area is set: `!setarea`
- Verify crops are within scan range
- Enable debug: `!debug farm on`

## File Structure

```
Mineflayer_BasicBot/
├── src/
│   ├── behaviors/        # Bot behaviors (farming, deposit, etc.)
│   ├── config/          # Static configuration
│   ├── core/            # Core bot controller
│   ├── state/           # State management
│   └── utils/           # Utilities (commands, logging, etc.)
├── data/                # Runtime data (chest locations, diagnostics)
├── package.json
├── install.js
└── README.md
```

## Support

For issues or questions, check:
1. Console debug output
2. `data/diagnostics-*.json` files
3. Enable module-specific debug: `!debug <module> on`
