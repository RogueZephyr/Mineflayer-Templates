# Proxy Configuration

Route bot connections through a SOCKS proxy to change the IP address used to connect to Minecraft servers.

## Requirements

First, install the `socks` module:

```bash
npm install socks
```

## Configuration

Edit `src/config/config.json`:

```json
{
  "proxy": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 1080,
    "type": 5,
    "username": "",
    "password": ""
  }
}
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | boolean | Enable/disable proxy connection |
| `host` | string | Proxy server IP address or hostname |
| `port` | number | Proxy server port |
| `type` | number | `4` for SOCKS4, `5` for SOCKS5 (recommended) |
| `username` | string | Proxy authentication username (optional) |
| `password` | string | Proxy authentication password (optional) |

## Common Proxy Types

### 1. Local SOCKS5 Proxy (SSH Tunnel)

Create an SSH tunnel to use as a proxy:

```bash
# On Linux/Mac
ssh -D 1080 -C -N user@your-server.com

# On Windows (using PuTTY)
# Connection > SSH > Tunnels
# Source port: 1080
# Destination: Dynamic
# Check "Auto" and "IPv4"
```

Config:
```json
{
  "proxy": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 1080,
    "type": 5
  }
}
```

### 2. Residential/Datacenter Proxy

If you have a paid proxy service:

```json
{
  "proxy": {
    "enabled": true,
    "host": "proxy.example.com",
    "port": 1080,
    "type": 5,
    "username": "your_username",
    "password": "your_password"
  }
}
```

### 3. Tor Network

Use Tor as a SOCKS5 proxy (changes IP automatically):

1. Install and run Tor
2. Default Tor SOCKS5 port is 9050

```json
{
  "proxy": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 9050,
    "type": 5
  }
}
```

### 4. VPN with SOCKS5

Some VPNs provide SOCKS5 proxy access:

```json
{
  "proxy": {
    "enabled": true,
    "host": "vpn-proxy.example.com",
    "port": 1080,
    "type": 5,
    "username": "vpn_user",
    "password": "vpn_pass"
  }
}
```

## Setting Up a Simple Proxy

### Using SSH (Free)

If you have access to a VPS or remote server:

```bash
# Create SOCKS5 proxy on port 1080
ssh -D 1080 -C -N -f user@your-server-ip

# -D 1080: Dynamic forwarding on port 1080
# -C: Compress data
# -N: Don't execute remote commands
# -f: Run in background
```

### Using Dante (SOCKS Server)

Install Dante on a VPS to create your own SOCKS5 server:

```bash
# On Ubuntu/Debian VPS
sudo apt-get install dante-server

# Edit /etc/danted.conf
sudo nano /etc/danted.conf

# Start service
sudo systemctl start danted
sudo systemctl enable danted
```

## Multi-Bot with Different IPs

You can use different proxies for each bot by modifying the config per bot instance or using a proxy rotation list.

### Example: Per-Bot Proxy

Modify `BotController.js` to accept per-instance proxy settings:

```javascript
// Pass proxy in constructor
const bot1 = new BotController(config, coordinator, { 
  proxyHost: '127.0.0.1', 
  proxyPort: 1080 
});

const bot2 = new BotController(config, coordinator, { 
  proxyHost: '127.0.0.1', 
  proxyPort: 1081 
});
```

## Testing Proxy Connection

Test if your proxy works:

```bash
# Test SOCKS5 proxy with curl
curl --socks5 127.0.0.1:1080 https://api.ipify.org

# Should return the proxy's IP address
```

## Troubleshooting

### Error: "Socks module not installed"

Install the required module:
```bash
npm install socks
```

### Error: "Proxy connection failed"

1. **Check proxy is running**: Verify the proxy server is active
2. **Check host/port**: Ensure correct IP and port
3. **Check authentication**: Verify username/password if required
4. **Check firewall**: Ensure port is open
5. **Test proxy**: Use curl or another tool to verify proxy works

### Connection timeout

- Increase timeout in proxy settings
- Check if proxy supports Minecraft connections
- Try a different proxy type (SOCKS4 vs SOCKS5)

### Bot connects but gets kicked

- Some servers detect proxy/VPN usage
- Try residential proxies instead of datacenter IPs
- Ensure proxy has clean IP reputation

## Security Notes

⚠️ **Important:**
- Never share proxy credentials publicly
- Use secure proxies from trusted sources
- Free public proxies may log your traffic
- Consider privacy implications

## Use Cases

### Development & Testing
- Test bot behavior from different regions
- Simulate multiple users from different locations

### Server Testing
- Test server anti-bot measures
- Verify region-based restrictions

### Privacy
- Mask your real IP when running bots
- Prevent server from tracking your actual location

## Advanced: Rotating Proxies

For rotating through multiple proxies, you could implement a proxy pool:

```javascript
const proxies = [
  { host: '127.0.0.1', port: 1080 },
  { host: '127.0.0.1', port: 1081 },
  { host: '127.0.0.1', port: 1082 }
];

// Rotate on each connection
const proxyIndex = botNumber % proxies.length;
config.proxy = { ...proxies[proxyIndex], enabled: true };
```

## References

- [SOCKS Protocol Documentation](https://en.wikipedia.org/wiki/SOCKS)
- [SSH Tunneling Guide](https://www.ssh.com/academy/ssh/tunneling)
- [Mineflayer Documentation](https://github.com/PrismarineJS/mineflayer)
