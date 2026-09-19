import { CARD_NAME } from '../data/cardDefs'
import { skillDef } from '../data/species'
import { firstFailed } from '../dsl/condition'
import type { UseContext } from '../dsl/kinds'
import { cardDoc, skillDoc } from '../dsl/registry'
import type { EffectContext, EvalEnv } from '../dsl/runtime'
import { resolveTargetChoice } from '../dsl/target'
import {
  activationCostCards,
  activationTargetChoice,
  activeOptions,
  dyingUsableLabel,
  playOptions,
  useDeniedReason,
  useOptions,
  useVariantOf,
} from '../skills'
import type { SkillId } from '../types'
import { findInHand } from './cardZones'
import type { Card, CardKind, GameState, PlayerIndex } from '../types'
import { RuleError } from '../util'
import { canPayEnergy, shortfallReason } from './energy'

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

/**
 * 使用一张牌：出牌阶段主动使用，或濒死结算中使用【回复】。
 *
 * 语境、目标、前置条件、费用全部来自卡牌文档的 use 变体：
 *  - 该语境没有对应变体（例如出牌阶段用【防御】、濒死时用【打击】）直接拒绝，
 *    并用文档结构派生的说明告诉玩家什么时候能用；
 *  - target 决定目标（打击=对手、回复=自己或濒死者），requires 里的 reason 直接作为报错。
 */
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
  } else if (pending.kind === 'dying') {
    if (pending.player !== p) return fail('现在不是你的响应时机')
    if (state.players[pending.dying].hp > 0) return fail('濒死结算已经结束')
  } else {
    return fail('当前不是使用牌的时机')
  }

  if (!findInHand(state, p, card.uid)) return fail('这张牌不在你的手牌中')

  // 先看该语境有没有这个牌面的用法（报错更贴近玩家意图：什么时候能用），再看是否可以转化
  const context: UseContext = pending.kind === 'dying' ? 'dying' : 'play'
  const variant = useVariantOf(as, context)
  if (!variant) {
    return fail(
      context === 'dying' ? `濒死结算中只能使用${dyingUsableLabel()}` : useDeniedReason(as, 'play'),
    )
  }
  if (!matchesOption(useOptions(state, p, card), as, via)) {
    return fail(describeBadOption(card, as, via))
  }

  // 所有「使用」都要按「当作的牌面」付费，付不起就不能用
  if (!canPayEnergy(state, p, as)) return fail(shortfallReason(state, p, as))

  const ctx: EffectContext = { self: p, active: state.active, usedUid: card.uid, costCards: [] }
  if (pending.kind === 'dying') {
    ctx.dying = pending.dying
    ctx.target = pending.dying
  }
  const env: EvalEnv = { state, ctx }

  if (variant.target) {
    const chosen = pending.kind === 'dying' ? pending.dying : undefined
    const resolved = resolveTargetChoice(env, variant.target, chosen)
    if (!resolved.ok) return fail(resolved.reason)
    ctx.target = resolved.target
  }
  const failed = firstFailed(env, variant.requires)
  if (failed) return fail(failed.reason ?? `【${CARD_NAME[as]}】当前无法使用`)

  return OK
}

/** 打出响应牌（默认是【防御】）以抵消对抗 */
export function checkPlayCardAsDefend(
  state: GameState,
  p: PlayerIndex,
  card: Card,
  as: CardKind,
  via?: SkillId,
): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'respond') {
    return fail('当前不是打出响应牌的时机')
  }
  if (pending.player !== p) return fail('现在不是你的响应时机')
  if (!state.players[p].alive) return fail('你已阵亡，无法行动')

  if (as !== pending.expected) {
    const opener = pending.card?.as ?? pending.expected
    return fail(`响应【${CARD_NAME[opener]}】时只能打出【${CARD_NAME[pending.expected]}】`)
  }
  if (!findInHand(state, p, card.uid)) return fail('这张牌不在你的手牌中')
  if (!matchesOption(playOptions(state, p, card), as, via)) {
    return fail(describeBadOption(card, as, via))
  }

  const variant = cardDoc(as).play
  if (!variant) return fail(`【${CARD_NAME[as]}】不能作为响应打出`)

  // 响应也要付能量：能量不足时只能放弃响应
  if (!canPayEnergy(state, p, as)) return fail(shortfallReason(state, p, as))

  const env: EvalEnv = {
    state,
    ctx: { self: p, active: state.active, source: pending.source, costCards: [] },
  }
  const failed = firstFailed(env, variant.requires)
  if (failed) return fail(failed.reason ?? `【${CARD_NAME[as]}】当前无法打出`)

  return OK
}

/**
 * 发动主动技。技能不是「使用一张牌」，因此不消耗能量；
 * 需要先弃置手牌的技能（疗愈）走 costCards，目标与前置条件全部来自文档。
 */
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

  const name = skillDef(skill).name
  const activate = skillDoc(skill).activate
  if (!activate) return fail(`【${name}】无法主动发动`)
  if (!activeOptions(state, p).includes(skill)) return fail(`当前无法发动【${name}】`)

  const provided = cards ?? []
  const env = { state, ctx: { self: p, active: state.active, costCards: provided.map((c) => c.uid) } }
  const need = activationCostCards(state, p, skill)
  if (provided.length !== need) {
    return fail(need === 0 ? `【${name}】不需要弃置手牌` : `【${name}】需要弃置 ${need} 张手牌`)
  }
  if (new Set(provided.map((card) => card.uid)).size !== provided.length) {
    return fail('费用牌中有重复')
  }
  for (const card of provided) {
    if (!findInHand(state, p, card.uid)) return fail('用于弃置的牌不在你的手牌中')
  }

  if (activate.target) {
    const choice = activationTargetChoice(state, p, skill)
    if (!choice?.spec) return fail(`当前无法发动【${name}】`)
    // 必须选目标却没给：给玩家一句能照做的提示，而不是缺省目标的条件原因
    if (target === undefined && choice.mustChoose) {
      return fail(`【${name}】需要指定一个目标`)
    }
    const resolved = resolveTargetChoice(env, choice.spec, target)
    if (!resolved.ok) return fail(resolved.reason)
    // 用最终目标重算 requires：可用（activeOptions 用了存在性目标）⟺ 提交必成功
    const scoped: EvalEnv = { state, ctx: { ...env.ctx, target: resolved.target } }
    const failed = firstFailed(scoped, activate.requires)
    if (failed) return fail(failed.reason ?? `当前无法发动【${name}】`)
  }

  return OK
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
