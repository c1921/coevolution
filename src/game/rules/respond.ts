import { defendNeedAgainst } from '../skills'
import type { GameState, PlayerIndex, VirtualCard } from '../types'

/**
 * 使用【打击】：把打击牌压入结算帧。
 * 调用方需先把该牌移入手牌 → 处理区。
 * need 由威压决定（1 或 2），结算收尾时 spent 中的牌从处理区进入弃牌堆。
 */
export function pushStrike(
  state: GameState,
  source: PlayerIndex,
  target: PlayerIndex,
  card: VirtualCard,
): void {
  state.stack.push({
    kind: 'strike',
    source,
    target,
    card,
    need: defendNeedAgainst(state, source),
    got: 0,
    spent: [card.source],
  })
}
