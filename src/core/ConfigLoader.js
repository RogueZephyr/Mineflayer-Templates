import fs from 'fs/promises';
import path from 'path';
import Ajv from 'ajv';

// Hoist Ajv instance and validator to module scope for reuse
const ajv = new Ajv();
const configSchema = {
  type: 'object',
  required: ['host', 'port', 'version', 'master'],
  properties: {
    host: { type: 'string' },
    port: { type: 'number', minimum: 1, maximum: 65535 },
    version: { type: 'string' },
    master: { type: 'string' },
    auth: { type: 'string', enum: ['microsoft', 'offline'] },
    behaviors: { type: 'object' }
  }
};
const validateConfig = ajv.compile(configSchema);

class ConfigLoader {
  static async loadConfig(filePath = './src/config/config.json', serverOverride = null) {
    const absolutePath = path.resolve(filePath);
    try {
      const data = await fs.readFile(absolutePath, 'utf8');
      const config = JSON.parse(data);

      // Apply server override (host, port, version)
      if (serverOverride) {
        if (serverOverride.host) config.host = serverOverride.host;
        if (serverOverride.port) config.port = Number(serverOverride.port);
        if (serverOverride.version) config.version = serverOverride.version;
      }

      // Validate structure using cached validator
      if (!validateConfig(config)) {
        const errors = validateConfig.errors.map(e => `${e.instancePath} ${e.message}`).join(', ');
        // Return structured error object instead of exiting
        return {
          success: false,
          error: `Invalid configuration structure: ${errors}`,
          errors: validateConfig.errors
        };
      }

      console.log(`[CONFIG] Loaded successfully from ${absolutePath}${serverOverride ? ' (override applied)' : ''}`);
      return {
        success: true,
        config
      };
    } catch (err) {
      console.error(`[CONFIG] Error loading config: ${err.message}`);
      // Return structured error instead of exiting
      return {
        success: false,
        error: err.message,
        exception: err
      };
    }
  }
}

export default ConfigLoader;