import { cardRole, cardSelfHarm, effectsInclude, skillDoc } from '../dsl/registry'
import type { CardRole } from '../dsl/registry'
import type { Effect } from '../dsl/types'
import type { UseContext } from '../dsl/kinds'
import { canPayEnergy, energyCost } from '../rules/energy'
import {
  activationCostCards,
  activationTargetChoice,
  activeOptions,
  cardTargetChoice,
  playOptions,
  useOptions,
  useVariantOf,
} from '../skills'
import type { CardOption } from '../skills'
import type { Action, Card, CardKind, GameState, PlayerIndex, SkillId } from '../types'
import { otherPlayer, RuleError } from '../util'

/** AI 思考延迟（毫秒）：只影响界面节奏，引擎与单测不受影响 */
export const AI_DELAY_MS = 600

/**
 * 预留给防御的能量：手上还有能打出的【防御】（含疾影转化）时，
 * 进攻到只剩这么多能量就收手，留着拦对手下回合的【打击】。
 */
export const DEFENSE_RESERVE = 1

/* ------------------------------------------------------------------
 * 策略阈值：数值都属于"怎么打"，不属于规则，因此留在 AI 模块里。
 * 技能/卡牌的用途分类则完全由文档结构派生，见 activationRole 与 cardRole。
 * ------------------------------------------------------------------ */

/** 体力告急到多少就用【回复】 */
export const HEAL_MAX_HP = 2
/**
 * 换牌类主动技：体力至少这么高才敢失血换牌。
 * 出牌数量的真正闸门是能量（上限 3），多摸的牌常常打不出去，
 * 因此只在满血附近才值得为摸牌付体力——否则 AI 会一路失血自杀（牛曾因此垫底）。
 */
export const CYCLE_MIN_HP = 4
/** 换牌类主动技：手牌少到这个数才值得换 */
export const CYCLE_MAX_HAND = 2
/** 发动需要弃牌的技能时至少留下的手牌数 */
export const HAND_RESERVE = 1
/** 发动进攻型主动技（如【猛扑】）后至少留下的手牌数：不把最后的牌全押在一次进攻上 */
export const OFFENSE_RESERVE = 3

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
  // 对选定目标造成伤害 / 失去体力 / 扣能量 = 进攻型主动技（如虎的【猛扑】）
  if (hasHarm(effects)) return 'offense'
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
  return hasHarm([...activate.effects, ...(activate.after ?? [])])
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
  const rank = (index: PlayerIndex): number =>
    harm ? (index === p ? 1 : 0) : index === p ? 0 : 1
  const ranked = [...choice.candidates].sort((a, b) => rank(a) - rank(b) || a - b)
  const size = choice.multi ? choice.size : 1
  return ranked.slice(0, size)
}

/** 卡牌是否以「伤害选定的目标」为目的 */
function cardHarmsChosenTarget(kind: CardKind, context: UseContext): boolean {
  const variant = useVariantOf(kind, context)
  if (!variant) return false
  return hasHarm([...variant.effects, ...(variant.after ?? [])])
}

/** 该牌面现在是否连目标都凑不出来（AI 据此跳过，绝不提交必失败的牌） */
function canTarget(state: GameState, p: PlayerIndex, kind: CardKind, context: UseContext): boolean {
  const choice = cardTargetChoice(state, p, kind, context)
  if (choice === null) return false
  if (!choice.spec) return true
  return !choice.multi || choice.candidates.length >= choice.size
}

/** 自伤牌是否构成终结：对手体力 ≤ 自伤点数，且自己扛得住 */
function selfHarmFinishes(state: GameState, p: PlayerIndex, kind: CardKind): boolean {
  const harm = cardSelfHarm(kind)
  if (harm <= 0) return true
  const self = state.players[p]
  const opponent = state.players[otherPlayer(p)]
  return opponent.hp <= harm && self.hp > harm
}

function hasHarm(effects: readonly Effect[]): boolean {
  for (const effect of effects) {
    if (
      (effect.kind === 'damage' || effect.kind === 'lose-hp' || effect.kind === 'pay-energy') &&
      effect.target === 'target'
    ) {
      return true
    }
    if (effect.kind === 'if' && (hasHarm(effect.then) || hasHarm(effect.else ?? []))) {
      return true
    }
    if (
      effect.kind === 'contest' &&
      (hasHarm(effect.onUnmet ?? []) || hasHarm(effect.onMet ?? []))
    ) {
      return true
    }
    if (effect.kind === 'for-each-target' && hasHarm(effect.effects)) {
      return true
    }
  }
  return false
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
 * 出牌阶段决策：自我治疗 → 回血 → 换牌 → 攻击（受能量约束）→ 结束阶段。
 *
 * 每次 submit 只走一步，引擎再把待输入项交回这里，所以「能打几张攻击牌」
 * 由循环自然形成：付得起就打，付不起或要留防御余量就结束出牌阶段。
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

  // 2. 体力告急就用【回复】（要付得起能量，且目标要凑得出来）
  if (player.hp <= HEAL_MAX_HP && player.hp < player.maxHp) {
    const heal = findDirect(state, p, 'recovery', 'use', (option) =>
      !canTarget(state, p, option.as, 'play'),
    )
    if (heal) return asAction(state, p, heal, 'use')
  }

  // 3. 换牌类主动技：体力充裕但手牌太少时换牌
  const cycle = activations.find((item) => item.role === 'card-cycle')
  if (cycle && player.hp >= CYCLE_MIN_HP && player.hand.length <= CYCLE_MAX_HAND) {
    const target = chooseActivationTarget(state, p, cycle.skill)
    return target === undefined
      ? { kind: 'activate', skill: cycle.skill }
      : { kind: 'activate', skill: cycle.skill, target }
  }

  // 4. 进攻型主动技：弃得起且留出余量时发动（如虎的【猛扑】）
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

  // 5. 进攻
  const attack = bestAttack(state, p)
  if (attack) return attack

  return { kind: 'end-phase' }
}

/** 手上是否还有能打出【防御】的牌（真【防御】或疾影把【打击】当【防御】） */
function holdsDefense(state: GameState, p: PlayerIndex): boolean {
  return state.players[p].hand.some((card) =>
    playOptions(state, p, card).some((option) => cardRole(option.as) === 'defense'),
  )
}

/**
 * 找出可用于进攻的最佳方案，优先真牌，其次技能转化。
 * 攻击没有次数限制，唯一的门槛是能量：除了这一张的费用，还要留出防御余量。
 * 会伤到自己的牌（对称的多目标牌）只在能直接终结对手时才打。
 */
function bestAttack(state: GameState, p: PlayerIndex): Action | null {
  const player = state.players[p]
  if (!state.players[otherPlayer(p)].alive) return null

  const reserve = holdsDefense(state, p) ? DEFENSE_RESERVE : 0
  const skip = (option: CardOption): boolean =>
    !canTarget(state, p, option.as, 'play') || !selfHarmFinishes(state, p, option.as)

  const direct = findDirect(state, p, 'attack', 'use', skip)
  if (direct) {
    if (player.energy - energyCost(state, p, direct.option.as) < reserve) return null
    return asAction(state, p, direct, 'use')
  }

  // 转化攻击：只在同用途的牌还有富余时（否则会把唯一的防御牌打光）
  const transformed = findTransformed(state, p, 'attack', 'use', skip)
  if (!transformed) return null
  if (player.energy - energyCost(state, p, transformed.option.as) < reserve) return null
  const role = cardRole(transformed.card.kind)
  const sameRole = player.hand.filter((card) => cardRole(card.kind) === role).length
  if (sameRole < 2) return null
  return asAction(state, p, transformed, 'use')
}

/** 响应【打击】：付得起就抵消（优先真【防御】，其次技能转化），否则承受伤害 */
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
  return [...hand]
    .sort((a, b) => cardScore(a) - cardScore(b) || a.uid - b.uid)
    .slice(0, count)
}

function decideDiscard(state: GameState, p: PlayerIndex, count: number): Action {
  return { kind: 'discard-cards', cards: worstCards(state.players[p].hand, count) }
}
