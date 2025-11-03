//import { pathfinder, Movements, goals } from 'mineflayer-pathfinder'
import pkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkg;
const { GoalNear, GoalBlock, GoalFollow } = goals

export class PathfinderBehavior {
  constructor(bot) {
    this.bot = bot
    this.defaultMovements = null
  }

  initialize() {
    this.bot.loadPlugin(pathfinder)
    this.defaultMovements = new Movements(this.bot, this.bot.registry)
  }

  goTo(x, y, z) {
    const goal = new GoalBlock(x, y, z)
    this.bot.pathfinder.setMovements(this.defaultMovements)
    this.bot.pathfinder.setGoal(goal)
  }

  followPlayer(playerName) {
    const player = this.bot.players[playerName]?.entity
    if (!player) {
      this.bot.chat(`I can’t see ${playerName}.`)
      return
    }
    const goal = new GoalFollow(player, 2)
    this.bot.pathfinder.setMovements(this.defaultMovements)
    this.bot.pathfinder.setGoal(goal, true)
  }

  comeTo(senderName) {
    const player = this.bot.players[senderName]?.entity
    if (!player) {
      this.bot.chat(`I can’t find ${senderName}.`)
      return
    }
    const goal = new GoalNear(player.position.x, player.position.y, player.position.z, 2)
    this.bot.pathfinder.setMovements(this.defaultMovements)
    this.bot.pathfinder.setGoal(goal)
  }

  stop() {
    this.bot.pathfinder.stop()
    this.bot.chat('Stopped moving.')
  }
}
