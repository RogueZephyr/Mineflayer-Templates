// scripts/vitest-debug.mjs
// Purpose: Inspect vitest package export shape in current environment.
import * as vitest from 'vitest';

console.log('[vitest-debug] keys:', Object.keys(vitest));
console.log('[vitest-debug] describe typeof:', typeof vitest.describe);
console.log('[vitest-debug] it typeof:', typeof vitest.it);
console.log('[vitest-debug] test typeof:', typeof vitest.test);

// Show raw module default if present
if ('default' in vitest) {
  console.log('[vitest-debug] default keys:', Object.keys(vitest.default || {}));
}
