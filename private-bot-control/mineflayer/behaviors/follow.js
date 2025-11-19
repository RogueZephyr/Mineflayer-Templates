// private-bot-control/mineflayer/behaviors/follow.js
// Follow the master's latest position with a periodic goal update

import { getLatestMasterState } from '../../bridge/state.js';

export function startFollow(bot) {
  const controller = bot?.controller;
  if (!controller || controller.isActive?.() === false) {
    throw new Error('INACTIVE');
  }
  if (!bot?.entity || !bot.pathfindingUtil) {
    throw new Error('UNAVAILABLE');
  }

  stopFollow(bot); // cancel prior

  const intervalMs = 250;
  const radius = 2.0;

  const loop = async () => {
    try {
      const state = getLatestMasterState();
      if (!state?.position) return;
      const p = state.position;
      await bot.pathfindingUtil.followPoint({ x: p.x, y: p.y, z: p.z }, radius, 'bridge:follow');
    } catch (_) {}
  };

  const timer = setInterval(loop, intervalMs);
  bot._bridgeFollow = { timer };
  return true;
}

export function stopFollow(bot) {
  const f = bot?._bridgeFollow;
  if (f?.timer) {
    try { clearInterval(f.timer); } catch (_) {}
  }
  if (bot && bot.pathfindingUtil) {
    try { bot.pathfindingUtil.stop(); } catch (_) {}
  }
  bot._bridgeFollow = null;
}
