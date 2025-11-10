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
    const mgr = this.bot.manager;
    if (mgr) {
      try { if (this._mgrTaskHandler) mgr.off('taskAssigned', this._mgrTaskHandler); } catch (_) {}
      try { if (this._mgrMsgHandler) mgr.off('botMessage', this._mgrMsgHandler); } catch (_) {}
    }
    // clear pathfinder goal if any
    try { if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') this.bot.pathfinder.setGoal(null); } catch (_) {}
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
