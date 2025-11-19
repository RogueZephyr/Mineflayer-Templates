# Minescript Bridge Client (Python)

This directory contains a Python client for Minescript that lets you privately control your Mineflayer bot via a local WebSocket bridge.

Files:
- `private_bridge.py` — Minescript job script that:
  - Intercepts `/come`, `/follow`, `/mine` and prevents them from reaching the server
  - Sends `{ type: "command", name, args }` to `ws://127.0.0.1:8080`
  - Periodically sends player state `{ type: "state", position, rotation, lookingAt }`

## Prerequisites
1. In this Node project, enable the bridge in `src/config/config.json` under `security.privateBridge`:

```jsonc
{
  "security": {
    "privateBridge": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8080,
      "secret": "" // optional, set a value for extra safety
    }
  }
}
```

2. Ensure the Python environment Minescript uses has the `websockets` package installed:
   - Windows (cmd):
     - `pip install websockets`

## How to use in-game
1. Start your Mineflayer bot (this project). With `privateBridge.enabled=true`, it will start the local WS server on 127.0.0.1:8080.
2. In your Minescript-enabled client, run the Python job. For many setups you can invoke:
   - `\private_bridge [ws_url] [secret]`
   - Example: `\private_bridge ws://127.0.0.1:8080` (no secret)
   - Example: `\private_bridge ws://127.0.0.1:8080 mySharedSecret`
3. Use the commands in chat (they are intercepted locally and not sent to the server):
  - `/come` — Bot moves near your current position
  - `/follow` — Bot follows you continuously
  - `/mine` — Bot mines the block under your crosshair
  - `/hello` — Simple connectivity test (bot logs a greeting; may chat if not silent)

If your Minescript install uses a different way to start scripts, adapt step 2 accordingly (e.g., pointing the job runner to `private_bridge.py`).

## Notes
- The Node bridge binds only to localhost for safety.
- If you set a shared secret in Node config, pass the same `secret` when starting the Python job.
- The script will reconnect automatically if the bot restarts.
