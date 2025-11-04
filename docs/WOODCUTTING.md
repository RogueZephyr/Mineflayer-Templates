# 🪓 Woodcutting Behavior Documentation

## Overview
The WoodCuttingBehavior enables bots to automatically harvest trees, replant saplings, and manage wood resources. It supports both area-based woodcutting (for multi-bot operations) and opportunistic mode (finding nearest trees).

## Features

### Tree Detection
- **All vanilla log types supported**: Oak, Spruce, Birch, Jungle, Acacia, Dark Oak, Cherry, Mangrove
- **Nether wood types**: Crimson Stems, Warped Stems
- **Smart tree scanning**: Finds tree bases and tops automatically
- **Branch detection**: Handles complex tree structures (jungle, dark oak)

### Harvesting Strategy
1. **Bottom-up detection**: Finds the lowest log block in a tree
2. **Top-down harvesting**: Cuts from top to bottom (prevents floating logs)
3. **Complete tree removal**: Follows all connected logs including branches
4. **Leaf awareness**: Detects leaves to identify trees but doesn't harvest them

### Tool Management
- **Smart axe detection**: Automatically finds best axe in inventory (Netherite → Diamond → Iron → Stone → Wood)
- **Tool chest retrieval**: Searches for nearby tool chest if no axe available
- **Manual fallback**: Proceeds with hand-harvesting if no axe found (slower but functional)
- **Auto-equip**: Keeps axe equipped during harvesting for efficiency

### Deposit System
- **Smart deposit location**: Uses bot's starting position as deposit area reference
- **Chest detection**: Searches for chests within 10 blocks of deposit location
- **Auto-deposit**: Stores logs when inventory reaches threshold (2+ stacks)
- **Registered chests**: Uses chestRegistry for 'logs' chest type if available
- **Fallback to home**: Uses home position if no specific deposit area set

### Replanting System
- **Automatic sapling detection**: Matches log type to correct sapling
- **Ground validation**: Only plants on valid ground (dirt, grass, podzol, etc.)
- **Inventory management**: Uses saplings from inventory when available
- **Fungus support**: Handles crimson and warped fungus for nether trees

### Multi-Bot Coordination

#### Work Zone Division
When multiple bots are active and an area is set:
```javascript
// Bots automatically divide the area
const zones = coordinator.divideArea(woodcuttingArea, botCount);
// Each bot gets an exclusive zone
bot.coordinator.assignWorkZone(botUsername, 'woodcutting', zone);
```

#### Block Claiming
Prevents duplicate work:
```javascript
// Bot claims tree before harvesting
coordinator.claimBlock(botUsername, treeBase, 'tree');
// Other bots skip claimed trees
if (coordinator.isBlockClaimed(treeBase, botUsername)) continue;
// Release claim after harvesting
coordinator.releaseBlock(treeBase);
```

### Operating Modes

#### 1. Area-Based Mode (Recommended for Multi-Bot)
Set a designated woodcutting zone:
```bash
# Set area boundaries
!setarea wood start
!setarea wood end

# Start woodcutting in area
!wood start
```

**Behavior:**
- Scans entire area for trees
- Prioritizes trees within assigned work zone
- Automatically divides area among active bots
- Efficient for managed tree farms

#### 2. Opportunistic Mode
No area set - bot searches for nearest trees:
```bash
# Start without area
!wood start
```

**Behavior:**
- Searches up to 50 blocks away
- Finds nearest unclaimed tree
- Harvests and replants
- Good for exploring/clearing forests

## Configuration

### config.json
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

### Settings Explained
- `enabled`: Enable/disable woodcutting behavior
- `replantSaplings`: Auto-replant after harvesting
- `depositThreshold`: Number of logs before auto-deposit (default: 2 stacks)
- `searchRadius`: Max distance to search for trees in opportunistic mode

## Usage Examples

### Single Bot Woodcutting with Tools
```bash
# Prepare tools chest with axes
# Place chest near starting area, fill with axes

# Set home near tree farm
!sethome 100 64 200

# Start opportunistic woodcutting
!wood start

# Bot will:
# 1. Check for axe in inventory
# 2. If no axe, search for nearby tool chest
# 3. Retrieve best available axe (diamond, iron, etc.)
# 4. Find nearest tree
# 5. Harvest with axe (faster)
# 6. Replant sapling
# 7. Collect dropped logs
# 8. Deposit to chest near starting position when full
# 9. Repeat
```

### Multi-Bot Tree Farm
```bash
# Set woodcutting area
!setarea wood start   # Stand at corner 1
!setarea wood end     # Stand at corner 2

# Start all bots
!wood start

# Bots will:
# 1. Auto-divide the area into zones
# 2. Each bot works in their zone
# 3. Avoid each other's trees
# 4. Deposit when inventory fills
```

### Targeted Commands
```bash
# Only RogueW0lfy chops wood
!wood RogueW0lfy start

# Stop specific bot
!wood Subject_9-17 stop

# All bots stop
!wood stop
```

## Technical Details

### Tree Scanning Algorithm
```javascript
_getTreeLogs(startPos) {
  // Breadth-first search for connected logs
  // Checks all 26 adjacent blocks (including diagonals)
  // Handles complex tree shapes
  // Max 100 logs per tree (configurable)
}
```

### Harvest Flow
1. **Check tools** → Verify axe in inventory
2. **Retrieve tools** → Get axe from tool chest if needed (or proceed manually)
3. **Detect tree** → Find base position
4. **Claim tree** → Register with coordinator
5. **Scan structure** → Get all log blocks
6. **Sort logs** → Top to bottom
7. **Equip axe** → Ensure best tool is in hand
8. **Harvest** → Dig each block with axe
9. **Replant** → Place matching sapling
10. **Collect** → Gather dropped items
11. **Release** → Free tree claim
12. **Check inventory** → Deposit if full (128+ logs)
13. **Navigate to deposit** → Go to starting area
14. **Find chest** → Search 10 blocks around deposit point
15. **Store logs** → Transfer all logs to chest

### Supported Items

#### Logs (Harvested)
- `oak_log`, `spruce_log`, `birch_log`
- `jungle_log`, `acacia_log`, `dark_oak_log`
- `cherry_log`, `mangrove_log`
- `crimson_stem`, `warped_stem`

#### Saplings (Replanted)
- `oak_sapling` → `birch_sapling`
- `spruce_sapling` → `jungle_sapling`
- `acacia_sapling` → `dark_oak_sapling`
- `cherry_sapling` → `mangrove_propagule`
- `crimson_fungus` → `warped_fungus`

#### Tools (Auto-detected priority order)
1. `netherite_axe` (fastest)
2. `diamond_axe`
3. `iron_axe`
4. `golden_axe` (fast but low durability)
5. `stone_axe`
6. `wooden_axe` (slowest)

## Chest Setup Guide

### Tool Chest Setup
Place a chest near the woodcutting area and fill it with axes:

```bash
# 1. Place chest near spawn/starting area
# 2. Fill with axes (diamond recommended)
# 3. Bot will automatically find and use it

# Optional: Register as tool chest
# (If using chestRegistry system)
!chest register tools <x> <y> <z>
```

### Deposit Chest Setup
Place a chest near bot's starting position:

```bash
# 1. Set bot's home position
!sethome 100 64 200

# 2. Place chest within 10 blocks of home
# Bot will search and use it automatically

# Optional: Register as logs chest
!chest register logs <x> <y> <z>
```

### Recommended Layout
```
[Starting Position/Home]
    ↓
[Tool Chest] ← Axes stored here
    ↓ 5-10 blocks
[Deposit Chest] ← Logs deposited here
    ↓
[Tree Farm Area] ← Woodcutting zone
```

## Debugging

### Enable Debug Mode
```bash
# Enable woodcutting debug logs
!debug enable wood

# Check what bot is doing
# Logs show:
# - Tree detection
# - Harvesting progress
# - Sapling replanting
# - Item collection
# - Errors/issues
```

### Debug Output Examples
```
[DEBUG:Wood] [RogueW0lfy] Starting harvest at 120, 65, 200
[DEBUG:Wood] [RogueW0lfy] Found 15 log blocks in tree
[DEBUG:Wood] [RogueW0lfy] Harvested 15 logs
[DEBUG:Wood] [RogueW0lfy] Replanted oak_sapling at 120, 65, 200
[DEBUG:Wood] [RogueW0lfy] Logs deposited
```

## Integration with Other Behaviors

### Works With
- ✅ **ItemCollectorBehavior**: Collects dropped logs automatically
- ✅ **DepositBehavior**: Auto-stores logs when threshold reached
- ✅ **LookBehavior**: Paused during woodcutting, resumed when stopped
- ✅ **HomeBehavior**: Can return home via `!home` while woodcutting
- ✅ **BotCoordinator**: Full multi-bot support with work zones

### Behavior Interactions
```javascript
// Woodcutting pauses look behavior
woodcuttingBehavior.enable() → lookBehavior.pause()
woodcuttingBehavior.disable() → lookBehavior.resume()

// Uses item collector for drops
await bot.itemCollector.collectOnce({ radius: 5 })

// Auto-deposits when full
if (_shouldDeposit()) await bot.depositBehavior.depositAll()
```

## Troubleshooting

### Bot Not Finding Trees
- **Check search radius**: Increase in config.json
- **Verify area**: Ensure trees are within set boundaries
- **Check coordinates**: Use `!setarea wood start/end` correctly

### Bot Not Replanting
- **Check inventory**: Ensure bot has saplings
- **Verify ground**: Must be dirt, grass, or podzol
- **Check config**: Ensure `replantSaplings: true`

### Multiple Bots Harvesting Same Tree
- **Verify coordinator**: Check `!coordstatus`
- **Check claims**: Enable debug to see block claims
- **Restart bots**: Sometimes claim system needs refresh

### Bot Stuck on Tree
- **Use stop command**: `!stop` to cancel pathfinding
- **Manual navigation**: `!goto <x> <y> <z>`
- **Restart**: Worst case, restart the bot

## Best Practices

### For Efficiency
1. **Set designated areas** for consistent harvesting
2. **Plant trees in grids** (5-block spacing ideal)
3. **Use multiple bots** to cover large forests
4. **Set deposit chests** near woodcutting areas

### For Safety
1. **Keep bots away from builds** (trees can be anywhere!)
2. **Monitor inventory** to prevent overflow
3. **Set homes near work areas** for quick recovery
4. **Use whitelist** to prevent unauthorized commands

### For Multi-Bot Operations
1. **Area size**: Minimum 16x16 per bot
2. **Tree density**: At least 10+ trees per zone
3. **Sapling supply**: Ensure bots have saplings
4. **Coordination**: Check `!coordstatus` regularly

## Future Enhancements
See `roadmap.md` for planned features:
- [ ] Tree growth detection (only harvest mature trees)
- [ ] Custom tree farm patterns
- [ ] Bone meal automation
- [ ] Strip log crafting
- [ ] Charcoal production
- [ ] Build scaffolding for tall trees
