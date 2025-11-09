// src/utils/ProxyManager.js
import fs from 'fs'; // kept for existsSync fallback
import fsp from 'fs/promises';
import MetricsAdapter from './MetricsAdapter.js';
import path from 'path';

/**
 * ProxyManager - Handles proxy connections for Mineflayer bots
 * Supports SOCKS4/SOCKS5 proxies with optional authentication
 * Includes proxy rotation for multi-bot deployments
 */
export default class ProxyManager {
  static proxyPool = null;
  static currentIndex = 0;
  static instanceCount = 0;

  constructor(config, logger, instanceId = null) {
    this.config = config;
    this.logger = logger;
    this.socksModule = null;
    this.instanceId = instanceId !== null ? instanceId : ProxyManager.instanceCount++;
    this.assignedProxy = null;
    this.metrics = new MetricsAdapter(logger);
    // Pool is loaded via explicit async call before instantiation in BotController
  }

  /**
   * Load proxy pool from proxies.json
   */
  static _loadingPromise = null;
  static async loadProxyPool(logger) {
    if (ProxyManager.proxyPool) return ProxyManager.proxyPool;
    if (ProxyManager._loadingPromise) return ProxyManager._loadingPromise;
    ProxyManager._loadingPromise = (async () => {
      const proxyFile = path.join(process.cwd(), 'data', 'proxies.json');
      try {
        const raw = await fsp.readFile(proxyFile, 'utf8').catch(() => null);
        if (raw) {
          ProxyManager.proxyPool = JSON.parse(raw);
        } else {
          if (fs.existsSync(proxyFile)) {
            ProxyManager.proxyPool = JSON.parse(fs.readFileSync(proxyFile, 'utf8'));
          } else {
            ProxyManager.proxyPool = { proxies: [], rotation: { enabled: false } };
            logger?.warn?.('[ProxyManager] No proxies.json found, rotation disabled');
          }
        }
        const enabledCount = ProxyManager.proxyPool.proxies?.filter(p => p.enabled !== false).length || 0;
        logger?.info?.(`[ProxyManager] Loaded proxy pool: ${enabledCount} enabled proxies`);
      } catch (e) {
        logger?.error?.(`[ProxyManager] Failed to load proxy pool: ${e.message}`);
        ProxyManager.proxyPool = { proxies: [], rotation: { enabled: false } };
      }
      return ProxyManager.proxyPool;
    })();
    return ProxyManager._loadingPromise;
  }

  /**
   * Get the next proxy from the pool based on rotation mode
   */
  static _getNextProxy() {
    const pool = ProxyManager.proxyPool;
    if (!pool || !pool.proxies || pool.proxies.length === 0) return null;
    
    const enabled = pool.proxies.filter(p => p.enabled !== false);
    if (enabled.length === 0) return null;

    const mode = pool.rotation?.mode || 'sequential';
    
    if (mode === 'random') {
      return enabled[Math.floor(Math.random() * enabled.length)];
    } else {
      // Sequential mode
      const proxy = enabled[ProxyManager.currentIndex % enabled.length];
      ProxyManager.currentIndex++;
      return proxy;
    }
  }

  /**
   * Assign a proxy to this instance from the pool
   */
  assignProxyFromPool() {
    const pool = ProxyManager.proxyPool;
    if (!pool?.rotation?.enabled) {
      // Rotation disabled, use config proxy
      if (this.config?.proxy?.enabled) {
        this.assignedProxy = this.config.proxy;
        return this.assignedProxy;
      }
      return null;
    }

    // Get next proxy from pool
    const proxy = ProxyManager._getNextProxy();
    if (proxy) {
      this.assignedProxy = proxy;
      this.logger?.info?.(`[ProxyManager] Bot #${this.instanceId} assigned proxy: ${proxy.label || proxy.host}:${proxy.port}`);
      return proxy;
    }
    
    this.logger?.warn?.(`[ProxyManager] No proxies available in pool`);
    return null;
  }

  /**
   * Check if proxy is enabled in config
   */
  isEnabled() {
    // Check if rotation is enabled
    if (ProxyManager.proxyPool?.rotation?.enabled) {
      return this.assignedProxy !== null;
    }
    // Fallback to config proxy
    return this.config?.proxy?.enabled === true;
  }

  /**
   * Get the active proxy configuration (assigned or config)
   */
  getActiveProxy() {
    if (this.assignedProxy) return this.assignedProxy;
    if (this.config?.proxy?.enabled) return this.config.proxy;
    return null;
  }

  /**
   * Load socks module dynamically
   */
  async loadSocksModule() {
    if (this.socksModule) return this.socksModule;

    try {
      const socks = await import('socks');
      this.socksModule = socks;
      return socks;
  } catch (_err) {
      this.logger.error('[Proxy] Failed to load socks module');
      this.logger.error('[Proxy] Install with: npm install socks');
      throw new Error('Socks module not installed. Run: npm install socks');
    }
  }

  /**
   * Get proxy configuration for bot connection
   * Returns the connect function for mineflayer createBot options
   */
  async getProxyConnectFunction(targetHost, targetPort) {
    // Assign proxy from pool if rotation enabled
    if (!this.assignedProxy && ProxyManager.proxyPool?.rotation?.enabled) {
      this.assignProxyFromPool();
    }

    const proxyConfig = this.getActiveProxy();
    
    if (!proxyConfig) {
      return null;
    }

    // Validate proxy configuration
    if (!proxyConfig.host || !proxyConfig.port) {
      this.logger.error('[Proxy] Invalid proxy configuration: host and port required');
      return null;
    }

    // Load socks module
    let SocksClient;
    try {
      const socks = await this.loadSocksModule();
      SocksClient = socks.SocksClient;
    } catch (err) {
      this.logger.error(`[Proxy] ${err.message}`);
      return null;
    }

    // Return the connect function
    return (client) => {
      const options = {
        proxy: {
          host: proxyConfig.host,
          port: proxyConfig.port,
          type: proxyConfig.type || 5, // SOCKS5 by default
        },
        command: 'connect',
        destination: {
          host: targetHost,
          port: targetPort
        }
      };

      // Add authentication if provided
      if (proxyConfig.username && proxyConfig.password) {
        options.proxy.userId = proxyConfig.username;
        options.proxy.password = proxyConfig.password;
      }

      const label = proxyConfig.label || `${proxyConfig.host}:${proxyConfig.port}`;
  this.logger.info(`[Proxy] Bot #${this.instanceId} connecting via ${label} (SOCKS${proxyConfig.type || 5})`);
  this.metrics.inc('proxy_connect_attempts');

      SocksClient.createConnection(options)
        .then(info => {
          client.setSocket(info.socket);
          client.emit('connect');
          this.logger.success(`[Proxy] Bot #${this.instanceId} connection established via ${label}`);
          this.metrics.inc('proxy_connect_success');
        })
        .catch(err => {
          this.logger.error(`[Proxy] Bot #${this.instanceId} connection failed via ${label}: ${err.message}`);
          this.metrics.inc('proxy_connect_fail');
          client.emit('error', err);
        });
    };
  }

  /**
   * Get proxy info for logging/display
   */
  getProxyInfo() {
    const proxyConfig = this.getActiveProxy();
    
    if (!proxyConfig) {
      return { enabled: false };
    }

    return {
      enabled: true,
      host: proxyConfig.host,
      port: proxyConfig.port,
      type: `SOCKS${proxyConfig.type || 5}`,
      authenticated: !!(proxyConfig.username && proxyConfig.password),
      label: proxyConfig.label || null,
      instanceId: this.instanceId
    };
  }

  /**
   * Test proxy connection (optional utility method)
   */
  async testConnection(targetHost = 'minecraft.net', targetPort = 25565) {
    const proxyConfig = this.getActiveProxy();
    
    if (!proxyConfig) {
      this.logger.warn('[Proxy] Proxy is not enabled');
      return false;
    }

    try {
      const socks = await this.loadSocksModule();
      const SocksClient = socks.SocksClient;

      const options = {
        proxy: {
          host: proxyConfig.host,
          port: proxyConfig.port,
          type: proxyConfig.type || 5,
        },
        command: 'connect',
        destination: {
          host: targetHost,
          port: targetPort
        }
      };

      if (proxyConfig.username && proxyConfig.password) {
        options.proxy.userId = proxyConfig.username;
        options.proxy.password = proxyConfig.password;
      }

      const stop = this.metrics.startTimer('proxy_test_connection');
      const info = await SocksClient.createConnection(options);
      info.socket.destroy();
      const dur = stop();
      
      const label = proxyConfig.label || `${proxyConfig.host}:${proxyConfig.port}`;
      this.logger.success(`[Proxy] Test connection successful to ${targetHost}:${targetPort} via ${label}`);
      this.metrics.inc('proxy_test_success');
      this.metrics.setGauge('proxy_test_last_ms', dur);
      return true;
    } catch (err) {
      this.logger.error(`[Proxy] Test connection failed: ${err.message}`);
      this.metrics.inc('proxy_test_fail');
      return false;
    }
  }

  /**
   * Validate proxy configuration
   */
  validateConfig() {
    const proxyConfig = this.getActiveProxy();
    
    if (!proxyConfig) {
      return { valid: true, message: 'Proxy disabled' };
    }

    const errors = [];

    if (!proxyConfig.host) {
      errors.push('Proxy host is required');
    }

    if (!proxyConfig.port || typeof proxyConfig.port !== 'number') {
      errors.push('Proxy port must be a number');
    }

    if (proxyConfig.type && ![4, 5].includes(proxyConfig.type)) {
      errors.push('Proxy type must be 4 (SOCKS4) or 5 (SOCKS5)');
    }

    if (proxyConfig.username && !proxyConfig.password) {
      errors.push('Proxy password required when username is provided');
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }

  /**
   * Fetch the external IP as seen by an HTTP service via the proxy.
   * Uses a raw SOCKS connection and minimal HTTP request to avoid extra deps.
   * Returns the IP string (IPv4/IPv6) or null on failure.
   */
  async fetchExternalIP(timeoutMs = 7000) {
    const proxyConfig = this.getActiveProxy();
    
    if (!proxyConfig) return null;
    
    let SocksClient;
    try {
      const socks = await this.loadSocksModule();
      SocksClient = socks.SocksClient;
    } catch (e) {
      this.logger.error(`[Proxy] Cannot load socks module for IP check: ${e.message || e}`);
      return null;
    }

    const destinationHost = 'api.ipify.org';
    const destinationPort = 80; // plain HTTP
    const options = {
      proxy: {
        host: proxyConfig.host,
        port: proxyConfig.port,
        type: proxyConfig.type || 5
      },
      command: 'connect',
      destination: { host: destinationHost, port: destinationPort }
    };
    if (proxyConfig.username && proxyConfig.password) {
      options.proxy.userId = proxyConfig.username;
      options.proxy.password = proxyConfig.password;
    }

    try {
      const controller = { timedOut: false };
      const stop = this.metrics.startTimer('proxy_ip_fetch');
      const timer = setTimeout(() => { controller.timedOut = true; }, timeoutMs);
      const info = await SocksClient.createConnection(options);
      clearTimeout(timer);
      if (controller.timedOut) {
        this.logger.warn(`[Proxy] Bot #${this.instanceId} external IP check timed out`);
        info.socket.destroy();
        this.metrics.inc('proxy_ip_fetch_timeout');
        return null;
      }
      const socket = info.socket;
      const req = 'GET /?format=text HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\nUser-Agent: MineflayerBot/1.0\r\n\r\n';
      socket.write(req);
      return await new Promise(resolve => {
        let dataBuf = '';
        socket.on('data', chunk => { dataBuf += chunk.toString('utf8'); });
        socket.on('error', err => {
          this.logger.warn(`[Proxy] Bot #${this.instanceId} external IP fetch error: ${err.message}`);
          try { socket.destroy(); } catch (_) {}
          this.metrics.inc('proxy_ip_fetch_error');
          resolve(null);
        });
        socket.on('end', () => {
          try { socket.destroy(); } catch (_) {}
          // Split headers/body
          const parts = dataBuf.split(/\r?\n\r?\n/);
          const body = parts.length > 1 ? parts.slice(1).join('\n\n') : dataBuf;
          const ipMatch = body.match(/([0-9]{1,3}(?:\.[0-9]{1,3}){3})|([a-fA-F0-9:]{3,})/);
          if (ipMatch) {
            const ip = ipMatch[0];
            const label = proxyConfig.label || `${proxyConfig.host}:${proxyConfig.port}`;
            this.logger.info(`[Proxy] Bot #${this.instanceId} external IP via ${label}: ${ip}`);
            const dur = stop();
            this.metrics.setGauge('proxy_ip_fetch_last_ms', dur);
            this.metrics.inc('proxy_ip_fetch_success');
            resolve(ip);
          } else {
            this.logger.warn(`[Proxy] Bot #${this.instanceId} could not parse external IP response`);
            this.metrics.inc('proxy_ip_parse_fail');
            resolve(null);
          }
        });
      });
    } catch (e) {
      this.logger.error(`[Proxy] Bot #${this.instanceId} failed to fetch external IP: ${e.message || e}`);
      this.metrics.inc('proxy_ip_fetch_fail');
      return null;
    }
  }
}
