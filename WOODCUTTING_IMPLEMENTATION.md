# 🪓 Woodcutting Implementation Summary

## What Was Built

A complete woodcutting automation system for Mineflayer bots with the following capabilities:

### Core Features Implemented
1. ✅ **Tree Detection & Harvesting**
   - Detects all vanilla log types (oak, spruce, birch, jungle, acacia, dark oak, cherry, mangrove)
   - Supports nether wood (crimson stems, warped stems)
   - Smart tree base/top detection
   - Handles complex tree structures with branches

2. ✅ **Area-Based Operation**
   - Bots can work within designated woodcutting zones
   - Multi-bot work zone division
   - Automatic area splitting based on bot count

3. ✅ **Opportunistic Mode**
   - When no area is set, bots find and harvest nearest trees
   - Searches up to 50 blocks away (configurable)
   - Great for forest clearing and exploration

4. ✅ **Auto-Replanting**
   - Matches log type to correct sapling
   - Validates ground suitability
   - Handles fungus for nether trees

5. ✅ **Multi-Bot Coordination**
   - Tree claiming system (prevents duplicate work)
   - Work zone assignment
   - Collision avoidance during navigation

6. ✅ **Inventory Management**
   - Auto-collects dropped logs after harvesting
   - Auto-deposits when threshold reached (128 logs = 2 stacks)
   - Works with existing DepositBehavior

7. ✅ **Integration**
   - Pauses/resumes LookBehavior appropriately
   - Uses ItemCollectorBehavior for drops
   - Full coordinator support
   - Debug system integration

## Files Created/Modified

### New Files
- `src/behaviors/WoodCuttingBehavior.js` (522 lines)
- `docs/WOODCUTTING.md` (comprehensive documentation)

### Modified Files
- `src/core/BotController.js` - Added WoodCuttingBehavior initialization
- `src/utils/ChatCommandHandler.js` - Added `!wood` commands
- `src/config/config.json` - Added woodcutting configuration
- `README.md` - Updated with woodcutting documentation

## Commands Added

```bash
# Start woodcutting (with area)
!setarea wood start
!setarea wood end
!wood start

# Start woodcutting (opportunistic - no area)
!wood start

# Stop woodcutting
!wood stop

# Debug woodcutting
!debug enable wood
```

## How It Works

### Area-Based Workflow
1. Player sets area boundaries with `!setarea wood start/end`
2. Bot command `!wood start` triggers behavior
3. Bot scans entire area for trees
4. If multiple bots: coordinator divides area into zones
5. Each bot harvests trees in their zone
6. Trees are claimed during harvest (prevents duplication)
7. After harvest: replant sapling, collect drops
8. When inventory fills (128+ logs): auto-deposit

### Opportunistic Workflow
1. Player command `!wood start` (no area set)
2. Bot searches for nearest tree within radius (default 50 blocks)
3. Claims tree base to prevent other bots from targeting
4. Harvests entire tree (top-down)
5. Replants matching sapling
6. Collects dropped items
7. Repeats: find next tree

### Harvesting Algorithm
```javascript
1. Find tree base (lowest log position)
2. Claim tree with coordinator
3. Get all connected logs (BFS algorithm)
4. Sort logs by height (highest first)
5. Navigate to each log and dig
6. Replant sapling at base
7. Collect nearby drops
8. Release tree claim
```

## Configuration

```json
{
  "behaviors": {
    "woodcutting": {
      "enabled": true,
      "replantSaplings": true,
      "depositThreshold": 128,
      "searchRadius": 50
    }
  }
}
```

## Testing Checklist

### Basic Functionality
- [ ] Bot can detect oak trees
- [ ] Bot harvests entire tree (no floating logs)
- [ ] Bot replants oak sapling after harvest
- [ ] Bot collects dropped logs

### Multi-Tree Types
- [ ] Works with spruce, birch, jungle, acacia
- [ ] Works with dark oak (2x2 trunk)
- [ ] Works with cherry and mangrove
- [ ] Works with crimson/warped stems

### Area-Based Mode
- [ ] Can set woodcutting area boundaries
- [ ] Bot scans and finds trees in area
- [ ] Bot stays within designated zone
- [ ] Multiple bots divide area automatically

### Opportunistic Mode
- [ ] Finds nearest tree without area set
- [ ] Harvests and moves to next tree
- [ ] Doesn't wander too far (respects search radius)

### Multi-Bot Coordination
- [ ] Bots don't harvest same tree
- [ ] Work zones are properly divided
- [ ] Tree claiming prevents conflicts
- [ ] Bots navigate around each other

### Inventory & Deposits
- [ ] Collects dropped logs after harvest
- [ ] Auto-deposits when reaching threshold
- [ ] Keeps saplings for replanting
- [ ] Handles full inventory gracefully

### Integration
- [ ] Look behavior pauses during woodcutting
- [ ] Look behavior resumes when stopped
- [ ] `!stop` command halts woodcutting
- [ ] `!wood stop` disables behavior properly

### Debug System
- [ ] `!debug enable wood` shows logs
- [ ] Debug output shows tree detection
- [ ] Debug shows harvest progress
- [ ] Debug shows replanting status

## Usage Examples

### Single Bot Tree Farm
```bash
# Setup
!sethome 100 64 200
!setarea wood start   # Stand at corner 1
!setarea wood end     # Stand at corner 2

# Start
!wood start

# Monitor (optional)
!debug enable wood

# Stop
!wood stop
```

### Multi-Bot Forest Clearing
```bash
# Start 3 bots
node src/index.js
> 3

# Send to forest
!goto all 500 70 -200

# Start opportunistic mode (no area)
!wood all start

# All bots will find and clear nearby trees
```

### Targeted Woodcutting
```bash
# Only one bot cuts wood
!wood RogueW0lfy start

# Other bots do farming
!farm Subject_9-17 start
!farm L@b_R4t start
```

## Known Limitations

1. **No tree growth detection** - Harvests any tree regardless of size
2. **No bone meal automation** - Won't speed up sapling growth
3. **Manual sapling supply** - Must ensure bots have saplings in inventory
4. **No strip log crafting** - Harvests as full logs only
5. **No scaffolding for tall trees** - May struggle with very tall custom trees

These are documented in `roadmap.md` for future implementation.

## Performance Notes

- **Tree scanning**: O(n) where n = area volume (uses early exit on block checks)
- **BFS for logs**: Max 100 logs per tree (configurable)
- **Path calculation**: Leverages mineflayer-pathfinder with collision avoidance
- **Claiming overhead**: Minimal (hash map lookups)

## Next Steps

1. **Test on live server** with multiple bots
2. **Monitor for edge cases** (unusual tree shapes)
3. **Tune configuration** (deposit threshold, search radius)
4. **Gather user feedback** on behavior
5. **Implement enhancements** from roadmap (tree growth detection, bone meal, etc.)

## Credits

Built on the existing Mineflayer BasicBot architecture:
- Uses `BotCoordinator` for multi-bot sync
- Integrates with `ItemCollectorBehavior` for drops
- Leverages `DepositBehavior` for storage
- Compatible with `AreaRegistry` for zone management
- Follows established behavior patterns (enable/disable, look pause/resume)
