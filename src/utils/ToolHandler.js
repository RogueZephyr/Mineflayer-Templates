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

  // Block to tool type mapping (derived dynamically)
  this.blockToolMap = this._buildDynamicBlockToolMap();
    
    // Tool durability thresholds
    this.minDurability = 5; // Don't use tools below this durability
    this.lowDurabilityThreshold = 20; // Warn when tool is low
  }

  /**
   * Build dynamic mapping of block names to optimal tool types using minecraft-data.
   * Falls back to material/name heuristics when harvestTools are not defined.
   */
  _buildDynamicBlockToolMap() {
    const map = {};
    const blocks = this.mcData.blocksByName || {};
    const itemsById = this.mcData.items || {};

    const nameIncludes = (name, parts) => parts.some(p => name.includes(p));

    const materialToTool = (material) => {
      if (!material) return null;
      const m = material.toLowerCase();
      if (m.includes('rock') || m.includes('stone') || m.includes('metal')) return 'pickaxe';
      if (m.includes('wood') || m.includes('nether_wood')) return 'axe';
      if (m.includes('earth') || m.includes('ground') || m.includes('dirt') || m.includes('sand') || m.includes('clay') || m.includes('snow')) return 'shovel';
      if (m.includes('wool') || m.includes('web') || m.includes('plant')) return 'shears';
      return null;
    };

    const nameHeuristic = (name) => {
      // ordered heuristics based on common blocks
      if (nameIncludes(name, ['_ore', 'deepslate', 'stone', 'bricks', 'basalt', 'blackstone', 'obsidian', 'netherrack', 'end_stone', 'prismarine', 'terracotta', 'furnace', 'anvil', 'rail', 'hopper', 'dispenser', 'dropper', 'observer', 'piston', 'lantern', 'chain'])) return 'pickaxe';
      if (nameIncludes(name, ['_log', '_planks', '_wood', 'hyphae', '_stem', 'fence', 'door', 'stairs', 'slab', 'crafting_table', 'barrel', 'chest', 'bookshelf', 'lectern', 'campfire', 'beehive', 'bee_nest', 'bamboo_block', 'stripped_bamboo_block'])) return 'axe';
      if (nameIncludes(name, ['dirt', 'gravel', 'sand', 'mud', 'soul', 'farmland', 'dirt_path', 'powder_snow', 'snow', 'concrete_powder', 'clay'])) return 'shovel';
      if (nameIncludes(name, ['leaves', 'hay_block', 'dried_kelp_block', 'target', 'wart_block', 'sponge', 'moss_', 'sculk'])) return 'hoe';
      if (nameIncludes(name, ['wool', 'cobweb', 'vine', 'lichen', 'seagrass', 'kelp', 'twisting_vines', 'weeping_vines'])) return 'shears';
      if (nameIncludes(name, ['bamboo'])) return 'sword';
      return null;
    };

    const itemNameToToolType = (itemName) => {
      if (!itemName) return null;
      if (itemName.includes('pickaxe')) return 'pickaxe';
      if (itemName.includes('axe')) return 'axe';
      if (itemName.includes('shovel')) return 'shovel';
      if (itemName.includes('hoe')) return 'hoe';
      if (itemName.includes('shears')) return 'shears';
      if (itemName.includes('sword')) return 'sword';
      return null;
    };

    for (const [name, block] of Object.entries(blocks)) {
      let tool = null;
      // 1) Prefer harvestTools if defined
      if (block.harvestTools && Object.keys(block.harvestTools).length > 0) {
        const toolIds = Object.keys(block.harvestTools).map(id => parseInt(id, 10));
        // Map candidate tool ids to tool types and pick the most specific (non-null) one
        for (const id of toolIds) {
          const item = itemsById[id];
          const t = itemNameToToolType(item?.name);
          if (t) { tool = t; break; }
        }
      }

      // 2) Fall back to material
      if (!tool) {
        tool = materialToTool(block.material);
      }

      // 3) Fall back to name heuristics
      if (!tool) {
        tool = nameHeuristic(name);
      }

      if (tool) {
        map[name] = tool;
      }
    }

    // Explicit overrides for known edge cases where fastest tool differs
    map['cobweb'] = map['cobweb'] || 'shears';
    map['bamboo'] = map['bamboo'] || 'sword';

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
    
    // Fallback: check live block data from mcData for harvestTools/material
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
              if (toolData.name.includes('shears')) return 'shears';
              if (toolData.name.includes('sword')) return 'sword';
            }
          }
        }
        
        // Check material property
        if (blockData.material) {
          const material = blockData.material.toLowerCase();
          if (material.includes('rock') || material.includes('stone')) return 'pickaxe';
          if (material.includes('wood')) return 'axe';
          if (material.includes('dirt') || material.includes('sand')) return 'shovel';
          if (material.includes('wool') || material.includes('web') || material.includes('plant')) return 'shears';
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
