# Electron Dashboard Quick Start Guide

## Installation

```bash
# Navigate to the dashboard directory
cd dashboards/electron

# Install dependencies
npm install
```

## Running the Dashboard

```bash
# From dashboards/electron directory
npm run electron:dev
```

This will:
1. Build the Electron application
2. Launch the dashboard window
3. Start your bot in the background
4. Stream logs in real-time

## What You'll See

The dashboard opens with:
- **Left sidebar**: Bot selector (switch between bots or view all)
- **Center panel**: Real-time log viewer with color-coded messages
- **Bottom bar**: Command input with history support

## Try These Commands

Type in the command bar at the bottom:

```
!say Hello from the dashboard!
!manager status
!manager list
!ping
!tools status
!come
```

## Features

✅ **Real-time logs** - All bot output streams to the UI
✅ **Multi-bot ready** - Switch between bots or view combined logs  
✅ **Command history** - Use ↑/↓ arrows to recall commands
✅ **Status monitoring** - See health, hunger, position for each bot
✅ **Clean UI** - Modern dark theme with Tailwind CSS

## Next Steps

Once running:
1. Watch the logs as your bot connects to the server
2. Try sending commands through the UI
3. Monitor bot health/hunger in the sidebar
4. Switch between "All Bots" view and individual bot logs

## Troubleshooting

**Dashboard won't start?**
- Make sure you're in `dashboards/electron` directory
- Run `npm install` first
- Check that Node.js 18+ is installed

**No logs showing?**
- Wait for bot connection (can take 10-30 seconds)
- Check your `src/config/config.json` for correct server details
- Look for "Runtime ready" message in console

**Commands not working?**
- Commands must start with `!` (e.g., `!say hello`)
- Make sure bot is spawned (check logs for "Spawn event detected")

Enjoy your new dashboard! 🚀
