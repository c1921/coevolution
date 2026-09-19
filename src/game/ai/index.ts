import { effectsHarmChosenTarget, findEffect } from '../dsl/effects'
import {
  cardDoc,
  cardRole,
  cardSelfThreat,
  cardThreatToTarget,
  effectsInclude,
  skillDoc,
} from '../dsl/registry'
import type { CardRole } from '../dsl/registry'
import type { Effect, Value } from '../dsl/types'
import type { UseContext } from '../dsl/kinds'
import { canPayEnergy } from '../rules/energy'
import { checkUseCard } from '../rules/legality'
import { removeCandidates, serviceOptions } from '../rules/reward'
import {
  activationCostCards,
  activationTargetChoice,
  activeOptions,
  cardTargetChoice,
  playOptions,
  targetsSatisfied,
  useOptions,
  useVariantOf,
} from '../skills'
import type { CardOption } from '../skills'
import type {
  Action,
  Card,
  CardKind,
  Frame,
  GameState,
  PlayerIndex,
  Prompt,
  SkillId,
} from '../types'
import { otherPlayer, RuleError } from '../util'

/** AI 思考延迟（毫秒）：只影响界面节奏，引擎与单测不受影响 */
export const AI_DELAY_MS = 600

/* ------------------------------------------------------------------
 * 策略阈值：数值都属于"怎么打"，不属于规则，因此留在 AI 模块里。
 * 技能/卡牌的用途分类则完全由文档结构派生，见 activationRole 与 cardRole。
 * ------------------------------------------------------------------ */

/** 体力告急到多少就用【回复】 */
export const HEAL_MAX_HP = 2
/**
 * 换牌类主动技：体力至少这么高才敢失血换牌。
 * 出牌数量的真正闸门是能量（上限 3），多摸的牌常常打不出去，
 * 因此只在满血附近才值得为摸牌付体力——否则 AI 会一路失血自杀（换牌型主动技曾因此垫底）。
 */
export const CYCLE_MIN_HP = 4
/** 换牌类主动技：手牌少到这个数才值得换 */
export const CYCLE_MAX_HAND = 2
/** 发动需要弃牌的技能时至少留下的手牌数 */
export const HAND_RESERVE = 1
/** 发动进攻型主动技（如【强袭】）后至少留下的手牌数：不把最后的牌全押在一次进攻上 */
export const OFFENSE_RESERVE = 3
/** 手牌少到这个数就值得打抽牌类牌面（卡牌本身打出后手牌还会减一） */
export const UTILITY_DRAW_MAX_HAND = 3
/** 对手手牌多到这个数就值得打弃他手牌的牌面 */
export const UTILITY_DISCARD_MIN_HAND = 3
/**
 * 自伤牌的门槛：`对手受到的威胁 − 自己承受的威胁` 至少要有这么多才值得打。
 * 只看"自伤量"会让【血怒】这类以血换输出的牌几乎绝迹，因此改成比较净收益；
 * 对手会被这一击压垮时另算（见 selfHarmWorthwhile）。
 */
export const SELF_HARM_MARGIN = 1

/** 奖励卡牌评分权重（"怎么选"属于 AI 策略，不是规则） */
export const REWARD_SCORE = {
  threat: 1.4,
  heal: 1.2,
  offset: 0.8,
  draw: 1.4,
  cost: 0.3,
  utility: 2,
} as const
/** 卡牌奖励的最低接受分：最高分低于它且允许跳过时就跳过 */
export const REWARD_MIN_SCORE = 1.5
/**
 * 服务奖励：体力低到这个值时才优先回复。
 * 回复量只有 1 点，平时不如删掉一张低质量初始牌；只有真的快死了才值得拿它续命。
 */
export const REWARD_DANGER_HP = 3
/**
 * 服务奖励：未升级的初始牌多于这个数就继续「移除」，降到它及以下就改为「升级」。
 * 用「低质量牌数量」而不是牌组总张数：奖励会不断往手里加牌，总张数几乎不会降下来，
 * 只看总张数会让 AI 永远在删牌、从不升级。
 */
export const REWARD_KEEP_BASE = 8

/**
 * 规则式 AI：读取当前待输入项并返回一个动作。
 * 完全确定性——同样的状态必定给出同样的动作，随机部分只走 state.rngState。
 *
 * 这里不出现任何技能/卡牌 id：用处（治疗、换牌、攻击、防御）由 DSL 文档结构派生
 * （registry.ts 的 cardRole / skillKinds），因此新增内容不需要改 AI。
 */
export function aiDecide(state: GameState): Action {
  const pending = state.pending
  if (!pending) throw new RuleError('AI 无事可做：当前没有待输入项')

  const p = pending.player
  switch (pending.kind) {
    case 'play':
      return decidePlay(state, p)
    case 'respond':
      return decideRespond(state, p)
    case 'dying':
      return decideDying(state, p, pending.dying)
    case 'trigger':
      // 受到伤害后的可选技能总是纯收益，AI 一律发动
      return { kind: 'trigger-choice', accept: true }
    case 'discard':
      return decideDiscard(state, p, pending.count)
    case 'reward':
      return decideReward(state, p, pending)
    case 'pick-card':
      return decidePickCard(pending)
  }
}

/** 主动技的用途：含 heal 效果 = 自我治疗，含 draw 效果 = 换牌，伤害选定目标 = 进攻 */
type ActivationRole = 'self-heal' | 'card-cycle' | 'offense'

interface Activation {
  skill: SkillId
  role: ActivationRole | undefined
}

function activationRole(skill: SkillId): ActivationRole | undefined {
  const activate = skillDoc(skill).activate
  if (!activate) return undefined
  const effects = [...activate.effects, ...(activate.after ?? [])]
  if (effectsInclude(effects, 'heal')) return 'self-heal'
  if (effectsInclude(effects, 'draw')) return 'card-cycle'
  // 对选定目标造成伤害 / 失去体力 / 扣能量 = 进攻型主动技（如进攻型的【强袭】）
  if (effectsHarmChosenTarget(effects)) return 'offense'
  return undefined
}

/**
 * 主动技的目标：完全由文档结构派生，AI 不认识任何技能 id。
 *
 *  - 对敌效果（伤害 / 失去体力 / 扣能量指向 target）优先选对手；
 *  - 其余（治疗等）优先选自己；
 *  - 首选不在候选内时退回文档缺省目标，再退回第一个候选。
 *
 * 返回 undefined 表示该技能现在没有合法目标，调用方应跳过它。
 */
export function chooseActivationTarget(
  state: GameState,
  p: PlayerIndex,
  skill: SkillId,
): PlayerIndex | undefined {
  const choice = activationTargetChoice(state, p, skill)
  if (!choice?.spec) return undefined

  const candidates = choice.candidates
  if (candidates.length === 0) return undefined
  if (choice.spec.scope === 'self') return p

  const other = candidates.find((index) => index !== p)
  if (harmsChosenTarget(skill)) {
    if (other !== undefined) return other
  } else if (candidates.includes(p)) {
    return p
  }
  if (choice.fallback !== undefined) return choice.fallback
  return candidates[0]
}

/** 主动技是否以「伤害选定的目标」为目的（看效果指令与它引用的角色） */
function harmsChosenTarget(skill: SkillId): boolean {
  const activate = skillDoc(skill).activate
  if (!activate) return false
  return effectsHarmChosenTarget([...activate.effects, ...(activate.after ?? [])])
}

/**
 * 卡牌使用时的目标选择：完全由文档结构派生。
 *  - `count.mode = all` 不需要指定（引擎作用于全部合法候选）；
 *  - 单选且不需要选择时返回空数组（交给引擎使用文档缺省目标）；
 *  - 需要选择时：有害效果优先选对手，其余优先选自己，再按候选顺序补齐。
 */
export function chooseCardTargets(
  state: GameState,
  p: PlayerIndex,
  kind: CardKind,
  context: UseContext,
): PlayerIndex[] {
  const choice = cardTargetChoice(state, p, kind, context)
  if (!choice?.spec) return []
  if (choice.spec.count?.mode === 'all') return []
  if (!choice.mustChoose) return []

  const harm = cardHarmsChosenTarget(kind, context)
  const rank = (index: PlayerIndex): number => (harm ? (index === p ? 1 : 0) : index === p ? 0 : 1)
  const ranked = [...choice.candidates].sort((a, b) => rank(a) - rank(b) || a - b)
  const size = choice.multi ? choice.size : 1
  return ranked.slice(0, size)
}

/** 卡牌是否以「伤害选定的目标」为目的 */
function cardHarmsChosenTarget(kind: CardKind, context: UseContext): boolean {
  const variant = useVariantOf(kind, context)
  if (!variant) return false
  return effectsHarmChosenTarget([...variant.effects, ...(variant.after ?? [])])
}

/** 该牌面现在是否连目标都凑不出来（AI 据此跳过，绝不提交必失败的牌） */
function canTarget(state: GameState, p: PlayerIndex, kind: CardKind, context: UseContext): boolean {
  return targetsSatisfied(cardTargetChoice(state, p, kind, context))
}

/**
 * 自伤牌是否值得打：比较「对对手的收益 − 对自己的威胁」，而不是只看自伤量。
 *  - 自己的威胁在**自己的回合结束时**兑现，因此先把"已有威胁 + 这张牌的自伤"
 *    加在一起：扛不住就绝不打（哪怕对手会被这一击压垮——自己会先结算阵亡）；
 *  - 对手会被这一击压垮时，只要自己扛得住就打（收尾优先）；
 *  - 否则净收益至少要有 SELF_HARM_MARGIN。
 */
function selfHarmWorthwhile(state: GameState, p: PlayerIndex, kind: CardKind): boolean {
  const harm = cardSelfThreat(kind)
  if (harm <= 0) return true
  const self = state.players[p]
  const opponent = state.players[otherPlayer(p)]
  const benefit = cardThreatToTarget(kind)
  // 本回合结束时自己身上的威胁会全部兑现，打出自伤牌只会雪上加霜
  if (self.hp <= self.threat + harm) return false
  if (opponent.hp <= benefit) return true
  return benefit - harm >= SELF_HARM_MARGIN
}

/** 某张手牌在该语境下的可选牌面（直接用法优先，其次技能转化） */
function optionsOf(
  state: GameState,
  p: PlayerIndex,
  card: Card,
  context: 'use' | 'respond',
): CardOption[] {
  return context === 'use' ? useOptions(state, p, card) : playOptions(state, p, card)
}

/** 手牌里第一个"直接就能当某用途使用且付得起"的牌面 */
function findDirect(
  state: GameState,
  p: PlayerIndex,
  role: CardRole,
  context: 'use' | 'respond',
  skip: (option: CardOption) => boolean = () => false,
): { card: Card; option: CardOption } | undefined {
  for (const card of state.players[p].hand) {
    const option = optionsOf(state, p, card, context).find(
      (item) => item.via === undefined && cardRole(item.as) === role && !skip(item),
    )
    if (option && canPayEnergy(state, p, option.as)) return { card, option }
  }
  return undefined
}

/** 手牌里第一个"经技能转化可当某用途使用且付得起"的牌面（从手牌末尾往前找，优先留前面的牌） */
function findTransformed(
  state: GameState,
  p: PlayerIndex,
  role: CardRole,
  context: 'use' | 'respond',
  skip: (option: CardOption) => boolean = () => false,
): { card: Card; option: CardOption } | undefined {
  for (const card of [...state.players[p].hand].reverse()) {
    const option = optionsOf(state, p, card, context).find(
      (item) => item.via !== undefined && cardRole(item.as) === role && !skip(item),
    )
    if (option && canPayEnergy(state, p, option.as)) return { card, option }
  }
  return undefined
}

/**
 * 把「手牌 + 牌面」变成动作。
 *  - respond：打出响应牌，不带目标；
 *  - dying：濒死使用，目标由结算决定（濒死者），不带目标；
 *  - use：出牌阶段使用，按文档结构补上需要选择的目标。
 */
function asAction(
  state: GameState,
  p: PlayerIndex,
  found: { card: Card; option: CardOption },
  mode: 'use' | 'respond' | 'dying',
): Action {
  if (mode === 'respond') {
    return { kind: 'play-card', card: found.card, as: found.option.as, via: found.option.via }
  }
  const targets = mode === 'dying' ? [] : chooseCardTargets(state, p, found.option.as, 'play')
  return {
    kind: 'use-card',
    card: found.card,
    as: found.option.as,
    ...(found.option.via !== undefined ? { via: found.option.via } : {}),
    ...(targets.length > 0 ? { targets } : {}),
  }
}

/**
 * 出牌阶段决策：自我治疗 → 抵消威胁 → 回血 → 换牌 → 进攻主动技 → 攻击 → 结束阶段。
 *
 * 每次 submit 只走一步，引擎再把待输入项交回这里，所以「能打几张攻击牌」
 * 由循环自然形成：付得起就打，付不起就结束出牌阶段。
 * 能量在回合开始时回满，所以留能量过回合没有意义：先清掉自己身上的威胁，再用剩下的能量进攻。
 */
function decidePlay(state: GameState, p: PlayerIndex): Action {
  const player = state.players[p]
  const activations: Activation[] = activeOptions(state, p).map((skill) => ({
    skill,
    role: activationRole(skill),
  }))

  // 1. 自我治疗类主动技：自己已受伤，且弃得起（留下 HAND_RESERVE 张手牌）
  const selfHeal = activations.find((item) => item.role === 'self-heal')
  if (selfHeal && player.hp < player.maxHp) {
    const cost = activationCostCards(state, p, selfHeal.skill)
    // 文档声明了目标时，只有选得中自己才发动：这个分支是"自我治疗"，
    // 不能因为自己不是候选（例如满血）就把治疗送给对手。
    const choice = activationTargetChoice(state, p, selfHeal.skill)
    const target = chooseActivationTarget(state, p, selfHeal.skill)
    const selfTargeted = choice?.spec === undefined || target === p
    if (player.hand.length >= cost + HAND_RESERVE && selfTargeted) {
      // 按文档的费用张数取最差的几张（costCards 可能不是 1）
      const fodder = worstCards(player.hand, cost)
      if (fodder.length === cost) {
        const action: Extract<Action, { kind: 'activate' }> = {
          kind: 'activate',
          skill: selfHeal.skill,
        }
        if (choice?.spec && target !== undefined) action.target = target
        if (cost > 0) action.cards = fodder
        return action
      }
    }
  }

  // 2. 抵消威胁：剩余威胁会在自己的回合结束时变成伤害，先用防御类牌抵消
  const defense = findDefensePlay(state, p)
  if (defense) return defense

  // 3. 体力告急就用【回复】（要付得起能量，且目标要凑得出来）
  if (player.hp <= HEAL_MAX_HP && player.hp < player.maxHp) {
    const heal = findDirect(
      state,
      p,
      'recovery',
      'use',
      (option) => !canTarget(state, p, option.as, 'play'),
    )
    if (heal) return asAction(state, p, heal, 'use')
  }

  // 4. 功能牌：抽牌 / 弃对手手牌 / 额外阶段——按文档结构判断，不用牌种 id
  const utility = bestUtility(state, p)
  if (utility) return utility

  // 5. 换牌类主动技：体力充裕但手牌太少时换牌
  const cycle = activations.find((item) => item.role === 'card-cycle')
  if (cycle && player.hp >= CYCLE_MIN_HP && player.hand.length <= CYCLE_MAX_HAND) {
    const target = chooseActivationTarget(state, p, cycle.skill)
    return target === undefined
      ? { kind: 'activate', skill: cycle.skill }
      : { kind: 'activate', skill: cycle.skill, target }
  }

  // 6. 进攻型主动技：弃得起且留出余量时发动（如进攻型的【强袭】）
  const offense = activations.find((item) => item.role === 'offense')
  if (offense) {
    const cost = activationCostCards(state, p, offense.skill)
    const target = chooseActivationTarget(state, p, offense.skill)
    if (player.hand.length >= cost + OFFENSE_RESERVE && target !== undefined) {
      const action: Extract<Action, { kind: 'activate' }> = {
        kind: 'activate',
        skill: offense.skill,
      }
      if (cost > 0) action.cards = worstCards(player.hand, cost)
      action.target = target
      return action
    }
  }

  // 7. 进攻
  const attack = bestAttack(state, p)
  if (attack) return attack

  return { kind: 'end-phase' }
}

/**
 * 功能牌：当前 `cardRole` 把抽牌 / 额外阶段 / 弃对手手牌都归为 utility，
 * 旧 AI 完全不会用，新卡里的【战术演习】【疾跑】【掠夺】【后空翻】因此成了死牌。
 *
 * 判定完全由文档结构派生（`effectsInclude` / `findEffect`），不出现任何牌种 id：
 *  - 含 `draw` 且手牌 ≤ UTILITY_DRAW_MAX_HAND → 用；
 *  - 含从对手手牌取牌的 `move-cards` 且对手手牌 ≥ UTILITY_DISCARD_MIN_HAND → 用；
 *  - 含 `extra-phase` → 用。
 * 提交前过一遍 `checkUseCard`，保证 `requires`（如【后空翻】需要自己有威胁）不满足时不会打出。
 */
function bestUtility(state: GameState, p: PlayerIndex): Action | null {
  const player = state.players[p]
  const opponent = state.players[otherPlayer(p)]

  for (const card of player.hand) {
    for (const option of optionsOf(state, p, card, 'use')) {
      // 转化牌留给进攻/防御分支，不在功能分支里抢牌
      if (option.via !== undefined) continue
      const variant = useVariantOf(option.as, 'play')
      if (!variant) continue
      const effects = [...variant.effects, ...(variant.after ?? [])]
      const wantsDraw =
        effectsInclude(effects, 'draw') && player.hand.length <= UTILITY_DRAW_MAX_HAND
      const wantsDiscard =
        discardsOpponentHand(effects) && opponent.hand.length >= UTILITY_DISCARD_MIN_HAND
      const wantsPhase = effectsInclude(effects, 'extra-phase')
      if (!wantsDraw && !wantsDiscard && !wantsPhase) continue
      if (!canPayEnergy(state, p, option.as)) continue

      const targets = chooseCardTargets(state, p, option.as, 'play')
      const legality = checkUseCard(
        state,
        p,
        card,
        option.as,
        option.via,
        targets.length > 0 ? targets : undefined,
      )
      if (!legality.ok) continue
      return asAction(state, p, { card, option }, 'use')
    }
  }
  return null
}

/** 效果树里是否含"从对手手牌取牌"的 move-cards（弃对手手牌 / 干扰类） */
function discardsOpponentHand(effects: readonly Effect[]): boolean {
  return (
    findEffect(
      effects,
      (effect) => effect.kind === 'move-cards' && effect.from.of === 'opponent',
    ) !== undefined
  )
}

/**
 * 抵消自己的威胁：有威胁时才行动，优先真【防御】，其次技能转化（如转换）。
 * 威胁足以致命时不保留同类牌；否则沿用「同用途牌还有富余」的守卫。
 */
function findDefensePlay(state: GameState, p: PlayerIndex): Action | null {
  const player = state.players[p]
  if (player.threat <= 0) return null

  const direct = findDirect(state, p, 'defense', 'use')
  if (direct) return asAction(state, p, direct, 'use')

  const transformed = findTransformed(state, p, 'defense', 'use')
  if (!transformed) return null
  if (player.threat < player.hp) {
    const role = cardRole(transformed.card.kind)
    const sameRole = player.hand.filter((card) => cardRole(card.kind) === role).length
    if (sameRole < 2) return null
  }
  return asAction(state, p, transformed, 'use')
}

/**
 * 找出可用于进攻的最佳方案，优先真牌，其次技能转化。
 * 攻击没有次数限制，唯一的门槛是能量（能量在回合开始时回满，不需要留余量）。
 * 会威胁到自己的牌（对称的多目标牌）只在对手会被这一击压垮时才打。
 */
function bestAttack(state: GameState, p: PlayerIndex): Action | null {
  const player = state.players[p]
  if (!state.players[otherPlayer(p)].alive) return null

  const skip = (option: CardOption): boolean =>
    !canTarget(state, p, option.as, 'play') || !selfHarmWorthwhile(state, p, option.as)

  const direct = findDirect(state, p, 'attack', 'use', skip)
  if (direct) return asAction(state, p, direct, 'use')

  // 转化攻击：只在同用途的牌还有富余时（否则会把唯一的防御牌打光）
  const transformed = findTransformed(state, p, 'attack', 'use', skip)
  if (!transformed) return null
  const role = cardRole(transformed.card.kind)
  const sameRole = player.hand.filter((card) => cardRole(card.kind) === role).length
  if (sameRole < 2) return null
  return asAction(state, p, transformed, 'use')
}

/**
 * 响应窗口（对抗机制的占位）：当前没有任何卡牌声明 play 变体，
 * 因此永远只会走到「放弃响应」。保留这条路径，供后续反制机制复用。
 */
function decideRespond(state: GameState, p: PlayerIndex): Action {
  const direct = findDirect(state, p, 'defense', 'respond')
  if (direct) return asAction(state, p, direct, 'respond')

  const transformed = findTransformed(state, p, 'defense', 'respond')
  if (transformed) return asAction(state, p, transformed, 'respond')

  return { kind: 'cancel' }
}

/** 濒死求【回复】：只救自己，绝不救对手；付不起能量就只能放弃 */
function decideDying(state: GameState, p: PlayerIndex, dying: PlayerIndex): Action {
  if (p !== dying) return { kind: 'cancel' }
  if (state.players[p].hp > 0) return { kind: 'cancel' }

  // 只有文档里声明了 dying 语境的牌面才能用于自救（如【回复】；【急救】不能）
  const heal = findDirect(
    state,
    p,
    'recovery',
    'use',
    (option) => useVariantOf(option.as, 'dying') === undefined,
  )
  return heal ? asAction(state, p, heal, 'dying') : { kind: 'cancel' }
}

/**
 * 弃牌优先级：攻击牌 → 防御牌 → 回复牌；同级弃 uid 最小者。
 * 攻击牌每个牌组有 11 张且只要 1 点能量，多出来的攻击牌最不值得留。
 */
const DISCARD_PRIORITY: Record<CardRole, number> = {
  attack: 0,
  defense: 1,
  recovery: 2,
  utility: 1,
}

function cardScore(card: Card): number {
  return DISCARD_PRIORITY[cardRole(card.kind)]
}

/** 最不值得留的 count 张手牌（发动费用与弃牌阶段共用同一份优先级） */
function worstCards(hand: Card[], count: number): Card[] {
  return [...hand].sort((a, b) => cardScore(a) - cardScore(b) || a.uid - b.uid).slice(0, count)
}

function decideDiscard(state: GameState, p: PlayerIndex, count: number): Action {
  return { kind: 'discard-cards', cards: worstCards(state.players[p].hand, count) }
}

/* ------------------------------------------------------------------ 奖励决策 */

/** 栈顶的奖励帧（AI 用它读取服务奖励的参数） */
function currentRewardFrame(state: GameState): Extract<Frame, { kind: 'reward' }> | undefined {
  const top = state.stack[state.stack.length - 1]
  return top && top.kind === 'reward' ? top : undefined
}

function constNumber(value: Value, fallback: number): number {
  return value.kind === 'const' ? value.value : fallback
}

/** 效果树里某类效果的数值合计（含嵌套分支；非 const 按 fallback=1 估） */
function magnitudeOf(
  effects: readonly Effect[] | undefined,
  kind: 'threat' | 'heal' | 'offset-threat' | 'draw',
): number {
  let total = 0
  for (const effect of effects ?? []) {
    if (effect.kind === 'threat' && kind === 'threat') total += constNumber(effect.amount, 1)
    else if (effect.kind === 'heal' && kind === 'heal') total += constNumber(effect.amount, 1)
    else if (effect.kind === 'offset-threat' && kind === 'offset-threat') {
      total += constNumber(effect.amount, 1)
    } else if (effect.kind === 'draw' && kind === 'draw') total += constNumber(effect.count, 1)

    if (effect.kind === 'for-each-target') total += magnitudeOf(effect.effects, kind)
    if (effect.kind === 'if') {
      total += Math.max(magnitudeOf(effect.then, kind), magnitudeOf(effect.else, kind))
    }
    if (effect.kind === 'contest') {
      total += Math.max(magnitudeOf(effect.onMet, kind), magnitudeOf(effect.onUnmet, kind))
    }
  }
  return total
}

/**
 * 奖励卡牌评分：完全由文档结构派生（威胁/治疗/抵消/摸牌的量与费用），
 * 不含任何牌种 id。无以上效果的牌（干扰、额外阶段等）按 utility 给低基础分，
 * 避免它们因为"分数算不出来"而被一律跳过。
 */
export function rewardCardScore(kind: CardKind): number {
  const doc = cardDoc(kind)
  const cost = doc.cost.kind === 'const' ? doc.cost.value : 1
  const effects = (doc.use ?? []).flatMap((variant) => variant.effects)
  const raw =
    magnitudeOf(effects, 'threat') * REWARD_SCORE.threat +
    magnitudeOf(effects, 'heal') * REWARD_SCORE.heal +
    magnitudeOf(effects, 'offset-threat') * REWARD_SCORE.offset +
    magnitudeOf(effects, 'draw') * REWARD_SCORE.draw
  return raw + (raw === 0 ? REWARD_SCORE.utility : 0) - cost * REWARD_SCORE.cost
}

/** 卡牌三选一：取评分最高者；最高分低于阈值且允许跳过时跳过 */
function decideReward(
  state: GameState,
  p: PlayerIndex,
  pending: Extract<Prompt, { kind: 'reward' }>,
): Action {
  if (pending.reward === 'service') return decideServiceReward(state, p)

  const cards = pending.cards ?? []
  if (cards.length === 0) {
    return pending.allowSkip ? { kind: 'skip-reward' } : { kind: 'pick-reward' }
  }
  const best = [...cards].sort(
    (a, b) => rewardCardScore(b) - rewardCardScore(a) || a.localeCompare(b),
  )[0] as CardKind
  if (pending.allowSkip && rewardCardScore(best) < REWARD_MIN_SCORE) {
    return { kind: 'skip-reward' }
  }
  return { kind: 'pick-reward', card: best }
}

/**
 * 牌组循环（deck cycling）的核心思路：**删掉低质量初始牌**。
 * 牌组越薄，关键牌的上手率越高，因此「未升级的初始牌」不如「升级版 / 奖励牌」值得留。
 * 这些判定完全由文档结构派生（有没有 `upgradeTo` 即是否未升级），不含任何牌种 id。
 */
function isUnupgraded(card: Card): boolean {
  return cardDoc(card.kind).upgradeTo !== undefined
}

/** 移除优先级：未升级攻击 → 未升级其他 → 其他攻击 → 其余；同级按 uid 升序 */
function removalRank(card: Card): number {
  const attack = cardRole(card.kind) === 'attack'
  if (isUnupgraded(card) && attack) return 0
  if (isUnupgraded(card)) return 1
  if (attack) return 2
  return 3
}

/** 最该移除的一张（先删未升级的初始牌，尤其是未升级的攻击） */
function removalTarget(candidates: Card[]): Card {
  return [...candidates].sort((a, b) => removalRank(a) - removalRank(b) || a.uid - b.uid)[0] as Card
}

/**
 * 服务三选一：**删牌与升级兼顾**的牌组循环。
 *  - 体力危险（≤ REWARD_DANGER_HP）且回复可用 → 先回复保命；
 *  - 未升级的初始牌还多（> REWARD_KEEP_BASE）且可移除 → 移除（牌组越薄关键牌上手率越高）；
 *  - 否则能升级就升级（把留下的牌变强）；
 *  - 再否则有牌就删，最后才是回复。
 * 每次只提交当前可用的选项，绝不下发一个必被 legality 拒绝的动作。
 */
function decideServiceReward(state: GameState, p: PlayerIndex): Action {
  const frame = currentRewardFrame(state)
  const available = frame
    ? serviceOptions(state, p, frame)
    : { upgrade: false, remove: false, heal: false }
  const player = state.players[p]

  if (available.heal && player.hp <= REWARD_DANGER_HP) {
    return { kind: 'pick-reward', service: 'heal' }
  }
  const lowQuality = removeCandidates(state, p).filter(isUnupgraded).length
  if (available.remove && lowQuality > REWARD_KEEP_BASE) {
    return { kind: 'pick-reward', service: 'remove' }
  }
  if (available.upgrade) return { kind: 'pick-reward', service: 'upgrade' }
  if (available.remove) return { kind: 'pick-reward', service: 'remove' }
  return { kind: 'pick-reward', service: 'heal' }
}

/**
 * 升级 / 移除的选牌。
 * 升级优先挑攻击牌（提高输出），同档按奖励评分、再按 uid；
 * 移除则先删低质量初始牌（未升级的攻击最优先），见 `removalTarget`。
 */
function decidePickCard(pending: Extract<Prompt, { kind: 'pick-card' }>): Action {
  const candidates = pending.candidates
  if (candidates.length === 0) {
    throw new RuleError('奖励选牌没有候选')
  }
  if (pending.purpose === 'upgrade') {
    const priority = (card: Card): number =>
      (cardRole(card.kind) === 'attack' ? 100 : 0) + rewardCardScore(card.kind)
    const best = [...candidates].sort(
      (a, b) => priority(b) - priority(a) || a.uid - b.uid,
    )[0] as Card
    return { kind: 'pick-own-card', card: best }
  }
  return { kind: 'pick-own-card', card: removalTarget(candidates) }
}
