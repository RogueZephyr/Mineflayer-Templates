// private-bot-control/mineflayer/bridgeClient.js
// Bind bridge command events to a specific mineflayer bot

import { onCommand } from '../bridge/commands.js';
import { handleCome } from './behaviors/come.js';
import { startFollow, stopFollow } from './behaviors/follow.js';
import { handleMine } from './behaviors/mine.js';

export function wireBotToBridge(bot, logger) {
  if (!bot || bot._bridgeWired) return;
  bot._bridgeWired = true;

  // Come
  onCommand('come', async () => {
    try { await handleCome(bot); } catch (e) { logger?.info?.(`[Bridge] come failed: ${e?.message || e}`); }
  });

  // Follow
  onCommand('follow', async () => {
    try { startFollow(bot); } catch (e) { logger?.info?.(`[Bridge] follow failed: ${e?.message || e}`); }
  });

  // Mine under crosshair
  onCommand('mine', async () => {
    try {
      // Stop follow before mining
      stopFollow(bot);
      await handleMine(bot);
    } catch (e) { logger?.info?.(`[Bridge] mine failed: ${e?.message || e}`); }
  });

  // Hello test command
  onCommand('hello', async () => {
    try {
      logger?.info?.('[Bridge] hello command received');
      // Optionally respond in chat if not silent and chat method exists
      if (bot && typeof bot.chat === 'function' && !bot._consoleCommandActive && !bot._silentMode) {
        bot.chat('Hello from Mineflayer bridge!');
      }
    } catch (e) {
      logger?.info?.(`[Bridge] hello failed: ${e?.message || e}`);
    }
  });
}
