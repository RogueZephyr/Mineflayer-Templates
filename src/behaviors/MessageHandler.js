// src/behaviors/MessageHandler.js
export default class MessageHandler {
  constructor(bot, logger, master) {
    this.bot = bot;
    this.logger = logger;
    this.master = master || null;
    this.enabled = true;
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  /**
   * Handle a manager-level message delivered via BotManager.sendBotMessage
   * @param {{from:string,to:string|null,payload:object,at:number}} msg
   * @param {object} controller BotController instance
   */
  handleManagerMessage(msg, controller) {
    if (!this.enabled) return;
    try {
      const p = msg.payload || {};
      this.logger?.info?.(`[MessageHandler] from=${msg.from} to=${msg.to || 'ALL'} payload=${JSON.stringify(p)}`);

      // If message is targeted to a specific bot, ignore unless it's for me
      try {
        if (msg.to && String(msg.to).toLowerCase() !== String(this.bot.username).toLowerCase()) {
          return;
        }
      } catch (_) {}

      if (p.type === 'chat') {
        const text = String(p.message || '');
        // If allowed, send a private message to master in-game; otherwise just log
        const allowChat = !!(controller?.config?.allowInGameChat === true);
        const master = controller?.master || this.master;
        if (allowChat && this.bot && typeof this.bot.chat === 'function' && master) {
          // send a private message to master to avoid public spam
          this.bot.chat(`/msg ${master} ${text}`);
        } else {
          this.logger?.info?.(`[MessageHandler] (oob) ${msg.from} -> ${msg.to || 'ALL'}: ${text}`);
        }
        return;
      }

      // Farm command coordination (multi-bot assignment via manager broadcast)
      if (p.type === 'farm-command') {
        const action = p.action;
        const targetBots = Array.isArray(p.bots) ? p.bots.map(b => String(b).toLowerCase()) : null;
        const myName = this.bot.username.toLowerCase();
        // If a target list exists and this bot isn't included, ignore
        if (targetBots && !targetBots.includes(myName)) return;

        // Store the intended farming group on the bot for consistent subdivision logic
        // This helps prevent premature area splitting when only one bot is actually farming.
        try {
          if (Array.isArray(p.bots) && p.bots.length) {
            this.bot.pendingFarmStartGroup = p.bots.slice();
          } else {
            // Clear if broadcast without explicit list (e.g., stop action)
            if (action !== 'start') delete this.bot.pendingFarmStartGroup;
          }
        } catch (_) {}

        const farmBehavior = controller?.behaviors?.farm;
        if (!farmBehavior) return;

        // Support group add/remove for farm
        if ((action === 'add' || action === 'remove') && controller && controller.coordinator) {
          const coordinator = controller.coordinator;
          const areaType = 'farm';
          const performUpdate = async (resolvedArea) => {
            try {
              let newGroup = [];
              if (action === 'add') newGroup = coordinator.addToGroup(areaType, p.bots || []);
              else newGroup = coordinator.removeFromGroup(areaType, p.bots || []);

              let assignments = [];
              if (resolvedArea && newGroup.length) {
                assignments = coordinator.recomputeAndAssignZones(areaType, resolvedArea, newGroup);
                // Start newly added bots
                if (action === 'add' && Array.isArray(p.bots)) {
                  for (const botId of p.bots) {
                    try { controller.manager.sendBotMessage(controller.bot.username, botId, { type: 'farm-command', action: 'start', bots: [botId] }); } catch (_) {}
                  }
                }
                // Stop removed bots
                if (action === 'remove' && Array.isArray(p.bots)) {
                  for (const botId of p.bots) {
                    try { controller.manager.sendBotMessage(controller.bot.username, botId, { type: 'farm-command', action: 'stop', bots: [botId] }); } catch (_) {}
                  }
                }
              }

              // Announce update (leader only for chat to avoid spam)
              try {
                const leader = controller?.manager?.getLeader?.()?.name;
                const isLeader = leader && String(leader).toLowerCase() === String(controller?.bot?.username).toLowerCase();
                const groupList = Array.isArray(newGroup) ? newGroup : [];
                // Emit machine-readable payload
                controller?.manager?.sendBotMessage(controller?.bot?.username, null, {
                  type: 'group-update',
                  areaType,
                  group: groupList,
                  assignments: (assignments || []).map(a => ({ botId: a.botId, zone: a.zone }))
                });
                // Human-friendly confirmation via chat payload
                if (isLeader) {
                  const short = `${areaType} group updated (${groupList.length}): ${groupList.join(', ') || 'none'}`;
                  controller?.manager?.sendBotMessage(controller?.bot?.username, null, { type: 'chat', message: short });
                }
              } catch (_) {}
            } catch (e) {
              this.logger?.warn?.(`[MessageHandler] farm add/remove failed: ${e.message || e}`);
            }
          };
          if (controller?.bot?.areaRegistry && typeof controller.bot.areaRegistry.getArea === 'function') {
            controller.bot.areaRegistry.getArea('farm')
              .then(a => { performUpdate(a); })
              .catch(() => { performUpdate(null); });
          } else {
            performUpdate(null);
          }
          return;
        }

        if (action === 'start') {
          // Load area if needed
          if (!farmBehavior.farmingArea && controller?.bot?.areaRegistry) {
            (async () => {
              try { farmBehavior.farmingArea = await controller.bot.areaRegistry.getArea('farm'); } catch (_) {}
              if (!farmBehavior.farmingArea) {
                this.logger?.warn?.('[MessageHandler] Farm start ignored: no area set');
                this._sendFarmStatus(controller, false, 'no-area');
                return;
              }
              if (!farmBehavior.enabled && typeof farmBehavior.enable === 'function') farmBehavior.enable();
              if (!farmBehavior.isWorking) {
                this.logger?.info?.(`[MessageHandler] Starting farming via manager for ${this.bot.username}`);
                farmBehavior.startFarming(farmBehavior.farmingArea)
                  .then(() => this._sendFarmStatus(controller, true))
                  .catch(e => {
                    this.logger?.warn?.(`[MessageHandler] farm start error: ${e.message || e}`);
                    this._sendFarmStatus(controller, false, e.message || 'start-error');
                  });
              }
              else {
                this._sendFarmStatus(controller, true, 'already-working');
              }
            })();
          } else {
            if (!farmBehavior.farmingArea) {
              this.logger?.warn?.('[MessageHandler] Farm start ignored: no area set');
              this._sendFarmStatus(controller, false, 'no-area');
              return;
            }
            if (!farmBehavior.enabled && typeof farmBehavior.enable === 'function') farmBehavior.enable();
            if (!farmBehavior.isWorking) {
              this.logger?.info?.(`[MessageHandler] Starting farming via manager for ${this.bot.username}`);
              farmBehavior.startFarming(farmBehavior.farmingArea)
                .then(() => this._sendFarmStatus(controller, true))
                .catch(e => {
                  this.logger?.warn?.(`[MessageHandler] farm start error: ${e.message || e}`);
                  this._sendFarmStatus(controller, false, e.message || 'start-error');
                });
            }
            else {
              this._sendFarmStatus(controller, true, 'already-working');
            }
          }
          return;
        }
        if (action === 'stop') {
          if (farmBehavior.isWorking) this.logger?.info?.(`[MessageHandler] Stopping farming via manager for ${this.bot.username}`);
          farmBehavior.isWorking = false;
          if (typeof farmBehavior.disable === 'function') farmBehavior.disable();
          try {
            if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') this.bot.pathfinder.setGoal(null);
          } catch (_) {}
          this._sendFarmStatus(controller, true, 'stopped');
          // Clear pending group reference
          try { delete this.bot.pendingFarmStartGroup; } catch (_) {}
          return;
        }
      }

      // Mining command coordination (multi-bot assignment via manager broadcast)
      if (p.type === 'mine-command') {
        const action = p.action;
        const targetBots = Array.isArray(p.bots) ? p.bots.map(b => String(b)) : null;
  // const myName = this.bot.username; // reserved but unused in group updates

        // support group add/remove actions for dynamic reassignment
        if ((action === 'add' || action === 'remove') && controller && controller.coordinator) {
          try {
            const areaType = String(p.mode || 'quarry');
            // Determine area bounds: prefer explicit rawArgs for quarry, else attempt to load area from registry
            let area = null;
            if (Array.isArray(p.rawArgs) && p.rawArgs.length >= 5) {
              // rawArgs: x1, z1, x2, z2, depth
              const x1 = Number.parseInt(p.rawArgs[0]);
              const z1 = Number.parseInt(p.rawArgs[1]);
              const x2 = Number.parseInt(p.rawArgs[2]);
              const z2 = Number.parseInt(p.rawArgs[3]);
              const y = Math.floor(this.bot.entity?.position?.y || 64);
              if ([x1, z1, x2, z2].every(Number.isFinite)) {
                area = { start: { x: x1, y, z: z1 }, end: { x: x2, y, z: z2 } };
              }
            }
            const coordinator = controller.coordinator;
            const performUpdate = (resolvedArea) => {
              try {
                let newGroup = [];
                if (action === 'add') newGroup = coordinator.addToGroup(areaType, targetBots || []);
                else newGroup = coordinator.removeFromGroup(areaType, targetBots || []);

                let assignments = [];
                if (resolvedArea && newGroup.length) {
                  assignments = coordinator.recomputeAndAssignZones(areaType, resolvedArea, newGroup);
                  for (const a of assignments) {
                    const raw = [a.zone.start.x, a.zone.start.z, a.zone.end.x, a.zone.end.z, p.rawArgs?.[4] || 0];
                    const target = a.botId;
                    try { controller.manager.sendBotMessage(controller.bot.username, target, { type: 'mine-command', action: 'start', mode: areaType, rawArgs: raw }); } catch (_) {}
                  }
                }

                // Announce update
                try {
                  const leader = controller?.manager?.getLeader?.()?.name;
                  const isLeader = leader && String(leader).toLowerCase() === String(controller?.bot?.username).toLowerCase();
                  const groupList = Array.isArray(newGroup) ? newGroup : [];
                  controller?.manager?.sendBotMessage(controller?.bot?.username, null, {
                    type: 'group-update',
                    areaType,
                    group: groupList,
                    assignments: (assignments || []).map(a => ({ botId: a.botId, zone: a.zone }))
                  });
                  if (isLeader) {
                    const short = `${areaType} group updated (${groupList.length}): ${groupList.join(', ') || 'none'}`;
                    controller?.manager?.sendBotMessage(controller?.bot?.username, null, { type: 'chat', message: short });
                  }
                } catch (_) {}
              } catch (e) {
                this.logger?.warn?.(`[MessageHandler] group add/remove failed during update: ${e.message || e}`);
              }
            };

            if (area) {
              performUpdate(area);
              return;
            }
            if (controller?.bot?.areaRegistry && typeof controller.bot.areaRegistry.getArea === 'function') {
              controller.bot.areaRegistry.getArea(areaType).then(a => {
                performUpdate(a);
              }).catch(() => {
                performUpdate(null);
              });
            } else {
              performUpdate(null);
            }
            return;
          } catch (e) {
            this.logger?.warn?.(`[MessageHandler] group add/remove failed: ${e.message || e}`);
            return;
          }
        }

        // Otherwise fall back to existing start/stop handling for mine-command
        const mining = controller?.behaviors?.mining;
        if (!mining) return;

        // Persist intended mining group for future subdivision/coordination
        try {
          if (Array.isArray(p.bots) && p.bots.length && action === 'start') {
            this.bot.pendingMineStartGroup = p.bots.slice();
          } else if (action !== 'start') {
            delete this.bot.pendingMineStartGroup;
          }
        } catch (_) {}

        if (action === 'start') {
          const mode = String(p.mode || '').toLowerCase();
          const rawArgs = Array.isArray(p.rawArgs) ? p.rawArgs : [];
          // Ensure behavior enabled
          if (!mining.enabled && typeof mining.enable === 'function') mining.enable();

          // Dispatch by mode with basic arg parsing
          (async () => {
            try {
              switch (mode) {
                case 'strip': {
                  const direction = String(rawArgs[0] || 'east');
                  const mainLength = Number.parseInt(rawArgs[1]) || 100;
                  const numBranches = Number.parseInt(rawArgs[2]) || 10;
                  const startPos = this.bot.entity?.position?.floored?.() || this.bot.entity?.position;
                  await mining.startStripMining(startPos, direction, mainLength, numBranches);
                  this._sendMineStatus(controller, true, 'started');
                  break;
                }
                case 'tunnel': {
                  const direction = String(rawArgs[0] || 'east');
                  const length = Number.parseInt(rawArgs[1]) || 100;
                  const width = rawArgs[2] !== undefined ? Number.parseInt(rawArgs[2]) : null;
                  const height = rawArgs[3] !== undefined ? Number.parseInt(rawArgs[3]) : null;
                  const startPos = this.bot.entity?.position?.floored?.() || this.bot.entity?.position;
                  await mining.startTunnel(startPos, direction, length, Number.isFinite(width) ? width : null, Number.isFinite(height) ? height : null);
                  this._sendMineStatus(controller, true, 'started');
                  break;
                }
                case 'quarry': {
                  const x1 = Number.parseInt(rawArgs[0]);
                  const z1 = Number.parseInt(rawArgs[1]);
                  const x2 = Number.parseInt(rawArgs[2]);
                  const z2 = Number.parseInt(rawArgs[3]);
                  const depth = Number.parseInt(rawArgs[4]) || 5;
                  const y = Math.floor(this.bot.entity?.position?.y || 64);
                  const corner1 = { x: x1, y, z: z1 };
                  const corner2 = { x: x2, y, z: z2 };
                  await mining.startQuarry(corner1, corner2, depth);
                  this._sendMineStatus(controller, true, 'started');
                  break;
                }
                case 'vein': {
                  const radius = rawArgs[0] !== undefined ? Number.parseInt(rawArgs[0]) : null;
                  const result = await mining.startContinuousVeinMining(radius);
                  this._sendMineStatus(controller, !!result?.success, result?.success ? 'started' : 'failed');
                  break;
                }
                case 'stop': {
                  mining.stopMining?.();
                  mining.disable?.();
                  try { if (this.bot.pathfinder?.setGoal) this.bot.pathfinder.setGoal(null); } catch (_) {}
                  this._sendMineStatus(controller, true, 'stopped');
                  break;
                }
                default:
                  this._sendMineStatus(controller, false, 'bad-mode');
              }
            } catch (e) {
              this.logger?.warn?.(`[MessageHandler] mine start error: ${e.message || e}`);
              this._sendMineStatus(controller, false, e.message || 'start-error');
            }
          })();
          return;
        }

        if (action === 'stop') {
          if (mining.isWorking) this.logger?.info?.(`[MessageHandler] Stopping mining via manager for ${this.bot.username}`);
          mining.stopMining?.();
          mining.disable?.();
          try { if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') this.bot.pathfinder.setGoal(null); } catch (_) {}
          this._sendMineStatus(controller, true, 'stopped');
          try { delete this.bot.pendingMineStartGroup; } catch (_) {}
          return;
        }
      }

      if (p.type === 'announce-location') {
        const pos = this.bot?.entity?.position;
        if (pos) {
          const loc = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
          this.logger?.info?.(`[MessageHandler] location ${loc}`);
        }
        return;
      }

      // Woodcutting command coordination (multi-bot assignment via manager broadcast)
      if (p.type === 'wood-command') {
        const action = p.action;
        const targetBots = Array.isArray(p.bots) ? p.bots.map(b => String(b).toLowerCase()) : null;
        const myName = this.bot.username.toLowerCase();
        if (targetBots && !targetBots.includes(myName)) return;

        const wood = controller?.behaviors?.woodcutting;
        if (!wood) return;

        // Persist intended wood group
        try {
          if (Array.isArray(p.bots) && p.bots.length && action === 'start') {
            this.bot.pendingWoodStartGroup = p.bots.slice();
          } else if (action !== 'start') {
            delete this.bot.pendingWoodStartGroup;
          }
        } catch (_) {}

        // Support group add/remove for woodcutting
        if ((action === 'add' || action === 'remove') && controller && controller.coordinator) {
          const coordinator = controller.coordinator;
          const areaType = 'wood';
          const performUpdate = async (resolvedArea) => {
            try {
              let newGroup = [];
              if (action === 'add') newGroup = coordinator.addToGroup(areaType, p.bots || []);
              else newGroup = coordinator.removeFromGroup(areaType, p.bots || []);
              let assignments = [];
              if (resolvedArea && newGroup.length) {
                assignments = coordinator.recomputeAndAssignZones(areaType, resolvedArea, newGroup);
                // Start newly added
                if (action === 'add' && Array.isArray(p.bots)) {
                  for (const botId of p.bots) {
                    try { controller.manager.sendBotMessage(controller.bot.username, botId, { type: 'wood-command', action: 'start', bots: [botId] }); } catch (_) {}
                  }
                }
                // Stop removed
                if (action === 'remove' && Array.isArray(p.bots)) {
                  for (const botId of p.bots) {
                    try { controller.manager.sendBotMessage(controller.bot.username, botId, { type: 'wood-command', action: 'stop', bots: [botId] }); } catch (_) {}
                  }
                }
              }

              // Announce update (leader-only chat)
              try {
                const leader = controller?.manager?.getLeader?.()?.name;
                const isLeader = leader && String(leader).toLowerCase() === String(controller?.bot?.username).toLowerCase();
                const groupList = Array.isArray(newGroup) ? newGroup : [];
                controller?.manager?.sendBotMessage(controller?.bot?.username, null, {
                  type: 'group-update',
                  areaType,
                  group: groupList,
                  assignments: (assignments || []).map(a => ({ botId: a.botId, zone: a.zone }))
                });
                if (isLeader) {
                  const short = `${areaType} group updated (${groupList.length}): ${groupList.join(', ') || 'none'}`;
                  controller?.manager?.sendBotMessage(controller?.bot?.username, null, { type: 'chat', message: short });
                }
              } catch (_) {}
            } catch (e) {
              this.logger?.warn?.(`[MessageHandler] wood add/remove failed: ${e.message || e}`);
            }
          };
          if (controller?.bot?.areaRegistry && typeof controller.bot.areaRegistry.getArea === 'function') {
            controller.bot.areaRegistry.getArea('wood')
              .then(a => { performUpdate(a); })
              .catch(() => { performUpdate(null); });
          } else {
            performUpdate(null);
          }
          return;
        }

        if (action === 'start') {
          (async () => {
            try {
              if (!wood.woodcuttingArea && controller?.bot?.areaRegistry) {
                try { wood.woodcuttingArea = await controller.bot.areaRegistry.getArea('wood'); } catch (_) {}
              }
              if (!wood.enabled && typeof wood.enable === 'function') wood.enable();
              await wood.startWoodcutting(wood.woodcuttingArea || null);
              this._sendWoodStatus(controller, true, 'started');
            } catch (e) {
              this.logger?.warn?.(`[MessageHandler] wood start error: ${e.message || e}`);
              this._sendWoodStatus(controller, false, e.message || 'start-error');
            }
          })();
          return;
        }
        if (action === 'stop') {
          wood.isWorking = false;
          wood.disable?.();
          try { if (this.bot.pathfinder?.setGoal) this.bot.pathfinder.setGoal(null); } catch (_) {}
          this._sendWoodStatus(controller, true, 'stopped');
          try { delete this.bot.pendingWoodStartGroup; } catch (_) {}
          return;
        }
      }

      // Fallback: log payload
      this.logger?.debug?.(`[MessageHandler] unhandled payload type=${p.type}`);
    } catch (err) {
      this.logger?.warn?.(`[MessageHandler] error handling message: ${err.message || err}`);
    }
  }

  _sendFarmStatus(controller, success, code = null) {
    try {
      const mgr = controller?.bot?.manager;
      if (!mgr) return;
      mgr.sendBotMessage(this.bot.username, null, {
        type: 'farm-status',
        success: !!success,
        code: code || (success ? 'started' : 'failed'),
        at: Date.now()
      });
    } catch (_) {}
  }

  _sendMineStatus(controller, success, code = null) {
    try {
      const mgr = controller?.bot?.manager;
      if (!mgr) return;
      mgr.sendBotMessage(this.bot.username, null, {
        type: 'mine-status',
        success: !!success,
        code: code || (success ? 'started' : 'failed'),
        at: Date.now()
      });
    } catch (_) {}
  }

  _sendWoodStatus(controller, success, code = null) {
    try {
      const mgr = controller?.bot?.manager;
      if (!mgr) return;
      mgr.sendBotMessage(this.bot.username, null, {
        type: 'wood-status',
        success: !!success,
        code: code || (success ? 'started' : 'failed'),
        at: Date.now()
      });
    } catch (_) {}
  }
}
