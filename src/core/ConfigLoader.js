import fs from 'fs/promises';
import path from 'path';
import Ajv from 'ajv';

class ConfigLoader {
  static async loadConfig(filePath = './src/config/config.json') {
    const absolutePath = path.resolve(filePath);
    try {
      const data = await fs.readFile(absolutePath, 'utf8');
      const config = JSON.parse(data);

      // Validate structure
      const ajv = new Ajv();
      const validate = ajv.compile({
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
      });

      if (!validate(config)) {
        const errors = validate.errors.map(e => `${e.instancePath} ${e.message}`).join(', ');
        throw new Error(`Invalid configuration structure: ${errors}`);
      }

      console.log(`[CONFIG] Loaded successfully from ${absolutePath}`);
      return config;
    } catch (err) {
      console.error(`[CONFIG] Error loading config: ${err.message}`);
      process.exit(1);
    }
  }
}

export default ConfigLoader;