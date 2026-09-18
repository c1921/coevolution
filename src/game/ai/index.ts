import { cardRole, effectsInclude, skillDoc } from '../dsl/registry'
import type { CardRole } from '../dsl/registry'
import { canPayEnergy, energyCost } from '../rules/energy'
import { activationCostCards, activeOptions, playOptions, useOptions } from '../skills'
import type { CardOption } from '../skills'
import type { Action, Card, GameState, PlayerIndex, SkillId } from '../types'
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
/** 换牌类主动技：体力至少这么高才敢失血换牌 */
export const CYCLE_MIN_HP = 3
/** 换牌类主动技：手牌少到这个数才值得换 */
export const CYCLE_MAX_HAND = 2
/** 发动需要弃牌的技能时至少留下的手牌数 */
export const HAND_RESERVE = 1

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

/** 主动技的用途：含 heal 效果 = 自我治疗，含 draw 效果 = 换牌 */
type ActivationRole = 'self-heal' | 'card-cycle'

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
  return undefined
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
): { card: Card; option: CardOption } | undefined {
  for (const card of state.players[p].hand) {
    const option = optionsOf(state, p, card, context).find(
      (item) => item.via === undefined && cardRole(item.as) === role,
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
): { card: Card; option: CardOption } | undefined {
  for (const card of [...state.players[p].hand].reverse()) {
    const option = optionsOf(state, p, card, context).find(
      (item) => item.via !== undefined && cardRole(item.as) === role,
    )
    if (option && canPayEnergy(state, p, option.as)) return { card, option }
  }
  return undefined
}

function asAction(
  context: 'use' | 'respond',
  found: { card: Card; option: CardOption },
): Action {
  if (context === 'respond') {
    return { kind: 'play-card', card: found.card, as: found.option.as, via: found.option.via }
  }
  return { kind: 'use-card', card: found.card, as: found.option.as, via: found.option.via }
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
    if (player.hand.length >= cost + HAND_RESERVE) {
      const fodder = worstCard(player.hand)
      if (fodder) {
        return { kind: 'activate', skill: selfHeal.skill, cards: [fodder], target: p }
      }
    }
  }

  // 2. 体力告急就用【回复】（要付得起能量）
  if (player.hp <= HEAL_MAX_HP && player.hp < player.maxHp) {
    const heal = findDirect(state, p, 'recovery', 'use')
    if (heal) return asAction('use', heal)
  }

  // 3. 换牌类主动技：体力充裕但手牌太少时换牌
  const cycle = activations.find((item) => item.role === 'card-cycle')
  if (cycle && player.hp >= CYCLE_MIN_HP && player.hand.length <= CYCLE_MAX_HAND) {
    return { kind: 'activate', skill: cycle.skill }
  }

  // 4. 进攻
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
 */
function bestAttack(state: GameState, p: PlayerIndex): Action | null {
  const player = state.players[p]
  if (!state.players[otherPlayer(p)].alive) return null

  const reserve = holdsDefense(state, p) ? DEFENSE_RESERVE : 0

  const direct = findDirect(state, p, 'attack', 'use')
  if (direct) {
    if (player.energy - energyCost(direct.option.as) < reserve) return null
    return asAction('use', direct)
  }

  // 转化攻击：只在同用途的牌还有富余时（否则会把唯一的防御牌打光）
  const transformed = findTransformed(state, p, 'attack', 'use')
  if (!transformed) return null
  if (player.energy - energyCost(transformed.option.as) < reserve) return null
  const role = cardRole(transformed.card.kind)
  const sameRole = player.hand.filter((card) => cardRole(card.kind) === role).length
  if (sameRole < 2) return null
  return asAction('use', transformed)
}

/** 响应【打击】：付得起就抵消（优先真【防御】，其次技能转化），否则承受伤害 */
function decideRespond(state: GameState, p: PlayerIndex): Action {
  const direct = findDirect(state, p, 'defense', 'respond')
  if (direct) return asAction('respond', direct)

  const transformed = findTransformed(state, p, 'defense', 'respond')
  if (transformed) return asAction('respond', transformed)

  return { kind: 'cancel' }
}

/** 濒死求【回复】：只救自己，绝不救对手；付不起能量就只能放弃 */
function decideDying(state: GameState, p: PlayerIndex, dying: PlayerIndex): Action {
  if (p !== dying) return { kind: 'cancel' }
  if (state.players[p].hp > 0) return { kind: 'cancel' }

  const heal = findDirect(state, p, 'recovery', 'use')
  return heal ? asAction('use', heal) : { kind: 'cancel' }
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

function worstCard(hand: Card[]): Card | undefined {
  return [...hand].sort((a, b) => cardScore(a) - cardScore(b) || a.uid - b.uid)[0]
}

function decideDiscard(state: GameState, p: PlayerIndex, count: number): Action {
  const sorted = [...state.players[p].hand].sort(
    (a, b) => cardScore(a) - cardScore(b) || a.uid - b.uid,
  )
  return { kind: 'discard-cards', cards: sorted.slice(0, count) }
}
