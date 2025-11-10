import chalk from 'chalk'

/**
 * Logger with optional structured JSON emission when running in dashboard mode.
 * When process.env.DASHBOARD_MODE === 'electron', each log line is emitted as a
 * JSON event compatible with runtimeEntry's passthrough (it skips wrapping
 * lines beginning with '{'). This allows the Electron main process to forward
 * per-bot logs (botId) so the renderer can filter by bot.
 */
export default class Logger {
  constructor(ctx = {}) {
    this.startTime = new Date()
    this.botId = ctx.botId || null
  }

  setBotId(botId) {
    this.botId = botId
  }

  _timestamp() {
    return chalk.gray(`[${new Date().toLocaleTimeString()}]`)
  }

  _emit(level, msg) {
    const isDashboard = process.env.DASHBOARD_MODE === 'electron'
    // Strip ANSI escape sequences (CSI codes) ONLY for dashboard rendering
    const stripAnsi = (s) => {
      if (typeof s !== 'string') return s
      let out = ''
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i)
        if (code === 27 /* ESC */ && s[i + 1] === '[') {
          // Skip CSI sequence until final byte in range 64-126 ('@' to '~')
          i += 2
          while (i < s.length) {
            const c = s.charCodeAt(i)
            if (c >= 64 && c <= 126) break
            i++
          }
          continue
        }
        out += s[i]
      }
      return out
    }
    const outMsg = isDashboard ? stripAnsi(msg) : msg
    // Structured mode for dashboard: output a single JSON object so interceptLogs won't wrap
    if (isDashboard) {
      const event = {
        type: 'log',
        payload: {
          level,
          message: outMsg,
          botId: this.botId || undefined,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      }
      // Ensure it's a single line JSON to be parsed upstream
      console.log(JSON.stringify(event))
      return
    }
    // Fallback colorful human console output
    switch (level) {
      case 'error':
        console.log(`${this._timestamp()} ${chalk.red('[ERROR]')} ${outMsg}`)
        break
      case 'warn':
        console.log(`${this._timestamp()} ${chalk.yellow('[WARN]')} ${outMsg}`)
        break
      case 'success':
        console.log(`${this._timestamp()} ${chalk.green('[OK]')} ${outMsg}`)
        break
      case 'debug':
        console.log(`${this._timestamp()} ${chalk.magenta('[DEBUG]')} ${outMsg}`)
        break
      default:
        console.log(`${this._timestamp()} ${chalk.cyan('[INFO]')} ${outMsg}`)
    }
  }

  info(msg) { this._emit('info', msg) }
  warn(msg) { this._emit('warn', msg) }
  error(msg) { this._emit('error', msg) }
  success(msg) { this._emit('success', msg) }
  debug(msg) { this._emit('debug', msg) }
}