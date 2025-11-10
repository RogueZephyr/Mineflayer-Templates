// src/core/BotManager.js
import { EventEmitter } from 'events';

/**
 * BotManager - Phase A.1 foundational multi-bot manager
 * - Registry of workers (controllers + bots)
 * - Leader election via longest uptime
 * - Periodic status polling
 * - Lightweight event hub for future phases
 */
export default class BotManager extends EventEmitter {
  /**
   * @param {object} logger Project logger (info, warn, error, debug)
   * @param {object} options
   * @param {number} [options.pollIntervalMs=5000]
   * @param {string} [options.electionStrategy='longest-uptime']
   */
  constructor(logger, options = {}) {
    super();
    this.logger = logger;
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      electionStrategy: options.electionStrategy ?? 'longest-uptime'
    };

    this.workers = new Map(); // name -> { controller, bot, online, firstSpawnAt, lastSeenAt }
    this.leaderName = null;

    this._pollTimer = null;
    this._started = false;
    this.coordinator = null;
    
    // Task distribution internals
    this._taskCounter = 1;
    this._pendingTasks = []; // tasks waiting for assignment / claim
  }

  attachCoordinator(coordinator) {
    this.coordinator = coordinator;
  }

  /**
   * Register a bot (via its controller)
   * @param {string} name
   * @param {object} controller BotController instance
   */
  registerBot(name, controller) {
    if (!controller || !controller.bot) {
      this.logger?.warn?.(`[BotManager] registerBot(${name}) missing controller.bot`);
      return;
    }
    const bot = controller.bot;

    if (!this.workers.has(name)) {
      this.workers.set(name, {
        controller,
        bot,
        online: false,
        firstSpawnAt: null,
        lastSeenAt: null,
        queue: [] // per-bot task queue (assigned or in-progress tasks)
      });
      this.emit('workerRegistered', { name });
      this.logger?.debug?.(`[BotManager] Worker registered: ${name}`);
      // If controller supports task polling, enable it automatically (convenience)
      try {
        if (typeof controller.enableTaskPolling === 'function') {
          controller.enableTaskPolling(this, 5000);
        }
      } catch (err) {
        this.logger?.warn?.(`[BotManager] enableTaskPolling failed for ${name}: ${err.message || err}`);
      }
    }

    const onSpawn = () => {
      const w = this.workers.get(name);
      if (!w) return;
      const now = Date.now();
      if (!w.firstSpawnAt) w.firstSpawnAt = now;
      w.online = true;
      w.lastSeenAt = now;
      this.logger?.debug?.(`[BotManager] Worker spawn: ${name}`);
      this._maybeElectLeader();
      // leader (manager) should try to assign pending tasks when workers come online
      this._assignPendingTasks();
      this.emit('workerOnline', { name });
    };

    const onEnd = () => {
      const w = this.workers.get(name);
      if (!w) return;
      w.online = false;
      w.lastSeenAt = Date.now();
      this.logger?.debug?.(`[BotManager] Worker end: ${name}`);
      // Requeue tasks from this worker so others can pick them up
      if (w.queue && w.queue.length) {
        const reclaimed = w.queue.splice(0, w.queue.length);
        reclaimed.forEach(t => {
          t.assignedTo = null;
          t.status = 'pending';
          this._pendingTasks.push(t);
          this.emit('taskRequeued', { task: t, from: name });
        });
        this.logger?.info?.(`[BotManager] Requeued ${reclaimed.length} tasks from ${name}`);
      }
      if (this.leaderName === name) {
        this._maybeElectLeader();
      }
      this.emit('workerOffline', { name });
    };

    // Guard against multiple registrations by using once per lifecycle
    bot.once('spawn', onSpawn);
    bot.once('end', onEnd);
  }

  unregisterBot(name) {
    const w = this.workers.get(name);
    if (!w) return false;
    // Requeue any outstanding tasks
    if (w.queue && w.queue.length) {
      const reclaimed = w.queue.splice(0, w.queue.length);
      reclaimed.forEach(t => {
        t.assignedTo = null;
        t.status = 'pending';
        this._pendingTasks.push(t);
        this.emit('taskRequeued', { task: t, from: name });
      });
      this.logger?.info?.(`[BotManager] Requeued ${reclaimed.length} tasks from ${name} on unregister`);
    }

    this.workers.delete(name);
    this.emit('workerUnregistered', { name });
    this.logger?.debug?.(`[BotManager] Worker unregistered: ${name}`);
    if (this.leaderName === name) {
      this._maybeElectLeader();
    }
    return true;
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._pollTimer = setInterval(() => this._pollOnce().catch(() => {}), this.options.pollIntervalMs);
    this.logger?.info?.(`[BotManager] Started (poll=${this.options.pollIntervalMs}ms, election=${this.options.electionStrategy})`);
  }

  stop() {
    if (!this._started) return;
    this._started = false;
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    this.logger?.info?.('[BotManager] Stopped');
  }

  getLeader() {
    return this.leaderName ? { name: this.leaderName, ...this.getWorker(this.leaderName) } : null;
  }

  getWorker(name) {
    return this.workers.get(name) || null;
  }

  getWorkers() {
    return Array.from(this.workers.entries()).map(([name, data]) => ({ name, ...data }));
  }

  getStatus() {
    return {
      leader: this.leaderName,
      workers: this.getWorkers().map(w => ({
        name: w.name,
        online: w.online,
        uptimeSec: this._uptimeSec(w),
        lastSeenAt: w.lastSeenAt
      }))
    };
  }

  // -------- worker availability (idle/busy) --------

  /**
   * Determine if a worker is currently busy (running a behavior or task).
   * Centralizes the heuristic so callers don't peek into controller internals.
   * @param {object} worker
   * @returns {boolean}
   */
  _isWorkerBusy(worker) {
    if (!worker || !worker.online) return true; // offline treated as busy/unavailable

    // In-progress or assigned manager tasks
    try {
      if (Array.isArray(worker.queue)) {
        if (worker.queue.some(t => t && (t.status === 'in-progress' || t.status === 'assigned'))) return true;
      }
    } catch (_) {}

    // Behavior-level activity flags (best-effort, optional)
    try {
      const ctl = worker.controller;
      const beh = ctl?.behaviors || {};
      if (beh.mining?.isWorking) return true;
      if (beh.farm?.isWorking) return true;
      if (beh.woodcutting?.isWorking) return true;
      if (beh.sleep?.sleeping) return true;
      if (beh.itemCollector?.isRunning) return true;
    } catch (_) {}

    // TaskQueue processing state (optional)
    try {
      const q = worker.controller?.taskQueue;
      if (q && typeof q.getStatus === 'function') {
        const st = q.getStatus();
        if (st?.isProcessing) return true;
      }
    } catch (_) {}

    return false;
  }

  /**
   * Public predicate for idle state.
   * @param {string} name Worker/bot name
   * @returns {boolean}
   */
  isWorkerIdle(name) {
    const w = this.workers.get(name);
    if (!w) return false;
    if (!w.online) return false;
    return !this._isWorkerBusy(w);
  }

  /**
   * Convenience: get idle workers (optionally capped to N)
   * @param {number} [max]
   */
  getIdleWorkers(max = undefined) {
    const list = this.getWorkers().filter(w => this.isWorkerIdle(w.name));
    return typeof max === 'number' && max > 0 ? list.slice(0, max) : list;
  }

  // -------- task distribution API --------

  /**
   * Submit a task to the manager.
   * If botName is provided the task is queued for that bot (if present),
   * otherwise it becomes pending for leader/claiming.
   *
   * opts = { botName, priority }
   */
  submitTask(type, payload = {}, opts = {}) {
    const task = {
      id: `t${this._taskCounter++}`,
      type,
      payload,
      priority: Number.isFinite(opts.priority) ? opts.priority : 5,
      createdAt: Date.now(),
      assignedTo: null,
      status: 'pending'
    };

    if (opts.botName) {
      const w = this.workers.get(opts.botName);
      if (w) {
        w.queue.push(task);
        task.assignedTo = opts.botName;
        task.status = 'assigned';
        this.emit('taskAssigned', { task, to: opts.botName });
        this.logger?.info?.(`[BotManager] Task ${task.id} assigned to ${opts.botName} (preferred)`);
        return task.id;
      }
      // If preferred bot not found, fall through to pending
      this.logger?.warn?.(`[BotManager] Preferred bot ${opts.botName} not found. Task queued for assignment.`);
    }

    // Put into pending queue; leader or bots can claim
    this._pendingTasks.push(task);
    this.emit('taskQueued', { task });
    this.logger?.debug?.(`[BotManager] Task queued: ${task.id}`);
    // If there's a leader available, attempt assignment now
    if (this.leaderName) this._assignPendingTasks();
    return task.id;
  }

  /**
   * Bots call this to claim the next task for themselves.
   * If the bot already has assigned tasks those are claimed first.
   * If no assigned task exists, a pending task is assigned and returned.
   * Returns the claimed task object or null.
   */
  claimNextTask(botName, _opts = {}) {
    const w = this.workers.get(botName);
    if (!w) return null;

    // Prefer tasks already assigned to this bot
    if (Array.isArray(w.queue) && w.queue.length) {
      // choose highest-priority, oldest
      w.queue.sort((a, b) => (a.priority - b.priority) || (a.createdAt - b.createdAt));
      const idx = w.queue.findIndex(t => t.status === 'assigned' || t.status === 'pending');
      if (idx !== -1) {
        const task = w.queue[idx];
        task.status = 'in-progress';
        task.startedAt = Date.now();
        this.emit('taskClaimed', { task, by: botName });
        this.logger?.info?.(`[BotManager] ${botName} claimed task ${task.id}`);
        return task;
      }
    }

    // Otherwise attempt to assign a pending task to this bot and mark in-progress
    if (this._pendingTasks.length > 0) {
      // pick highest priority then oldest
      this._pendingTasks.sort((a, b) => (a.priority - b.priority) || (a.createdAt - b.createdAt));
      const task = this._pendingTasks.shift();
      task.assignedTo = botName;
      task.status = 'in-progress';
      task.startedAt = Date.now();
      w.queue.push(task);
      this.emit('taskAssigned', { task, to: botName });
      this.emit('taskClaimed', { task, by: botName });
      this.logger?.info?.(`[BotManager] ${botName} pulled and started task ${task.id}`);
      return task;
    }

    return null;
  }

  /**
   * Peek the next task that would be claimed for a bot without modifying state.
   */
  peekNextTask(botName) {
    const w = this.workers.get(botName);
    if (!w) return null;
    if (Array.isArray(w.queue) && w.queue.length) {
      const copy = [...w.queue].filter(t => t.status === 'assigned' || t.status === 'pending');
      copy.sort((a, b) => (a.priority - b.priority) || (a.createdAt - b.createdAt));
      return copy[0] || null;
    }
    if (this._pendingTasks.length > 0) {
      const copy = [...this._pendingTasks];
      copy.sort((a, b) => (a.priority - b.priority) || (a.createdAt - b.createdAt));
      return copy[0] || null;
    }
    return null;
  }

  /**
   * Release a task currently in-progress back to pending (e.g., bot failed or wants to delay)
   */
  releaseTask(botName, taskId, _opts = {}) {
    const w = this.workers.get(botName);
    if (!w || !Array.isArray(w.queue)) return false;
    const idx = w.queue.findIndex(t => t.id === taskId);
    if (idx === -1) return false;
    const [task] = w.queue.splice(idx, 1);
    task.assignedTo = null;
    task.status = 'pending';
    task.releasedAt = Date.now();
    this._pendingTasks.push(task);
    this.emit('taskReleased', { task, from: botName });
    this.logger?.info?.(`[BotManager] Task ${task.id} released by ${botName}`);
    return true;
  }

  /**
   * Mark a task complete for a bot.
   */
  completeTask(botName, taskId) {
    const w = this.workers.get(botName);
    if (!w || !Array.isArray(w.queue)) return false;
    const idx = w.queue.findIndex(t => t.id === taskId);
    if (idx === -1) return false;
    const [task] = w.queue.splice(idx, 1);
    task.status = 'completed';
    task.completedAt = Date.now();
    this.emit('taskCompleted', { task, by: botName });
    this.logger?.info?.(`[BotManager] Task ${task.id} completed by ${botName}`);
    // After completing, leader can assign pending tasks
    if (this.leaderName) this._assignPendingTasks();
    return true;
  }

  getWorkerQueue(name) {
    const w = this.workers.get(name);
    return w ? [...(w.queue || [])] : [];
  }

  getPendingTasks() {
    return [...this._pendingTasks];
  }

  /**
   * Send an out-of-band message between bots (in-process manager delivery).
   * @param {string} from
   * @param {string|null} to - recipient bot name or null for broadcast
   * @param {object} payload
   */
  sendBotMessage(from, to, payload = {}) {
    const msg = { from, to: to ?? null, payload, at: Date.now() };
    this.emit('botMessage', msg);
    this.logger?.debug?.(`[BotManager] botMessage from=${from} to=${to ?? 'ALL'} payload=${JSON.stringify(payload)}`);
  }

  // -------- internals --------

  _assignTaskToBot(task, botName) {
    const w = this.workers.get(botName);
    if (!w) {
      this.logger?.warn?.(`[BotManager] Attempted to assign task ${task.id} to missing bot ${botName}`);
      return false;
    }
    task.assignedTo = botName;
    task.status = 'assigned';
    w.queue.push(task);
    this.emit('taskAssigned', { task, to: botName });
    this.logger?.info?.(`[BotManager] Task ${task.id} assigned to ${botName}`);
    return true;
  }

  _chooseBestBotForTask() {
    const onlineWorkers = this.getWorkers().filter(w => w.online);
    if (onlineWorkers.length === 0) return null;

    // choose by smallest queue length, tie-breaker by sum of priority (lower better), then uptime
    let best = null;
    for (const w of onlineWorkers) {
      if (!best) { best = w; continue; }
      const len = (w.queue || []).length;
      const bestLen = (best.queue || []).length;
      if (len < bestLen) { best = w; continue; }
      if (len === bestLen) {
        const sumPri = (w.queue || []).reduce((s, t) => s + (t.priority ?? 5), 0);
        const bestSumPri = (best.queue || []).reduce((s, t) => s + (t.priority ?? 5), 0);
        if (sumPri < bestSumPri) { best = w; continue; }
        // tie-break by uptime
        if ((w.uptimeSec ?? this._uptimeSec(w)) > (best.uptimeSec ?? this._uptimeSec(best))) {
          best = w;
        }
      }
    }
    return best;
  }

  _assignPendingTasks() {
    if (!this.leaderName) return;
    // attempt to drain pending tasks, assigning them one-by-one to best candidates
    let madeAssignment = false;
    // sort pending by priority then createdAt
    this._pendingTasks.sort((a, b) => (a.priority - b.priority) || (a.createdAt - b.createdAt));
    while (this._pendingTasks.length > 0) {
      const task = this._pendingTasks.shift();
      const chosen = this._chooseBestBotForTask(task);
      if (!chosen) {
        // put back and stop
        this._pendingTasks.unshift(task);
        break;
      }
      this._assignTaskToBot(task, chosen.name);
      madeAssignment = true;
    }
    if (madeAssignment) {
      this.emit('pendingAssignmentsDrained');
    }
  }

  forceReelection() {
    this._maybeElectLeader(true);
  }

  // -------- internals --------

  _maybeElectLeader(force = false) {
    const onlineWorkers = this.getWorkers().filter(w => w.online);
    if (onlineWorkers.length === 0) {
      if (this.leaderName) {
        const prev = this.leaderName;
        this.leaderName = null;
        this.emit('leaderChanged', { previous: prev, current: null, reason: 'no-online-workers' });
        this.logger?.info?.('[BotManager] No online workers. Leader cleared.');
      }
      return;
    }

    if (!force && this.leaderName && onlineWorkers.some(w => w.name === this.leaderName)) {
      return; // keep current leader
    }

    if (this.options.electionStrategy === 'longest-uptime') {
      const sorted = onlineWorkers
        .map(w => ({ name: w.name, up: this._uptimeSec(w) }))
        .sort((a, b) => b.up - a.up);
      const nextLeader = sorted[0]?.name ?? null;

      if (nextLeader !== this.leaderName) {
        const previous = this.leaderName;
        this.leaderName = nextLeader;
        this.emit('leaderChanged', { previous, current: this.leaderName, reason: 'longest-uptime' });
        this.logger?.info?.(`[BotManager] Leader elected: ${this.leaderName} (strategy=longest-uptime)`);
      }
    }
  }

  _uptimeSec(worker) {
    if (!worker?.firstSpawnAt) return 0;
    return Math.max(0, Math.floor((Date.now() - worker.firstSpawnAt) / 1000));
  }

  async _pollOnce() {
    const summaries = [];
    for (const [name, w] of this.workers.entries()) {
      const bot = w.bot;
      const online = !!bot?.entity;
      w.online = online;
      w.lastSeenAt = Date.now();

      const health = Number.isFinite(bot?.health) ? bot.health : null;
      const hunger = Number.isFinite(bot?.food) ? bot.food : null;
      const pos = bot?.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null;

      let invUsed = null;
      let invTotal = null;
      try {
        const items = bot?.inventory?.items ? bot.inventory.items() : (bot?.inventory?.slots ?? []).filter(Boolean);
        invUsed = Array.isArray(items) ? items.length : null;
        invTotal = Array.isArray(bot?.inventory?.slots) ? bot.inventory.slots.length : null;
      } catch {
        // ignore
      }

      summaries.push({
        name,
        online,
        uptimeSec: this._uptimeSec(w),
        health,
        hunger,
        position: pos,
        inventory: { used: invUsed, total: invTotal }
      });
    }

    this.emit('statusUpdate', { at: Date.now(), summaries });
    this.logger?.debug?.(`[BotManager] Polled ${summaries.length} workers`);
  }
}
