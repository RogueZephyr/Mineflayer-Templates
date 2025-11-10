// tests/runtimeInbox.test.js
// Simple smoke test for runtimeEntry stdin -> inbox event flow
// Runs independently of Vitest to avoid ESM loader complexity here.
// You can execute manually with: node tests/runtimeInbox.test.js

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const runtimePath = join(__dirname, '..', 'src', 'dashboard', 'runtimeEntry.js');

const child = spawn(process.execPath, [runtimePath], {
  env: { ...process.env, DASHBOARD_MODE: 'electron-test', FORCE_COLOR: '0' },
  stdio: ['pipe', 'pipe', 'pipe']
});

let gotInbox = false;
let stdoutBuffer = '';
let stderrBuffer = '';

const timeoutMs = 8000;
const payload = { type: 'bot:add', payload: { username: 'TestSmoke' } };

function log(line) {
  process.stdout.write(line + '\n');
}

child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk.toString();
  // Process line-delimited JSON
  let idx;
  while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
    const line = stdoutBuffer.slice(0, idx).trim();
    stdoutBuffer = stdoutBuffer.slice(idx + 1);
    if (!line) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'inbox') {
        gotInbox = true;
        log(`[TEST] Received inbox event: ${JSON.stringify(evt.payload)}`);
      }
      if (evt.type === 'error') {
        log(`[TEST] Runtime error event: ${JSON.stringify(evt.payload)}`);
      }
    } catch (_e) {
      log(`[TEST] Non-JSON stdout: ${line}`);
    }
  }
});

child.stderr.on('data', (chunk) => {
  stderrBuffer += chunk.toString();
});

child.on('exit', (code, signal) => {
  if (!gotInbox) {
    log(`[TEST][FAIL] Runtime exited (code=${code}, signal=${signal}) without receiving inbox event.`);
    log('[TEST][DIAG] STDERR:');
    log(stderrBuffer.trim());
  } else {
    log('[TEST][PASS] Inbox event flow working.');
  }
});

// Send after slight delay to ensure runtime has attached readline
setTimeout(() => {
  log('[TEST] Sending JSON line to runtime stdin...');
  child.stdin.write(JSON.stringify(payload) + '\n');
}, 500);

// Force timeout check
setTimeout(() => {
  if (!gotInbox) {
    log('[TEST][TIMEOUT] Did not observe inbox event within timeout. Diagnostics:');
    log('--- STDERR START ---');
    log(stderrBuffer.trim());
    log('--- STDERR END ---');
    try { child.kill('SIGTERM'); } catch (_) {}
  } else {
    try { child.kill('SIGTERM'); } catch (_) {}
  }
}, timeoutMs);
