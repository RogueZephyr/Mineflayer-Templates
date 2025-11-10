import test from 'node:test';
import assert from 'node:assert/strict';
import BotCoordinator from '../src/core/BotCoordinator.js';
import { Vec3 } from 'vec3';

// Node built-in test runner fallback for CI until Vitest issue is resolved

test('coordinator prevents double-claim and allows after release', async () => {
  const c = new BotCoordinator();
  const pos = new Vec3(10, 64, 10);
  await c.claimBlock('A', pos, 'mining');
  const ok2 = await c.claimBlock('B', pos, 'mining');
  assert.equal(ok2, false);
  c.releaseBlock(pos);
  const ok3 = await c.claimBlock('B', pos, 'mining');
  assert.equal(ok3, true);
});

test('isBlockClaimed excludeBotId', async () => {
  const c = new BotCoordinator();
  const pos = new Vec3(20, 64, 20);
  await c.claimBlock('X', pos, 'mining');
  assert.equal(c.isBlockClaimed(pos), true);
  assert.equal(c.isBlockClaimed(pos, 'X'), false);
});

test('pathfinding goal occupancy and alternative goal', () => {
  const c = new BotCoordinator();
  const pos = new Vec3(30, 64, 30);
  c.registerPathfindingGoal('bot1', pos, 'mining');
  assert.equal(c.isGoalOccupied(pos), true);
  assert.equal(c.isGoalOccupied(pos, 'bot1'), false);
  const alt = c.findAlternativeGoal(pos, 'bot1', 2);
  assert.ok(alt);
  // alt may be the same as pos when excluding the same bot (position considered free).
  // Just ensure it returns a valid Vec3-like with integers.
  assert.ok(Number.isInteger(alt.x) && Number.isInteger(alt.y) && Number.isInteger(alt.z));
});

test('cleanup removes expired claims', async () => {
  const c = new BotCoordinator();
  const pos = new Vec3(40, 64, 40);
  await c.claimBlock('Y', pos, 'mining');
  const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  const entry = c.claimedBlocks.get(key);
  if (entry) entry.timestamp = Date.now() - (c.blockClaimDuration + 1000);
  c.cleanup();
  assert.equal(c.isBlockClaimed(pos), false);
});
