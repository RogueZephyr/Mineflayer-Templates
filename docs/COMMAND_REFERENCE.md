# Chat Command Reference

Quick reference for all bot commands. Use `/msg <BotName> <command>` for whispered commands.

## 📋 Quick Command List

### Essential Commands
```
!help                    - Show command list
!help <command>          - Detailed help for specific command
!ping                    - Test bot responsiveness
!whoami                  - Show your permissions
!stop                    - Stop all current tasks
```

### Movement
```
!come                    - Bot comes to you
!goto <x> <y> <z>        - Navigate to coordinates
!follow <player>         - Follow a player
```

### Home Management
```
!sethome                 - Set home at current position
!sethome <x> <y> <z>     - Set home at coordinates
!home                    - Return to home
!ishome                  - Check if at home
```

### Farming
```
!setarea farm start      - Set farm corner 1
!setarea farm end        - Set farm corner 2
!farm start              - Start farming
!farm stop               - Stop farming
```

### Woodcutting
```
!setarea wood start      - Set woodcutting area corner 1 (optional)
!setarea wood end        - Set woodcutting area corner 2 (optional)
!wood start              - Start woodcutting
!wood stop               - Stop woodcutting
```

### Mining
```
!mine strip <dir> [length] [branches]      - Strip mining
!mine tunnel <dir> [length] [width] [height] - Tunnel (defaults from config)
!mine deposit                               - Deposit after current task or immediately if idle
!mine stop                                  - Stop mining
!mine status                                - Show progress
```
**Directions:** north, south, east, west

**Examples:**
- `!mine strip east 100 10` - 100m tunnel, 10 branches
- `!mine tunnel north 50` - 50m tunnel heading north
- `!mine tunnel south 30 4 3` - 30m tunnel 4 blocks wide, 3 high

Note: Deposit keeps tools, up to N bridging blocks, and at least M food where N/M come from `behaviors.mining` in `src/config/config.json` (`keepBridgingTotal`, `keepFoodMin`).

### Tool Management
```
!tools status            - Quick tool count
!tools report            - Detailed durability report
!tools check <type>      - Check for tool (pickaxe/axe/shovel/hoe)
!tools equip <block>     - Equip best tool for block
```

**Examples:**
- `!tools check pickaxe`
- `!tools equip stone`

### Item Management
```
!collect once            - Collect items once
!collect start           - Auto-collect continuously
!collect stop            - Stop auto-collection
!loginv                  - Log inventory
!drop <type>             - Drop items (wood/ores/resources/itemName)
!deposit <x> <y> <z> <type>  - Deposit to chest
!depositall <type>       - Deposit to nearest chest
```

### Actions
```
!eat                     - Check hunger and eat
!sleep                   - Find and sleep in bed
```

### Debug & Admin (Master Only)
```
!debug enable <module>   - Enable debug (farm/eat/mining/tools/itemCollector)
!debug disable <module>  - Disable debug
!debug status            - Show debug status
!whitelist reload        - Reload whitelist
!whitelist list          - List whitelisted players
!coordstatus             - Show coordinator diagnostics
!cache stats             - Show path cache stats
!cache clear             - Clear path cache
```

---

## 💡 Usage Tips

### Bot Targeting
Target specific bots by including the bot name:
```
/msg RogueW0lfy sethome 100 64 200    # Only RogueW0lfy
/msg Subject_9-17 farm start          # Only Subject_9-17
```

Without bot name, all bots respond:
```
/msg RogueW0lfy home                  # All bots go home
```

### Command Shortcuts
Most commands accept shortened versions:
```
!farm start    = !farm s
!wood stop     = !wood
!mine status   = !mine stat
```

### Area Setup Pattern
For farming, woodcutting, or other area-based tasks:
1. Move to corner 1: `!setarea <type> start`
2. Move to corner 2: `!setarea <type> end`
3. Start task: `!<type> start`

**Area Types:** farm, wood, quarry (future)

---

## 🎯 Common Workflows

### Quick Farming Setup
```
/msg RogueW0lfy setarea farm start
<Move to opposite corner>
/msg RogueW0lfy setarea farm end
/msg RogueW0lfy farm start
```

### Quick Mining Session
```
/msg RogueW0lfy mine strip east 100 10
<Wait for completion or stop>
/msg RogueW0lfy mine stop
```

### Tool Check Before Task
```
/msg RogueW0lfy tools report
<Check durability>
/msg RogueW0lfy mine strip north 50 8
```

### Emergency Stop All
```
/msg RogueW0lfy stop
<All bots stop tasks>
/msg RogueW0lfy home
<All bots return home>
```

---

## 🔧 Automatic Features

### Auto-Switching Tools
The bot automatically switches tools based on block type:
- **Mining:** pickaxe for stone → shovel for dirt → back to pickaxe
- **Woodcutting:** always uses best available axe
- **Farming:** hoe for farmland, hand for crops

**No manual tool management needed!**

### Auto-Deposit
Behaviors automatically deposit items when inventory reaches threshold:
- **Farming:** 3+ stacks
- **Woodcutting:** 2+ stacks
- **Mining:** 5+ stacks (320 items)

### Auto-Collection
Item collection happens automatically in work zones:
- **Range:** 3 blocks around bot
- **Filtering:** Only collects items within assigned work zone
- **Smart:** Ignores items outside work area (prevents conflicts)

### Tool Durability Protection
- Skips tools with < 5 durability remaining
- Warns when tool reaches < 20 durability
- Automatically switches to next best tool

---

## 📊 Status Commands

### Check Bot Status
```
!mine status             - Mining progress
!tools status            - Tool inventory
!coordstatus             - Multi-bot coordination
!cache stats             - Pathfinding cache
```

### Check Your Access
```
!whoami                  - Your permissions
!help                    - Commands you can use
```

---

## 🚨 Troubleshooting

### Bot Not Responding
```
!ping                    - Check if bot is alive
<No response> → Bot might be disconnected
```

### Bot Stuck
```
!stop                    - Force stop all tasks
!goto <x> <y> <z>       - Manually navigate
!home                    - Return to home
```

### Mining Not Working
```
!tools check pickaxe     - Verify has pickaxe
!mine status             - Check if already mining
!mine stop               - Stop and restart
```

### Permission Denied
```
!whoami                  - Check your access level
<Ask server admin to update whitelist.json>
```

---

## 🎓 Advanced Usage

### Multi-Bot Coordination
```
# Spawn multiple bots
node src/index.js
<Enter number: 3>

# Each bot auto-assigns to different work zones
/msg RogueW0lfy farm start    # All 3 bots start farming
<Bots divide area automatically>
```

### Debug Mode
```
!debug enable mining     - See mining debug logs
!debug enable tools      - See tool selection logs
!debug status            - Check what's enabled
!debug disable all       - Turn off all debug
```

### Path Caching
Path caching speeds up repeated routes by 99%:
```
!cache stats             - View cache performance
!cache clear             - Clear if needed
<Automatic cleanup every 10 seconds>
```

---

## 📝 Command Format Rules

### Required Parameters
Shown in angle brackets: `<parameter>`
```
!goto <x> <y> <z>        # All 3 coordinates required
!mine strip <direction>  # Direction required
```

### Optional Parameters
Shown in square brackets: `[parameter]`
```
!mine strip east [100] [10]    # Uses defaults if omitted
!sethome [x] [y] [z]           # Uses current pos if omitted
```

### Choices
Shown with pipe: `option1|option2`
```
!mine <strip|tunnel|quarry|stop|status>
!tools <status|report|check|equip>
```

---

## 🔐 Permission Levels

### Master
- Full access to all commands
- Can manage whitelist
- Can enable/disable debug
- Bots respond to master even when not explicitly whitelisted

### Whitelisted Players
- Access to specified bots only
- Access to specified commands only
- Configure in `data/whitelist.json`

### Non-Whitelisted
- Silently ignored
- No bot responses
- Add to whitelist for access

---

## 📚 Detailed Documentation

For in-depth guides, see the `/docs` folder:
- `MINING.md` - Complete mining system documentation
- `TOOLHANDLER.md` - Tool management system details
- `WOODCUTTING.md` - Woodcutting behavior guide
- `PATH_CACHING.md` - Pathfinding optimization info
- `WHISPER_PATTERNS.md` - Custom whisper format setup

---

## 💬 In-Game Help

Use the in-game help system for quick reference:
```
!help                    - Command overview
!help mine              - Mining commands
!help tools             - Tool commands
!help wood              - Woodcutting commands
!help farm              - Farming commands
```

All help is whispered to avoid chat spam!
