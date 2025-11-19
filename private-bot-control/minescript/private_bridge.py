#!/usr/bin/env python3
r"""
Minescript ⇆ Mineflayer Private Bridge (Python)
Usage in-game: \private_bridge [ws_url] [secret]

- Intercepts outgoing chat messages that look like private bot commands:
  /come, /follow, /mine
- Prevents them from reaching the server (client-only)
- Sends {type:"command", name, args} to a local WebSocket bridge (Node)
- Periodically streams player state and crosshair target ({type:"state"})

Requirements:
- Enable Node bridge in src/config/config.json: security.privateBridge.enabled: true
- This script uses the 'websockets' package. Install once for your Python used by Minescript.
  Windows PowerShell:  pip install websockets

Stop the job with: \jobs to find the id, then \killjob <ID>
"""

import sys
import re
import json
import time
import threading
from queue import Queue, Empty
from typing import Any, Dict, Optional

# Minescript Python API
# Docs: functions available via minescript.py (echo, chat, log, etc.)
try:
    import minescript  # type: ignore
    from minescript import echo, log  # type: ignore
except Exception:  # Fallback when running outside Minescript to appease linters
    class _DummyMS:
        def player(self):
            return None

        def player_orientation(self):
            return (0.0, 0.0)

        def player_get_targeted_block(self, max_distance: float = 48.0):
            return None

        def chat(self, msg: str):
            print(f"[PrivateBridge dummy chat] {msg}")

    minescript = _DummyMS()  # type: ignore

    def echo(msg: str):  # type: ignore
        print(msg)

    def log(msg: str):  # type: ignore
        print(msg)

# Optional dependency: websockets
try:
    import asyncio
    import websockets  # type: ignore
except ImportError:
    websockets = None  # type: ignore

# -------------------------------
# Configuration
# -------------------------------
WS_URL = "ws://127.0.0.1:8080"
SHARED_SECRET = ""  # If set on Node bridge, set the same value here
STATE_INTERVAL_MS = 125  # ~8 Hz
COMMAND_PATTERN = re.compile(r"^/(come|follow|mine|hello)(?:\s|$)", re.IGNORECASE)
PROTOCOL_VERSION = 1

# -------------------------------
# Accessors for player state / crosshair using Minescript helpers if available
# Fallbacks are guarded to avoid noisy errors if world not loaded
# -------------------------------
def get_player_state() -> Optional[Dict[str, float]]:
    try:
        me = minescript.player()
        if not me:
            return None
        pos = me.position  # Vector3f (x,y,z)
        yaw, pitch = minescript.player_orientation()
        return {"x": float(pos[0]), "y": float(pos[1]), "z": float(pos[2]), "yaw": float(yaw), "pitch": float(pitch)}
    except Exception:
        return None


def get_crosshair_block() -> Optional[Dict[str, int]]:
    try:
        info = minescript.player_get_targeted_block(max_distance=48.0)
        if not info:
            return None
        bp = info.position  # Block pos (x,y,z)
        return {"x": int(bp[0]), "y": int(bp[1]), "z": int(bp[2])}
    except Exception:
        return None


# -------------------------------
# WS client running in a background thread with an asyncio loop
# -------------------------------
class WSClient:
    def __init__(self, url: str, secret: str = ""):
        self.url = url
        self.secret = secret
        self.tx_queue: "Queue[Dict[str, Any]]" = Queue()
        self._thread: Optional[threading.Thread] = None
        self._stop_evt = threading.Event()
        self._connected = False

    def start(self):
        if websockets is None:
            echo("[PrivateBridge] Missing dependency: pip install websockets")
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop_evt.clear()
        self._thread = threading.Thread(target=self._run_loop, name="PrivateBridgeWS", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_evt.set()
        try:
            self.tx_queue.put_nowait({"_type": "STOP"})
        except Exception:
            pass
        if self._thread:
            self._thread.join(timeout=2)
        self._thread = None
        self._connected = False

    def is_connected(self) -> bool:
        return self._connected

    def send(self, payload: Dict[str, Any]):
        try:
            self.tx_queue.put_nowait(payload)
        except Exception as e:
            log(f"[PrivateBridge] enqueue failed: {e}")

    # Internal thread target
    def _run_loop(self):
        asyncio.run(self._async_main())

    async def _async_main(self):
        backoff = 0.5
        while not self._stop_evt.is_set():
            try:
                async with websockets.connect(self.url, max_size=64 * 1024) as ws:  # type: ignore
                    self._connected = True
                    backoff = 0.5
                    # Hello
                    hello = {"type": "hello", "v": PROTOCOL_VERSION}
                    if self.secret:
                        hello["secret"] = self.secret
                    await ws.send(json.dumps(hello, separators=(",", ":")))
                    # Start receiver task
                    recv_task = asyncio.create_task(self._recv_loop(ws))
                    # Sender loop
                    while not self._stop_evt.is_set():
                        try:
                            item = self.tx_queue.get(timeout=0.25)
                        except Empty:
                            continue
                        if item.get("_type") == "STOP":
                            break
                        try:
                            await ws.send(json.dumps(item, separators=(",", ":")))
                        except Exception as e:
                            log(f"[PrivateBridge] send failed: {e}")
                            break
                    try:
                        recv_task.cancel()
                    except Exception:
                        pass
            except Exception as e:
                if not self._stop_evt.is_set():
                    log(f"[PrivateBridge] connect error: {e}")

            self._connected = False
            if self._stop_evt.is_set():
                break
            # backoff before reconnect (async-friendly)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2.0, 5.0)

    async def _recv_loop(self, ws):
        try:
            async for raw in ws:
                try:
                    data = json.loads(raw)
                except Exception:
                    continue
                t = data.get("type")
                if t == "ack":
                    # optional: first ack after hello or command
                    pass
                elif t == "error":
                    code = data.get("code")
                    msg = data.get("message", "")
                    echo(f"[PrivateBridge] error: {code} {msg}")
        except Exception:
            # socket closed or failed
            pass


# -------------------------------
# Command parsing and state payload builder
# -------------------------------
def parse_private_command(msg: str) -> Optional[Dict[str, Any]]:
    if not msg:
        return None
    if not COMMAND_PATTERN.match(msg.strip()):
        return None
    parts = msg.strip()[1:].split()
    if not parts:
        return None
    name = parts[0].lower()
    args = parts[1:] if len(parts) > 1 else []
    return {"name": name, "args": args}


def build_state_payload() -> Optional[Dict[str, Any]]:
    st = get_player_state()
    if not st:
        return None
    looking = get_crosshair_block()
    payload = {
        "type": "state",
        "v": PROTOCOL_VERSION,
        "position": {"x": st["x"], "y": st["y"], "z": st["z"]},
        "rotation": {"yaw": st["yaw"], "pitch": st["pitch"]},
    }
    if looking:
        payload["lookingAt"] = looking
    return payload


# -------------------------------
# Main entry point (Minescript job)
# -------------------------------
def main():
    # Allow overrides: \private_bridge [ws_url] [secret]
    url = WS_URL
    secret = SHARED_SECRET
    if len(sys.argv) >= 2:
        url = sys.argv[1]
    if len(sys.argv) >= 3:
        secret = sys.argv[2]

    echo(f"[PrivateBridge] starting → {url}")
    client = WSClient(url, secret)
    client.start()

    last_state_ms = 0.0

    # Use EventQueue when available to intercept outgoing chat and world changes.
    # If EventQueue is not available in your Minescript version, you can remove
    # this section and rely on your specific API to hook chat interception.
    try:
        from minescript import EventQueue
    except Exception:
        EventQueue = None

    if EventQueue is None:
        echo("[PrivateBridge] WARNING: EventQueue not available; chat interception may not work")
        # Fallback: lightweight loop that only sends state periodically
        try:
            while True:
                now_ms = time.time() * 1000.0
                if client.is_connected() and now_ms - last_state_ms >= STATE_INTERVAL_MS:
                    last_state_ms = now_ms
                    st = build_state_payload()
                    if st:
                        client.send(st)
                time.sleep(max(STATE_INTERVAL_MS / 1000.0, 0.05))
        except KeyboardInterrupt:
            echo("[PrivateBridge] stopped by user")
        return

    # Preferred path: Event-driven loop with intercept
    with EventQueue() as eq:
        eq.register_world_listener()
        eq.register_outgoing_chat_interceptor(pattern=r"^/(come|follow|mine|hello)(?:\s|$)")

        while True:
            # Drive periodic state at ~8 Hz using timeout on event queue
            timeout = max(STATE_INTERVAL_MS / 1000.0, 0.05)
            try:
                event = eq.get(block=True, timeout=timeout)
            except Exception:
                event = None

            # Periodic state push
            now_ms = time.time() * 1000.0
            if now_ms - last_state_ms >= STATE_INTERVAL_MS and client.is_connected():
                last_state_ms = now_ms
                st = build_state_payload()
                if st:
                    client.send(st)

            if not event:
                continue

            if event.type == "world":
                if not event.connected:
                    echo("[PrivateBridge] world disconnected, stopping.")
                    break

            elif event.type == "outgoing_chat_intercept":
                msg = (event.message or "").strip()
                cmd = parse_private_command(msg)
                if not cmd:
                    # Not our command; re-send as normal chat so it's not lost
                    minescript.chat(msg)
                    continue
                payload = {"type": "command", "v": PROTOCOL_VERSION, "name": cmd["name"]}
                if cmd["args"]:
                    payload["args"] = cmd["args"]
                client.send(payload)
                log(f"[PrivateBridge] {cmd['name']} {' '.join(cmd['args']) if cmd['args'] else ''}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        echo("[PrivateBridge] stopped by user")
