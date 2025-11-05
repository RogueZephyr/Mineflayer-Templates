# Mining Behavior - Obstacle Handling Update (v2.0.1)

## Overview
Enhanced MiningBehavior with intelligent obstacle detection and handling. The bot now automatically detects and handles holes, water pockets, and lava pockets while maintaining its original Y level throughout mining operations.

## What's New

### Obstacle Detection System
The bot continuously monitors for three types of obstacles:
- **Holes/Gaps**: Air blocks that would cause the bot to fall
- **Water Pockets**: Water sources or flowing water
- **Lava Pockets**: Lava sources or flowing lava

### Automatic Handling
When an obstacle is detected, the bot:
1. **Pauses mining** to handle the obstacle
2. **Selects bridging material** from inventory (priority: cobblestone > dirt > stone)
3. **Places blocks** to bridge gaps or cover liquids
4. **Continues mining** on the same Y level

### Three-Stage Detection
The bot checks for obstacles at three critical moments:

1. **Pre-Dig Check**: Before breaking a block
   - Prevents mining into voids or lava pockets
   - Handles obstacles before they become dangerous

2. **Post-Dig Check**: After breaking a block
   - Detects exposed cavities, water, or lava
   - Covers or bridges newly revealed obstacles

3. **Floor Check**: While moving
   - Ensures safe footing at all times
   - Maintains original Y level

## Technical Implementation

### New Methods Added

#### Detection Methods
```javascript
_isHole(pos)          // Detects air/void blocks
_isWater(pos)         // Detects water blocks
_isLava(pos)          // Detects lava blocks
_detectObstacle(pos)  // Comprehensive obstacle check
```

#### Handling Methods
```javascript
_getBridgingMaterial()   // Finds suitable block from inventory
_placeBlock(pos, item)   // Places block at position
_bridgeGap(pos)          // Fills holes with blocks
_coverWater(pos)         // Covers water with blocks
_coverLava(pos)          // Covers lava with blocks
_handleObstacle(obstacle) // Coordinates obstacle handling
```

### Modified Methods
- **`_executeDig()`**: Now includes three obstacle checks (pre-dig, post-dig, floor)
- Enhanced with detailed debug logging for obstacle detection

## Configuration

### New Settings in config.json

```json
"obstacleHandling": {
  "handleObstacles": true,
  "bridgeGaps": true,
  "coverWater": true,
  "coverLava": true,
  "bridgingMaterials": [
    "cobblestone",
    "dirt", 
    "stone",
    "andesite",
    "diorite",
    "granite",
    "netherrack"
  ],
  "maxBridgeDistance": 5
}
```

### Settings Explained

| Setting | Default | Description |
|---------|---------|-------------|
| `handleObstacles` | `true` | Master toggle for obstacle detection |
| `bridgeGaps` | `true` | Automatically bridge holes/gaps |
| `coverWater` | `true` | Cover water sources with blocks |
| `coverLava` | `true` | Cover lava sources with blocks |
| `bridgingMaterials` | See above | Priority list of materials for bridging |
| `maxBridgeDistance` | `5` | Maximum consecutive blocks to bridge |

## Usage Examples

### Normal Mining with Obstacle Handling
```
!mine strip east 100 10
```
The bot will:
- Mine the planned strip mine pattern
- Automatically detect any holes, water, or lava
- Bridge/cover obstacles as encountered
- Continue mining on the same Y level
- Complete the entire operation safely

### Disable Obstacle Handling (Not Recommended)
Edit `config.json`:
```json
"handleObstacles": false
```

### Custom Bridging Materials
Edit `config.json` to prioritize specific materials:
```json
"bridgingMaterials": ["stone_bricks", "cobblestone", "deepslate"]
```

## Debugging

Enable mining debug mode to see obstacle handling in action:
```
!debug enable mining
```

You'll see output like:
```
[DEBUG:Mining] Detected hole after digging at (100, 12, 200)
[DEBUG:Mining] Bridging gap at (100, 11, 200)
[DEBUG:Mining] Found bridging material: cobblestone (32)
[DEBUG:Mining] Placed cobblestone at (100, 11, 200)
```

## Behavior Flow

```
┌─────────────────────┐
│ Navigate to Target  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Pre-Dig Check       │ ◄── Check for obstacles BEFORE digging
│ • Holes             │
│ • Water             │
│ • Lava              │
└──────────┬──────────┘
           │
           ▼
    ┌──────────┐
    │ Handle?  │──YES──► Bridge/Cover ──┐
    └──────────┘                         │
           │                             │
          NO                             │
           │                             │
           ▼                             ▼
┌─────────────────────┐         ┌───────────────┐
│ Dig Block           │         │ Continue Flow │
│ (ToolHandler)       │         └───────────────┘
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Post-Dig Check      │ ◄── Check for obstacles AFTER digging
│ (exposed cavity?)   │
└──────────┬──────────┘
           │
           ▼
    ┌──────────┐
    │ Handle?  │──YES──► Bridge/Cover ──┐
    └──────────┘                         │
           │                             │
          NO                             │
           │                             │
           ▼                             ▼
┌─────────────────────┐         ┌───────────────┐
│ Floor Check         │         │ Continue Flow │
│ (safe footing?)     │         └───────────────┘
└──────────┬──────────┘
           │
           ▼
    ┌──────────┐
    │ Handle?  │──YES──► Bridge/Cover ──┐
    └──────────┘                         │
           │                             │
          NO                             │
           │◄────────────────────────────┘
           ▼
┌─────────────────────┐
│ Next Block          │
└─────────────────────┘
```

## Benefits

### Safety
- **No falling**: Bot bridges all gaps automatically
- **No lava damage**: Covers lava before proceeding
- **No drowning**: Covers water pockets

### Efficiency
- **Maintains Y level**: Stays on target elevation throughout
- **No manual intervention**: Fully autonomous obstacle handling
- **Continuous operation**: Doesn't stop for environmental hazards

### Reliability
- **Cave mining**: Can mine through natural caves safely
- **Ravine crossing**: Bridges ravines to continue tunnel
- **Underground water**: Handles aquifers and water pockets

## Limitations

### Material Requirements
- Bot needs bridging materials in inventory
- Uses mined materials (cobblestone, dirt, stone)
- Will fail if no suitable blocks available

### Large Obstacles
- `maxBridgeDistance` limits how far bot will bridge
- Very large cavities may require manual intervention
- Consider pre-stocking with bridging materials for deep mining

### Mob Interference
- Obstacle handling doesn't include mob detection yet
- Mobs can still interrupt mining operations
- Future update will add mob avoidance

## Future Enhancements

Planned for future versions:
- **Smart Material Usage**: Reserve valuable blocks, use common materials first
- **Obstacle Mapping**: Remember obstacle locations for efficiency
- **Alternative Routing**: Route around large obstacles instead of bridging
- **Mob Integration**: Pause obstacle handling during mob threats
- **Torch Placement**: Combine obstacle handling with torch placement
- **Vein Mining**: Detect and mine exposed ore veins during obstacle handling

## Files Modified

### src/behaviors/MiningBehavior.js
- Added 9 new methods for obstacle detection and handling
- Enhanced `_executeDig()` with three-stage checking
- Added configuration loading for obstacle settings
- 200+ lines of new code

### src/config/config.json
- Added `obstacleHandling` section with 7 settings
- Comprehensive inline documentation
- Sensible defaults for safety

### docs/MINING.md
- Updated features list
- Added obstacle handling documentation
- Added troubleshooting section for obstacles
- Added technical details on detection system

## Migration Notes

### Existing Bots
- **No breaking changes**: All existing mining operations work as before
- **Auto-enabled**: Obstacle handling is ON by default
- **Can disable**: Set `handleObstacles: false` if unwanted

### Inventory Management
- **Stock bridging materials**: Ensure bot has cobblestone, dirt, or stone
- **Auto-generates materials**: Mining produces cobblestone naturally
- **Monitor inventory**: Bridging consumes blocks from inventory

### Testing Recommendations
1. Test in controlled environment with known obstacles
2. Enable debug mode: `!debug enable mining`
3. Verify bridging material priority order
4. Test with different obstacle types (holes, water, lava)
5. Confirm Y level maintenance across operations

## Version History

- **v2.0.1** (Current): Added obstacle detection and handling
- **v2.0.0**: Initial mining system with ToolHandler integration
- **v1.x**: Legacy behavior without obstacle handling

---

*This update maintains 100% backward compatibility while adding essential safety features for autonomous mining operations.*
