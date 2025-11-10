# Mineflayer Electron Dashboard

A modern Electron-based dashboard for managing and monitoring Mineflayer bots with real-time log streaming and command execution.

## Features

- 🖥️ **Real-time log streaming** - See all bot activity as it happens
- 🎮 **Command execution** - Send commands to bots directly from the UI
- 🤖 **Bot status monitoring** - Track health, hunger, position for each bot
- 📊 **Multi-bot support** - Switch between individual bots or view all logs combined
- ⌨️ **Command history** - Use arrow keys to navigate previous commands
- 🎨 **Modern UI** - Clean, dark-themed interface built with React + Tailwind

## Quick Start

### 1. Install Dependencies

```bash
cd dashboards/electron
npm install
```

### 2. Run in Development Mode

```bash
npm run electron:dev
```

This will:
- Build the Electron app
- Launch the dashboard window
- Start the bot runtime in the background
- Connect everything via IPC

### 3. Use the Dashboard

- **View Logs**: Select "All Bots" or individual bots from the sidebar
- **Send Commands**: Type commands in the input box (e.g., `!say hello`, `!manager status`)
- **Monitor Status**: See real-time health, hunger, and position updates
- **Command History**: Use ↑/↓ arrow keys to cycle through previous commands

## Available Commands

The dashboard supports all existing bot commands:

- `!manager status` - Show bot manager status
- `!manager list` - List all registered bots
- `!manager leader` - Show current leader bot
- `!say <message>` - Make the bot say something
- `!come` - Call the bot to you
- `!mine strip <direction> [length] [branches]` - Start strip mining
- `!tools status` - Check tool inventory
- And all other commands from the ChatCommandHandler

## Architecture

```
┌─────────────────────┐
│  Electron Main      │  ← Supervises runtime process
│  (Process Manager)  │  ← Handles IPC routing
└──────────┬──────────┘
           │ IPC
┌──────────┴──────────┐     ┌─────────────────────┐
│  React Renderer     │ ←─→ │  Bot Runtime        │
│  (Dashboard UI)     │     │  (Mineflayer Bots)  │
└─────────────────────┘     └─────────────────────┘
```

- **Main Process**: Spawns and supervises the bot runtime
- **Renderer**: React UI with Zustand state management
- **Runtime**: Existing bot system wrapped with IPC bridge
- **Preload**: Secure IPC API with context isolation

## Project Structure

```
dashboards/electron/
├── main/              # Electron main process
│   └── main.js       # Window + runtime supervisor
├── preload/          # Secure IPC bridge
│   └── preload.js    # Context-isolated API
├── renderer/         # React frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── store/       # Zustand state
│   │   ├── App.jsx      # Main app
│   │   └── main.jsx     # Entry point
│   └── index.html
├── shared/           # Shared schemas
│   └── schemas.js    # Zod validation
└── package.json
```

## Building for Production

```bash
# Build distributable
npm run build

# Build without packaging (faster, for testing)
npm run build:dir
```

Outputs will be in `dashboards/electron/release/`.

## Development Tips

### Hot Reload
The renderer supports hot module reload. Changes to React components will update instantly.

### Debugging
- Renderer: DevTools open automatically in dev mode (F12)
- Main Process: Use `console.log` or attach VSCode debugger
- Runtime: Logs appear in the dashboard UI

### Adding New Commands
1. Add command in `src/utils/ChatCommandHandler.js`
2. Restart the runtime (close dashboard and reopen)
3. Command will be available immediately

### Customizing UI
- Components: `renderer/src/components/`
- Styling: `renderer/src/index.css` (Tailwind)
- State: `renderer/src/store/botStore.js` (Zustand)

## Troubleshooting

### Dashboard won't start
- Ensure you ran `npm install` in `dashboards/electron/`
- Check that Node.js 18+ is installed
- Verify the runtime entry exists at `src/dashboard/runtimeEntry.js`

### No logs appearing
- Check that the bot is actually spawning (look for connection messages)
- Verify IPC bridge is forwarding events (check main process console)
- Try restarting the dashboard

### Commands not working
- Ensure command starts with `!` (e.g., `!say hello` not `say hello`)
- Check that ChatCommandHandler is initialized
- Look for error logs in the dashboard

## Next Steps

Future enhancements planned:
- Task queue visualization
- Resource/inventory tracking
- Mining progress bars
- Multi-bot coordination controls
- Performance metrics dashboard
- Command autocomplete with hints

## License

MIT - Same as parent project
