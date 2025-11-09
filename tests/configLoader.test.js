import { describe, it, expect } from 'vitest';
import ConfigLoader from '../src/core/ConfigLoader.js';
import path from 'node:path';
import fs from 'node:fs/promises';

// Basic smoke test to ensure config loads successfully

describe('ConfigLoader', () => {
  it('loads config.json successfully', async () => {
    const configPath = path.join(process.cwd(), 'src', 'config', 'config.json');
    const result = await ConfigLoader.loadConfig(configPath);
    expect(result.success).toBe(true);
    expect(result.config).toBeDefined();
  });

  it('returns structured error on malformed JSON', async () => {
    const badPath = path.join(process.cwd(), 'tests', 'tmp-bad-config.json');
    await fs.writeFile(badPath, '{"invalid": true,'); // malformed JSON
    const result = await ConfigLoader.loadConfig(badPath);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    await fs.unlink(badPath);
  });
});
