import fs from 'fs'
import path from 'path'

class ConfigLoader {
  static loadConfig(filePath = '../src/config/config.json') {
    try {
      const absolutePath = path.resolve(filePath)
      const data = fs.readFileSync(absolutePath, 'utf-8')
      const config = JSON.parse(data)
      console.log(`[CONFIG] Loaded successfully from ${absolutePath}`)
      return config
    } catch (err) {
      console.error(`[CONFIG] Error loading config file: ${err.message}`)
      process.exit(1)
    }
  }
}

export default ConfigLoader