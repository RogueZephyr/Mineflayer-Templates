# Bot Login Cache & First-Login Commands

This document describes the bot login cache feature and how bots handle first-time logins on specific servers using a generated password.

## Overview

The login cache provides each bot username with a persistent password and remembers which servers that password has been used on. This allows:

- Per-bot secret passwords for external auth or `/register`-style server commands.
- Automatic first-time registration on a server using a configurable chat command.
- Avoiding repeated registration commands on subsequent joins to the same server.

## Data Flow

1. **Bot creation**
   - `BotController` selects a username via its existing username list logic.
   - `BotLoginCache.getOrCreateCredentials(username)` is called.
   - If the username already exists in the cache, its stored password is returned.
   - If it does not exist, a new random password is generated and stored.

2. **Bot spawn**
   - On the bot's `spawn` event, `BotController` computes the `serverKey` as `host:port` based on `config.server`.
   - The controller checks `loginCache.hasServerRegistration(username, serverKey)`.
   - If the bot has **not** registered on this server before, it sends a configurable first-login command (for example `/register {password}`) and then calls `loginCache.markServerRegistration(username, serverKey)`.
   - If the bot **has** registered on this server before, the command is skipped and only `lastSeenAt` is updated for that server.

## BotLoginCache Structure

The cache is stored as JSON (default path: `src/config/botLoginCache.json`), with this shape:

```jsonc
{
  "version": 1,
  "bots": {
    "ExampleBot": {
      "password": "generatedSecretPassword",
      "createdAt": "2025-11-15T12:34:56.000Z",
      "lastUsedAt": "2025-11-15T12:40:00.000Z",
      "servers": {
        "play.example.com:25565": {
          "registeredAt": "2025-11-15T12:35:00.000Z",
          "lastSeenAt": "2025-11-15T12:40:00.000Z"
        }
      }
    }
  }
}
```

### Key responsibilities

- **getOrCreateCredentials(username)**
  - Ensures each username has a single persistent password.
  - Updates `lastUsedAt` whenever credentials are requested.

- **hasServerRegistration(username, serverKey)**
  - Returns `true` when the bot has already performed its first-login command on the specified server.

- **markServerRegistration(username, serverKey)**
  - Marks the bot as registered on `serverKey`.
  - Creates or updates the `servers[serverKey]` entry with `registeredAt`/`lastSeenAt` timestamps.

## First-Login Command Behavior

The first-login command is configurable via `config.json` under `security.botLoginCache`:

```jsonc
"security": {
  "botLoginCache": {
    "filePath": "./src/config/botLoginCache.json",
    "firstLoginCommandTemplate": "/register {password} {confirm}",
    "firstLoginCommandDelayMs": 3000,
    "loginOnJoinCommandTemplate": "/login {password}",
    "loginCommandDelayMs": 12000,
    "serverOverrides": {}
  }
}
```

- Templates support `{password}`, `{confirm}`, and `{username}` placeholders.
- If `config.allowInGameChat` is `false`, no auth commands are sent.
- `firstLoginCommandDelayMs` and `loginCommandDelayMs` control when the commands are sent after spawn.
- `serverOverrides` lets you customize per server using keys like `"host:port"`:

```jsonc
"serverOverrides": {
  "example.net:25565": {
    "firstLoginCommandTemplate": "/auth register {password} {confirm}",
    "loginOnJoinCommandTemplate": "/auth login {username} {password}",
    "firstLoginCommandDelayMs": 8000,
    "loginCommandDelayMs": 12000
  }
}
```

## Global Chat Cooldown

To avoid spamming the server with messages from behaviors or first-login commands, the bot applies a global chat cooldown wrapper around `bot.chat`.

Configured in `config.json`:

```jsonc
"_chat": "Global chat settings (cooldowns, filters, etc.)",
"chat": {
  "cooldown": {
    "enabled": true,
    "minIntervalMs": 1500,
    "_minIntervalMsHelp": "Minimum delay between chat messages sent by the bot to reduce spam/kicks. Default: 1500ms"
  }
}
```

- When enabled, all calls to `bot.chat(...)` are queued and sent one at a time, with at least `minIntervalMs` between messages.
- This applies to behavior messages, first-login registration commands, and any other chat output, helping prevent anti-spam kicks on stricter servers.
- Console-originated commands still use the same wrapper but redirect output to the local console rather than the server while they are running.

## Usage Notes

- The cache file should be treated as sensitive; avoid committing it to version control.
- Passwords are currently stored in plaintext for convenience; if stronger security is needed, the implementation can be extended to hash passwords and/or support rotation.
- Other components (e.g. dashboards or external services) can use the cached password as a shared secret to authenticate requests for a given bot username.
