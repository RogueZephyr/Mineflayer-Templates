import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

export default class IdleBehavior {
  constructor(bot, logger, config = {}) {
    this.bot = bot;
    this.logger = logger;
    this.enabled = true;
    this.isIdle = false;
    this.config = config;
    this._mgrTaskHandler = null;
    this._mgrMsgHandler = null;
    this._nightCheckTimer = null;
    this._roamTimer = null;
  }

  enable() { this.enabled = true; this.startIdle(); }
  disable() { this.enabled = false; this.stopIdle(); }

  _emitDebug(...args) {
    try { if (this.bot.debugTools) this.bot.debugTools.log('idle', ...args); } catch (_) {}
  }

  async startIdle() {
    if (!this.enabled || this.isIdle) return;
    if (!this.bot || !this.bot.entity) return;

    // Use HomeBehavior's home position if available, otherwise config.idleLocation
    const home = this.bot.homeBehavior?.getHome ? this.bot.homeBehavior.getHome() : null;
    const loc = this.config.idleLocation || home;
    if (!loc) {
      this.logger.info('[IdleBehavior] No idle location configured or home set; skipping idle navigation');
      return;
    }

    // Navigate to idle location
    try {
      this.logger.info(`[IdleBehavior] Going to idle area: ${loc.x},${loc.y},${loc.z}`);
      this._emitDebug('Navigating to idle area', loc);

      if (this.bot.homeBehavior && typeof this.bot.homeBehavior.setHomeAt === 'function') {
        // ensure home is set so goHome works
        this.bot.homeBehavior.setHomeAt(loc.x, loc.y, loc.z);
        await this.bot.homeBehavior.goHome(60000);
      } else if (this.bot.pathfindingUtil) {
        await this.bot.pathfindingUtil.gotoBlock({ x: loc.x, y: loc.y, z: loc.z }, 60000, 'idle');
      } else if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalBlock(loc.x, loc.y, loc.z);
        await this.bot.pathfinder.goto(goal);
      }

      this.isIdle = true;
      this.logger.info(`[IdleBehavior] Arrived at idle area and idling`);
      this._emitDebug('Arrived at idle area');

      // Subscribe to manager events if available
      const mgr = this.bot.manager;
      if (mgr) {
        this._mgrTaskHandler = (ev) => {
          try {
            // ev.task or taskAssigned events: support both shapes
            const task = ev.task || ev;
            if (!task) return;
            if (task.assignedTo === this.bot.username) {
              this.logger.info(`[IdleBehavior] Task ${task.id} assigned to me; exiting idle`);
              this.stopIdle();
            }
          } catch (e) { this.logger.debug('[IdleBehavior] task event handler error', e.message || e); }
        };
        mgr.on('taskAssigned', this._mgrTaskHandler);

        this._mgrMsgHandler = (msg) => {
          try {
            if (msg.to && msg.to !== this.bot.username) return;
            const p = msg.payload || {};
            if (p.type === 'wake' || p.type === 'start-task') {
              this.logger.info('[IdleBehavior] Received wake/start-task manager message');
              this.stopIdle();
            }
          } catch (e) { this.logger.debug('[IdleBehavior] msg handler error', e.message || e); }
        };
        mgr.on('botMessage', this._mgrMsgHandler);
      }

      // Check periodically for night to try sleeping (delegate to SleepBehavior)
      this._nightCheckTimer = setInterval(() => this._maybeSleep(), 15000);

      // Start ambient roaming if configured
      this._startAmbientRoam(loc);

    } catch (err) {
      this.logger.warn(`[IdleBehavior] Failed to go to idle area: ${err.message || err}`);
      this._emitDebug('Idle navigation failed', err.message || err);
      this.isIdle = false;
    }
  }

  stopIdle() {
    if (!this.isIdle) return;
    this.isIdle = false;
    this._emitDebug('Stopping idle state');
    // clear timers and remove listeners
    if (this._nightCheckTimer) { clearInterval(this._nightCheckTimer); this._nightCheckTimer = null; }
  if (this._roamTimer) { clearTimeout(this._roamTimer); this._roamTimer = null; }
    const mgr = this.bot.manager;
    if (mgr) {
      try { if (this._mgrTaskHandler) mgr.off('taskAssigned', this._mgrTaskHandler); } catch (_) {}
      try { if (this._mgrMsgHandler) mgr.off('botMessage', this._mgrMsgHandler); } catch (_) {}
    }
    // clear pathfinder goal if any
    try { if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') this.bot.pathfinder.setGoal(null); } catch (_) {}
  }

  _startAmbientRoam(idleLoc) {
    const roamCfg = this.config.roam || {};
    if (!roamCfg.enabled) return;

    const radius = typeof roamCfg.radius === 'number' && roamCfg.radius > 0 ? roamCfg.radius : 4;
    const minPauseMs = typeof roamCfg.minPauseMs === 'number' && roamCfg.minPauseMs > 0 ? roamCfg.minPauseMs : 3000;
    const maxPauseMs = typeof roamCfg.maxPauseMs === 'number' && roamCfg.maxPauseMs >= minPauseMs ? roamCfg.maxPauseMs : 9000;
    const interactChance = typeof roamCfg.interactChance === 'number' ? roamCfg.interactChance : 0.35;
    const lookAroundChance = typeof roamCfg.lookAroundChance === 'number' ? roamCfg.lookAroundChance : 0.5;

    const scheduleNext = () => {
      if (!this.enabled || !this.isIdle || !this.bot || !this.bot.entity) return;
      const pause = minPauseMs + Math.random() * (maxPauseMs - minPauseMs);
      this._roamTimer = setTimeout(() => this._doAmbientStep(idleLoc, radius, interactChance, lookAroundChance), pause);
    };

    // Kick off the first roam step
    scheduleNext();
  }

  async _doAmbientStep(idleLoc, radius, interactChance, lookAroundChance) {
    if (!this.enabled || !this.isIdle || !this.bot || !this.bot.entity) return;

    try {
      // Pick random offset within radius on X/Z, stay near idle Y
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const target = {
        x: Math.round(idleLoc.x + Math.cos(angle) * r),
        y: idleLoc.y,
        z: Math.round(idleLoc.z + Math.sin(angle) * r)
      };

      this._emitDebug('Ambient roam step to', target);

      if (this.bot.pathfindingUtil && typeof this.bot.pathfindingUtil.gotoBlock === 'function') {
        await this.bot.pathfindingUtil.gotoBlock(target, 30000, 'idle-roam');
      } else if (this.bot.pathfinder && typeof this.bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalBlock(target.x, target.y, target.z);
        await this.bot.pathfinder.goto(goal);
      }

      // Once arrived, maybe look around or interact with nearby blocks
      if (Math.random() < lookAroundChance) {
        this._ambientLookAround();
      }

      if (Math.random() < interactChance) {
        this._ambientInteract();
      }
    } catch (err) {
      this.logger.debug?.(`[IdleBehavior] Ambient roam step failed: ${err.message || err}`);
    } finally {
      // Schedule next step if still idling
      const roamCfg = this.config.roam || {};
      if (roamCfg.enabled && this.enabled && this.isIdle) {
        const radiusNext = typeof roamCfg.radius === 'number' && roamCfg.radius > 0 ? roamCfg.radius : radius;
        const minPauseMs = typeof roamCfg.minPauseMs === 'number' && roamCfg.minPauseMs > 0 ? roamCfg.minPauseMs : 3000;
        const maxPauseMs = typeof roamCfg.maxPauseMs === 'number' && roamCfg.maxPauseMs >= minPauseMs ? roamCfg.maxPauseMs : 9000;
        const interactChanceNext = typeof roamCfg.interactChance === 'number' ? roamCfg.interactChance : interactChance;
        const lookAroundChanceNext = typeof roamCfg.lookAroundChance === 'number' ? roamCfg.lookAroundChance : lookAroundChance;

        const pause = minPauseMs + Math.random() * (maxPauseMs - minPauseMs);
        this._roamTimer = setTimeout(
          () => this._doAmbientStep(idleLoc, radiusNext, interactChanceNext, lookAroundChanceNext),
          pause
        );
      }
    }
  }

  _ambientLookAround() {
    try {
      const ent = this.bot.entity;
      if (!ent || !ent.position) return;

      // Pick a slight random offset in yaw/pitch by choosing a pseudo point in front/side
      const yawOffset = (Math.random() - 0.5) * Math.PI / 2; // +/- 45 degrees
      const pitchOffset = (Math.random() - 0.5) * Math.PI / 8; // small up/down

      const dir = ent.yaw + yawOffset;
      const dx = Math.cos(dir);
      const dz = Math.sin(dir);
      const dy = Math.sin(pitchOffset);

      const targetPos = ent.position.offset(dx * 4, dy * 2, dz * 4);
      if (this.bot.lookAt) {
        this.bot.lookAt(targetPos, true).catch?.(() => {});
      }
    } catch (_) {}
  }

  _ambientInteract() {
    try {
      const ent = this.bot.entity;
      if (!ent || !ent.position || !this.bot.world) return;

      const pos = ent.position;
      const r = 3;
      const interesting = [];
      const interestingTypes = new Set([
        'chest',
        'trapped_chest',
        'barrel',
        'crafting_table',
        'furnace',
        'blast_furnace',
        'smoker',
        'anvil',
        'grindstone',
        'enchanting_table',
        'lectern'
      ]);

      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            const block = this.bot.blockAt(pos.offset(dx, dy, dz));
            if (!block || !block.name) continue;
            if (interestingTypes.has(block.name)) {
              interesting.push(block);
            }
          }
        }
      }

      if (interesting.length === 0) return;

      const block = interesting[Math.floor(Math.random() * interesting.length)];

      // Look at the block
      if (this.bot.lookAt && block.position) {
        this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true).catch?.(() => {});
      }

      const roamCfg = this.config.roam || {};
      if (roamCfg.openContainers && typeof this.bot.activateBlock === 'function') {
        // Occasionally open the block; rely on other behaviors to close/inventory-manage
        this.bot.activateBlock(block).catch?.(() => {});
      }
    } catch (_) {}
  }

  _maybeSleep() {
    if (!this.enabled || !this.isIdle) return;
    if (!this.bot || !this.bot.entity) return;
    try {
      const time = (this.bot.time && typeof this.bot.time.timeOfDay === 'number') ? this.bot.time.timeOfDay : null;
      if (time === null) return;
      // Minecraft night roughly when timeOfDay in [13000,23000]
      if (time >= 13000 && time <= 23000) {
        // Attempt to sleep via SleepBehavior if available
        if (this.behaviorSleep === undefined) {
          this.behaviorSleep = this.bot.sleepBehavior || this.bot.behaviors?.sleep || null;
        }
        if (this.behaviorSleep && typeof this.behaviorSleep.sleep === 'function') {
          this.logger.info('[IdleBehavior] Night detected, attempting to sleep');
          this.behaviorSleep.sleep().catch(() => {});
        }
      }
    } catch (_e) { /* ignore */ }
  }
}
