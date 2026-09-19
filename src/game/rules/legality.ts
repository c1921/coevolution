import { CARD_NAME } from '../data/cardDefs'
import { skillDef } from '../data/species'
import { firstFailed } from '../dsl/condition'
import type { UseContext } from '../dsl/kinds'
import { cardDoc, skillDoc } from '../dsl/registry'
import type { EffectContext, EvalEnv } from '../dsl/runtime'
import { resolveTargetChoice, resolveTargetChoices } from '../dsl/target'
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
import {
  canRemove,
  findOwnCard,
  removeCandidates,
  serviceOptions,
  upgradeCandidates,
} from './reward'
import type { Card, CardKind, Frame, GameState, PlayerIndex } from '../types'
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

function matchesOption(options: CardOptionLike[], as: CardKind, via?: SkillId): boolean {
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
  targets?: PlayerIndex[],
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

  const provided = targets && targets.length > 0 ? targets : undefined
  if (provided !== undefined && !variant.target) {
    return fail(`【${CARD_NAME[as]}】不需要指定目标`)
  }
  if (
    pending.kind === 'dying' &&
    provided !== undefined &&
    !(provided.length === 1 && provided[0] === pending.dying)
  ) {
    return fail('濒死结算的目标必须是濒死者')
  }

  const ctx: EffectContext = { self: p, active: state.active, usedUid: card.uid, costCards: [] }
  if (pending.kind === 'dying') {
    ctx.dying = pending.dying
    ctx.target = pending.dying
  }
  const env: EvalEnv = { state, ctx }

  if (variant.target) {
    // 濒死语境的目标由结算决定（濒死者），其余语境用提交的目标或文档缺省目标
    const chosen = pending.kind === 'dying' ? [pending.dying] : provided
    const resolved = resolveTargetChoices(env, variant.target, chosen)
    if (!resolved.ok) return fail(resolved.reason)
    ctx.targets = resolved.targets
    if (resolved.targets.length === 1) ctx.target = resolved.targets[0]
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
 * 需要先弃置手牌的技能（如强袭）走 costCards，目标与前置条件全部来自文档。
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
  const env = {
    state,
    ctx: { self: p, active: state.active, costCards: provided.map((c) => c.uid) },
  }
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
export function checkDiscard(state: GameState, p: PlayerIndex, cards: Card[]): Legality {
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

/* ------------------------------------------------------------------ 奖励 */

/** 栈顶的奖励帧（没有则返回 undefined） */
function rewardFrameOf(state: GameState): Extract<Frame, { kind: 'reward' }> | undefined {
  const top = state.stack[state.stack.length - 1]
  return top && top.kind === 'reward' ? top : undefined
}

/**
 * 提交奖励选择（卡牌奖励给 `card`，服务奖励给 `service`）。
 *
 * 这里是奖励的**唯一合法性入口**：候选内、可用性（满血不能回复、无牌可升、
 * 移除后不足下限）都在这里判，错误信息就是文档给出的 reason。
 * prompt 与提交用的是同一份候选（`pick-card` 的 candidates 也是现算的）。
 */
export function checkPickReward(
  state: GameState,
  p: PlayerIndex,
  choice: { card?: CardKind; service?: 'upgrade' | 'remove' | 'heal' },
): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'reward') return fail('当前没有待选择的奖励')
  if (pending.player !== p) return fail('现在不是你的奖励选择时机')
  const frame = rewardFrameOf(state)
  if (!frame) return fail('结算栈异常：缺少奖励结算帧')

  if (frame.reward === 'card') {
    if (choice.service !== undefined) return fail('这是卡牌奖励，请选择一张候选牌')
    const cards = frame.cards ?? []
    if (cards.length === 0) return fail('本次奖励没有可选的牌')
    if (choice.card === undefined || !cards.includes(choice.card)) {
      return fail('这张牌不在本次奖励候选中')
    }
    return OK
  }

  if (choice.card !== undefined) return fail('这是服务奖励，请选择升级 / 移除 / 回复')
  const available = serviceOptions(state, p, frame)
  switch (choice.service) {
    case 'heal':
      if (!available.heal) return fail('你的体力已满，无法回复')
      return OK
    case 'upgrade':
      if (!available.upgrade) return fail('你没有可以升级的牌')
      return OK
    case 'remove':
      if (!available.remove) {
        return fail(`移除后牌组、手牌与弃牌堆不得少于 ${frame.removeFloor} 张`)
      }
      return OK
    default:
      return fail('请选择升级 / 移除 / 回复')
  }
}

/** 跳过卡牌奖励：只有允许跳过的卡牌奖励才能跳过 */
export function checkSkipReward(state: GameState, p: PlayerIndex): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'reward') return fail('当前没有待选择的奖励')
  if (pending.player !== p) return fail('现在不是你的奖励选择时机')
  const frame = rewardFrameOf(state)
  if (!frame || frame.reward !== 'card') return fail('服务奖励不能跳过')
  if (!frame.allowSkip) return fail('本次奖励不能跳过')
  return OK
}

/**
 * 升级 / 移除服务的选牌：
 *  - 升级要求目标牌在当前注册表里有 `upgradeTo`；
 *  - 移除要求移除后「牌组 + 手牌 + 弃牌堆」不少于 `removeFloor`。
 */
export function checkPickOwnCard(state: GameState, p: PlayerIndex, card: Card): Legality {
  const pending = state.pending
  if (!pending || pending.kind !== 'pick-card') return fail('当前没有待选牌的奖励')
  if (pending.player !== p) return fail('现在不是你的选牌时机')
  const frame = rewardFrameOf(state)
  const pick = frame?.pendingPick
  if (!frame || !pick || pick.player !== p) return fail('结算栈异常：缺少待选牌的奖励')

  const real = findOwnCard(state, p, card.uid)
  if (!real) return fail('这张牌不在你的牌组、手牌或弃牌堆中')

  if (pick.purpose === 'upgrade') {
    if (cardDoc(real.kind).upgradeTo === undefined) {
      return fail(`【${CARD_NAME[real.kind]}】没有可升级的版本`)
    }
    if (!upgradeCandidates(state, p).some((item) => item.uid === real.uid)) {
      return fail('这张牌不在可升级的候选中')
    }
    return OK
  }

  if (!removeCandidates(state, p).some((item) => item.uid === real.uid)) {
    return fail('这张牌不在可移除的候选中')
  }
  if (!canRemove(state, p, frame.removeFloor)) {
    return fail(`移除后牌组、手牌与弃牌堆不得少于 ${frame.removeFloor} 张`)
  }
  return OK
}
