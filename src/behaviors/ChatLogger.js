// src/behaviors/ChatLogger.js
import chalk from 'chalk'

export default class ChatLogger {
  constructor(bot, logger, botList = []) {
    this.bot = bot
    this.logger = logger
    this.botList = botList
    this.enabled = false
  }

  enable() {
    if (this.enabled) return
    this.enabled = true

    this.bot.on('whisper', (username, message) => {
      // ignore messages from the bot itself or other known bot usernames
      if (username === this.bot.username || this.botList.includes(username)) return
      this.logger.info(chalk.ansi256(98)(`[${this.bot.username}]<${username}> whispered: ${message}`))
    })
    this.bot.on('chat', (username, message) => {
      // ignore messages from the bot itself or other known bot usernames
      if (username === this.bot.username || this.botList.includes(username)) return
      this.logger.info(chalk.ansi256(98)(`[${this.bot.username}]<${username}> ${message}`))
    })

    this.logger.success('ChatLogger enabled')
  }

  disable() {
    if (!this.enabled) return
    this.enabled = false
    this.bot.removeAllListeners('chat')
    this.logger.warn('ChatLogger disabled')
  }
}
