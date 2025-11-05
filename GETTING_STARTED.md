# Getting Started with Mineflayer BasicBot

Welcome! This guide will help you set up and run your first Minecraft bot using Mineflayer BasicBot.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Basic Configuration](#basic-configuration)
- [Running Your First Bot](#running-your-first-bot)
- [Basic Commands](#basic-commands)
- [Setting Up Automation](#setting-up-automation)
- [Common Issues](#common-issues)
- [Next Steps](#next-steps)

## Prerequisites

Before you begin, ensure you have the following:

### Required
- **Node.js 16 or higher** - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Minecraft Java Edition**
- **A Minecraft server** (local or remote) that accepts bot connections

### Recommended Knowledge
- Basic familiarity with command line/terminal
- Basic understanding of JSON file format
- Your Minecraft username

### Server Requirements
- The server should allow offline-mode accounts OR you need valid bot account credentials
- The bot needs appropriate permissions on the server
- Make sure the server version matches the version in your configuration

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/RogueZephyr/Mineflayer-Templates.git
cd Mineflayer-Templates
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install all required packages including:
- mineflayer - The bot framework
- mineflayer-pathfinder - For navigation
- minecraft-data - For block/item information
- chalk - For colored console output
- figlet - For ASCII art

## Basic Configuration

### Step 3: Configure Your Bot

1. **Edit the main configuration file:**
   ```bash
   # Open src/config/config.json in your text editor
   ```

2. **Update server settings:**
   ```json
   {
     "host": "localhost",        // Your server address
     "port": 25565,              // Server port (default: 25565)
     "version": "1.20.1",        // Minecraft version
     "master": "YourUsername"    // Your Minecraft username
   }
   ```

3. **If using online-mode authentication, add credentials:**
   ```json
   {
     "host": "localhost",
     "port": 25565,
     "version": "1.20.1",
     "master": "YourUsername",
     "auth": "microsoft"         // Authentication type
   }
   ```

### Step 4: Configure Bot Names

1. **Edit bot names file:**
   ```bash
   # Open data/botNames.json
   ```

2. **Add bot usernames:**
   ```json
   {
     "names": [
       "MyFirstBot",
       "WorkerBot",
       "HelperBot"
     ]
   }
   ```

### Step 5: Configure Permissions (Optional)

1. **Edit whitelist file:**
   ```bash
   # Open data/whitelist.json
   ```

2. **Add player permissions:**
   ```json
   {
     "players": {
       "FriendUsername": {
         "allowedBots": ["MyFirstBot"],
         "allowedCommands": ["ping", "come", "stop"],
         "description": "Friend with basic access"
       }
     }
   }
   ```

   **Note:** The master player (from config.json) always has full access.

## Running Your First Bot

### Step 6: Start the Bot

**Option 1: Development Mode (Auto-restart on code changes)**
```bash
npm start
```

**Option 2: Production Mode (Single run)**
```bash
npm run dev
```

or directly:
```bash
node src/index.js
```

### Step 7: Bot Initialization

When you start the bot, you'll see:

```
? How many bots would you like to spawn? (default: 1)
```

For your first run, enter `1` and press Enter.

The bot will:
1. Connect to the server
2. Load configuration
3. Initialize behaviors
4. Display a startup banner
5. Start listening for commands

You should see:
```
[MyFirstBot] Connected to localhost:25565
[MyFirstBot] Bot spawned at x: 100, y: 64, z: 200
[MyFirstBot] All behaviors enabled
```

## Basic Commands

Now that your bot is running, let's try some basic commands!

### Testing Connection

In Minecraft, whisper to your bot:
```
/msg MyFirstBot ping
```

The bot should respond:
```
MyFirstBot whispers to you: pong!
```

### Getting Help

```
/msg MyFirstBot help
```

This shows all available commands and your permissions.

### Basic Movement

**Make the bot come to you:**
```
/msg MyFirstBot come
```

**Send bot to coordinates:**
```
/msg MyFirstBot goto 100 64 200
```

**Make bot follow you:**
```
/msg MyFirstBot follow YourUsername
```

**Stop current action:**
```
/msg MyFirstBot stop
```

### Setting Home

**Set home at current position:**
```
/msg MyFirstBot sethome
```

**Set home at specific coordinates:**
```
/msg MyFirstBot sethome 100 64 200
```

**Send bot home:**
```
/msg MyFirstBot home
```

## Setting Up Automation

### Farming Setup

**Step 1: Prepare farming area**
- Create a farmland area with crops
- Place a chest nearby for deposits

**Step 2: Set farm boundaries**

Stand at one corner of your farm:
```
/msg MyFirstBot setarea farm start
```

Walk to the opposite corner:
```
/msg MyFirstBot setarea farm end
```

**Step 3: Start farming**
```
/msg MyFirstBot farm start
```

The bot will:
- Scan for mature crops
- Harvest them
- Replant automatically
- Continue in a loop

**Stop farming:**
```
/msg MyFirstBot farm stop
```

### Woodcutting Setup

**Option 1: With designated area**

Stand at one corner of your forest:
```
/msg MyFirstBot setarea wood start
```

Walk to opposite corner:
```
/msg MyFirstBot setarea wood end
```

Start woodcutting:
```
/msg MyFirstBot wood start
```

**Option 2: Opportunistic mode**

The bot will search for nearby trees:
```
/msg MyFirstBot wood start
```

### Mining Setup

**Strip mining (creates main tunnel with branches):**
```
/msg MyFirstBot mine strip east 100 10
```
This creates a 100-block tunnel heading east with 10 side branches.

**Tunnel mining (simple 2x2 tunnel):**
```
/msg MyFirstBot mine tunnel north 50
```
Creates a 50-block tunnel heading north.

**Check mining progress:**
```
/msg MyFirstBot mine status
```

**Stop mining:**
```
/msg MyFirstBot mine stop
```

### Item Management

**Check inventory:**
```
/msg MyFirstBot loginv
```

**Collect nearby items:**
```
/msg MyFirstBot collect once
```

**Auto-collect continuously:**
```
/msg MyFirstBot collect start
```

**Deposit items to chest:**
```
/msg MyFirstBot deposit 100 64 200 crops
```

## Common Issues

### Bot won't connect

**Check:**
- Is the server running?
- Is the server address correct in config.json?
- Is the Minecraft version correct?
- Does the server allow offline-mode accounts?

**Solution:**
```bash
# Verify server is reachable
ping your-server-address

# Check server version compatibility
# Make sure config.json version matches server
```

### Bot doesn't respond to commands

**Check:**
- Are you whispering (`/msg BotName command`) or using public chat?
- Is your username set as master in config.json?
- Is the bot name correct?

**Solution:**
```bash
# Verify master username in config.json
# Ensure bot name matches exactly (case-sensitive)
# Try reloading whitelist:
/msg BotName whitelist reload
```

### Bot can't find blocks/crops

**Check:**
- Is the bot within range of the area?
- Are the area boundaries set correctly?
- Is the bot's pathfinding enabled?

**Solution:**
```bash
# Re-set the area boundaries
/msg BotName setarea farm clear
# Then set start and end again
```

### Bot gets stuck or disconnected

**Solution:**
```bash
# Stop current task
/msg BotName stop

# Send bot home
/msg BotName home

# If frozen, restart the bot process
# Press Ctrl+C to gracefully shutdown
```

### Permission denied errors

**Check:**
- Is your username spelled correctly in config.json as master?
- Are you in the whitelist with correct permissions?

**Solution:**
```bash
# Check your permissions
/msg BotName whoami

# Reload whitelist (master only)
/msg BotName whitelist reload
```

## Next Steps

Now that you have the basics down, explore more features:

### Advanced Features

1. **Multi-Bot Coordination**
   - Run multiple bots: `node src/index.js` and enter `3`
   - Bots automatically divide work areas
   - They avoid colliding with each other

2. **Tool Management**
   - Check tools: `/msg BotName tools status`
   - Detailed report: `/msg BotName tools report`
   - Bot automatically switches tools while working

3. **Path Caching**
   - View cache stats: `/msg BotName cache stats`
   - Clear cache: `/msg BotName cache clear`
   - Speeds up repeated pathfinding by 99%

4. **Debug Mode**
   - Enable debugging: `/msg BotName debug enable farm`
   - Disable: `/msg BotName debug disable farm`
   - Helps troubleshoot issues

### Learn More

- **Full Command List:** See [README.md](README.md#-commands)
- **Mining Details:** See [docs/MINING.md](docs/MINING.md)
- **Woodcutting Details:** See [docs/WOODCUTTING.md](docs/WOODCUTTING.md)
- **Tool System:** See [docs/TOOLHANDLER.md](docs/TOOLHANDLER.md)
- **Path Caching:** See [docs/PATH_CACHING.md](docs/PATH_CACHING.md)

### Contributing

Want to add features or fix bugs?
- Read [CONTRIBUTING.md](CONTRIBUTING.md)
- Check [open issues](https://github.com/RogueZephyr/Mineflayer-Templates/issues)
- Submit pull requests

### Get Help

- **Questions:** [GitHub Discussions](https://github.com/RogueZephyr/Mineflayer-Templates/discussions)
- **Bugs:** [GitHub Issues](https://github.com/RogueZephyr/Mineflayer-Templates/issues)
- **Security:** [Security Policy](SECURITY.md)

## Tips for Success

1. **Start Small:** Begin with one bot and basic commands
2. **Test Safely:** Use a test server or single-player world first
3. **Read Docs:** Check the docs folder for detailed information
4. **Use Debug Mode:** Enable debug when troubleshooting
5. **Graceful Shutdown:** Always use Ctrl+C to stop bots properly
6. **Save Homes:** Set home positions so bots can return safely
7. **Check Permissions:** Verify whitelist settings for multi-user servers
8. **Monitor Logs:** Watch console output for errors and status

## Example Workflow

Here's a complete example of setting up a farming bot:

```bash
# 1. Start the bot
npm run dev
# Enter: 1 (for one bot)

# 2. In Minecraft, test connection
/msg MyFirstBot ping

# 3. Set bot's home near the farm
/msg MyFirstBot sethome

# 4. Define farm area (stand at corners)
/msg MyFirstBot setarea farm start
# Walk to opposite corner
/msg MyFirstBot setarea farm end

# 5. Start farming
/msg MyFirstBot farm start

# 6. Check status anytime
/msg MyFirstBot farm status

# 7. Stop when done
/msg MyFirstBot farm stop

# 8. Send bot home
/msg MyFirstBot home

# 9. Gracefully shutdown (in terminal)
Ctrl+C
```

Congratulations! You're now ready to use Mineflayer BasicBot. Happy automating! 🤖⛏️🌾
