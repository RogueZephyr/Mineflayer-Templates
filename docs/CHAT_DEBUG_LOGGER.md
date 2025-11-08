# Chat Debug Logger

A utility for logging all Minecraft chat events with their raw formats, designed to help debug and understand different chat formats across various servers.

## Purpose

Different Minecraft servers can have different chat formats, plugins, and message structures. This tool captures ALL chat-related events with their raw JSON data to help you:

- Understand how a specific server formats chat messages
- Debug chat parsing issues
- Identify custom whisper patterns from server plugins
- See what events are triggered for different message types
- Analyze server-specific chat modifications

## Configuration

Enable the chat debug logger in `src/config/config.json`:

```json
{
  "chatDebugLogger": {
    "enabled": true
  }
}
```

## Output

All logs are saved to: `data/chat_debug_log.json`

The log file contains JSON entries with:
- `eventType`: The type of chat event (message, chat, whisper, actionBar, title, subtitle)
- `data`: Full event data including raw JSON messages
- `timestamp`: ISO timestamp of when the event occurred

### Example Log Entry

```json
{
  "eventType": "message",
  "data": {
    "jsonMsg": {
      "text": "Hello world",
      "extra": [...]
    },
    "jsonString": "Hello world",
    "position": "chat",
    "timestamp": "2025-11-08T10:30:00.000Z",
    "botUsername": "Bot_1"
  },
  "timestamp": "2025-11-08T10:30:00.000Z"
}
```

## Commands (Master Only)

Use these in-game commands to control the logger:

### Start/Enable Logging
```
!chatdebug start
!chatdebug enable
```

### Stop/Disable Logging
```
!chatdebug stop
!chatdebug disable
```
Disabling will also flush any pending logs to file.

### View Summary
```
!chatdebug summary
```
Shows:
- Total number of logged events
- Count of each event type

### Clear Logs
```
!chatdebug clear
```
Deletes the log file and clears memory.

### Flush Logs
```
!chatdebug flush
```
Forces immediate write of pending logs to file (normally auto-flushes every 100 events).

## Event Types Captured

| Event Type | Description |
|------------|-------------|
| `message` | Raw message event with full JSON structure |
| `chat` | Parsed chat message with username and text |
| `whisper` | Direct whisper messages |
| `actionBar` | Messages displayed above hotbar |
| `title` | Title screen messages |
| `subtitle` | Subtitle screen messages |

## Usage Workflow

1. **Enable in config**: Set `chatDebugLogger.enabled: true`
2. **Start the bot**: Logger starts automatically if enabled
3. **Play normally**: All chat events are captured
4. **Review logs**: Open `data/chat_debug_log.json` to analyze formats
5. **Use summary**: Check `!chatdebug summary` for quick overview
6. **Disable when done**: Use `!chatdebug stop` or set config to false

## Tips

- **Keep it disabled by default**: This generates large log files over time
- **Enable only when debugging**: Turn it on when investigating chat issues
- **Clear logs regularly**: Use `!chatdebug clear` to prevent file bloat
- **Compare across servers**: Run on different servers to see format differences
- **JSON formatting**: The output file is pretty-printed for easy reading

## Integration with Whisper Patterns

If you're adding custom whisper patterns (see `docs/WHISPER_PATTERNS.md`), use this tool to:

1. Enable chat debug logging
2. Have someone whisper you on the server
3. Check the log for the raw message format
4. Extract the pattern from the `jsonString` or `message` fields
5. Add the pattern to your whisper handler

## Performance

- **Memory buffer**: Logs are buffered in memory (default: 100 entries)
- **Auto-flush**: Automatically writes to file every 100 logs
- **Manual flush**: Use `!chatdebug flush` to force write
- **Minimal impact**: Logging has negligible performance impact

## Troubleshooting

**Logger not starting:**
- Check `chatDebugLogger.enabled` is `true` in config
- Restart the bot after config changes

**No logs appearing:**
- Use `!chatdebug summary` to check if events are being captured
- Ensure `data/` directory exists (created automatically)

**File too large:**
- Use `!chatdebug clear` to reset
- Consider filtering specific event types in the code

**Commands not working:**
- Commands are master-only
- Ensure you're logged in as the master user in config
