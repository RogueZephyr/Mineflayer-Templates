import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  include: ['tests/**/*.test.js'],
  exclude: ['tests/runtimeInbox.test.js', 'tests/**/*.node.test.js'],
    pool: 'forks',
    isolate: true,
    setupFiles: ['tests/setup.vitest.js'],
    reporters: 'default',
    coverage: {
      enabled: false
    }
  }
});
