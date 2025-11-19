import { describe, it, expect } from 'vitest';
import { registerCommand, emitCommand, clearAllHandlers } from '../private-bot-control/bridge/commands.js';

describe('Bridge hello command', () => {
  it('invokes handler and passes payload', async () => {
    const hits = [];
    registerCommand('hello', (payload) => { hits.push(payload); });
    const res = await emitCommand('hello', { ping: 'pong' });
    expect(res.ok).toBe(true);
    expect(hits.length).toBe(1);
    expect(hits[0].ping).toBe('pong');
    clearAllHandlers();
  });
});
