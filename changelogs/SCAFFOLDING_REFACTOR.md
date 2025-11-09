# Scaffolding System Refactor - Implementation Summary

## Overview
Complete refactor of the scaffolding system to properly leverage mineflayer-pathfinder's native capabilities with enhanced lag compensation, block tracking, and cleanup management.

## What Changed

### New Files Created

#### 1. `src/utils/ScaffoldingUtil.js` (393 lines)
**Purpose**: Core scaffolding management utility

**Key Features**:
- Creates optimized Movements configurations for scaffolding
- Dynamic lag compensation based on server ping
- Tracks placed scaffolding blocks for cleanup
- Smart block inventory checking
- Configurable safety settings
- Statistics and debugging support

**Main Methods**:
- `createScaffoldingMovements(options)` - Configure pathfinder for scaffolding
- `startTracking()` / `stopTracking()` - Track placed blocks
- `cleanup(centerPos, radius)` - Remove placed scaffolding
- `hasEnoughBlocks(height)` - Check inventory
- `getScaffoldItem()` - Get available scaffolding item
- `scanForScaffoldBlocks()` - Find scaffolding in area

#### 2. `docs/SCAFFOLDING.md` (395 lines)
**Purpose**: Complete documentation for scaffolding system

**Contents**:
- Architecture overview
- Feature descriptions
- Configuration examples
- Usage patterns (3 methods)
- API reference
- Performance optimization guide
- Troubleshooting section
- Migration guide from PillarBuilder
- Best practices

### Modified Files

#### 1. `src/utils/PathfindingUtil.js`
**Changes**: Extended `goto()` method to support scaffolding

**Added Parameters**:
```javascript
async goto(pos, timeoutMs, task, range, options = {})
// New options:
// - movements: Custom Movements instance
// - scaffolding: Enable scaffolding mode (uses ScaffoldingUtil)
// - aggressive: Use aggressive scaffolding settings
```

**Implementation**:
- Stores original movements before applying custom ones
- Automatically restores movements after pathfinding
- Integrates with ScaffoldingUtil when available
- Handles errors gracefully with movement restoration

#### 2. `src/behaviors/WoodCuttingBehavior.js`
**Changes**: Complete refactor to use new scaffolding system

**Removed**:
- Import of `mineflayer-pathfinder` components
- Import of `minecraft-data`
- Inline pathfinder configuration (~50 lines)
- Complex climbUp implementation with manual movement setup

**Added**:
- ScaffoldingUtil integration
- Block tracking initialization
- Simplified climbUp using PathfindingUtil
- Enhanced cleanup using ScaffoldingUtil
- Fallback for when ScaffoldingUtil unavailable

**Key Changes**:
```javascript
// Before: Manual pathfinder configuration
const mcData = mcDataFactory(this.bot.version);
const defaultMove = new Movements(this.bot, mcData);
// ... 30+ lines of configuration ...

// After: Simple PathfindingUtil call
await bot.pathfindingUtil.goto(
  targetPos,
  15000,
  'scaffold_climb',
  1.5,
  { scaffolding: true }
);
```

#### 3. `src/core/BotController.js`
**Changes**: Initialize ScaffoldingUtil for all bots

**Added**:
- Import of ScaffoldingUtil
- ScaffoldingUtil initialization in `onSpawn()`
- Configuration loading from config.json
- Attachment to bot instance

**Configuration Loading**:
```javascript
const scaffoldConfig = this.config.behaviors?.woodcutting?.scaffolding || {};
this.scaffoldingUtil = new ScaffoldingUtil(this.bot, this.logger, {
  allowedBlocks: scaffoldConfig.allowedBlocks || ['dirt', 'cobblestone'],
  basePlaceCost: scaffoldConfig.basePlaceCost || 10,
  baseDigCost: scaffoldConfig.baseDigCost || 40,
  lagThresholdMs: scaffoldConfig.lagThresholdMs || 100,
  // ... more settings
});
this.bot.scaffoldingUtil = this.scaffoldingUtil;
```

#### 4. `src/utils/PillarBuilder.js`
**Changes**: Updated deprecation notice

**Updates**:
- Points to ScaffoldingUtil as replacement
- Updated migration examples
- Explains benefits of new system
- Clearer documentation structure

#### 5. `docs/WOODCUTTING.md`
**Changes**: Updated scaffolding section

**Updates**:
- New scaffolding system documentation
- ScaffoldingUtil usage examples
- Updated configuration section
- Link to SCAFFOLDING.md
- Version updated to v2.2.0+

## Technical Improvements

### 1. Lag Compensation
**Previous**: Fixed timing delays
**Now**: Dynamic adjustment based on ping
```javascript
// Automatically adjusts costs
if (ping > lagThresholdMs) {
  placeCost *= (1 + (ping - lagThresholdMs) / 100);
  digCost *= (1 + (ping - lagThresholdMs) / 100);
}
```

### 2. Block Tracking
**Previous**: Manual scanning of area (inefficient)
**Now**: Event-based tracking
```javascript
bot.on('blockPlaced', (oldBlock, newBlock) => {
  if (isScaffoldingBlock(newBlock)) {
    placedBlocks.add(newBlock.position);
  }
});
```

### 3. Cleanup Efficiency
**Previous**: Full area scan, any order
**Now**: Tracked blocks only, top-to-bottom
```javascript
// Sort by height for safe removal
positions.sort((a, b) => b.y - a.y);
for (const pos of positions) {
  await dig(pos);
}
```

### 4. Code Organization
**Previous**: Inline configuration in WoodCuttingBehavior
**Now**: Centralized in ScaffoldingUtil
- Single source of truth
- Reusable across behaviors
- Easier to test and maintain

### 5. Error Handling
**Previous**: Limited error recovery
**Now**: Comprehensive error handling
- Movement restoration on failure
- Fallback to scan-based cleanup
- Graceful degradation without ScaffoldingUtil

## Configuration Schema

### New Config Options
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

### Backward Compatibility
Old config still works (uses defaults):
```json
{
  "behaviors": {
    "woodcutting": {
      "scaffoldBlocks": ["dirt", "cobblestone"],
      "cleanupScaffold": true
    }
  }
}
```

## Usage Patterns

### Pattern 1: Simple Scaffolding (Recommended)
```javascript
await bot.pathfindingUtil.goto(
  targetPos,
  15000,
  'climb',
  1.5,
  { scaffolding: true }
);
```

### Pattern 2: With Cleanup
```javascript
bot.scaffoldingUtil.startTracking();
await bot.pathfindingUtil.goto(pos, 15000, 'climb', 1.5, { scaffolding: true });
await bot.scaffoldingUtil.cleanup(centerPos, 5);
```

### Pattern 3: Custom Configuration
```javascript
const movements = bot.scaffoldingUtil.createScaffoldingMovements({
  aggressive: true  // Faster climbing
});
bot.pathfinder.setMovements(movements);
// ... pathfind to target ...
```

## Benefits

### For Users
1. **More reliable** - Works better on laggy servers
2. **Cleaner** - Automatically removes scaffolding blocks
3. **Smarter** - Adapts to server conditions
4. **Safer** - Better collision detection and safety checks

### For Developers
1. **Maintainable** - Centralized scaffolding logic
2. **Reusable** - Can be used by any behavior
3. **Testable** - Isolated utility class
4. **Extensible** - Easy to add new features
5. **Documented** - Comprehensive documentation

### Performance
1. **Faster cleanup** - Only removes placed blocks
2. **Better timing** - Lag-adjusted costs
3. **Resource efficient** - Tracks exactly what was placed
4. **Optimized pathfinding** - Uses pathfinder's native features

## Migration Guide

### For Existing Deployments

#### No Changes Required
The system maintains backward compatibility. WoodcuttingBehavior will:
- Use ScaffoldingUtil if available
- Fall back to manual methods if not
- Continue working with existing configs

#### To Enable New Features
Add scaffolding config to `config.json`:
```json
{
  "behaviors": {
    "woodcutting": {
      "scaffolding": {
        "lagThresholdMs": 100,
        "trackPlacedBlocks": true
      }
    }
  }
}
```

### For Custom Behaviors

#### Old Code
```javascript
import PillarBuilder from '../utils/PillarBuilder.js';
const pillar = new PillarBuilder(bot, logger);
await pillar.buildUp(column, startY, 5);
```

#### New Code
```javascript
// ScaffoldingUtil is already on bot instance
await bot.pathfindingUtil.goto(
  new Vec3(column.x, startY + 5, column.z),
  15000,
  'climb',
  1.5,
  { scaffolding: true }
);
```

## Testing Recommendations

### Test Cases
1. **Basic climbing** - Climb 5-10 blocks
2. **Tall trees** - Test with 20+ block height
3. **Lag simulation** - Test with high ping
4. **Cleanup verification** - Ensure all blocks removed
5. **Error recovery** - Test pathfinding failures
6. **Inventory checks** - Test with insufficient blocks
7. **Multi-bot** - Test coordination with multiple bots

### Test Scenarios
1. Low-lag server (< 50ms ping)
2. Medium-lag server (100-200ms ping)
3. High-lag server (> 300ms ping)
4. Uneven terrain
5. Obstructed paths
6. Limited inventory space

## Known Limitations

1. **Requires mineflayer-pathfinder** - Won't work without it
2. **Block types limited** - Only supports solid blocks
3. **No underwater scaffolding** - Water mechanics differ
4. **Height limitations** - Pathfinder has max path length
5. **Concurrent operations** - One scaffolding op per bot at a time

## Future Enhancements

Potential improvements identified:
1. Predictive lag compensation (learn from history)
2. Multi-column scaffolding (2x2 platforms)
3. Material optimization (prefer cheaper blocks)
4. Intelligent restocking (auto-fetch from chests)
5. Scaffold templates (pre-calculated patterns)
6. Height limits (configurable max height)
7. Enhanced safety (detect lava, void, etc.)

## Conclusion

The scaffolding system refactor provides:
- ✅ More reliable scaffolding on all server types
- ✅ Cleaner resource management with tracking
- ✅ Better integration with pathfinding system
- ✅ Comprehensive documentation
- ✅ Backward compatibility
- ✅ Foundation for future enhancements

Total changes: **5 files modified, 2 files created, 788 lines added**
