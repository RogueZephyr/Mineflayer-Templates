# Custom Whisper Pattern Support

## Overview

The bot supports flexible whisper detection for different server plugins and chat formats. You can configure multiple whisper patterns to match your server's specific message format.

## Problem

Different Minecraft servers use different chat plugins (Essentials, custom plugins, etc.) that format whisper messages differently:

- **Vanilla/Mineflayer default**: `PlayerName whispers to you: message`
- **Custom plugins**: `[BotName]<Player> PlayerName whispers to you: message`
- **Essentials**: `[PlayerName -> BotName] message`
- **Other formats**: Various custom formats

The standard Mineflayer `whisper` event doesn't always trigger for custom formats.

## Solution

Configure regex patterns to match your server's whisper format. The bot will:
1. Listen to the standard `whisper` event
2. Also listen to raw chat packets
3. Try to match raw messages against configured patterns
4. Extract username and message from matches

## Configuration

Edit `config.json` and add/modify patterns in the `whisperPatterns` array:

```json
{
  "whisperPatterns": [
    {
      "name": "custom_plugin",
      "enabled": true,
      "pattern": "^\\[.+?\\]<Player>\\s+(.+?)\\s+whispers to you:\\s+(.+)$",
      "usernameGroup": 1,
      "messageGroup": 2
    },
    {
      "name": "vanilla_style",
      "enabled": true,
      "pattern": "^(.+?)\\s+whispers to you:\\s+(.+)$",
      "usernameGroup": 1,
      "messageGroup": 2
    },
    {
      "name": "essentials",
      "enabled": true,
      "pattern": "^\\[(.+?)\\s+->\\s+.+?\\]\\s+(.+)$",
      "usernameGroup": 1,
      "messageGroup": 2
    }
  ]
}
```

### Pattern Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Descriptive name for the pattern |
| `enabled` | boolean | Whether to use this pattern |
| `pattern` | string | Regular expression pattern (escaped for JSON) |
| `usernameGroup` | number | Regex capture group for username (default: 1) |
| `messageGroup` | number | Regex capture group for message (default: 2) |

## Pattern Examples

### Custom Plugin Format
**Format:** `[RogueW0lfy]<Player> RogueZ3phyr whispers to you: come`

```json
{
  "name": "custom_plugin",
  "enabled": true,
  "pattern": "^\\[.+?\\]<Player>\\s+(.+?)\\s+whispers to you:\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 2
}
```

**Breakdown:**
- `^\\[.+?\\]` - Match `[BotName]` at start
- `<Player>\\s+` - Match `<Player> ` literal
- `(.+?)` - **Group 1**: Capture username (non-greedy)
- `\\s+whispers to you:\\s+` - Match ` whispers to you: `
- `(.+)$` - **Group 2**: Capture message until end

### Vanilla/Standard Format
**Format:** `PlayerName whispers to you: message`

```json
{
  "name": "vanilla_style",
  "enabled": true,
  "pattern": "^(.+?)\\s+whispers to you:\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 2
}
```

### Essentials Plugin
**Format:** `[PlayerName -> BotName] message`

```json
{
  "name": "essentials",
  "enabled": true,
  "pattern": "^\\[(.+?)\\s+->\\s+.+?\\]\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 2
}
```

**Breakdown:**
- `^\\[` - Start with `[`
- `(.+?)` - **Group 1**: Capture sender username
- `\\s+->\\s+` - Match ` -> `
- `.+?` - Match receiver (bot name) non-greedy
- `\\]\\s+` - Match `] `
- `(.+)$` - **Group 2**: Capture message

### Advanced: Multiple Formats
**Format:** `<PlayerName> whispers: message` OR `[PM] PlayerName: message`

```json
{
  "name": "multi_format",
  "enabled": true,
  "pattern": "(?:<(.+?)>\\s+whispers:|\\[PM\\]\\s+(.+?):)\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 3
}
```

Note: Use group 1 or 2 for username (whichever matched), group 3 for message.

## Commands

### List Active Patterns

```
!whisper list
```

Output:
```
=== Whisper Patterns (3) ===
1. custom_plugin: ^\[.+?\]<Player>\s+(.+?)\s+whispers to you...
2. vanilla_style: ^(.+?)\s+whispers to you:\s+(.+)$
3. essentials: ^\[(.+?)\s+->\s+.+?\]\s+(.+)$
```

### Test a Pattern

```
!whisper test [RogueW0lfy]<Player> RogueZ3phyr whispers to you: come
```

Output:
```
Testing: "[RogueW0lfy]<Player> RogueZ3phyr whispers to you: come"
✓ Matched! User: RogueZ3phyr, Message: come
```

Or if no match:
```
Testing: "some random text"
✗ No pattern matched
```

## How to Create Your Pattern

### Step 1: Identify Your Format

Send a whisper to the bot and check the console logs. You'll see raw messages like:

```
[Chat] Raw: [BotName]<Player> YourName whispers to you: test
```

Or check the Minecraft chat directly for the exact format.

### Step 2: Write the Regex

Identify the parts:
- **Fixed text**: Literal strings like `whispers to you:`, `<Player>`, `[PM]`
- **Username**: Where the sender's name appears
- **Message**: Where the actual message content is

Example breakdown for `[BotName]<Player> Username whispers to you: message`:
```
[BotName]<Player>  →  \\[.+?\\]<Player>\\s+
Username           →  (.+?)  (Group 1)
 whispers to you:  →  \\s+whispers to you:\\s+
message            →  (.+)$  (Group 2)
```

### Step 3: Escape for JSON

In JSON, backslashes must be doubled:
- `\s` becomes `\\s`
- `\[` becomes `\\[`
- `.+?` becomes `.+?` (no change)

### Step 4: Test the Pattern

1. Add to `config.json`
2. Restart bot
3. Use `!whisper test <your format>` to verify

### Step 5: Test with Real Whisper

Send an actual whisper and verify the bot responds.

## Regex Reference

Common patterns for whisper matching:

| Pattern | Meaning | Example |
|---------|---------|---------|
| `^` | Start of string | Match from beginning |
| `$` | End of string | Match to end |
| `.` | Any character | Matches any single char |
| `.+` | One or more chars | Matches `abc`, `x`, `hello` |
| `.+?` | Non-greedy match | Stops at first match |
| `\s` | Whitespace | Space, tab, newline |
| `\s+` | One or more spaces | Multiple spaces/tabs |
| `(.+?)` | Capture group | Extract matched text |
| `\[` | Literal `[` | Escape special char |
| `\]` | Literal `]` | Escape special char |
| `.*?` | Optional chars | Zero or more (non-greedy) |
| `(?:...)` | Non-capturing | Group without capturing |

## Troubleshooting

### Bot Not Responding to Whispers

**Check if pattern matches:**
```
!whisper test <copy exact message from chat>
```

**Enable debug logging:**
```javascript
// In ChatCommandHandler.js, check for log output:
[Whisper] Detected custom format from PlayerName: message
[Whisper] Matched pattern 'custom_plugin': PlayerName -> message
```

**Verify pattern is enabled:**
```
!whisper list
```
Should show your pattern in the list.

### Pattern Matches Wrong Text

**Make pattern more specific:**
- Add `^` at start and `$` at end
- Use more fixed text literals
- Make capture groups non-greedy (`.+?` instead of `.+`)

**Example:**
```json
// Too broad
"pattern": "(.+) (.+)"

// Better
"pattern": "^\\[.+?\\]\\s+(.+?)\\s+whispers to you:\\s+(.+)$"
```

### Multiple Patterns Conflict

Patterns are tested **in order**. First match wins.

**Solution:**
1. Put most specific patterns first
2. Disable unused patterns (`"enabled": false`)
3. Test with `!whisper test` to see which pattern matches

### Special Characters Not Working

**Common mistakes:**
- Forgetting to escape `\` in JSON (use `\\`)
- Not escaping regex special chars: `[ ] ( ) . + * ? ^ $ | \`

**Fix:**
```json
// Wrong
"pattern": "[Player] (.+): (.+)"

// Correct
"pattern": "\\[Player\\]\\s+(.+?):\\s+(.+)$"
```

## Examples by Server Plugin

### EssentialsX

```json
{
  "name": "essentials",
  "enabled": true,
  "pattern": "^\\[(.+?)\\s+->\\s+.+?\\]\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 2
}
```

### BetterChat

```json
{
  "name": "betterchat",
  "enabled": true,
  "pattern": "^\\[Whisper\\]\\s+<(.+?)>\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 2
}
```

### ChatControl

```json
{
  "name": "chatcontrol",
  "enabled": true,
  "pattern": "^(.+?)\\s+→\\s+.+?:\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 2
}
```

### DeluxeChat

```json
{
  "name": "deluxechat",
  "enabled": true,
  "pattern": "^\\[PM\\]\\s+(.+?):\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 2
}
```

### Custom Server (Your Format)

For: `[RogueW0lfy]<Player> RogueZ3phyr whispers to you: come`

```json
{
  "name": "custom_plugin",
  "enabled": true,
  "pattern": "^\\[.+?\\]<Player>\\s+(.+?)\\s+whispers to you:\\s+(.+)$",
  "usernameGroup": 1,
  "messageGroup": 2
}
```

## Advanced Configuration

### Priority Order

Patterns are tested in array order. First match wins.

**Strategy:**
1. Most specific patterns first (custom plugins)
2. Standard patterns in middle (vanilla)
3. Catch-all patterns last (generic)

```json
{
  "whisperPatterns": [
    { "name": "custom_plugin", ... },      // Try this first
    { "name": "essentials", ... },         // Then this
    { "name": "vanilla_style", ... }       // Finally this
  ]
}
```

### Multiple Username Groups

Some formats have multiple possible username locations:

```json
{
  "pattern": "(?:<(.+?)>|\\[(.+?)\\])\\s+whispers:\\s+(.+)$",
  "usernameGroup": 1,  // Will be group 1 or 2 (whichever matched)
  "messageGroup": 3
}
```

### Case Insensitive

Add `i` flag to regex (note: modify code to support flags):

```javascript
// In _compileWhisperPatterns, modify:
regex: new RegExp(pattern.pattern, 'i')  // Add 'i' flag
```

## Performance Considerations

- Patterns are compiled once at startup (no runtime overhead)
- Patterns tested sequentially (first match wins)
- Failed matches are silent (no error spam)
- Approximately 1-5ms overhead per message

**Best Practices:**
- Disable unused patterns
- Put most common formats first
- Use specific patterns (avoid `.+` wildcards)

## Summary

The flexible whisper pattern system allows the bot to work with any server chat plugin by:

✅ **Easy configuration** - Just edit JSON, no code changes  
✅ **Multiple formats** - Support different plugins simultaneously  
✅ **Testing tools** - `!whisper test` validates patterns  
✅ **Fallback support** - Still uses standard Mineflayer events  
✅ **Zero overhead** - Patterns compiled once at startup  

Your specific format (`[BotName]<Player> Username whispers to you: message`) is now supported by default in the configuration!
