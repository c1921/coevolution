import { CARD_NAME } from '../data/cardDefs'
import { skillDef } from '../data/species'
import { runEffectGroup, runEffects } from '../dsl/effect'
import { runTrigger } from '../dsl/event'
import { cardDoc, skillDoc } from '../dsl/registry'
import type { EffectContext } from '../dsl/runtime'
import type { UseContext } from '../dsl/kinds'
import { resolveTargetChoice, resolveTargetChoices } from '../dsl/target'
import { log, playerLabel } from '../log'
import { findInHand } from '../rules/cardZones'
import { discardHandCards } from '../rules/discard'
import { payEnergy } from '../rules/energy'
import {
  checkActivate,
  checkDiscard,
  checkEndPhase,
  checkPickOwnCard,
  checkPickReward,
  checkPlayCardAsDefend,
  checkSkipReward,
  checkTriggerChoice,
  checkUseCard,
  ensure,
} from '../rules/legality'
import { finishPhaseBody } from '../rules/phase'
import { applyPickOwnCard, applyPickReward, applySkipReward } from '../rules/reward'
import { useVariantOf } from '../skills'
import type { Action, Card, CardKind, GameState, PlayerIndex, VirtualCard } from '../types'
import { RuleError } from '../util'

/**
 * 动作应用：把玩家/AI 提交的 `Action` 落到状态上。
 *
 * 每个 applier 的形状固定为 **校验 → 应用 → 交回回合循环**：
 *  - 校验一律走 `rules/legality.ts` 的 `check*`（与界面可用性判定同源），
 *    失败时抛 `RuleError` 且状态尚未被修改——这是"非法动作不改状态"的实现方式；
 *  - 应用只做"扣费用、绑上下文、执行文档里的效果"这三件事，
 *    引擎**不认识任何具体牌种/技能 id**（`guards.test.ts` 机械守卫）；
 *  - 阶段类动作（弃牌、结束出牌阶段）做完后调用 `finishPhaseBody`，
 *    把控制权交回回合循环去执行「阶段结束时」。
 */

/** 取出真正在手里的那张牌（防止用伪造的 uid 绕过手牌校验） */
function requireInHand(state: GameState, p: PlayerIndex, card: Card): Card {
  const real = findInHand(state, p, card.uid)
  if (!real) throw new RuleError('这张牌不在你的手牌中')
  return real
}

export function applyAction(state: GameState, action: Action): void {
  switch (action.kind) {
    case 'use-card':
      return applyUseCard(state, action)
    case 'play-card':
      return applyPlayCard(state, action)
    case 'activate':
      return applyActivate(state, action)
    case 'trigger-choice':
      return applyTriggerChoice(state, action)
    case 'discard-cards':
      return applyDiscard(state, action)
    case 'pick-reward':
      return applyPickRewardAction(state, action)
    case 'skip-reward':
      return applySkipRewardAction(state)
    case 'pick-own-card':
      return applyPickOwnCardAction(state, action)
    case 'end-phase':
      return applyEndPhase(state)
    case 'cancel':
      return applyCancel(state)
  }
}

/**
 * 使用一张牌：校验 → 付费 → 按卡牌文档的 use 变体执行效果。
 *
 * 变体的语境（出牌阶段 / 濒死）决定目标与效果；打击会由文档里的 contest 指令
 * 开启对抗帧，回复在濒死语境里带 resolve-dying 指令弹出濒死帧。
 * 引擎这里只负责"谁的牌、当作什么、上下文是谁"，不再判断具体牌种。
 */
function applyUseCard(state: GameState, action: Extract<Action, { kind: 'use-card' }>): void {
  const pending = state.pending
  if (!pending || (pending.kind !== 'play' && pending.kind !== 'dying')) {
    throw new RuleError('当前不是使用牌的时机')
  }
  const p = pending.player
  const as: CardKind = action.as ?? action.card.kind
  ensure(checkUseCard(state, p, action.card, as, action.via, action.targets))
  const card = requireInHand(state, p, action.card)
  // 付费按「当作的牌面」：转化牌付转化后那张牌的费用
  payEnergy(state, p, as)

  const context: UseContext = pending.kind === 'dying' ? 'dying' : 'play'
  const variant = useVariantOf(as, context)
  if (!variant) throw new RuleError(`【${CARD_NAME[as]}】没有「${context}」语境的用法`)

  const virtual: VirtualCard = action.via
    ? { as, source: card, via: action.via }
    : { as, source: card }
  const ctx: EffectContext = {
    self: p,
    active: state.active,
    usedUid: card.uid,
    usedCard: virtual,
    costCards: [],
  }
  if (pending.kind === 'dying') {
    ctx.dying = pending.dying
    ctx.target = pending.dying
    ctx.source = p
  }
  if (variant.target) {
    // 濒死语境的目标由结算决定（濒死者），其余语境用提交的目标或文档缺省目标
    const provided = action.targets && action.targets.length > 0 ? action.targets : undefined
    const chosen = pending.kind === 'dying' ? [pending.dying] : provided
    const resolved = resolveTargetChoices({ state, ctx }, variant.target, chosen)
    // checkUseCard 已经校验过，这里只是兜底：校验通过却解析失败说明调用点与文档不匹配
    if (!resolved.ok) throw new RuleError(resolved.reason)
    ctx.targets = resolved.targets
    // 多目标时不绑定 target：效果必须写在 for-each-target 内（加载期已守住）
    if (resolved.targets.length === 1) ctx.target = resolved.targets[0]
  }
  runEffectGroup(state, variant, ctx)
}

/** 打出响应牌抵消对抗：校验 → 付费 → 按文档的 play 变体执行效果，最后记录抵消进度 */
function applyPlayCard(state: GameState, action: Extract<Action, { kind: 'play-card' }>): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'respond') {
    throw new RuleError('当前不是打出响应牌的时机')
  }
  const p = pending.player
  const as: CardKind = action.as ?? action.card.kind
  ensure(checkPlayCardAsDefend(state, p, action.card, as, action.via))
  const card = requireInHand(state, p, action.card)
  payEnergy(state, p, as)

  const top = state.stack[state.stack.length - 1]
  if (!top || top.kind !== 'contest') {
    throw new RuleError('结算栈异常：缺少对抗结算帧')
  }
  const variant = cardDoc(as).play
  if (!variant) throw new RuleError(`【${CARD_NAME[as]}】不能作为响应打出`)

  const ctx: EffectContext = {
    self: p,
    active: state.active,
    source: top.source,
    usedUid: card.uid,
    usedCard: action.via ? { as, source: card, via: action.via } : { as, source: card },
    costCards: [],
  }
  runEffects(state, variant.effects, ctx)

  // 机制战报：抵消进度（属于引擎，不属于内容）
  if (top.got >= top.need) {
    log(state, `【${CARD_NAME[top.expected]}】被抵消`)
  } else {
    log(
      state,
      `${playerLabel(state, p)} 还需再打出 ${top.need - top.got} 张【${CARD_NAME[top.expected]}】才能抵消`,
    )
  }
}

function applyActivate(state: GameState, action: Extract<Action, { kind: 'activate' }>): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'play') throw new RuleError('现在不是你的出牌阶段')
  const p = pending.player
  ensure(checkActivate(state, p, action.skill, action.cards, action.target))

  const activate = skillDoc(action.skill).activate
  if (!activate) throw new RuleError('该技能无法主动发动')

  const ctx: EffectContext = {
    self: p,
    active: state.active,
    costCards: (action.cards ?? []).map((card) => card.uid),
  }
  if (activate.target) {
    const resolved = resolveTargetChoice({ state, ctx }, activate.target, action.target)
    if (resolved.ok) ctx.target = resolved.target
  }
  runEffectGroup(state, activate, ctx)
}

function applyTriggerChoice(
  state: GameState,
  action: Extract<Action, { kind: 'trigger-choice' }>,
): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'trigger') throw new RuleError('当前没有待应答的技能')
  const p = pending.player
  ensure(checkTriggerChoice(state, p))

  const top = state.stack[state.stack.length - 1]
  if (!top || (top.kind !== 'damage' && top.kind !== 'threat')) {
    throw new RuleError('结算栈异常：缺少触发结算帧')
  }
  const trigger = top.triggers.shift()
  if (trigger === undefined || trigger.skill !== pending.skill) {
    throw new RuleError('结算栈异常：待应答技能不匹配')
  }

  if (!action.accept) {
    log(state, `${playerLabel(state, p)} 放弃发动【${skillDef(trigger.skill).name}】`)
    return
  }

  runTrigger(state, trigger, top.kind === 'damage' ? { damage: top.ctx } : { threat: top.ctx })
}

function applyDiscard(state: GameState, action: Extract<Action, { kind: 'discard-cards' }>): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'discard') throw new RuleError('当前不是弃牌阶段')
  const p = pending.player
  ensure(checkDiscard(state, p, action.cards))

  // 先全部解析成真实牌再落库：任何一张不合法都不会留下"弃了一半"的状态
  const cards = action.cards.map((card) => requireInHand(state, p, card))
  discardHandCards(state, p, cards)
  // 弃牌阶段的效果已完成，交回回合循环执行「阶段结束时」
  finishPhaseBody(state)
}

function applyEndPhase(state: GameState): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'play') throw new RuleError('现在不是你的出牌阶段')
  ensure(checkEndPhase(state, pending.player))
  log(state, `${playerLabel(state, pending.player)} 结束出牌阶段`)
  // 出牌阶段的效果已完成，交回回合循环执行「阶段结束时」并推进到弃牌阶段
  finishPhaseBody(state)
}

/**
 * 奖励三选一：校验 → 应用 → 交回结算循环。
 * 奖励发生在「回合开始时」，因此做完后不需要碰回合游标，`advance` 会自动继续。
 */
function applyPickRewardAction(
  state: GameState,
  action: Extract<Action, { kind: 'pick-reward' }>,
): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'reward') throw new RuleError('当前没有待选择的奖励')
  const p = pending.player
  ensure(checkPickReward(state, p, action))
  applyPickReward(state, p, action)
}

/** 跳过卡牌奖励（服务奖励不可跳过，由 checkSkipReward 拒绝） */
function applySkipRewardAction(state: GameState): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'reward') throw new RuleError('当前没有待选择的奖励')
  const p = pending.player
  ensure(checkSkipReward(state, p))
  applySkipReward(state, p)
}

/** 升级 / 移除服务选定一张自己的牌 */
function applyPickOwnCardAction(
  state: GameState,
  action: Extract<Action, { kind: 'pick-own-card' }>,
): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'pick-card') throw new RuleError('当前没有待选牌的奖励')
  const p = pending.player
  ensure(checkPickOwnCard(state, p, action.card))
  applyPickOwnCard(state, p, action.card)
}

function applyCancel(state: GameState): void {
  const pending = state.pending
  if (!pending) throw new RuleError('当前没有可以放弃的事项')

  if (pending.kind === 'respond') {
    const top = state.stack[state.stack.length - 1]
    if (!top || top.kind !== 'contest') {
      throw new RuleError('结算栈异常：缺少对抗结算帧')
    }
    log(state, `${playerLabel(state, pending.player)} 放弃打出【${CARD_NAME[top.expected]}】`)
    state.stack.pop()
    // 先安排收尾（在处理区之下），再执行未抵消效果，保证伤害结算完才清牌
    state.stack.push({ kind: 'flush', cards: top.spent })
    runEffects(state, top.onUnmet, top.ctx)
    return
  }

  if (pending.kind === 'dying') {
    const top = state.stack[state.stack.length - 1]
    if (!top || top.kind !== 'dying') {
      throw new RuleError('结算栈异常：缺少濒死结算帧')
    }
    log(state, `${playerLabel(state, pending.player)} 放弃救援`)
    top.ask.shift()
    return
  }

  throw new RuleError('当前没有可以放弃的事项')
}
