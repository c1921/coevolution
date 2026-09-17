import { CARD_NAME } from '../data/cardDefs'
import { skillDef } from '../data/species'
import { activeOptions, playOptions, strikeLimit, useOptions } from '../skills'
import type { SkillId } from '../types'
import { findInHand } from './cardZones'
import type { Card, CardKind, GameState, PlayerIndex } from '../types'
import { otherPlayer, RuleError } from '../util'
import { isInRange } from './distance'
import { cardUseCount } from './usage'

export type Legality = { ok: true } | { ok: false; reason: string }

export const OK: Legality = { ok: true }

export function fail(reason: string): Legality {
  return { ok: false, reason }
}

/** 合法性不通过时抛出规则错误；调用方保证此时状态尚未被修改 */
export function ensure(legality: Legality): void {
  if (!legality.ok) throw new RuleError(legality.reason)
}

interface CardOptionLike {
  as: CardKind
  via?: SkillId
}

function matchesOption(
  options: CardOptionLike[],
  as: CardKind,
  via?: SkillId,
): boolean {
  return options.some((o) => o.as === as && o.via === via)
}

function describeBadOption(card: Card, as: CardKind, via?: SkillId): string {
  if (via) {
    return `无法发动【${skillDef(via).name}】将【${CARD_NAME[card.kind]}】当【${CARD_NAME[as]}】使用`
  }
  return `无法将【${CARD_NAME[card.kind]}】当【${CARD_NAME[as]}】使用`
}

/** 使用一张牌：出牌阶段主动使用，或濒死结算中使用【回复】 */
export function checkUseCard(
  state: GameState,
  p: PlayerIndex,
  card: Card,
  as: CardKind,
  via?: SkillId,
): Legality {
  const pending = state.pending
  const player = state.players[p]
  if (!pending) return fail('当前没有需要你操作的事项')
  if (!player.alive) return fail('你已阵亡，无法行动')

  if (pending.kind === 'play') {
    if (pending.player !== p) return fail('现在不是你的出牌阶段')
    if (state.phase !== 'play' || state.active !== p) return fail('现在不是你的出牌阶段')
    if (as === 'defend') return fail('【防御】只能在响应【打击】时打出')
    if (!findInHand(state, p, card.uid)) return fail('这张牌不在你的手牌中')
    if (!matchesOption(useOptions(state, p, card), as, via)) {
      return fail(describeBadOption(card, as, via))
    }

    if (as === 'strike') {
      // 使用次数上限：默认每回合一张【打击】，【怒吼】改为无限制
      if (cardUseCount(state, p, 'strike') >= strikeLimit(state, p)) {
        return fail('本回合你已经使用过【打击】了')
      }
      const target = otherPlayer(p)
      if (!state.players[target].alive) return fail('对方已阵亡')
      if (!isInRange(p, target)) return fail('对方不在你的攻击范围内')
    }

    if (as === 'heal' && player.hp >= player.maxHp) {
      return fail('你的体力已满，无法使用【回复】')
    }

    return OK
  }

  if (pending.kind === 'dying') {
    if (pending.player !== p) return fail('现在不是你的响应时机')
    if (as !== 'heal') return fail('濒死结算中只能使用【回复】')
    if (state.players[pending.dying].hp > 0) return fail('濒死结算已经结束')
    if (!findInHand(state, p, card.uid)) return fail('这张牌不在你的手牌中')
    if (!matchesOption(useOptions(state, p, card), as, via)) {
      return fail(describeBadOption(card, as, via))
    }
    return OK
  }

  return fail('当前不是使用牌的时机')
}

/** 打出【防御】以响应【打击】 */
export function checkPlayCardAsDefend(
  state: GameState,
  p: PlayerIndex,
  card: Card,
  as: CardKind,
  via?: SkillId,
): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'respond') {
    return fail('当前不是打出【防御】的时机')
  }
  if (pending.player !== p) return fail('现在不是你的响应时机')
  if (as !== 'defend') return fail('响应【打击】时只能打出【防御】')
  if (!state.players[p].alive) return fail('你已阵亡，无法行动')
  if (!findInHand(state, p, card.uid)) return fail('这张牌不在你的手牌中')
  if (!matchesOption(playOptions(state, p, card), as, via)) {
    return fail(describeBadOption(card, as, via))
  }
  return OK
}

/** 发动主动技：透支 / 疗愈 */
export function checkActivate(
  state: GameState,
  p: PlayerIndex,
  skill: SkillId,
  cards: Card[] | undefined,
  target: PlayerIndex | undefined,
): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'play' || pending.player !== p) {
    return fail('现在不是你的出牌阶段')
  }
  if (state.phase !== 'play' || state.active !== p) return fail('现在不是你的出牌阶段')
  if (!state.players[p].alive) return fail('你已阵亡，无法行动')
  if (!activeOptions(state, p).includes(skill)) {
    return fail(`当前无法发动【${skillDef(skill).name}】`)
  }

  if (skill === 'overexert') return OK

  if (skill === 'mend') {
    const discard = cards ?? []
    const card = discard[0]
    if (discard.length !== 1 || !card) return fail('疗愈需要弃置一张手牌')
    if (!findInHand(state, p, card.uid)) return fail('用于弃置的牌不在你的手牌中')
    const targetIndex = target ?? p
    const targetPlayer = state.players[targetIndex]
    if (!targetPlayer.alive) return fail('目标角色已阵亡')
    if (targetPlayer.hp >= targetPlayer.maxHp) return fail('目标角色体力已满，无法回复')
    return OK
  }

  return fail(`【${skillDef(skill).name}】无法主动发动`)
}

/** 弃牌阶段弃置手牌 */
export function checkDiscard(
  state: GameState,
  p: PlayerIndex,
  cards: Card[],
): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'discard') return fail('当前不是弃牌阶段')
  if (pending.player !== p) return fail('现在不是你的弃牌阶段')
  if (cards.length !== pending.count) {
    return fail(`需要弃置 ${pending.count} 张手牌`)
  }
  if (new Set(cards.map((c) => c.uid)).size !== cards.length) {
    return fail('弃置的牌中有重复')
  }
  for (const card of cards) {
    if (!findInHand(state, p, card.uid)) return fail('弃置的牌不在你的手牌中')
  }
  return OK
}

/** 结束出牌阶段 */
export function checkEndPhase(state: GameState, p: PlayerIndex): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'play' || pending.player !== p) {
    return fail('现在不是你的出牌阶段')
  }
  return OK
}

/** 可选发动技能的应答 */
export function checkTriggerChoice(state: GameState, p: PlayerIndex): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'trigger') return fail('当前没有待应答的技能')
  if (pending.player !== p) return fail('现在不是你的应答时机')
  return OK
}
