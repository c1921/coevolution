import { log, plainLabel, playerLabel } from '../log'
import type { Card, GameState, PlayerIndex } from '../types'
import { moveHandToDiscard } from './cardZones'

/**
 * 把若干手牌弃置进自己的弃牌堆，并记一条战报。
 *
 * 两处共用同一份落库逻辑：
 *  - 玩家 / AI 提交的弃牌动作（`engine/actions.ts` 的 `applyDiscard`）；
 *  - 手牌上限为 0 时弃牌阶段的**自动弃置**（此时没有可选择的余地，不需要询问）。
 */
export function discardHandCards(state: GameState, p: PlayerIndex, cards: readonly Card[]): void {
  const names: string[] = []
  for (const card of cards) {
    moveHandToDiscard(state, p, card)
    names.push(plainLabel(card))
  }
  log(state, `${playerLabel(state, p)} 弃置了 ${cards.length} 张手牌：${names.join('、')}`)
}
