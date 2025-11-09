// src/utils/MetricsAdapter.js
// Lightweight metrics and structured logging adapter with optional hooks.
// No external dependencies; callers can wire exporters later if desired.

export default class MetricsAdapter {
  constructor(logger = null) {
    this.logger = logger;
    this.counters = new Map();
    this.timers = new Map();
    this.gauges = new Map();
    this.enabled = true; // allow runtime disable if needed
  }

  // ---- Counters ----
  inc(name, labels = {}, value = 1) {
    if (!this.enabled) return;
    const key = this._key(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  getCount(name, labels = {}) {
    return this.counters.get(this._key(name, labels)) || 0;
  }

  // ---- Gauges ----
  setGauge(name, value, labels = {}) {
    if (!this.enabled) return;
    this.gauges.set(this._key(name, labels), Number(value) || 0);
  }

  getGauge(name, labels = {}) {
    return this.gauges.get(this._key(name, labels)) || 0;
  }

  // ---- Timers ----
  startTimer(name, labels = {}) {
    if (!this.enabled) return () => 0;
    const start = Date.now();
    const key = this._key(name, labels);
    this.timers.set(key, start);
    return () => {
      const end = Date.now();
      const dur = end - (this.timers.get(key) || start);
      this.inc(`${name}_count`, labels, 1);
      this.setGauge(`${name}_last_ms`, dur, labels);
      return dur;
    };
  }

  // ---- Structured logging helpers ----
  info(msg, fields = {}) { this._log('info', msg, fields); }
  warn(msg, fields = {}) { this._log('warn', msg, fields); }
  error(msg, fields = {}) { this._log('error', msg, fields); }
  debug(msg, fields = {}) { this._log('debug', msg, fields); }

  _log(level, msg, fields) {
    if (!this.logger || typeof this.logger[level] !== 'function') return;
    try {
      const payload = Object.keys(fields).length ? `${msg} | ${JSON.stringify(fields)}` : msg;
      this.logger[level](payload);
    } catch (_err) {
      // Non-fatal: only emit in debug mode if logger has debug method
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`MetricsAdapter log failure: ${_err?.message || _err}`);
      }
    }
  }

  _key(name, labels) {
    const parts = Object.keys(labels).sort().map(k => `${k}=${labels[k]}`);
    return parts.length ? `${name}|${parts.join(',')}` : name;
  }
}
