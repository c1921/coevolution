import type { Effect } from '../dsl/types'
import { defendNeedAgainst } from '../skills'
import type { GameState, PlayerIndex, VirtualCard } from '../types'

/**
 * 开启一次「攻击 → 响应」对抗：把对抗帧压入结算栈。
 * 调用方需先把攻击牌移入手牌 → 处理区。
 *
 * need 由 defend-need-against 通道决定（威压为 2）；结算收尾时 spent 中的牌从处理区
 * 进入**各自的**弃牌堆（攻击牌归使用者、响应牌归响应者），因此 spent 记录每张牌的归属。
 * 未抵消时执行 onUnmet 里的效果（当前由调用方给出，S8 起改由卡牌文档的 contest 指令给出）。
 */
export function pushStrike(
  state: GameState,
  source: PlayerIndex,
  target: PlayerIndex,
  card: VirtualCard,
  onUnmet: readonly Effect[],
): void {
  state.stack.push({
    kind: 'contest',
    source,
    target,
    card,
    openedBy: card.as,
    // S8：expected 与 onUnmet 都改由 cards/strike.json 的 contest 指令提供
    expected: 'defend',
    need: defendNeedAgainst(state, source),
    got: 0,
    spent: [{ card: card.source, owner: source }],
    onUnmet: [...onUnmet],
    ctx: { self: source, active: state.active, target, source, usedCard: card, costCards: [] },
  })
}
