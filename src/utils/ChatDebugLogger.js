// src/utils/ChatDebugLogger.js
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * ChatDebugLogger - Logs all chat events and their raw formats for debugging
 * Useful for understanding different chat formats across servers
 */
export default class ChatDebugLogger {
  constructor(bot, logger, config = {}) {
    this.bot = bot
    this.logger = logger
    this.config = config
    this.enabled = false
    this.logFilePath = path.join(__dirname, '..', '..', 'data', 'chat_debug_log.json')
    this.logs = []
    this.maxLogsInMemory = 100 // Keep last 100 logs in memory before flushing
    this.flushInterval = null // Auto-flush timer
    
    // Ensure data directory exists
    this.ensureDataDirectory()
  }

  /**
   * Ensure the data directory exists
   */
  ensureDataDirectory() {
    const dataDir = path.dirname(this.logFilePath)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
  }

  /**
   * Enable chat debug logging
   */
  enable() {
    if (this.enabled) return
    this.enabled = true

    // Log all message events with full details
    this.bot.on('message', (jsonMsg, position) => {
      this.logChatEvent('message', {
        jsonMsg: jsonMsg,
        jsonString: jsonMsg.toString(),
        position: position,
        timestamp: new Date().toISOString(),
        botUsername: this.bot.username
      })
    })

    // Log chat events (parsed username + message)
    this.bot.on('chat', (username, message) => {
      this.logChatEvent('chat', {
        username: username,
        message: message,
        timestamp: new Date().toISOString(),
        botUsername: this.bot.username
      })
    })

    // Log whisper events
    this.bot.on('whisper', (username, message) => {
      this.logChatEvent('whisper', {
        username: username,
        message: message,
        timestamp: new Date().toISOString(),
        botUsername: this.bot.username
      })
    })

    // Log actionBar messages (server messages above hotbar)
    this.bot.on('actionBar', (jsonMsg) => {
      this.logChatEvent('actionBar', {
        jsonMsg: jsonMsg,
        jsonString: jsonMsg.toString(),
        timestamp: new Date().toISOString(),
        botUsername: this.bot.username
      })
    })

    // Log title events
    this.bot.on('title', (text) => {
      this.logChatEvent('title', {
        text: text,
        timestamp: new Date().toISOString(),
        botUsername: this.bot.username
      })
    })

    // Log subtitle events
    this.bot.on('subtitle', (text) => {
      this.logChatEvent('subtitle', {
        text: text,
        timestamp: new Date().toISOString(),
        botUsername: this.bot.username
      })
    })

    this.logger.success(`[${this.bot.username}] ChatDebugLogger enabled - logging to ${this.logFilePath}`)
    
    // Set up periodic flush every 30 seconds
    this.flushInterval = setInterval(() => {
      if (this.logs.length > 0) {
        this.flushLogs()
      }
    }, 30000) // Flush every 30 seconds
  }

  /**
   * Disable chat debug logging and flush remaining logs
   */
  disable() {
    if (!this.enabled) return
    this.enabled = false

    // Clear flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }

    // Remove all chat-related listeners
    this.bot.removeAllListeners('message')
    this.bot.removeAllListeners('chat')
    this.bot.removeAllListeners('whisper')
    this.bot.removeAllListeners('actionBar')
    this.bot.removeAllListeners('title')
    this.bot.removeAllListeners('subtitle')

    // Flush any remaining logs
    this.flushLogs()

    this.logger.warn(`[${this.bot.username}] ChatDebugLogger disabled`)
  }

  /**
   * Log a chat event to memory
   */
  logChatEvent(eventType, data) {
    if (!this.enabled) return

    // Simplify the data structure for better readability
    const simplifiedData = this.simplifyEventData(eventType, data)

    const logEntry = {
      eventType: eventType,
      data: simplifiedData,
      timestamp: new Date().toISOString()
    }

    this.logs.push(logEntry)

    // Console log for immediate visibility (only if debug is enabled in config)
    if (this.config?.debug) {
      this.logger.debug(`[ChatDebug] ${eventType}: ${JSON.stringify(simplifiedData, null, 2)}`)
    }

    // Flush to file if we've accumulated enough logs
    if (this.logs.length >= this.maxLogsInMemory) {
      this.flushLogs()
    }
    
    // Also flush immediately for first 5 messages (helps with debugging)
    if (this.logs.length <= 5) {
      this.flushLogs()
    }
  }

  /**
   * Simplify event data for better readability
   */
  simplifyEventData(eventType, data) {
    const simplified = {
      timestamp: data.timestamp,
      botUsername: data.botUsername
    }

    if (eventType === 'message') {
      simplified.displayText = data.jsonString
      simplified.position = data.position
      
      // Try to extract username and actual message from unsigned data
      if (data.jsonMsg?.unsigned?.with) {
        const unsignedWith = data.jsonMsg.unsigned.with[0]
        if (unsignedWith?.extra) {
          const extras = unsignedWith.extra
          let username = ''
          let message = ''
          
          extras.forEach(part => {
            const text = part.text || part.json?.text || ''
            if (text.includes('[Member]') || text.includes('[')) {
              // Skip rank prefix
            } else if (text.includes(':')) {
              // Extract message after colon
              message = text.split(':').slice(1).join(':').trim()
            } else if (!username && text.trim()) {
              username = text.trim()
            }
          })
          
          if (username) simplified.extractedUsername = username
          if (message) simplified.extractedMessage = message
        }
      }
      
      // Keep raw JSON only if we couldn't extract useful info
      if (!simplified.extractedUsername && !simplified.extractedMessage) {
        simplified.rawJsonSample = this.getJsonSummary(data.jsonMsg)
      }
    } else if (eventType === 'chat') {
      simplified.username = data.username
      simplified.message = data.message
    } else if (eventType === 'whisper') {
      simplified.username = data.username
      simplified.message = data.message
    } else if (eventType === 'actionBar') {
      simplified.text = data.jsonString
      simplified.rawJsonSample = this.getJsonSummary(data.jsonMsg)
    } else if (eventType === 'title' || eventType === 'subtitle') {
      simplified.text = data.text
    }

    return simplified
  }

  /**
   * Get a concise summary of JSON message structure
   */
  getJsonSummary(jsonMsg) {
    if (!jsonMsg) return null
    
    const summary = {}
    
    if (jsonMsg.json) {
      if (jsonMsg.json.text) summary.mainText = jsonMsg.json.text
      if (jsonMsg.json.translate) summary.translate = jsonMsg.json.translate
      if (jsonMsg.json.color) summary.color = jsonMsg.json.color
      if (jsonMsg.json.extra) summary.hasExtra = true
      if (jsonMsg.json.with) summary.hasWith = true
    }
    
    if (jsonMsg.text) summary.text = jsonMsg.text
    if (jsonMsg.translate) summary.translateKey = jsonMsg.translate
    
    return Object.keys(summary).length > 0 ? summary : null
  }

  /**
   * Flush logs to file
   */
  flushLogs() {
    if (this.logs.length === 0) return

    try {
      // Read existing logs if file exists
      let existingLogs = []
      if (fs.existsSync(this.logFilePath)) {
        const fileContent = fs.readFileSync(this.logFilePath, 'utf8')
        if (fileContent.trim()) {
          existingLogs = JSON.parse(fileContent)
        }
      }

      // Append new logs
      const allLogs = [...existingLogs, ...this.logs]

      // Write to file with pretty formatting
      fs.writeFileSync(this.logFilePath, JSON.stringify(allLogs, null, 2), 'utf8')

      if (this.config?.debug) {
        this.logger.debug(`[ChatDebug] Flushed ${this.logs.length} logs to file`)
      }
      this.logs = []
    } catch (error) {
      this.logger.error(`[ChatDebug] Error flushing logs: ${error.message}`)
    }
  }

  /**
   * Clear all logged chat data
   */
  clearLogs() {
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.unlinkSync(this.logFilePath)
        this.logger.success(`[ChatDebug] Cleared log file: ${this.logFilePath}`)
      }
      this.logs = []
    } catch (error) {
      this.logger.error(`[ChatDebug] Error clearing logs: ${error.message}`)
    }
  }

  /**
   * Get summary of logged events
   */
  getSummary() {
    try {
      if (!fs.existsSync(this.logFilePath)) {
        return { totalLogs: 0, eventTypes: {} }
      }

      const fileContent = fs.readFileSync(this.logFilePath, 'utf8')
      const logs = JSON.parse(fileContent)

      const summary = {
        totalLogs: logs.length,
        eventTypes: {}
      }

      logs.forEach(log => {
        if (!summary.eventTypes[log.eventType]) {
          summary.eventTypes[log.eventType] = 0
        }
        summary.eventTypes[log.eventType]++
      })

      return summary
    } catch (error) {
      this.logger.error(`[ChatDebug] Error getting summary: ${error.message}`)
      return { totalLogs: 0, eventTypes: {}, error: error.message }
    }
  }
}
