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
  // 阵亡者的未结算威胁随死亡消失（对局随即终局，不会再有属于他的回合结束时）
  player.threat = 0
  log(state, `${playerLabel(state, p)} 阵亡`)

  if (player.hand.length > 0) {
    const count = player.hand.length
    player.discard.push(...player.hand)
    player.hand = []
    log(state, `${playerLabel(state, p)} 弃置了 ${count} 张手牌`)
  }

  // 结算栈与处理区一并清空：未收尾的牌按归属直接进各自的弃牌堆
  state.stack = []
  state.pending = null
  if (state.processing.length > 0) {
    for (const entry of state.processing) {
      state.players[entry.owner].discard.push(entry.card)
    }
    state.processing = []
  }

  const winner = otherPlayer(p)
  state.result = { winner }
  state.phase = 'game-over'
  log(state, `${playerLabel(state, winner)} 获胜！`)
}
