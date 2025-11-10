import { describe, it, expect } from 'vitest';
import BotCoordinator from '../src/core/BotCoordinator.js';
import { Vec3 } from 'vec3';

// Unit tests for BotCoordinator claim/goal semantics

describe('BotCoordinator - claiming and goals', () => {
  it('prevents double claiming and allows claim after release', async () => {
    const c = new BotCoordinator();
    const pos = new Vec3(10, 64, 10);

    // Register two mock bots
    const botA = { username: 'botA', entity: { position: new Vec3(0, 64, 0) } };
    const botB = { username: 'botB', entity: { position: new Vec3(1, 64, 1) } };
    c.registerBot(botA);
    c.registerBot(botB);

    const ok1 = await c.claimBlock(botA.username, pos, 'mining');
    expect(ok1).toBe(true);

    const ok2 = await c.claimBlock(botB.username, pos, 'mining');
    expect(ok2).toBe(false);

    // Release and let B claim
    c.releaseBlock(pos);
    const ok3 = await c.claimBlock(botB.username, pos, 'mining');
    expect(ok3).toBe(true);
  });

  it('isBlockClaimed respects excludeBotId', async () => {
    const c = new BotCoordinator();
    const pos = new Vec3(20, 64, 20);

    await c.claimBlock('botX', pos, 'mining');
    expect(c.isBlockClaimed(pos)).toBe(true);
    expect(c.isBlockClaimed(pos, 'botX')).toBe(false);
  });

  it('pathfinding goal occupancy and alternative goal', () => {
    const c = new BotCoordinator();
    const pos = new Vec3(30, 64, 30);

    c.registerPathfindingGoal('bot1', pos, 'mining');
    expect(c.isGoalOccupied(pos)).toBe(true);
    expect(c.isGoalOccupied(pos, 'bot1')).toBe(false);

    const alt = c.findAlternativeGoal(pos, 'bot1', 2);
    expect(alt).toBeDefined();
    // alt should not be exactly the same coordinates as pos (unless everything free)
    const same = alt.x === Math.floor(pos.x) && alt.z === Math.floor(pos.z);
    expect(same).toBe(false);
  });

  it('cleanup removes expired claims', async () => {
    const c = new BotCoordinator();
    const pos = new Vec3(40, 64, 40);

    await c.claimBlock('botY', pos, 'mining');

    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    const entry = c.claimedBlocks.get(key);
    // Make it appear very old so cleanup will remove it
    if (entry) entry.timestamp = Date.now() - (c.blockClaimDuration + 1000);

    // Run cleanup and assert it no longer reports as claimed
    c.cleanup();
    expect(c.isBlockClaimed(pos)).toBe(false);
  });
});
