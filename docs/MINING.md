# Mining Behavior Documentation

## Overview
The MiningBehavior provides modular mining strategies with inventory-aware stopping and automatic chest deposits. The bot can execute strip mining, tunneling, and (future) quarry operations.

## Features

### Implemented Features
- **Strip Mining**: Main tunnel with alternating side branches
- **Tunnel Mining**: Long directional 2x2 tunnels
- **Tool Management**: Automatically equips best available pickaxe
- **Inventory Management**: Auto-deposit when inventory fills up
- **Pathfinding Integration**: Uses centralized pathfinding with path caching
- **Multi-bot Coordination**: Respects shared coordinator for multi-bot setups

### Placeholder Features (Future Implementation)
- **Quarry Mode**: Layer-by-layer square area excavation with stairway access
- **Torch Placement**: Automatic torch placement at configurable intervals
- **Vein Mining**: Enhanced ore detection and contiguous vein mining
- **Tool Restocking**: Auto-restock tools from designated chest
- **Light Level Checks**: Safety checks for adequate lighting
- **Mob Avoidance**: Detect and respond to hostile mobs
- **Courier Handoff**: Transfer inventory to courier bots for continuous mining

## Usage

### Chat Commands

#### Strip Mining
```
!mine strip <direction> [mainLength] [numBranches]
```
- **direction**: north, south, east, west (required)
- **mainLength**: Length of main tunnel in blocks (default: 100)
- **numBranches**: Number of side branches (default: 10)

**Example:**
```
!mine strip east 100 10
```
Creates a 100-block main tunnel heading east with 10 side branches (5 on each side).

#### Tunnel Mining
```
!mine tunnel <direction> [length]
```
- **direction**: north, south, east, west (required)
- **length**: Length of tunnel in blocks (default: 100)

**Example:**
```
!mine tunnel north 50
```
Creates a 50-block 2x2 tunnel heading north.

#### Other Commands
```
!mine stop           # Stop current mining operation
!mine status         # Show mining status and progress
!mine quarry         # (Not yet implemented)
```

### Programmatic API

```javascript
// Get mining behavior
const mining = bot.behaviors.mining;

// Strip mining
const startPos = bot.entity.position.floored();
await mining.startStripMining(startPos, 'east', 100, 10);

// Tunnel mining
await mining.startTunnel(startPos, 'north', 50);

// Stop mining
mining.stopMining();
```

## Configuration

Located in `src/config/config.json` under `behaviors.mining`:

### General Settings
- `enabled`: Enable/disable mining behavior (default: true)
- `depositThreshold`: Number of items before auto-deposit (default: 320 = 5 stacks)
- `returnOnFullInventory`: Auto-return to chest when full (default: true)

### Strip Mining Settings
- `stripMainTunnelHeight`: Height of main tunnel (default: 2)
- `stripMainTunnelWidth`: Width of main tunnel (default: 1)
- `stripBranchSpacing`: Blocks between branches (default: 3)
  - 3 leaves 2 blocks between branches for optimal ore visibility
- `stripBranchLength`: Length of each side branch (default: 32)

### Tunnel Settings
- `tunnelHeight`: Height of tunnel (default: 2)
- `tunnelWidth`: Width of tunnel (default: 2)

### Tool Management
- `toolMinDurability`: Minimum durability before tool replacement (default: 10)

### Torch Settings (Placeholder)
- `torchInterval`: Blocks between torches (default: 8)
- `autoPlaceTorches`: Enable auto-torch placement (default: false)
  - **Note**: Not yet implemented

### Safety Settings (Placeholder)
- `checkLightLevel`: Enable light level safety checks (default: false)
- `minLightLevel`: Minimum safe light level (default: 8)
  - **Note**: Not yet implemented

## Mining Strategies

### Strip Mining Pattern
```
Main Tunnel (100 blocks)
├── Branch 1 Left (32 blocks) ──►
├── Branch 2 Right ◄── (32 blocks)
├── Branch 3 Left (32 blocks) ──►
├── Branch 4 Right ◄── (32 blocks)
└── ... (continues)
```

Spacing of 3 blocks ensures maximum ore visibility while minimizing excavation.

### Tunnel Mining
Creates a 2x2 tunnel in the specified direction, ideal for:
- Long-distance underground travel
- Connecting mining areas
- Rail systems
- Exploring caves

## Technical Details

### Tool Priority
The bot automatically selects the best available pickaxe:
1. Netherite Pickaxe
2. Diamond Pickaxe
3. Iron Pickaxe
4. Stone Pickaxe
5. Golden Pickaxe
6. Wooden Pickaxe

### Mining Plan System
Mining operations are represented as sequences of `digActions`:
```javascript
{
  position: Vec3(x, y, z),
  action: 'dig',
  priority: 'main_tunnel' | 'branch' | 'tunnel'
}
```

The behavior processes actions sequentially, handling:
- Navigation to each block
- Tool equipping
- Block breaking
- Drop collection (via ItemCollectorBehavior)

### Deposit System
When inventory reaches threshold:
1. Bot navigates to deposit location (registered mining chest or start position)
2. Searches for nearby chest (10-block radius)
3. Deposits all non-tool items
4. Returns to mining position
5. Resumes mining

## Integration

### Chest Registry
Register a mining chest for automatic deposits:
```javascript
// In-game via debug tools
!debug exec bot.chestRegistry.addChest(bot.entity.position, 'mining', 'Ore Storage')

// Or programmatically
bot.chestRegistry.addChest(chestPosition, 'mining', 'Main Mining Deposit');
```

### Multi-bot Coordination
The mining behavior respects the shared BotCoordinator:
- Work zones prevent path conflicts
- Block claiming prevents simultaneous mining of same block
- Collision avoidance at goal positions

### PathfindingUtil Integration
All navigation uses the centralized PathfindingUtil:
- Path caching for repeated routes (to/from deposit chest)
- Configurable timeouts
- Task-based labeling for debugging

## Future Enhancements

### Quarry Mode (Planned)
Layer-by-layer excavation of a defined square area:
- User defines two corners
- Bot creates stairway every N layers
- Systematic clearing from top to bottom
- Ideal for creating large underground rooms

### Vein Mining (Planned)
When ore is discovered:
1. Identify ore type
2. Search for all connected ore blocks
3. Mine entire vein before continuing
4. Return to original mining plan position

### Torch Placement (Planned)
- Place torches at configurable intervals
- Detect light level before placing
- Use walls/floor for placement
- Track torch inventory

### Tool Restocking (Planned)
- Register tool chest location
- Monitor tool durability
- Auto-return to tool chest when needed
- Withdraw replacement pickaxe
- Resume mining from last position

### Courier System (Planned)
- Request courier bot when inventory full
- Wait for courier arrival
- Transfer items to courier
- Continue mining without deposit trip
- Significantly increases mining efficiency

## Troubleshooting

### Bot stops mining
- Check pickaxe availability in inventory
- Verify deposit chest is accessible
- Check for pathfinding errors in logs
- Use `!mine status` to see current state

### Bot doesn't deposit
- Ensure chest exists near mining start position
- Register a mining chest with `bot.chestRegistry.addChest()`
- Check `returnOnFullInventory` setting is true

### Branches are too close/far apart
- Adjust `stripBranchSpacing` in config.json
- Value of 3 is optimal for diamond/ore visibility
- Lower values = more thorough but slower
- Higher values = faster but may miss ores

### Performance issues
- Reduce `mainTunnelLength` and `numBranches`
- Ensure path caching is enabled
- Check if multiple bots are mining simultaneously
- Verify server has adequate TPS

## Debug Mode

Enable mining debug output:
```
!debug enable mining
```

This will show:
- Dig action execution
- Tool selection
- Pathfinding attempts
- Deposit operations
- Progress updates

Disable with:
```
!debug disable mining
```
