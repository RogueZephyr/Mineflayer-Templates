// Log vitest globals presence for debugging
try {
  // @ts-ignore
  const g = globalThis.__vitest__;
  if (!g) {
    console.log('[setup] __vitest__ is not defined');
  } else {
    console.log('[setup] __vitest__ ok');
  }
} catch (e) {
  console.log('[setup] error reading __vitest__:', e && e.message);
}
