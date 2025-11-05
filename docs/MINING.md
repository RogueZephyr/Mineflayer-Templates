# Mining Behavior Documentation

## Overview
The MiningBehavior provides modular mining strategies with inventory-aware stopping and automatic chest deposits. The bot can execute strip mining, tunneling, and (future) quarry operations.

## Features

### Implemented Features
- **Strip Mining**: Main tunnel with alternating side branches
- **Tunnel Mining**: Long directional 2x2 tunnels
- **Tool Management**: Automatically equips best available pickaxe via ToolHandler
- **Inventory Management**: Auto-deposit when inventory fills up
- **Obstacle Detection & Handling** *(NEW v2.0.1)*: 
  - Detects holes, water pockets, and lava pockets
  - Automatically bridges gaps to maintain Y level
  - Covers water sources with blocks for safe passage
  - Covers lava sources to prevent damage
  - Maintains original mining Y level throughout operation
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

### Obstacle Handling *(NEW v2.0.1)*
- `handleObstacles`: Enable automatic obstacle detection and handling (default: true)
- `bridgeGaps`: Automatically bridge gaps/holes (default: true)
- `coverWater`: Cover water pockets with blocks (default: true)
- `coverLava`: Cover lava pockets with blocks (default: true)
- `bridgingMaterials`: Priority list of materials for bridging
  - Default: `["cobblestone", "dirt", "stone", "andesite", "diorite", "granite", "netherrack"]`
  - Bot uses first available material from the list
- `maxBridgeDistance`: Maximum distance to bridge in one go (default: 5)

**How It Works:**
When mining, the bot:
1. Checks for obstacles **before** digging (prevents mining into voids)
2. Checks for obstacles **after** digging (handles exposed cavities)
3. Checks floor constantly (maintains safe footing and Y level)
4. Automatically places blocks to bridge/cover obstacles
5. Continues mining at the same Y level

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
- **Obstacle detection** (before and after digging)
- **Obstacle handling** (bridging, covering water/lava)
- Tool equipping (via ToolHandler)
- Block breaking
- Drop collection (via ItemCollectorBehavior)

### Obstacle Detection & Handling *(NEW v2.0.1)*
The bot now intelligently handles obstacles encountered during mining:

**Detection:**
- **Holes/Gaps**: Air blocks below the mining path
- **Water Pockets**: Flowing or still water in the path
- **Lava Pockets**: Flowing or still lava in the path

**Handling:**
- **Pre-Dig Check**: Scans the target position before mining
- **Post-Dig Check**: Scans after mining (in case cavity exposed)
- **Floor Check**: Continuously validates safe footing

**Bridging System:**
1. Detects gap in mining path
2. Selects bridging material from inventory (priority: cobblestone > dirt > stone > etc.)
3. Places block to fill gap, maintaining original Y level
4. Continues mining on same elevation

**Material Priority:**
- Cobblestone (preferred)
- Dirt
- Stone
- Andesite, Diorite, Granite
- Netherrack
- Any other solid block (excluding tools and valuables)

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
- Obstacle detection (holes, water, lava)
- Bridging operations
- Pathfinding attempts
- Deposit operations
- Progress updates

Disable with:
```
!debug disable mining
```

### Obstacle Handling Issues

**Bot stops mining when encountering obstacles:**
- Check if `handleObstacles` is enabled in config.json
- Verify bot has bridging materials in inventory (cobblestone, dirt, stone)
- Use `!debug enable mining` to see which obstacle is blocking

**Bot falls into holes:**
- Ensure `bridgeGaps` is set to true
- Bot needs solid blocks in inventory to bridge
- Check if bot has enough inventory space for bridging materials

**Bot takes damage from lava:**
- Ensure `coverLava` is set to true
- Verify bot has fire resistance or adequate health
- Bot will attempt to cover lava before proceeding

**Bot drowns in water:**
- Ensure `coverWater` is set to true
- Bot should cover water pockets automatically
- Check if bot has bridging materials available

**Bot can't find bridging material:**
- Add preferred materials to inventory: cobblestone, dirt, stone
- Adjust `bridgingMaterials` list in config.json to match available blocks
- Bot will try to use any solid block if preferred materials unavailable
