import { log, playerLabel } from '../log'
import type { GameState, PlayerIndex } from '../types'
import { otherPlayer } from '../util'

/**
 * 死亡结算：标记阵亡 → 弃置全部手牌 → 清空结算栈 → 判定胜负。
 * 本作是单将决胜的 1v1，因此任何一方阵亡即终局。
 */
export function killPlayer(state: GameState, p: PlayerIndex): void {
  const player = state.players[p]
  if (!player.alive) return

  player.alive = false
  if (player.hp > 0) player.hp = 0
  log(state, `${playerLabel(state, p)} 阵亡`)

  if (player.hand.length > 0) {
    const count = player.hand.length
    state.discard.push(...player.hand)
    player.hand = []
    log(state, `${playerLabel(state, p)} 弃置了 ${count} 张手牌`)
  }

  // 结算栈与处理区一并清空：未收尾的牌直接进弃牌堆
  state.stack = []
  state.pending = null
  if (state.processing.length > 0) {
    state.discard.push(...state.processing)
    state.processing = []
  }

  const winner = otherPlayer(p)
  state.result = { winner }
  state.phase = 'game-over'
  log(state, `${playerLabel(state, winner)} 获胜！`)
}
