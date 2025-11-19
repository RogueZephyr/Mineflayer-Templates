// private-bot-control/mineflayer/behaviors/mine.js
// Mine the block under crosshair from latest state (lookingAt)

import { getLatestMasterState } from '../../bridge/state.js';

export async function handleMine(bot) {
  const controller = bot?.controller;
  if (!controller || controller.isActive?.() === false) {
    throw new Error('INACTIVE');
  }
  if (!bot?.entity) throw new Error('UNAVAILABLE');

  const state = getLatestMasterState();
  const target = state?.lookingAt;
  if (!target) throw new Error('BAD_TARGET');

  const goal = { x: target.x, y: target.y, z: target.z };

  // Navigate near if needed
  if (bot.pathfindingUtil) {
    try { await bot.pathfindingUtil.gotoBlock(goal, 30000, 'bridge:mine'); } catch (_) {}
  }

  // Equip best tool if available
  try {
    if (bot.toolHandler) {
      const blk = bot.blockAt(goal);
      if (blk) await bot.toolHandler.equipBestTool(blk);
    }
  } catch (_) {}

  // Dig with existing mining behavior if present; else raw dig
  try {
    if (bot.miningBehavior && typeof bot.miningBehavior._breakAndConfirm === 'function') {
      // Private internal method—fallback; prefer public if available later
      await bot.miningBehavior._breakAndConfirm(goal);
    } else {
      const blk = bot.blockAt(goal);
      if (blk) await bot.dig(blk);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}
