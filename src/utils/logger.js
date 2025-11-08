import chalk from 'chalk'

export default class Logger {
  constructor() {
    this.startTime = new Date()
  }

  _timestamp() {
    return chalk.gray(`[${new Date().toLocaleTimeString()}]`)
  }

  info(msg) { console.log(`${this._timestamp()} ${chalk.cyan('[INFO]')} ${msg}`) }
  warn(msg) { console.log(`${this._timestamp()} ${chalk.yellow('[WARN]')} ${msg}`) }
  error(msg) { console.log(`${this._timestamp()} ${chalk.red('[ERROR]')} ${msg}`) }
  success(msg) { console.log(`${this._timestamp()} ${chalk.green('[OK]')} ${msg}`) }
  debug(msg) { console.log(`${this._timestamp()} ${chalk.magenta('[DEBUG]')} ${msg}`) }
}