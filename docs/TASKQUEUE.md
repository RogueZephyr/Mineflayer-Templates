# TaskQueue Documentation

## Overview

The TaskQueue system provides sequential task execution with priority ordering, event handling, and queue management. It enables bots to queue complex operations and execute them one at a time in an organized manner.

**Location:** `src/utils/TaskQueue.js`

## Table of Contents

- [Features](#features)
- [Basic Usage](#basic-usage)
- [API Reference](#api-reference)
- [Task Configuration](#task-configuration)
- [Events](#events)
- [Priority System](#priority-system)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Commands](#commands)

---

## Features

- ✅ **Sequential Execution** - Tasks execute one at a time in order
- ✅ **Priority Ordering** - Higher priority tasks execute first
- ✅ **Event System** - Monitor task lifecycle with event handlers
- ✅ **Task Cancellation** - Remove tasks before execution
- ✅ **Queue Control** - Pause, resume, and stop queue processing
- ✅ **Statistics Tracking** - Monitor completion rates and execution times
- ✅ **Timeout Support** - Set maximum execution time for tasks
- ✅ **Fluent API** - Build tasks with TaskBuilder for elegant syntax
- ✅ **Error Handling** - Failed tasks don't stop the queue

---

## Basic Usage

### Accessing TaskQueue

The TaskQueue is initialized automatically and accessible via `bot.taskQueue`:

```javascript
// In a behavior or command handler
const taskQueue = this.bot.taskQueue;
```

### Adding a Simple Task

```javascript
bot.taskQueue.addTask({
  name: 'Go to coordinates',
  execute: async (bot) => {
    await bot.pathfindingUtil.goto({ x: 100, y: 64, z: 100 });
  }
});
```

### Adding a Task with Priority

```javascript
bot.taskQueue.addTask({
  name: 'Emergency return home',
  priority: 10, // Higher priority = executes sooner
  execute: async (bot) => {
    await bot.homeBehavior.goHome();
  }
});
```

---

## API Reference

### TaskQueue Methods

#### `addTask(taskConfig)`
Add a task to the queue.

**Parameters:**
- `taskConfig` (Object):
  - `name` (string) - Task name/description
  - `execute` (Function) - Async function to execute `async (bot) => {}`
  - `priority` (number) - Task priority (default: 0, higher = sooner)
  - `timeout` (number) - Max execution time in ms (optional)
  - `metadata` (Object) - Additional metadata (optional)
  - `canExecute` (Function) - Predicate function to check if task can run (optional)

**Returns:** `number` - Task ID

**Example:**
```javascript
const taskId = bot.taskQueue.addTask({
  name: 'Mine diamond ore',
  priority: 5,
  timeout: 60000, // 1 minute timeout
  metadata: { oreType: 'diamond' },
  execute: async (bot) => {
    await bot.behaviors.mining.mineVeinAt(orePosition);
  },
  canExecute: async () => {
    // Only execute if bot has a pickaxe
    return bot.toolHandler.hasTool('pickaxe');
  }
});
```

---

#### `addTasks(tasks)`
Add multiple tasks at once.

**Parameters:**
- `tasks` (Array) - Array of task configurations

**Returns:** `Array<number>` - Array of task IDs

**Example:**
```javascript
const taskIds = bot.taskQueue.addTasks([
  { name: 'Task 1', execute: async (bot) => { /* ... */ } },
  { name: 'Task 2', execute: async (bot) => { /* ... */ } },
  { name: 'Task 3', execute: async (bot) => { /* ... */ } }
]);
```

---

#### `removeTask(taskId)`
Remove a task from the queue by ID.

**Parameters:**
- `taskId` (number) - Task ID to remove

**Returns:** `boolean` - True if task was removed

**Example:**
```javascript
const taskId = bot.taskQueue.addTask({ /* ... */ });
// Later, cancel the task
const removed = bot.taskQueue.removeTask(taskId);
```

---

#### `clearQueue()`
Clear all pending tasks.

**Returns:** `number` - Number of tasks cleared

**Example:**
```javascript
const cleared = bot.taskQueue.clearQueue();
console.log(`Cleared ${cleared} tasks`);
```

---

#### `pause()`
Pause queue processing (current task continues).

**Example:**
```javascript
bot.taskQueue.pause();
```

---

#### `resume()`
Resume queue processing.

**Example:**
```javascript
bot.taskQueue.resume();
```

---

#### `stop()`
Stop current task and clear queue (async).

**Example:**
```javascript
await bot.taskQueue.stop();
```

---

#### `getTask(taskId)`
Get task by ID.

**Parameters:**
- `taskId` (number) - Task ID

**Returns:** `Object|null` - Task object or null

**Example:**
```javascript
const task = bot.taskQueue.getTask(taskId);
if (task) {
  console.log(`Task "${task.name}" status: ${task.status}`);
}
```

---

#### `getAllTasks()`
Get all tasks (pending and current).

**Returns:** `Array<Object>` - Array of task objects

**Example:**
```javascript
const tasks = bot.taskQueue.getAllTasks();
console.log(`${tasks.length} tasks in queue`);
```

---

#### `getStatus()`
Get queue status information.

**Returns:** `Object` - Status object with:
- `isProcessing` (boolean) - Queue is processing a task
- `isPaused` (boolean) - Queue is paused
- `queueLength` (number) - Number of pending tasks
- `currentTask` (Object|null) - Current executing task
- `stats` (Object) - Statistics
- `uptime` (number) - Queue uptime in ms

**Example:**
```javascript
const status = bot.taskQueue.getStatus();
console.log(`Queue: ${status.queueLength} pending, ${status.isProcessing ? 'processing' : 'idle'}`);
if (status.currentTask) {
  console.log(`Current: ${status.currentTask.name}`);
}
```

---

#### `getStats()`
Get statistics summary.

**Returns:** `Object` - Statistics with:
- `tasksCompleted` (number) - Total completed tasks
- `tasksFailed` (number) - Total failed tasks
- `tasksSkipped` (number) - Total skipped tasks
- `totalTasks` (number) - Total tasks processed
- `totalExecutionTime` (number) - Total execution time in ms
- `averageExecutionTime` (number) - Average time per task in ms
- `successRate` (string) - Success rate percentage
- `startTime` (number) - Queue start timestamp

**Example:**
```javascript
const stats = bot.taskQueue.getStats();
console.log(`Completed: ${stats.tasksCompleted}, Failed: ${stats.tasksFailed}`);
console.log(`Success Rate: ${stats.successRate}, Avg Time: ${stats.averageExecutionTime}ms`);
```

---

#### `on(event, handler)`
Register event handler.

**Parameters:**
- `event` (string) - Event name (see [Events](#events))
- `handler` (Function) - Handler function

**Example:**
```javascript
bot.taskQueue.on('taskCompleted', ({ task, result, executionTime }) => {
  console.log(`✓ ${task.name} completed in ${executionTime}ms`);
});
```

---

#### `off(event, handler)`
Unregister event handler.

**Parameters:**
- `event` (string) - Event name
- `handler` (Function) - Handler function to remove

**Example:**
```javascript
const handler = (data) => { /* ... */ };
bot.taskQueue.on('taskStarted', handler);
// Later...
bot.taskQueue.off('taskStarted', handler);
```

---

#### `waitForCompletion(timeout)`
Wait for all tasks to complete (async).

**Parameters:**
- `timeout` (number) - Optional timeout in ms

**Returns:** `Promise<void>` - Resolves when queue is empty

**Example:**
```javascript
// Add tasks
bot.taskQueue.addTask({ /* ... */ });
bot.taskQueue.addTask({ /* ... */ });

// Wait for all to complete
await bot.taskQueue.waitForCompletion(30000); // 30 second timeout
console.log('All tasks complete!');
```

---

#### `createTask()`
Create a task builder for fluent API.

**Returns:** `TaskBuilder` - Builder instance

**Example:**
```javascript
bot.taskQueue.createTask()
  .name('Complex mining operation')
  .priority(5)
  .timeout(120000)
  .metadata({ operation: 'strip-mine' })
  .execute(async (bot) => {
    await bot.behaviors.mining.startStripMining(/* ... */);
  })
  .canExecute(async () => {
    return bot.inventory.slots.length > 10; // Need inventory space
  })
  .add(); // Returns task ID
```

---

## Task Configuration

### Task Object Structure

```javascript
{
  id: 1,                    // Unique task ID (auto-generated)
  name: 'Task name',        // Human-readable name
  execute: async (bot) => {},  // Execution function
  priority: 0,              // Priority (higher = sooner)
  timeout: null,            // Timeout in ms (null = no timeout)
  metadata: {},             // Custom metadata
  canExecute: null,         // Optional predicate function
  addedAt: 1699488000000,   // Timestamp when added
  status: 'pending',        // 'pending', 'running', 'completed', 'failed'
  startedAt: null,          // Timestamp when started
  completedAt: null,        // Timestamp when completed/failed
  result: null,             // Return value from execute()
  error: null               // Error message if failed
}
```

### Task States

- **`pending`** - Task is in queue, not yet executed
- **`running`** - Task is currently executing
- **`completed`** - Task finished successfully
- **`failed`** - Task threw an error during execution

---

## Events

The TaskQueue emits events during task lifecycle:

### `taskStarted`
Fired when a task begins execution.

**Data:** `task` (Object)

```javascript
bot.taskQueue.on('taskStarted', (task) => {
  console.log(`▶ Starting: ${task.name}`);
});
```

---

### `taskCompleted`
Fired when a task completes successfully.

**Data:** `{ task, result, executionTime }`

```javascript
bot.taskQueue.on('taskCompleted', ({ task, result, executionTime }) => {
  console.log(`✓ Completed: ${task.name} (${executionTime}ms)`);
  if (result) {
    console.log(`Result:`, result);
  }
});
```

---

### `taskFailed`
Fired when a task throws an error.

**Data:** `{ task, error, executionTime }`

```javascript
bot.taskQueue.on('taskFailed', ({ task, error, executionTime }) => {
  console.log(`✗ Failed: ${task.name} (${executionTime}ms)`);
  console.error(`Error: ${error.message}`);
});
```

---

### `taskSkipped`
Fired when a task is removed or fails `canExecute()` check.

**Data:** `task` (Object)

```javascript
bot.taskQueue.on('taskSkipped', (task) => {
  console.log(`⊘ Skipped: ${task.name}`);
});
```

---

### `queueEmpty`
Fired when the queue becomes empty.

**Data:** `null`

```javascript
bot.taskQueue.on('queueEmpty', () => {
  console.log('Queue is empty - all tasks completed');
});
```

---

## Priority System

Tasks are executed based on priority (higher values execute first).

### Default Priority: 0

```javascript
// Default priority
bot.taskQueue.addTask({
  name: 'Normal task',
  execute: async (bot) => { /* ... */ }
}); // priority = 0
```

### High Priority Tasks

```javascript
// High priority - executes before normal tasks
bot.taskQueue.addTask({
  name: 'Important task',
  priority: 10,
  execute: async (bot) => { /* ... */ }
});
```

### Priority Examples

```javascript
// Add tasks in random order
bot.taskQueue.addTask({ name: 'Low priority', priority: 1, execute: /* ... */ });
bot.taskQueue.addTask({ name: 'Critical', priority: 100, execute: /* ... */ });
bot.taskQueue.addTask({ name: 'Normal', priority: 5, execute: /* ... */ });
bot.taskQueue.addTask({ name: 'High priority', priority: 50, execute: /* ... */ });

// Execution order: Critical (100) → High priority (50) → Normal (5) → Low priority (1)
```

---

## Examples

### Example 1: Mining Sequence

```javascript
// Queue a complete mining operation
const tasks = [
  {
    name: 'Go to mine entrance',
    priority: 1,
    execute: async (bot) => {
      await bot.pathfindingUtil.goto({ x: 100, y: 60, z: 100 });
    }
  },
  {
    name: 'Start strip mining',
    priority: 1,
    execute: async (bot) => {
      await bot.behaviors.mining.startStripMining(
        bot.entity.position,
        'east',
        100, // length
        10   // branches
      );
    }
  },
  {
    name: 'Deposit items',
    priority: 1,
    execute: async (bot) => {
      await bot.behaviors.deposit.depositToNearest();
    }
  },
  {
    name: 'Return home',
    priority: 1,
    execute: async (bot) => {
      await bot.homeBehavior.goHome();
    }
  }
];

bot.taskQueue.addTasks(tasks);
```

---

### Example 2: Resource Gathering Loop

```javascript
// Set up event handlers
bot.taskQueue.on('queueEmpty', () => {
  console.log('Gathering complete!');
});

bot.taskQueue.on('taskFailed', ({ task, error }) => {
  console.error(`Task "${task.name}" failed:`, error.message);
  // Add retry task
  bot.taskQueue.addTask({
    name: `Retry: ${task.name}`,
    priority: 5,
    execute: task.execute
  });
});

// Add gathering tasks
const resources = ['oak_log', 'cobblestone', 'wheat'];
resources.forEach(resource => {
  bot.taskQueue.addTask({
    name: `Collect ${resource}`,
    execute: async (bot) => {
      await bot.behaviors.itemCollector.collectOnce({ 
        radius: 32 
      });
    },
    canExecute: async () => {
      // Only collect if inventory has space
      return bot.inventory.emptySlotCount() > 5;
    }
  });
});
```

---

### Example 3: Conditional Task Execution

```javascript
// Task only executes if bot has required items
bot.taskQueue.addTask({
  name: 'Craft iron pickaxe',
  priority: 10,
  execute: async (bot) => {
    // Crafting logic here
    await craftItem(bot, 'iron_pickaxe');
  },
  canExecute: async () => {
    // Check if bot has materials
    const ironIngots = bot.inventory.count('iron_ingot');
    const sticks = bot.inventory.count('stick');
    return ironIngots >= 3 && sticks >= 2;
  }
});
```

---

### Example 4: Timeout Handling

```javascript
// Task with 30 second timeout
bot.taskQueue.addTask({
  name: 'Long pathfinding',
  timeout: 30000, // 30 seconds
  execute: async (bot) => {
    await bot.pathfindingUtil.goto({ x: 1000, y: 64, z: 1000 });
  }
});

// Listen for failures
bot.taskQueue.on('taskFailed', ({ task, error }) => {
  if (error.message.includes('timeout')) {
    console.log(`Task "${task.name}" timed out!`);
  }
});
```

---

### Example 5: Fluent API

```javascript
// Build complex task with fluent API
const taskId = bot.taskQueue.createTask()
  .name('Emergency deposit sequence')
  .priority(100) // Critical priority
  .timeout(60000)
  .metadata({ 
    reason: 'inventory full',
    timestamp: Date.now() 
  })
  .execute(async (bot) => {
    // Stop all work
    if (bot.behaviors.mining.isWorking) {
      bot.behaviors.mining.stopMining();
    }
    
    // Find chest
    const chest = await bot.depositBehavior.findNearestChest(32);
    if (!chest) throw new Error('No chest found');
    
    // Deposit all items
    await bot.depositBehavior.depositToChest(chest);
    
    return { itemsDeposited: true, chest: chest.position };
  })
  .canExecute(async () => {
    return bot.inventory.emptySlotCount() < 3;
  })
  .add();

console.log(`Emergency deposit task queued: ${taskId}`);
```

---

## Best Practices

### 1. Use Descriptive Names
```javascript
// ❌ Bad
bot.taskQueue.addTask({ name: 'Task 1', execute: /* ... */ });

// ✅ Good
bot.taskQueue.addTask({ name: 'Mine diamond vein at cave entrance', execute: /* ... */ });
```

### 2. Set Appropriate Priorities
```javascript
// Critical operations = high priority
bot.taskQueue.addTask({ name: 'Emergency deposit', priority: 100, /* ... */ });

// Normal operations = default priority
bot.taskQueue.addTask({ name: 'Collect drops', priority: 0, /* ... */ });

// Background tasks = negative priority
bot.taskQueue.addTask({ name: 'Organize inventory', priority: -10, /* ... */ });
```

### 3. Use canExecute for Preconditions
```javascript
bot.taskQueue.addTask({
  name: 'Mine with pickaxe',
  execute: async (bot) => { /* ... */ },
  canExecute: async () => {
    // Check preconditions before executing
    return bot.toolHandler.hasTool('pickaxe') && 
           bot.entity.food > 10;
  }
});
```

### 4. Set Timeouts for Long Operations
```javascript
bot.taskQueue.addTask({
  name: 'Long distance travel',
  timeout: 120000, // 2 minute timeout
  execute: async (bot) => { /* ... */ }
});
```

### 5. Handle Events for Monitoring
```javascript
// Monitor queue health
bot.taskQueue.on('taskFailed', ({ task, error }) => {
  console.error(`FAILED: ${task.name}`, error);
  // Send alert, retry, or take corrective action
});

bot.taskQueue.on('queueEmpty', () => {
  // Queue complete - return to idle state
  console.log('All tasks complete, returning to idle');
});
```

### 6. Use Metadata for Context
```javascript
bot.taskQueue.addTask({
  name: 'Mine ore vein',
  metadata: {
    oreType: 'diamond',
    veinSize: 8,
    location: { x: 100, y: 12, z: 100 },
    initiator: 'RogueZ3phyr'
  },
  execute: async (bot) => { /* ... */ }
});
```

### 7. Clean Up on Stop
```javascript
// Stop all behaviors when queue stops
bot.taskQueue.on('queueEmpty', () => {
  if (bot.behaviors.mining.isWorking) {
    bot.behaviors.mining.stopMining();
  }
});
```

---

## Commands

The TaskQueue can be controlled via in-game commands:

### `!task status`
Show current task and queue status.

**Example:**
```
> !task status
Queue Status: Processing
Current Task: Mine diamond vein (ID: 5, running for 12s)
Queue Length: 3 pending tasks
```

---

### `!task list`
List all tasks in queue with priorities.

**Example:**
```
> !task list
=== Task Queue (4 tasks) ===
[RUNNING] #5: Mine diamond vein (Priority: 10, 12s)
[PENDING] #6: Deposit items (Priority: 5)
[PENDING] #7: Return home (Priority: 0)
[PENDING] #8: Collect drops (Priority: 0)
```

---

### `!task stats`
Show queue statistics.

**Example:**
```
> !task stats
=== Task Statistics ===
Completed: 142
Failed: 3
Skipped: 5
Success Rate: 97.9%
Avg Execution Time: 8.3s
Uptime: 2h 15m
```

---

### `!task pause`
Pause queue execution.

**Example:**
```
> !task pause
Queue paused (current task will complete)
```

---

### `!task resume`
Resume queue execution.

**Example:**
```
> !task resume
Queue resumed
```

---

### `!task clear`
Clear all pending tasks.

**Example:**
```
> !task clear
Cleared 5 tasks from queue
```

---

### `!task remove <id>`
Remove specific task by ID.

**Example:**
```
> !task remove 7
Task #7 removed from queue
```

---

## Advanced Usage

### Chaining Tasks

```javascript
function createTaskChain(steps) {
  const taskIds = [];
  
  steps.forEach((step, index) => {
    const taskId = bot.taskQueue.addTask({
      name: step.name,
      priority: steps.length - index, // Higher priority for earlier steps
      execute: step.execute,
      canExecute: async () => {
        // Check if previous tasks completed
        if (index === 0) return true;
        const prevTask = bot.taskQueue.getTask(taskIds[index - 1]);
        return prevTask && prevTask.status === 'completed';
      }
    });
    taskIds.push(taskId);
  });
  
  return taskIds;
}

// Usage
createTaskChain([
  { name: 'Step 1', execute: async (bot) => { /* ... */ } },
  { name: 'Step 2', execute: async (bot) => { /* ... */ } },
  { name: 'Step 3', execute: async (bot) => { /* ... */ } }
]);
```

---

### Dynamic Task Generation

```javascript
// Generate tasks based on world state
function queueDynamicTasks(bot) {
  const nearbyOres = bot.findBlocks({
    matching: (block) => bot.oreScanner.isOre(block.name),
    maxDistance: 32,
    count: 10
  });
  
  nearbyOres.forEach((pos, index) => {
    bot.taskQueue.addTask({
      name: `Mine ore at ${pos}`,
      priority: 10 - index, // Closer ores have higher priority
      execute: async (bot) => {
        await bot.behaviors.mining.mineVeinAt(pos);
      }
    });
  });
}
```

---

## Integration with Other Systems

### With Mining Behavior

```javascript
// Use task queue for complex mining operations
bot.taskQueue.addTask({
  name: 'Complete mining session',
  priority: 1,
  execute: async (bot) => {
    await bot.behaviors.mining.startStripMining(/* ... */);
  }
});
```

### With Multi-Bot Coordination

```javascript
// Coordinate multiple bots via shared task system
bot.coordinator.assignTask(botName, {
  name: 'Bot-specific mining',
  execute: async (bot) => {
    const zone = bot.coordinator.getAssignedZone(bot.username);
    await bot.behaviors.mining.startQuarry(zone.corner1, zone.corner2, 10);
  }
});
```

---

## Troubleshooting

### Queue Not Processing

**Check if queue is paused:**
```javascript
const status = bot.taskQueue.getStatus();
if (status.isPaused) {
  bot.taskQueue.resume();
}
```

### Tasks Failing

**Listen for failures:**
```javascript
bot.taskQueue.on('taskFailed', ({ task, error }) => {
  console.error(`Task "${task.name}" failed:`, error);
  // Debug: Check task configuration
  console.log('Task config:', task);
});
```

### Tasks Stuck

**Check current task:**
```javascript
const status = bot.taskQueue.getStatus();
if (status.currentTask) {
  console.log('Current task:', status.currentTask);
  console.log('Running for:', Date.now() - status.currentTask.startedAt, 'ms');
  
  // Consider adding timeout if missing
  if (!status.currentTask.timeout) {
    console.warn('Task has no timeout - might run forever!');
  }
}
```

---

## Performance Tips

1. **Limit Queue Size** - Don't queue thousands of tasks at once
2. **Use Timeouts** - Always set timeouts for long-running tasks
3. **Batch Operations** - Group similar tasks to reduce overhead
4. **Monitor Statistics** - Check success rate and execution times
5. **Clean Up Events** - Unregister event handlers when not needed

---

## See Also

- [Command Reference](COMMAND_REFERENCE.md) - All bot commands including task commands
- [Mining Behavior](MINING.md) - Mining operations that can be queued
- [Pathfinding](PATHFINDING.md) - Pathfinding operations that can be queued
- [Overview](OVERVIEW.md) - General bot architecture and systems

---

**Version:** 2.3.0  
**Last Updated:** January 2025
