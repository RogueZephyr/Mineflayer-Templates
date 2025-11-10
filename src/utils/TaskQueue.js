// src/utils/TaskQueue.js

/**
 * TaskQueue - Sequential task execution system
 * Allows bots to queue tasks and execute them one by one
 * Supports task priorities, cancellation, and error handling
 */
export default class TaskQueue {
  constructor(bot, logger) {
    this.bot = bot;
    this.logger = logger;
    
    // Task queue (array of task objects)
    this.queue = [];
    
    // Current executing task
    this.currentTask = null;
    
    // Queue state
    this.isProcessing = false;
    this.isPaused = false;
    
    // Statistics
    this.stats = {
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksSkipped: 0,
      totalExecutionTime: 0,
      startTime: Date.now()
    };
    
    // Task ID counter
    this.nextTaskId = 1;
    
    // Event handlers for task lifecycle
    this.eventHandlers = {
      taskStarted: [],
      taskCompleted: [],
      taskFailed: [],
      taskSkipped: [],
      queueEmpty: []
    };
  }

  /**
   * Add a task to the queue
   * @param {Object} taskConfig - Task configuration
   * @param {string} taskConfig.name - Task name/description
   * @param {Function} taskConfig.execute - Async function to execute
   * @param {number} taskConfig.priority - Task priority (higher = sooner, default: 0)
   * @param {number} taskConfig.timeout - Max execution time in ms (default: no timeout)
   * @param {Object} taskConfig.metadata - Additional metadata
   * @param {Function} taskConfig.canExecute - Optional predicate function to check if task can execute
   * @returns {number} Task ID
   */
  addTask(taskConfig) {
    const {
      name = 'Unnamed Task',
      execute,
      priority = 0,
      timeout = null,
      metadata = {},
      canExecute = null
    } = taskConfig;

    if (typeof execute !== 'function') {
      throw new Error('Task execute must be a function');
    }

    const task = {
      id: this.nextTaskId++,
      name,
      execute,
      priority,
      timeout,
      metadata,
      canExecute,
      addedAt: Date.now(),
      status: 'pending'
    };

    this.queue.push(task);
    
    // Sort by priority (higher priority first)
    this.queue.sort((a, b) => b.priority - a.priority);

    this.logger.info(`[TaskQueue] Task added: "${name}" (ID: ${task.id}, Priority: ${priority}, Queue size: ${this.queue.length})`);

    // Start processing if not already running
    if (!this.isProcessing && !this.isPaused) {
      this._processNext();
    }

    return task.id;
  }

  /**
   * Add multiple tasks at once
   * @param {Array<Object>} tasks - Array of task configurations
   * @returns {Array<number>} Array of task IDs
   */
  addTasks(tasks) {
    if (!Array.isArray(tasks)) {
      throw new Error('addTasks expects an array of task configurations');
    }
    
    return tasks.map(task => this.addTask(task));
  }

  /**
   * Remove a task from the queue by ID
   * @param {number} taskId - Task ID to remove
   * @returns {boolean} True if task was removed
   */
  removeTask(taskId) {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      const task = this.queue[index];
      this.queue.splice(index, 1);
      this.logger.info(`[TaskQueue] Task removed: "${task.name}" (ID: ${taskId})`);
      this.stats.tasksSkipped++;
      this._emit('taskSkipped', task);
      return true;
    }
    return false;
  }

  /**
   * Clear all pending tasks
   * @returns {number} Number of tasks cleared
   */
  clearQueue() {
    const count = this.queue.length;
    this.queue.forEach(task => {
      this.stats.tasksSkipped++;
      this._emit('taskSkipped', task);
    });
    this.queue = [];
    this.logger.info(`[TaskQueue] Queue cleared: ${count} tasks removed`);
    return count;
  }

  /**
   * Pause queue processing
   */
  pause() {
    if (!this.isPaused) {
      this.isPaused = true;
      this.logger.info('[TaskQueue] Queue paused');
    }
  }

  /**
   * Resume queue processing
   */
  resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.logger.info('[TaskQueue] Queue resumed');
      if (!this.isProcessing) {
        this._processNext();
      }
    }
  }

  /**
   * Stop current task and clear queue
   */
  async stop() {
    this.pause();
    this.clearQueue();
    
    // Wait for current task to finish if any
    if (this.currentTask) {
      this.logger.info('[TaskQueue] Waiting for current task to complete...');
      // The current task will finish naturally, we just won't process more
    }
  }

  /**
   * Get task by ID
   * @param {number} taskId - Task ID
   * @returns {Object|null} Task object or null
   */
  getTask(taskId) {
    if (this.currentTask && this.currentTask.id === taskId) {
      return this.currentTask;
    }
    return this.queue.find(t => t.id === taskId) || null;
  }

  /**
   * Get all tasks (pending and current)
   * @returns {Array} Array of tasks
   */
  getAllTasks() {
    const tasks = [...this.queue];
    if (this.currentTask) {
      tasks.unshift(this.currentTask);
    }
    return tasks;
  }

  /**
   * Get queue status
   * @returns {Object} Queue status information
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      queueLength: this.queue.length,
      currentTask: this.currentTask ? {
        id: this.currentTask.id,
        name: this.currentTask.name,
        priority: this.currentTask.priority,
        startedAt: this.currentTask.startedAt,
        runningFor: Date.now() - (this.currentTask.startedAt || 0)
      } : null,
      stats: { ...this.stats },
      uptime: Date.now() - this.stats.startTime
    };
  }

  /**
   * Get statistics summary
   * @returns {Object} Statistics
   */
  getStats() {
    const total = this.stats.tasksCompleted + this.stats.tasksFailed + this.stats.tasksSkipped;
    const avgTime = this.stats.tasksCompleted > 0 
      ? Math.round(this.stats.totalExecutionTime / this.stats.tasksCompleted)
      : 0;
    
    return {
      ...this.stats,
      totalTasks: total,
      averageExecutionTime: avgTime,
      successRate: total > 0 
        ? ((this.stats.tasksCompleted / total) * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  /**
   * Register event handler
   * @param {string} event - Event name (taskStarted, taskCompleted, taskFailed, taskSkipped, queueEmpty)
   * @param {Function} handler - Handler function
   */
  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    } else {
      throw new Error(`Unknown event: ${event}`);
    }
  }

  /**
   * Unregister event handler
   * @param {string} event - Event name
   * @param {Function} handler - Handler function to remove
   */
  off(event, handler) {
    if (this.eventHandlers[event]) {
      const index = this.eventHandlers[event].indexOf(handler);
      if (index !== -1) {
        this.eventHandlers[event].splice(index, 1);
      }
    }
  }

  /**
   * Emit event to all registered handlers
   * @private
   */
  _emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          this.logger.error(`[TaskQueue] Event handler error (${event}): ${err.message}`);
        }
      });
    }
  }

  /**
   * Process next task in queue
   * @private
   */
  async _processNext() {
    // Check if we should process
    if (this.isPaused || this.isProcessing || this.queue.length === 0) {
      if (this.queue.length === 0 && !this.isProcessing) {
        this._emit('queueEmpty', null);
      }
      return;
    }

    this.isProcessing = true;

    // Get next task
    const task = this.queue.shift();
    
    // Check if task can execute (optional predicate)
    if (task.canExecute && typeof task.canExecute === 'function') {
      try {
        const canRun = await task.canExecute();
        if (!canRun) {
          this.logger.warn(`[TaskQueue] Task "${task.name}" (ID: ${task.id}) cannot execute, skipping`);
          this.stats.tasksSkipped++;
          this._emit('taskSkipped', task);
          this.isProcessing = false;
          this._processNext();
          return;
        }
      } catch (err) {
        this.logger.error(`[TaskQueue] Task canExecute check failed: ${err.message}`);
        this.stats.tasksSkipped++;
        this._emit('taskSkipped', task);
        this.isProcessing = false;
        this._processNext();
        return;
      }
    }

    this.currentTask = task;
    task.status = 'running';
    task.startedAt = Date.now();

    this.logger.info(`[TaskQueue] Executing task: "${task.name}" (ID: ${task.id}, ${this.queue.length} remaining)`);
    this._emit('taskStarted', task);

    try {
      // Execute with optional timeout
      let result;
      if (task.timeout) {
        result = await this._executeWithTimeout(task);
      } else {
        result = await task.execute(this.bot);
      }

      // Task completed successfully
      const executionTime = Date.now() - task.startedAt;
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();

      this.stats.tasksCompleted++;
      this.stats.totalExecutionTime += executionTime;

      this.logger.success(`[TaskQueue] Task completed: "${task.name}" (ID: ${task.id}, ${executionTime}ms)`);
      this._emit('taskCompleted', { task, result, executionTime });

    } catch (err) {
      // Task failed
      const executionTime = Date.now() - task.startedAt;
      task.status = 'failed';
      task.error = err.message || String(err);
      task.completedAt = Date.now();

      this.stats.tasksFailed++;

      this.logger.error(`[TaskQueue] Task failed: "${task.name}" (ID: ${task.id}): ${task.error}`);
      this._emit('taskFailed', { task, error: err, executionTime });
    } finally {
      this.currentTask = null;
      this.isProcessing = false;

      // Process next task after a small delay
      setTimeout(() => this._processNext(), 100);
    }
  }

  /**
   * Execute task with timeout
   * @private
   */
  async _executeWithTimeout(task) {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Task timeout after ${task.timeout}ms`));
      }, task.timeout);

      task.execute(this.bot)
        .then(result => {
          clearTimeout(timeoutHandle);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timeoutHandle);
          reject(err);
        });
    });
  }

  /**
   * Wait for all tasks to complete
   * @param {number} timeout - Optional timeout in ms
   * @returns {Promise<void>}
   */
  async waitForCompletion(timeout = null) {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (!this.isProcessing && this.queue.length === 0) {
          clearInterval(checkInterval);
          resolve();
        } else if (timeout && Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error('Task queue completion timeout'));
        }
      }, 100);
    });
  }

  /**
   * Create a task builder for fluent API
   * @returns {TaskBuilder}
   */
  createTask() {
    return new TaskBuilder(this);
  }
}

/**
 * TaskBuilder - Fluent API for building tasks
 */
class TaskBuilder {
  constructor(taskQueue) {
    this.taskQueue = taskQueue;
    this.config = {
      priority: 0,
      metadata: {}
    };
  }

  name(name) {
    this.config.name = name;
    return this;
  }

  execute(fn) {
    this.config.execute = fn;
    return this;
  }

  priority(priority) {
    this.config.priority = priority;
    return this;
  }

  timeout(ms) {
    this.config.timeout = ms;
    return this;
  }

  metadata(data) {
    this.config.metadata = { ...this.config.metadata, ...data };
    return this;
  }

  canExecute(fn) {
    this.config.canExecute = fn;
    return this;
  }

  add() {
    return this.taskQueue.addTask(this.config);
  }
}
