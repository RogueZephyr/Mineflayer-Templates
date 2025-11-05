# ToolHandler Documentation

## Overview
The ToolHandler is a centralized utility for intelligent tool management in the Mineflayer bot. It automatically selects and equips the best available tool for any block type, switches tools mid-task, and monitors tool durability.

## Features

### Core Functionality
- **Automatic Tool Selection**: Identifies the optimal tool type for any block (pickaxe, axe, shovel, hoe, shears, sword)
- **Smart Tool Switching**: Automatically switches tools when encountering different block types
- **Durability Management**: Tracks tool durability and avoids using tools below threshold
- **Tool Priority System**: Always selects the best available tool (netherite → diamond → iron → stone → golden → wooden)
- **Comprehensive Block Mapping**: 200+ blocks mapped to their optimal tools
- **Smart Dig Function**: One-call solution for equipping best tool and digging

### Integration
- Used by MiningBehavior for pickaxe/shovel switching (stone vs dirt)
- Used by WoodCuttingBehavior for optimal axe selection
- Available to all behaviors via `bot.toolHandler`
- Debug mode support for troubleshooting

## Usage

### Basic Usage

```javascript
// Access the tool handler
const toolHandler = bot.toolHandler;

// Smart dig - automatically equips best tool and digs
const block = bot.blockAt(position);
await toolHandler.smartDig(block);
```

### Manual Tool Selection

```javascript
// Get best tool for a specific block
const tool = toolHandler.getBestToolForBlock(block);

// Check if we need to switch tools
const shouldSwitch = await toolHandler.shouldSwitchTool(block);

// Equip best tool for a block
await toolHandler.equipBestTool(block);
```

### Tool Inventory Queries

```javascript
// Check if bot has a specific tool type
if (toolHandler.hasTool('pickaxe')) {
    console.log('Has pickaxe!');
}

// Check if bot has tool for a specific block
if (toolHandler.hasToolForBlock(block)) {
    console.log('Can mine this block!');
}

// Get all available tools of a type
const pickaxes = toolHandler.getAvailableTools('pickaxe');
pickaxes.forEach(p => {
    console.log(`${p.name}: ${p.percentage}% durability`);
});

// Get complete tool inventory
const inventory = toolHandler.getToolInventory();
console.log('Pickaxes:', inventory.pickaxe.length);
console.log('Axes:', inventory.axe.length);
```

### Tool Reports

```javascript
// Get detailed tool report
const report = toolHandler.getToolReport();
console.log(report);
// Output:
// {
//   summary: { pickaxe: 2, axe: 1, shovel: 1, ... },
//   details: {
//     pickaxe: [
//       { name: 'diamond_pickaxe', durability: 1400, percentage: 90 },
//       { name: 'iron_pickaxe', durability: 200, percentage: 80 }
//     ],
//     ...
//   }
// }
```

### Configuration

```javascript
// Set minimum durability threshold (tools below this won't be used)
toolHandler.setMinDurability(10); // Default: 5

// Set low durability warning threshold
toolHandler.setLowDurabilityThreshold(30); // Default: 20
```

## Chat Commands

### `!tools status`
Quick tool count summary.
```
!tools status
> Tool Inventory: pickaxe:2 axe:1 shovel:1
```

### `!tools report`
Detailed tool durability report.
```
!tools report
> === Tool Report ===
> pickaxe: 2 tools
>   - diamond_pickaxe (90% - 1400 uses left)
>   - iron_pickaxe (80% - 200 uses left)
> axe: 1 tools
>   - iron_axe (95% - 238 uses left)
```

### `!tools check <type>`
Check if bot has a specific tool type.
```
!tools check pickaxe
> Yes, 2 pickaxe(s) available

!tools check hoe
> No hoe available
```

### `!tools equip <blockName>`
Manually equip the best tool for a specific block type.
```
!tools equip stone
> Equipped diamond_pickaxe for stone

!tools equip oak_log
> Equipped iron_axe for oak_log
```

## Block-to-Tool Mapping

### Pickaxe Blocks
- **Ores**: coal, iron, gold, diamond, emerald, redstone, lapis, copper, ancient_debris
- **Stone**: stone, cobblestone, granite, diorite, andesite, deepslate, netherrack, end_stone
- **Metals**: iron_block, gold_block, diamond_block, netherite_block
- **Utility**: furnace, anvil, hopper, rails, brewing_stand, cauldron
- **Building**: bricks, stone_bricks, sandstone, prismarine, terracotta

### Axe Blocks
- **Logs**: oak_log, spruce_log, birch_log, jungle_log, acacia_log, dark_oak_log, mangrove_log, cherry_log
- **Stems**: crimson_stem, warped_stem, bamboo
- **Planks**: All wood plank variants
- **Furniture**: crafting_table, chest, barrel, bookshelf, lectern
- **Doors/Gates**: All wood doors, fence gates, trapdoors
- **Other**: campfire, beehive, note_block, loom

### Shovel Blocks
- **Dirt**: dirt, coarse_dirt, podzol, grass_block, mycelium, farmland
- **Sand/Gravel**: sand, red_sand, gravel
- **Clay**: clay, mud, packed_mud, mud_bricks
- **Snow**: snow, snow_block, powder_snow
- **Soul**: soul_sand, soul_soil
- **Concrete Powder**: All concrete powder variants

### Hoe Blocks
- **Leaves**: All leaf types (oak, spruce, birch, etc.)
- **Crops**: hay_block, dried_kelp_block, nether_wart_block
- **Sponge**: sponge, wet_sponge
- **Sculk**: sculk, sculk_sensor, sculk_catalyst, sculk_shrieker
- **Moss**: moss_block, moss_carpet

### Shears Blocks
- **Wool**: All wool colors
- **Plants**: vine, glow_lichen, seagrass, kelp
- **Cobweb**: cobweb (also works with sword)

### Sword Blocks
- **Special**: bamboo, cobweb (secondary option)

## Tool Priority

Tools are selected based on material quality (best to worst):

1. **Netherite** - Best efficiency and durability
2. **Diamond** - Excellent for all tasks
3. **Iron** - Good general-purpose tool
4. **Stone** - Basic but functional
5. **Golden** - Fast but low durability
6. **Wooden** - Last resort

## Integration with Behaviors

### MiningBehavior Integration
```javascript
// In _executeDig method
if (this.bot.toolHandler) {
    // Automatically switches between pickaxe (stone) and shovel (dirt)
    await this.bot.toolHandler.smartDig(blockToDig);
} else {
    // Fallback to manual method
    await this._ensurePickaxe();
    await this.bot.dig(blockToDig);
}
```

### WoodCuttingBehavior Integration
```javascript
// In _harvestTree method
if (this.bot.toolHandler) {
    // Always uses best available axe
    await this.bot.toolHandler.smartDig(logBlock);
} else {
    // Fallback to manual axe selection
    await this.bot.equip(this.currentAxe, 'hand');
    await this.bot.dig(logBlock);
}
```

### Creating New Behaviors
```javascript
export default class MyBehavior {
    async breakBlocks(blocks) {
        for (const block of blocks) {
            // ToolHandler automatically:
            // 1. Determines optimal tool type
            // 2. Selects best available tool
            // 3. Equips the tool
            // 4. Digs the block
            await this.bot.toolHandler.smartDig(block);
            
            // No need to manually manage tools!
        }
    }
}
```

## Durability Management

### Automatic Protection
The ToolHandler automatically:
- **Skips broken tools**: Tools with durability below `minDurability` (default: 5) are not used
- **Warns on low durability**: Logs warning when tool reaches `lowDurabilityThreshold` (default: 20)
- **Switches tools**: If current tool breaks or becomes too low, switches to next best available

### Durability Queries
```javascript
// Get durability info for current tool
const tool = bot.heldItem;
const durability = toolHandler._getItemDurability(tool);

if (durability) {
    console.log(`${tool.name}: ${durability.remaining}/${durability.max} (${durability.percentage}%)`);
}
```

## Debug Mode

Enable tool debugging for detailed logging:
```
!debug enable tools
```

Debug output includes:
- Tool selection decisions
- Block-to-tool mapping lookups
- Durability checks
- Tool switching events
- Fallback to minecraft-data when block not in mapping

Disable with:
```
!debug disable tools
```

## Advanced Features

### Material Property Fallback
If a block is not in the pre-built mapping, ToolHandler:
1. Checks `harvestTools` from minecraft-data
2. Analyzes block material properties
3. Makes intelligent guess based on material (rock → pickaxe, wood → axe, dirt → shovel)

### Smart Equip Delay
After equipping a new tool, ToolHandler adds a small 50ms delay to ensure the server registers the equipment change before digging.

### Force Look Parameter
```javascript
// Control whether bot looks at block while digging
await toolHandler.smartDig(block, true);  // Look at block (default)
await toolHandler.smartDig(block, false); // Don't look (for faster digging)
```

## Performance Benefits

### Without ToolHandler
```javascript
// Manual tool management (error-prone)
if (block.name.includes('log')) {
    await bot.equip(axe, 'hand');
} else if (block.name.includes('stone')) {
    await bot.equip(pickaxe, 'hand');
} else if (block.name.includes('dirt')) {
    await bot.equip(shovel, 'hand');
}
await bot.dig(block);
```

### With ToolHandler
```javascript
// Automatic tool management (one line!)
await bot.toolHandler.smartDig(block);
```

**Benefits:**
- ✅ No manual tool checking
- ✅ No hardcoded block lists
- ✅ Automatic tool switching mid-task
- ✅ Durability protection
- ✅ Always uses best available tool
- ✅ Works with 200+ block types

## Common Use Cases

### Strip Mining (Stone + Dirt)
```javascript
// Mining behavior automatically switches tools
for (const digAction of miningPlan) {
    const block = bot.blockAt(digAction.position);
    await bot.toolHandler.smartDig(block);
    // Uses pickaxe for stone, shovel for dirt - no manual switching needed!
}
```

### Tree Harvesting
```javascript
// Woodcutting behavior always uses best axe
for (const logPosition of trunkPath) {
    const log = bot.blockAt(logPosition);
    await bot.toolHandler.smartDig(log);
    // Automatically selects diamond_axe > iron_axe > stone_axe, etc.
}
```

### Farming (Mixed Blocks)
```javascript
// Breaking farmland, crops, hay, etc.
await bot.toolHandler.smartDig(farmlandBlock);  // Uses shovel
await bot.toolHandler.smartDig(hayBlock);       // Uses hoe
await bot.toolHandler.smartDig(fenceBlock);     // Uses axe
// All automatic!
```

### Cave Exploration
```javascript
// Encountering various blocks while exploring
await bot.toolHandler.smartDig(stoneBlock);     // Pickaxe
await bot.toolHandler.smartDig(coalOreBlock);   // Pickaxe
await bot.toolHandler.smartDig(cobwebBlock);    // Shears (or sword)
await bot.toolHandler.smartDig(dirtBlock);      // Shovel
await bot.toolHandler.smartDig(gravelBlock);    // Shovel
// Perfect tool every time!
```

## Troubleshooting

### Tool Not Switching
**Issue**: Bot continues using wrong tool
**Solution**: 
- Check debug logs with `!debug enable tools`
- Verify bot has the appropriate tool in inventory
- Ensure durability is above minimum threshold

### "No suitable tool" Message
**Issue**: Bot says it has no tool for a block
**Solution**:
- Check inventory with `!tools report`
- Verify the block type is in the mapping
- Some blocks don't require specific tools (hand is fine)

### Tool Running Out Mid-Task
**Issue**: Tool breaks during mining/woodcutting
**Solution**:
- ToolHandler automatically switches to next best tool
- Use `!tools report` to check durability before starting
- Implement tool restocking behavior (future feature)

### Wrong Tool Selected
**Issue**: Bot selects suboptimal tool
**Solution**:
- Check if better tools exist in inventory
- Verify tool priority list is correct
- Tool might be skipped due to low durability

## Future Enhancements

### Planned Features
- **Tool Restocking**: Auto-retrieve tools from designated chest
- **Enchantment Awareness**: Prefer Fortune/Silk Touch pickaxes for ores
- **Tool Crafting**: Auto-craft replacement tools when running low
- **Efficiency Tracking**: Log which tools are most-used and prioritize restocking
- **Tool Sharing**: Multi-bot tool lending system

### API Extensibility
The ToolHandler is designed to be extended:
```javascript
// Add custom tool types
toolHandler.toolPriority['custom_tool'] = ['my_special_tool'];

// Add custom block mappings
toolHandler.blockToolMap['custom_block'] = 'custom_tool';

// Override tool selection logic
toolHandler.getBestToolForBlock = (block) => {
    // Custom logic here
};
```

## Summary

The ToolHandler eliminates manual tool management headaches by:
- **Automatically selecting** the best tool for any block
- **Switching tools** mid-task when block types change
- **Managing durability** to prevent tool breakage
- **Integrating seamlessly** with all behaviors
- **Providing visibility** into tool inventory and status

Just call `bot.toolHandler.smartDig(block)` and let it handle the rest!
