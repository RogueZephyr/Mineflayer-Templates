// src/utils/ToolHandler.js
import mcDataFactory from 'minecraft-data';

/**
 * ToolHandler - Centralized tool management for optimal block breaking
 * Automatically selects and equips the best tool for any block type
 */
export default class ToolHandler {
  constructor(bot, logger = null) {
    this.bot = bot;
    this.logger = logger;
    this.mcData = mcDataFactory(bot.version);
    
    // Current equipped tool tracking
    this.currentTool = null;
    this.currentToolType = null;
    
    // Tool priority by type (best to worst)
    this.toolPriority = {
      pickaxe: [
        'netherite_pickaxe',
        'diamond_pickaxe',
        'iron_pickaxe',
        'stone_pickaxe',
        'golden_pickaxe',
        'wooden_pickaxe'
      ],
      axe: [
        'netherite_axe',
        'diamond_axe',
        'iron_axe',
        'stone_axe',
        'golden_axe',
        'wooden_axe'
      ],
      shovel: [
        'netherite_shovel',
        'diamond_shovel',
        'iron_shovel',
        'stone_shovel',
        'golden_shovel',
        'wooden_shovel'
      ],
      hoe: [
        'netherite_hoe',
        'diamond_hoe',
        'iron_hoe',
        'stone_hoe',
        'golden_hoe',
        'wooden_hoe'
      ],
      sword: [
        'netherite_sword',
        'diamond_sword',
        'iron_sword',
        'stone_sword',
        'golden_sword',
        'wooden_sword'
      ],
      shears: ['shears']
    };

    // Block to tool type mapping
    this.blockToolMap = this._buildBlockToolMap();
    
    // Tool durability thresholds
    this.minDurability = 5; // Don't use tools below this durability
    this.lowDurabilityThreshold = 20; // Warn when tool is low
  }

  /**
   * Build mapping of block types to optimal tool types
   */
  _buildBlockToolMap() {
    const map = {};
    
    // Pickaxe blocks (stone, ores, metals)
    const pickaxeBlocks = [
      'stone', 'cobblestone', 'granite', 'diorite', 'andesite', 'deepslate',
      'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'redstone_ore', 'lapis_ore',
      'copper_ore', 'nether_gold_ore', 'nether_quartz_ore', 'ancient_debris',
      'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_diamond_ore',
      'deepslate_emerald_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore', 'deepslate_copper_ore',
      'iron_block', 'gold_block', 'diamond_block', 'emerald_block', 'netherite_block',
      'anvil', 'chipped_anvil', 'damaged_anvil',
      'furnace', 'blast_furnace', 'smoker',
      'obsidian', 'crying_obsidian', 'respawn_anchor',
      'netherrack', 'nether_bricks', 'red_nether_bricks',
      'end_stone', 'end_stone_bricks',
      'sandstone', 'red_sandstone', 'smooth_sandstone', 'smooth_red_sandstone',
      'bricks', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks',
      'prismarine', 'prismarine_bricks', 'dark_prismarine',
      'terracotta', 'white_terracotta', 'orange_terracotta', 'magenta_terracotta',
      'light_blue_terracotta', 'yellow_terracotta', 'lime_terracotta', 'pink_terracotta',
      'gray_terracotta', 'light_gray_terracotta', 'cyan_terracotta', 'purple_terracotta',
      'blue_terracotta', 'brown_terracotta', 'green_terracotta', 'red_terracotta', 'black_terracotta',
      'rail', 'powered_rail', 'detector_rail', 'activator_rail',
      'hopper', 'dispenser', 'dropper', 'observer', 'piston', 'sticky_piston',
      'iron_door', 'iron_trapdoor', 'iron_bars',
      'cauldron', 'brewing_stand', 'bell', 'lantern', 'soul_lantern', 'chain',
      'basalt', 'smooth_basalt', 'polished_basalt', 'blackstone', 'gilded_blackstone',
      'polished_blackstone', 'polished_blackstone_bricks', 'cracked_polished_blackstone_bricks'
    ];
    
    // Axe blocks (wood, logs, planks)
    const axeBlocks = [
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
      'mangrove_log', 'cherry_log', 'crimson_stem', 'warped_stem',
      'stripped_oak_log', 'stripped_spruce_log', 'stripped_birch_log', 'stripped_jungle_log',
      'stripped_acacia_log', 'stripped_dark_oak_log', 'stripped_mangrove_log', 'stripped_cherry_log',
      'stripped_crimson_stem', 'stripped_warped_stem',
      'oak_wood', 'spruce_wood', 'birch_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood',
      'mangrove_wood', 'cherry_wood', 'crimson_hyphae', 'warped_hyphae',
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks',
      'mangrove_planks', 'cherry_planks', 'crimson_planks', 'warped_planks', 'bamboo_planks',
      'crafting_table', 'cartography_table', 'fletching_table', 'smithing_table',
      'barrel', 'chest', 'trapped_chest', 'bookshelf', 'lectern',
      'oak_fence', 'spruce_fence', 'birch_fence', 'jungle_fence', 'acacia_fence', 'dark_oak_fence',
      'mangrove_fence', 'cherry_fence', 'crimson_fence', 'warped_fence', 'bamboo_fence',
      'oak_fence_gate', 'spruce_fence_gate', 'birch_fence_gate', 'jungle_fence_gate',
      'acacia_fence_gate', 'dark_oak_fence_gate', 'mangrove_fence_gate', 'cherry_fence_gate',
      'crimson_fence_gate', 'warped_fence_gate', 'bamboo_fence_gate',
      'oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door', 'dark_oak_door',
      'mangrove_door', 'cherry_door', 'crimson_door', 'warped_door', 'bamboo_door',
      'oak_stairs', 'spruce_stairs', 'birch_stairs', 'jungle_stairs', 'acacia_stairs', 'dark_oak_stairs',
      'mangrove_stairs', 'cherry_stairs', 'crimson_stairs', 'warped_stairs', 'bamboo_stairs',
      'oak_slab', 'spruce_slab', 'birch_slab', 'jungle_slab', 'acacia_slab', 'dark_oak_slab',
      'mangrove_slab', 'cherry_slab', 'crimson_slab', 'warped_slab', 'bamboo_slab',
      'campfire', 'soul_campfire', 'beehive', 'bee_nest',
      'note_block', 'jukebox', 'loom', 'composter', 'daylight_detector',
      'bamboo', 'bamboo_block', 'stripped_bamboo_block'
    ];
    
    // Shovel blocks (dirt, sand, gravel, snow)
    const shovelBlocks = [
      'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'grass_block',
      'sand', 'red_sand', 'gravel',
      'clay', 'snow', 'snow_block', 'powder_snow',
      'soul_sand', 'soul_soil',
      'farmland', 'dirt_path', 'muddy_mangrove_roots',
      'mud', 'packed_mud', 'mud_bricks',
      'concrete_powder', 'white_concrete_powder', 'orange_concrete_powder', 'magenta_concrete_powder',
      'light_blue_concrete_powder', 'yellow_concrete_powder', 'lime_concrete_powder', 'pink_concrete_powder',
      'gray_concrete_powder', 'light_gray_concrete_powder', 'cyan_concrete_powder', 'purple_concrete_powder',
      'blue_concrete_powder', 'brown_concrete_powder', 'green_concrete_powder', 'red_concrete_powder',
      'black_concrete_powder'
    ];
    
    // Hoe blocks (leaves, hay, dried kelp, sponge, sculk, nether wart)
    const hoeBlocks = [
      'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves',
      'mangrove_leaves', 'cherry_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
      'hay_block', 'dried_kelp_block', 'target',
      'nether_wart_block', 'warped_wart_block',
      'sponge', 'wet_sponge',
      'moss_block', 'moss_carpet',
      'sculk', 'sculk_vein', 'sculk_catalyst', 'sculk_shrieker', 'sculk_sensor'
    ];
    
    // Shears blocks (wool, cobweb, vines)
    const shearsBlocks = [
      'cobweb',
      'white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool', 'lime_wool',
      'pink_wool', 'gray_wool', 'light_gray_wool', 'cyan_wool', 'purple_wool', 'blue_wool',
      'brown_wool', 'green_wool', 'red_wool', 'black_wool',
      'vine', 'glow_lichen', 'twisting_vines', 'weeping_vines',
      'seagrass', 'tall_seagrass', 'kelp'
    ];
    
    // Sword blocks (bamboo, cobweb can also use sword)
    const swordBlocks = [
      'bamboo', 'cobweb'
    ];
    
    // Map blocks to tool types
    pickaxeBlocks.forEach(block => map[block] = 'pickaxe');
    axeBlocks.forEach(block => map[block] = 'axe');
    shovelBlocks.forEach(block => map[block] = 'shovel');
    hoeBlocks.forEach(block => map[block] = 'hoe');
    shearsBlocks.forEach(block => map[block] = 'shears');
    swordBlocks.forEach(block => {
      // Sword is secondary for these blocks
      if (!map[block]) map[block] = 'sword';
    });
    
    return map;
  }

  _emitDebug(...args) {
    if (!this.logger) return;
    const botName = this.bot.username || 'Unknown';
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    try { 
      if (this.bot.debugTools && this.bot.debugTools.isEnabled('tools')) {
        this.logger.debug(`[Tools] [${botName}] ${message}`);
        this.bot.debugTools.log('tools', `[${botName}] ${message}`);
      }
    } catch (_) {}
  }

  /**
   * Get the best tool of a specific type from inventory
   */
  _getBestToolOfType(toolType) {
    const toolList = this.toolPriority[toolType];
    if (!toolList) return null;

    for (const toolName of toolList) {
      const items = this.bot.inventory.items();
      for (const item of items) {
        if (item && item.name === toolName) {
          // Check durability
          const durability = this._getItemDurability(item);
          if (durability !== null && durability.remaining < this.minDurability) {
            this._emitDebug(`Skipping ${toolName} - too low durability (${durability.remaining})`);
            continue;
          }
          
          this._emitDebug(`Found ${toolName} in inventory`);
          return item;
        }
      }
    }
    
    return null;
  }

  /**
   * Get item durability info
   */
  _getItemDurability(item) {
    if (!item) return null;
    
    if (item.durabilityUsed !== undefined && item.maxDurability !== undefined) {
      const remaining = item.maxDurability - item.durabilityUsed;
      const percentage = (remaining / item.maxDurability) * 100;
      return {
        remaining,
        max: item.maxDurability,
        percentage: Math.round(percentage)
      };
    }
    
    return null;
  }

  /**
   * Determine the optimal tool type for a block
   */
  getOptimalToolType(block) {
    if (!block || block.type === 0) return null;
    
    const blockName = block.name;
    const toolType = this.blockToolMap[blockName];
    
    if (toolType) {
      this._emitDebug(`Block ${blockName} -> optimal tool: ${toolType}`);
      return toolType;
    }
    
    // Fallback: check block material properties from mcData
    try {
      const blockData = this.mcData.blocksByName[blockName];
      if (blockData) {
        // Check harvest tools if available
        if (blockData.harvestTools) {
          const toolIds = Object.keys(blockData.harvestTools);
          if (toolIds.length > 0) {
            const toolId = parseInt(toolIds[0]);
            const toolData = this.mcData.items[toolId];
            if (toolData && toolData.name) {
              // Extract tool type from name (e.g., "wooden_pickaxe" -> "pickaxe")
              if (toolData.name.includes('pickaxe')) return 'pickaxe';
              if (toolData.name.includes('axe')) return 'axe';
              if (toolData.name.includes('shovel')) return 'shovel';
              if (toolData.name.includes('hoe')) return 'hoe';
            }
          }
        }
        
        // Check material property
        if (blockData.material) {
          const material = blockData.material.toLowerCase();
          if (material.includes('rock') || material.includes('stone')) return 'pickaxe';
          if (material.includes('wood')) return 'axe';
          if (material.includes('dirt') || material.includes('sand')) return 'shovel';
        }
      }
    } catch (e) {
      this._emitDebug(`Error checking block data for ${blockName}:`, e.message);
    }
    
    // No specific tool needed
    this._emitDebug(`Block ${blockName} -> no specific tool required`);
    return null;
  }

  /**
   * Get the best available tool for a block
   */
  getBestToolForBlock(block) {
    const toolType = this.getOptimalToolType(block);
    if (!toolType) return null;
    
    return this._getBestToolOfType(toolType);
  }

  /**
   * Check if we need to switch tools for a block
   */
  async shouldSwitchTool(block) {
    const optimalToolType = this.getOptimalToolType(block);
    
    // No tool needed
    if (!optimalToolType) {
      this._emitDebug(`No tool needed for ${block.name}`);
      return false;
    }
    
    // Check current hand
    const currentItem = this.bot.heldItem;
    
    // No item in hand - need to equip
    if (!currentItem) {
      this._emitDebug('No item in hand - need to equip tool');
      return true;
    }
    
    // Check if current item is the right type
    const currentItemName = currentItem.name;
    
    // Check if it's the optimal tool type
    const toolList = this.toolPriority[optimalToolType];
    if (toolList && toolList.includes(currentItemName)) {
      // Check durability
      const durability = this._getItemDurability(currentItem);
      if (durability && durability.remaining < this.minDurability) {
        this._emitDebug(`Current tool durability too low (${durability.remaining}) - need to switch`);
        return true;
      }
      
      this._emitDebug(`Current tool ${currentItemName} is suitable for ${block.name}`);
      return false;
    }
    
    // Wrong tool type - need to switch
    this._emitDebug(`Current tool ${currentItemName} not optimal for ${block.name} (need ${optimalToolType})`);
    return true;
  }

  /**
   * Equip the best tool for a block
   */
  async equipBestTool(block) {
    try {
      const tool = this.getBestToolForBlock(block);
      
      if (!tool) {
        this._emitDebug(`No suitable tool found for ${block.name} - using hand`);
        // Unequip current tool (equip null is not supported, so we just continue)
        return false;
      }
      
      // Check if already equipped
      const currentItem = this.bot.heldItem;
      if (currentItem && currentItem.type === tool.type) {
        this._emitDebug(`Tool ${tool.name} already equipped`);
        return true;
      }
      
      // Equip the tool
      await this.bot.equip(tool, 'hand');
      this.currentTool = tool;
      this.currentToolType = this.getOptimalToolType(block);
      
      this._emitDebug(`Equipped ${tool.name} for ${block.name}`);
      
      // Check if tool is low on durability
      const durability = this._getItemDurability(tool);
      if (durability && durability.remaining <= this.lowDurabilityThreshold) {
        this._emitDebug(`WARNING: ${tool.name} durability is low (${durability.remaining}/${durability.max})`);
        if (this.logger) {
          this.logger.warn(`[ToolHandler][${this.bot.username}] Tool ${tool.name} is low on durability!`);
        }
      }
      
      return true;
      
    } catch (err) {
      this._emitDebug(`Failed to equip tool for ${block.name}:`, err.message);
      return false;
    }
  }

  /**
   * Smart dig - automatically equips best tool and digs
   */
  async smartDig(block, forceLook = true) {
    if (!block || block.type === 0) {
      throw new Error('Invalid block');
    }
    
    try {
      // Check if we need to switch tools
      const needSwitch = await this.shouldSwitchTool(block);
      
      if (needSwitch) {
        const equipped = await this.equipBestTool(block);
        if (!equipped) {
          this._emitDebug('Failed to equip tool, continuing with hand');
        }
        
        // Small delay after equipping
        await new Promise(r => setTimeout(r, 50));
      }
      
      // Dig the block
      await this.bot.dig(block, forceLook);
      this._emitDebug(`Successfully dug ${block.name}`);
      
    } catch (err) {
      this._emitDebug(`Failed to dig ${block.name}:`, err.message);
      throw err;
    }
  }

  /**
   * Get available tools of a specific type
   */
  getAvailableTools(toolType) {
    const toolList = this.toolPriority[toolType];
    if (!toolList) return [];

    const available = [];
    const items = this.bot.inventory.items();
    
    for (const toolName of toolList) {
      for (const item of items) {
        if (item && item.name === toolName) {
          const durability = this._getItemDurability(item);
          available.push({
            item,
            name: toolName,
            durability: durability ? durability.remaining : null,
            percentage: durability ? durability.percentage : null
          });
        }
      }
    }
    
    return available;
  }

  /**
   * Get inventory summary of all tools
   */
  getToolInventory() {
    const inventory = {};
    
    for (const toolType of Object.keys(this.toolPriority)) {
      inventory[toolType] = this.getAvailableTools(toolType);
    }
    
    return inventory;
  }

  /**
   * Check if bot has any tool of a specific type
   */
  hasTool(toolType) {
    const tool = this._getBestToolOfType(toolType);
    return tool !== null;
  }

  /**
   * Check if bot has a tool suitable for a block
   */
  hasToolForBlock(block) {
    const tool = this.getBestToolForBlock(block);
    return tool !== null;
  }

  /**
   * Get tool durability report
   */
  getToolReport() {
    const report = {
      summary: {},
      details: {}
    };
    
    for (const toolType of Object.keys(this.toolPriority)) {
      const tools = this.getAvailableTools(toolType);
      report.summary[toolType] = tools.length;
      report.details[toolType] = tools.map(t => ({
        name: t.name,
        durability: t.durability,
        percentage: t.percentage
      }));
    }
    
    return report;
  }

  /**
   * Update minimum durability threshold
   */
  setMinDurability(value) {
    this.minDurability = Math.max(0, Math.min(value, 100));
    this._emitDebug(`Minimum durability set to ${this.minDurability}`);
  }

  /**
   * Update low durability warning threshold
   */
  setLowDurabilityThreshold(value) {
    this.lowDurabilityThreshold = Math.max(0, Math.min(value, 100));
    this._emitDebug(`Low durability threshold set to ${this.lowDurabilityThreshold}`);
  }
}
