# Scaffolding System Documentation

## Overview

The scaffolding system enables bots to automatically build vertical pillars to climb tall structures (like trees) using mineflayer-pathfinder's built-in scaffolding capabilities. The system has been completely refactored from a custom `PillarBuilder` implementation to leverage pathfinder's native features with enhanced lag compensation and tracking.

## Architecture

### Components

1. **ScaffoldingUtil** (`src/utils/ScaffoldingUtil.js`)
   - Core scaffolding management utility
   - Configures pathfinder Movements for scaffolding
   - Tracks placed blocks for cleanup
   - Handles lag compensation

2. **PathfindingUtil** (`src/utils/PathfindingUtil.js`)
   - Extended `goto()` method with scaffolding support
   - Automatic movement restoration
   - Seamless integration with ScaffoldingUtil

3. **WoodCuttingBehavior** (`src/behaviors/WoodCuttingBehavior.js`)
   - Primary consumer of scaffolding system
   - Uses PathfindingUtil with scaffolding mode
   - Automatic cleanup after tree harvesting

## Features

### 1. Automatic Lag Compensation
The system dynamically adjusts pathfinder costs based on server latency:

```javascript
// Base costs (low latency)
placeCost: 10
digCost: 40

// High latency (>100ms ping)
placeCost: 10 + (ping - 100) / 10  // Max 50
digCost: 40 + (ping - 100) / 5     // Max 150
```

This ensures reliable block placement even on laggy servers.

### 2. Block Tracking
ScaffoldingUtil automatically tracks all placed scaffolding blocks:
- Listens to `blockPlaced` events
- Stores positions as unique keys
- Enables precise cleanup

### 3. Smart Cleanup
Two cleanup methods available:
- **Tracked cleanup**: Removes only blocks placed during operation
- **Scan cleanup**: Scans area for scaffolding blocks (fallback)

### 4. Safety Features
- `dontCreateFlow`: Prevents water/lava flow
- `dontMineUnderFallingBlock`: Avoids breaking sand/gravel support
- `infiniteLiquidDropdownDistance: false`: Prevents falling into liquids
- `maxDropDown`: Limits safe drop distance (default 4 blocks)

## Configuration

### Global Config (config.json)
```json
{
  "behaviors": {
    "woodcutting": {
      "scaffoldBlocks": ["dirt", "cobblestone", "netherrack"],
      "cleanupScaffold": true,
      "scaffolding": {
        "allowedBlocks": ["dirt", "cobblestone"],
        "basePlaceCost": 10,
        "baseDigCost": 40,
        "lagThresholdMs": 100,
        "allowParkour": false,
        "allowSprinting": false,
        "maxDropDown": 4,
        "trackPlacedBlocks": true,
        "cleanupDelayMs": 80
      }
    }
  }
}
```

### ScaffoldingUtil Initialization
Automatically initialized in `BotController`:

```javascript
this.scaffoldingUtil = new ScaffoldingUtil(this.bot, this.logger, {
  allowedBlocks: ['dirt', 'cobblestone', 'netherrack', 'stone'],
  basePlaceCost: 10,
  baseDigCost: 40,
  lagThresholdMs: 100,
  allowParkour: false,
  allowSprinting: false,
  maxDropDown: 4,
  trackPlacedBlocks: true,
  cleanupDelayMs: 80
});
this.bot.scaffoldingUtil = this.scaffoldingUtil;
```

## Usage Examples

### Method 1: PathfindingUtil with Scaffolding Mode (Recommended)

```javascript
// Enable scaffolding mode for climbing
await bot.pathfindingUtil.goto(
  targetPosition,
  15000,                    // timeout
  'climb_tree',             // task name
  1.5,                      // acceptable range
  { 
    scaffolding: true,      // enable scaffolding
    aggressive: false       // use safe settings
  }
);
```

### Method 2: Direct ScaffoldingUtil Usage

```javascript
// Start tracking placed blocks
bot.scaffoldingUtil.startTracking();

// Create custom movements
const movements = bot.scaffoldingUtil.createScaffoldingMovements({
  aggressive: false  // Use safe, lag-tolerant settings
});

// Apply movements to pathfinder
bot.pathfinder.setMovements(movements);

// Navigate to target (pathfinder will automatically scaffold)
const goal = new bot.pathfinder.goals.GoalBlock(x, y, z);
bot.pathfinder.setGoal(goal);

// Wait for completion...

// Cleanup placed scaffolding
await bot.scaffoldingUtil.cleanup(centerPos, 5);
```

### Method 3: Custom Movements Configuration

```javascript
// Get movements with custom options
const movements = bot.scaffoldingUtil.createScaffoldingMovements({
  aggressive: true,  // Faster, less safe
  maxHeight: 50      // Future: height limits
});

// Manually configure additional settings
movements.allowParkour = true;  // Enable parkour for faster movement
movements.digCost = 20;          // Lower dig cost (dig more aggressively)

bot.pathfinder.setMovements(movements);
```

## WoodCuttingBehavior Integration

The woodcutting behavior demonstrates best practices:

```javascript
async _harvestTree(basePos) {
  // Initialize scaffolding
  let scaffoldingUtil = this.bot.scaffoldingUtil;
  
  if (scaffoldingUtil) {
    // Check inventory
    const estimatedHeight = topY - baseY;
    if (!scaffoldingUtil.hasEnoughBlocks(estimatedHeight + 5)) {
      this._emitDebug('Warning: May not have enough scaffolding blocks');
    }
    
    // Start tracking
    scaffoldingUtil.startTracking();
  }
  
  // ... harvest logs at ground level ...
  
  // Climb using scaffolding
  while (remainingLogsExist()) {
    await breakReachableLogs();
    
    // Climb 3 blocks higher
    const targetY = currentY + 3;
    await bot.pathfindingUtil.goto(
      new Vec3(x, targetY, z),
      15000,
      'scaffold_climb',
      1.5,
      { scaffolding: true }
    );
    
    currentY = targetY;
  }
  
  // Cleanup scaffolding
  if (this.settings.cleanupScaffold && scaffoldingUtil) {
    scaffoldingUtil.stopTracking();
    await scaffoldingUtil.cleanup(basePos, 5);
  }
}
```

## API Reference

### ScaffoldingUtil

#### Constructor
```javascript
new ScaffoldingUtil(bot, logger, config)
```

#### Methods

**`createScaffoldingMovements(options)`**
- Creates Movements configured for scaffolding
- Options:
  - `aggressive`: Use faster, less safe settings
  - `maxHeight`: (Future) Maximum height limit
- Returns: `Movements` instance

**`startTracking()`**
- Begins tracking placed scaffolding blocks
- Attaches `blockPlaced` event listener

**`stopTracking()`**
- Stops tracking
- Detaches event listener
- Logs total blocks placed

**`cleanup(centerPos, radius)`**
- Removes tracked scaffolding blocks
- Cleans top-to-bottom for safety
- Params:
  - `centerPos`: Center position (Vec3)
  - `radius`: Cleanup radius (number)
- Returns: Promise\<number\> (blocks removed)

**`hasEnoughBlocks(estimatedHeight)`**
- Checks if inventory has enough scaffolding blocks
- Returns: boolean

**`getScaffoldItem()`**
- Gets first available scaffolding item from inventory
- Returns: Item | null

**`scanForScaffoldBlocks(centerPos, radius, minY, maxY)`**
- Scans area for scaffolding blocks (alternative to tracking)
- Returns: Vec3[] array of positions

**`getStats()`**
- Returns scaffolding statistics object

### PathfindingUtil Extensions

**`goto(pos, timeout, task, range, options)`**
- Extended with scaffolding support
- New options parameter:
  - `movements`: Custom Movements instance
  - `scaffolding`: Enable scaffolding mode (boolean)
  - `aggressive`: Use aggressive scaffolding (boolean)

## Performance Optimization

### Lag Tolerance
The system automatically compensates for lag:
- **Low ping (<100ms)**: Uses base costs for fast movement
- **High ping (>100ms)**: Increases costs proportionally
- **Very high ping (>300ms)**: Costs capped at maximum values

### Block Placement Verification
Pathfinder naturally handles block placement verification through cost adjustments:
- Higher `placeCost` = more patience after placing blocks
- Prevents "ghost blocks" on laggy servers

### Cleanup Efficiency
- Tracked cleanup is faster (only removes known blocks)
- Top-to-bottom removal prevents floating blocks
- Configurable delay between digs (default 80ms)

## Troubleshooting

### Bot gets stuck while scaffolding
**Solution**: Increase lag compensation thresholds
```javascript
bot.scaffoldingUtil.updateSettings({
  basePlaceCost: 20,  // Increase from 10
  baseDigCost: 60,    // Increase from 40
  lagThresholdMs: 50  // Trigger compensation earlier
});
```

### Scaffolding blocks not cleaned up
**Solution**: Ensure tracking is enabled
```javascript
// Check if tracking is active
const stats = bot.scaffoldingUtil.getStats();
console.log(`Tracked blocks: ${stats.trackedBlocks}`);

// Use scan-based cleanup as fallback
const blocks = bot.scaffoldingUtil.scanForScaffoldBlocks(centerPos, 5);
```

### Bot falls during climb
**Solution**: Reduce movement speed, disable risky movements
```javascript
const movements = bot.scaffoldingUtil.createScaffoldingMovements({
  aggressive: false  // Use safe mode
});
movements.allowParkour = false;
movements.allowSprinting = false;
```

### Not enough scaffolding blocks
**Solution**: Implement inventory restocking
```javascript
// Check before operation
if (!bot.scaffoldingUtil.hasEnoughBlocks(estimatedHeight)) {
  // Restock from chest
  await restockScaffoldingBlocks();
}
```

## Migration from PillarBuilder

### Old Code
```javascript
import PillarBuilder from '../utils/PillarBuilder.js';

const pillar = new PillarBuilder(bot, logger, {
  allowedBlocks: ['dirt', 'cobblestone']
});

await pillar.buildUp(column, startY, 5);
await pillar.cleanup();
```

### New Code
```javascript
// No import needed - initialized in BotController

bot.scaffoldingUtil.startTracking();

await bot.pathfindingUtil.goto(
  new Vec3(column.x, startY + 5, column.z),
  15000,
  'climb',
  1.5,
  { scaffolding: true }
);

await bot.scaffoldingUtil.cleanup(column, 5);
```

## Best Practices

1. **Always track when cleanup is needed**
   ```javascript
   bot.scaffoldingUtil.startTracking();
   // ... scaffolding operations ...
   await bot.scaffoldingUtil.cleanup(centerPos, radius);
   ```

2. **Check inventory before scaffolding**
   ```javascript
   if (!bot.scaffoldingUtil.hasEnoughBlocks(height)) {
     // Handle insufficient blocks
   }
   ```

3. **Use PathfindingUtil for consistency**
   ```javascript
   // Preferred over direct pathfinder usage
   await bot.pathfindingUtil.goto(pos, timeout, task, range, { scaffolding: true });
   ```

4. **Clean up even on errors**
   ```javascript
   try {
     bot.scaffoldingUtil.startTracking();
     // ... scaffolding operations ...
   } finally {
     await bot.scaffoldingUtil.cleanup(centerPos, radius);
   }
   ```

5. **Use aggressive mode only when safe**
   ```javascript
   // On low-lag servers with flat terrain
   await bot.pathfindingUtil.goto(pos, timeout, task, range, { 
     scaffolding: true, 
     aggressive: true 
   });
   ```

## Future Enhancements

Potential improvements for the scaffolding system:

1. **Predictive Lag Compensation**: Learn optimal costs from past operations
2. **Multi-Column Scaffolding**: Build 2x2 platforms for stability
3. **Material Optimization**: Prefer cheaper blocks when available
4. **Intelligent Restock**: Automatically fetch blocks from nearby chests
5. **Scaffold Templates**: Pre-calculated patterns for common structures
6. **Height Limits**: Configurable maximum scaffolding height
7. **Safety Checks**: Detect unsafe situations (lava, void, etc.)

## See Also

- [WOODCUTTING.md](./WOODCUTTING.md) - Woodcutting behavior documentation
- [PATHFINDING.md](./PATHFINDING.md) - Pathfinding system documentation
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) - Upstream pathfinder plugin
