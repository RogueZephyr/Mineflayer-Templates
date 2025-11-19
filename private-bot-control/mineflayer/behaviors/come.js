// private-bot-control/mineflayer/behaviors/come.js
// Move near the master's latest position

import { getLatestMasterState } from '../../bridge/state.js';

export async function handleCome(bot) {
  const controller = bot?.controller;
  if (!controller || controller.isActive?.() === false) {
    throw new Error('INACTIVE');
  }
  if (!bot?.entity || !bot.pathfindingUtil) {
    throw new Error('UNAVAILABLE');
  }
  const state = getLatestMasterState();
  if (!state?.position) throw new Error('BAD_STATE');

  const target = state.position;
  try {
    await bot.pathfindingUtil.goto({ x: target.x, y: target.y, z: target.z }, 30000, 'bridge:come');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}
