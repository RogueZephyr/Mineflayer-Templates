// src/behaviors/SleepBehavior.js
import pkg from 'mineflayer-pathfinder';
const { goals, Movements } = pkg;
const { GoalNear } = goals;
import BedRegistry from '../state/BedRegistry.js';

export default class SleepBehavior {
  constructor(bot, mcData, logger, config = {}, behaviors = {}) {
    this.bot = bot;
    this.mcData = mcData;
    this.logger = logger;
    this.enabled = true;
    this.sleeping = false;
    this.movingToBed = false;
    this.bedColor = config.bedColor || 'red';
    this.bedPos = null;

    // Optional behaviors, e.g., LookBehavior
    this.behaviors = behaviors;
    this.lookBehavior = behaviors.look;
  }

  disable() { this.enabled = false; }
  enable() { this.enabled = true; }

  async sleep() {
    if (!this.enabled || this.sleeping || this.movingToBed) return;
    if (!this.bot.isAlive) return;

    this.movingToBed = true;

    let lookWasEnabled = false;
    if (this.lookBehavior && this.lookBehavior.enabled) {
      lookWasEnabled = true;
      this.lookBehavior.disable(); // disable LookBehavior while sleeping
    }

    try {
      this.bedPos = await this.findAvailableBed();
      if (!this.bedPos) {
        this.logger.warn(`[ManualSleep] No ${this.bedColor} bed available!`);
        return;
      }

      const bedBlock = this.bot.blockAt(this.bedPos);
      if (!bedBlock) throw new Error('Bed block no longer exists!');

      // Stop any ongoing movement
      if (this.bot.pathfindingUtil) {
        this.bot.pathfindingUtil.stop();
      } else if (this.bot.pathfinder) {
        this.bot.pathfinder.setGoal(null);
      }

      // Set proper movements
      const defaultMovements = new Movements(this.bot, this.mcData);
      this.bot.pathfinder.setMovements(defaultMovements);

      // Walk to bed
      if (this.bot.pathfindingUtil) {
        await this.bot.pathfindingUtil.gotoBlock(this.bedPos, 30000, 'sleep');
      } else {
        const goal = new GoalNear(this.bedPos.x, this.bedPos.y, this.bedPos.z, 1);
        await this.bot.pathfinder.goto(goal);
      }

      // Attempt to sleep
      await this.bot.sleep(bedBlock);
      this.sleeping = true;
      this.logger.success(`[ManualSleep] Bot is now sleeping at ${this.bedPos.x},${this.bedPos.y},${this.bedPos.z}`);

      // Handle wake
      this.bot.once('wake', () => this.onWake());
    } catch (err) {
      this.logger.error(`[ManualSleep] Failed to sleep: ${err.message}`);
      if (this.bedPos) BedRegistry.release(BedRegistry.toKey(this.bedPos));
      this.bedPos = null;
    } finally {
      this.movingToBed = false;
      // Leave LookBehavior disabled while sleeping, will re-enable on wake
      if (!this.sleeping && lookWasEnabled) {
        this.lookBehavior.enable();
      }
    }
  }

  async findAvailableBed() {
    const bedRegex = new RegExp(`${this.bedColor}_bed$`);
    const bedBlocks = this.bot.findBlocks({
      matching: (block) => bedRegex.test(block.name),
      maxDistance: 32,
      count: 10
    });

    for (const pos of bedBlocks) {
      const key = BedRegistry.toKey(pos);
      if (BedRegistry.claim(key)) {
        this.logger.info(`[ManualSleep] Claimed bed at ${key}`);
        return pos;
      }
    }
    return null;
  }

  onWake() {
    this.sleeping = false;
    if (this.bedPos) {
      BedRegistry.release(BedRegistry.toKey(this.bedPos));
      this.logger.info(`[ManualSleep] Released bed at ${BedRegistry.toKey(this.bedPos)}`);
      this.bedPos = null;
    }

    // Re-enable LookBehavior after waking
    if (this.lookBehavior) {
      this.lookBehavior.enable();
    }
  }
}
