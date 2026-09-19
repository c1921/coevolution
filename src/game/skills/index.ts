import { CARD_DEFS, CARD_NAME } from '../data/cardDefs'
import { skillDef } from '../data/species'
import { evalConditions } from '../dsl/condition'
import { channelBonus, channelValue } from '../dsl/modifier'
import { cardDoc, registry, skillDoc, skillsOf } from '../dsl/registry'
import { baseContext } from '../dsl/runtime'
import type { EffectContext, EvalEnv } from '../dsl/runtime'
import { resolveTargetChoice, targetCandidates } from '../dsl/target'
import type { UseContext } from '../dsl/kinds'
import type { TargetSpec, UseVariant } from '../dsl/types'
import { evalValue } from '../dsl/value'
import { skillUsed } from '../rules/usage'
import type { Card, CardKind, GameState, PlayerIndex, SkillId } from '../types'

/** 一张手牌在某语境下的一个可选"牌面"：直接用，或经技能转化后用 */
export interface CardOption {
  as: CardKind
  via?: SkillId
}

/** 按钮文案：「使用【打击】（猛扑）」 */
export function optionLabel(
  option: CardOption,
  verb: '使用' | '打出' | '当',
): string {
  if (option.via) {
    return `${verb}【${CARD_NAME[option.as]}】（${skillDef(option.via).name}）`
  }
  return `${verb}【${CARD_NAME[option.as]}】`
}

/** 卡牌自身在该语境是否有用法（defend 没有 use 变体，所以不能主动使用） */
function hasOwnVariant(kind: CardKind, context: 'use' | 'play'): boolean {
  const doc = cardDoc(kind)
  if (context === 'play') return doc.play !== undefined
  return (doc.use ?? []).some((variant) => variant.context === 'play' || variant.context === 'dying')
}

/**
 * 某语境下的全部牌面：卡牌自身的用法 + 该物种技能的转化。
 *
 * 转化完全由文档描述（skills/*.json 的 transforms），因此新增"把 A 当 B"的技能
 * 不需要改这里，也不需要碰 legality 或引擎。
 */
function optionsFor(
  state: GameState,
  p: PlayerIndex,
  card: Card,
  context: 'use' | 'play',
): CardOption[] {
  const options: CardOption[] = []
  if (hasOwnVariant(card.kind, context)) options.push({ as: card.kind })

  for (const skill of skillsOf(state.players[p].species)) {
    for (const transform of skill.transforms ?? []) {
      if (transform.from !== card.kind) continue
      if (!transform.contexts.includes(context)) continue
      options.push({ as: transform.to, via: skill.id })
    }
  }
  return options
}

/**
 * 「使用」语境（出牌阶段主动使用 / 濒死求【回复】）下的全部牌面。
 * 注意：只列出机制上说得通的牌面，具体合法性（次数、体力是否已满）由 legality 判定。
 */
export function useOptions(state: GameState, p: PlayerIndex, card: Card): CardOption[] {
  return optionsFor(state, p, card, 'use')
}

/** 「打出」语境（响应【打击】）下的全部牌面：本作中只有【防御】有意义 */
export function playOptions(state: GameState, p: PlayerIndex, card: Card): CardOption[] {
  return optionsFor(state, p, card, 'play')
}

/** 卡牌在某语境的用法变体（出牌阶段使用 / 濒死使用） */
export function useVariantOf(kind: CardKind, context: UseContext): UseVariant | undefined {
  return (cardDoc(kind).use ?? []).find((variant) => variant.context === context)
}

/**
 * 主动使用被拒时的说明：尽量告诉玩家"什么时候能用"。
 * 文案由文档结构派生（play.respondsTo、是否只有 dying 变体），因此换内容不用改引擎。
 */
export function useDeniedReason(as: CardKind, context: UseContext): string {
  const doc = cardDoc(as)
  const variants = doc.use ?? []
  if (variants.length === 0) {
    if (doc.play) return `【${doc.name}】只能在响应【${CARD_NAME[doc.play.respondsTo]}】时打出`
    return `【${doc.name}】不能使用`
  }
  if (context === 'play' && !variants.some((variant) => variant.context === 'play')) {
    return `【${doc.name}】只能在濒死时使用`
  }
  return `【${doc.name}】不能在这个时机使用`
}

/** 濒死时可用来自救的牌面（名字与费用），界面提示与报错说明共用 */
export function dyingRescueOptions(): { kind: CardKind; name: string; cost: number }[] {
  return registry.cards
    .filter((doc) => (doc.use ?? []).some((variant) => variant.context === 'dying'))
    .map((doc) => ({ kind: doc.id, name: doc.name, cost: CARD_DEFS[doc.id].cost }))
}

/** 濒死时可用的牌面名（如「【回复】」），用于濒死语境的报错说明 */
export function dyingUsableLabel(): string {
  const names = dyingRescueOptions().map((option) => `【${option.name}】`)
  return names.length > 0 ? names.join('、') : '【回复】'
}

/**
 * 发动某个主动技需要先选定并弃置的手牌数（0 表示不需要选牌）。
 * 界面据此提示"先点选 N 张手牌"，校验与结算也用它取同一份数值。
 */
export function activationCostCards(
  state: GameState,
  p: PlayerIndex,
  skill: SkillId,
): number {
  const activate = skillDoc(skill).activate
  if (!activate?.costCards) return 0
  const env = { state, ctx: baseContext(state, p) }
  return Math.max(0, Math.floor(evalValue(env, activate.costCards.count)))
}

/**
 * 目标选择：引擎、合法性判定、界面与 AI 想知道的「要不要选、能选谁、不选时用谁」。
 *
 * 这是目标解析的**唯一入口**——可用性判定（activeOptions / legalOptions）、合法性校验
 * （checkActivate / checkUseCard）与界面选择器都从这里取同一份结论，因此
 * 「按钮可用」与「提交必成功」不会再分叉。主动技与卡牌共用同一条实现。
 */
export interface TargetChoice {
  /** 目标规格；没有声明 target 时为 undefined（提交不带目标） */
  spec?: TargetSpec
  /** 全部合法候选（已按 alive / 距离 / conditions 过滤） */
  candidates: PlayerIndex[]
  /** 单选时不需要玩家选择所用的目标（= 合法的文档缺省目标） */
  fallback?: PlayerIndex
  /** 界面/AI 必须先选定目标 */
  mustChoose: boolean
  /** 需要选定多个目标（count.mode = exactly 且 N > 1） */
  multi: boolean
  /** 需要选定的目标个数（all 模式为候选个数，其余为 1 或 N） */
  size: number
}

/** 主动技目标选择的兼容别名（既有的调用点与测试沿用这个名字） */
export type ActivationTargetChoice = TargetChoice

/**
 * 解析目标选择；返回 null 表示声明了 target 却一个合法候选都没有。
 * 没有声明 target 时返回 `{ candidates: [], mustChoose: false, size: 1 }`。
 */
export function targetChoice(
  state: GameState,
  p: PlayerIndex,
  spec?: TargetSpec,
  /** 濒死语境下的濒死者：scope 为 dying 的目标规格需要它才有候选 */
  dying?: PlayerIndex,
): TargetChoice | null {
  if (!spec) return { candidates: [], mustChoose: false, multi: false, size: 1 }

  const ctx: EffectContext = {
    ...baseContext(state, p),
    ...(dying !== undefined ? { dying, target: dying } : {}),
  }
  const env: EvalEnv = { state, ctx }
  const candidates = targetCandidates(env, spec)
  // 声明了 target 却一个候选都没有：不能"无目标地"继续结算
  if (candidates.length === 0) return null

  if (spec.count?.mode === 'all') {
    // 作用于全部合法候选：不需要玩家选择
    return { spec, candidates, mustChoose: false, multi: false, size: candidates.length }
  }
  if (spec.count?.mode === 'exactly') {
    const size = Math.max(1, Math.floor(evalValue(env, spec.count.count)))
    return { spec, candidates, mustChoose: true, multi: size > 1, size }
  }

  const resolved = resolveTargetChoice(env, spec, undefined)
  const fallback = resolved.ok ? resolved.target : undefined
  const mustChoose = spec.required === true || candidates.length > 1 || fallback === undefined
  return {
    spec,
    candidates,
    ...(fallback !== undefined ? { fallback } : {}),
    mustChoose,
    multi: false,
    size: 1,
  }
}

/**
 * 解析主动技的目标选择；返回 null 表示该技能现在不能发动
 * （没有 activate，或声明了 target 却一个合法候选都没有）。
 */
export function activationTargetChoice(
  state: GameState,
  p: PlayerIndex,
  skill: SkillId,
): TargetChoice | null {
  const activate = skillDoc(skill).activate
  if (!activate) return null
  return targetChoice(state, p, activate.target)
}

/**
 * 解析卡牌使用时的目标选择（出牌阶段 / 濒死自救）。
 * 返回 null 表示该牌面在这个语境下根本不能用；没有 target 的牌面返回"无需选择"。
 * 濒死语境的 scope=dying 规格需要传入 dying（结算时由引擎强制为濒死者）。
 */
export function cardTargetChoice(
  state: GameState,
  p: PlayerIndex,
  kind: CardKind,
  context: UseContext,
  dying?: PlayerIndex,
): TargetChoice | null {
  const variant = useVariantOf(kind, context)
  if (!variant) return null
  return targetChoice(state, p, variant.target, context === 'dying' ? dying : undefined)
}

/**
 * 当前可发动的主动技：完全由 skills/*.json 的 activate 规格决定
 * （oncePerTurn / costCards / target / requires），引擎与界面不再判断技能 id。
 */
export function activeOptions(state: GameState, p: PlayerIndex): SkillId[] {
  const player = state.players[p]
  if (state.phase !== 'play' || state.active !== p || !player.alive) return []

  const out: SkillId[] = []
  for (const skill of skillsOf(player.species)) {
    const activate = skillDoc(skill.id).activate
    if (!activate) continue
    const choice = activationTargetChoice(state, p, skill.id)
    if (!choice) continue

    // requires 按"存在一个合法目标"求值，从而决定按钮是否出现；
    // 提交时 checkActivate 会用玩家最终选定的目标重算同一组条件。
    const ctx: EffectContext = { self: p, active: state.active, costCards: [] }
    if (choice.spec) {
      const bound = choice.fallback ?? choice.candidates[0]
      if (bound === undefined) continue
      ctx.target = bound
    }
    const env = { state, ctx }

    if (activate.oncePerTurn && skillUsed(state, p, skill.id)) continue
    if (activate.costCards && player.hand.length < evalValue(env, activate.costCards.count)) {
      continue
    }
    if (!evalConditions(env, activate.requires)) continue
    out.push(skill.id)
  }
  return out
}

/**
 * 【打击】需要目标打出几张【防御】才能抵消。
 * 数值来自 defend-need-against 通道：基准值在 rules/base.json，威压以 set 覆盖为 2。
 * 参考与 subject 都是"打击的使用者"。
 */
export function defendNeedAgainst(state: GameState, source: PlayerIndex): number {
  return channelValue(state, 'defend-need-against', source)
}

/**
 * 能量上限的技能修正（基础值见 rules/energy.ts 的 BASE_ENERGY_MAX）。
 * 数值来自 energy-max 通道：基准值 3，怒吼以 add +2 抬到 5。
 *
 * 【打击】的次数限制已从规则层面整体去除，所以原来的「无次数限制」不再是效果；
 * 【怒吼】改为「更多能量」，让熊依然打得更凶，同时避开另一条死路：
 * 任何把【打击】降成 0 费的效果都会与「无次数限制」组合成无限连击。
 */
export function energyMaxBonus(state: GameState, p: PlayerIndex): number {
  return channelBonus(state, 'energy-max', p)
}
