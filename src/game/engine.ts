import { CARD_NAME } from './data/cardDefs'
import { buildDeck } from './data/deck'
import { SPECIES, SPECIES_IDS, skillDef } from './data/species'
import { log, plainLabel, playerLabel } from './log'
import { pickOne, sample, shuffle } from './rng'
import {
  assertConservation,
  drawCards,
  findInHand,
  flushProcessing,
  moveHandToDiscard,
} from './rules/cardZones'
import { killPlayer } from './rules/death'
import { pushDying } from './rules/dying'
import { assertEnergyBounds, payEnergy, refillEnergy } from './rules/energy'
import {
  checkActivate,
  checkDiscard,
  checkEndPhase,
  checkPlayCardAsDefend,
  checkTriggerChoice,
  checkUseCard,
  ensure,
} from './rules/legality'
import { buildTurnPlan, finishPhaseBody } from './rules/phase'
import { assertThreatBounds } from './rules/threat'
import { advanceTurn, INITIAL_HAND } from './rules/turn'
import { useVariantOf } from './skills'
import { newCardUseRecord } from './rules/usage'
import { runEffectGroup, runEffects } from './dsl/effect'
import { runTrigger } from './dsl/event'
import type { UseContext } from './dsl/kinds'
import { cardDoc, skillDoc } from './dsl/registry'
import type { EffectContext } from './dsl/runtime'
import { resolveTargetChoice, resolveTargetChoices } from './dsl/target'
import type {
  Action,
  Card,
  CardKind,
  Frame,
  GameState,
  SpeciesId,
  PlayerIndex,
  PlayerState,
  Prompt,
  VirtualCard,
} from './types'
import { RuleError } from './util'

const DRAFT_SIZE = 3
/** 玩家固定使用下标 0，AI 使用下标 1 */
const PLAYER: PlayerIndex = 0
const AI: PlayerIndex = 1
/** 结算推进步数上限，用于把死循环变成显式报错 */
const MAX_ADVANCE_STEPS = 10000

export interface DraftRoll {
  playerOptions: SpeciesId[]
  rngState: number
}

/**
 * 随机抽将：从全部物种中抽 3 个作为玩家候选。
 * AI 的候选在玩家选定后才确定（见 createGame）：除玩家所选之外的全部物种。
 * 纯函数，同 seed 必定同结果。
 *
 * 这里只负责抽样物种：牌组是每个物种私有的，只有在双方物种都确定之后
 * （createGame）才能构建并洗牌，所以抽将阶段不再预洗任何牌组。
 */
export function rollDraft(seed: number): DraftRoll {
  const first = sample(SPECIES_IDS, DRAFT_SIZE, seed)
  return { playerOptions: first.values, rngState: first.state }
}

export interface CreateGameOptions {
  seed: number
  /** 玩家选定的物种，必须属于 rollDraft(seed).playerOptions */
  playerSpecies: SpeciesId
  /** 指定 AI 的物种；缺省时由 AI 从「除玩家所选之外」的物种里随机选 1 个（测试与调试用） */
  aiSpecies?: SpeciesId
  /** 先手玩家，默认玩家（0） */
  firstPlayer?: PlayerIndex
}

/**
 * 创建一局：确定双方物种 → 各自洗一副私有牌组 → 各摸 4 张起手牌
 * → 推进到玩家的第一个出牌阶段。返回时 state.pending 已经就绪，可以直接 submit。
 */
export function createGame(options: CreateGameOptions): GameState {
  const { seed, playerSpecies } = options
  const firstPlayer = options.firstPlayer ?? PLAYER

  const draft = rollDraft(seed)
  if (!draft.playerOptions.includes(playerSpecies)) {
    throw new RuleError(`选将非法：${playerSpecies} 不在本次候选之中`)
  }

  let aiSpecies: SpeciesId
  let rngState = draft.rngState
  if (options.aiSpecies) {
    if (options.aiSpecies === playerSpecies || !SPECIES_IDS.includes(options.aiSpecies)) {
      throw new RuleError(
        `AI 选将非法：${options.aiSpecies} 不可选（不能与玩家同种，且必须是已知物种）`,
      )
    }
    aiSpecies = options.aiSpecies
  } else {
    const candidates = SPECIES_IDS.filter((id) => id !== playerSpecies)
    const aiPick = pickOne(candidates, rngState)
    aiSpecies = aiPick.value
    rngState = aiPick.state
  }

  const firstDeck = shuffle(buildDeck(playerSpecies, 0), rngState)
  // 玩家 1 的 uid 从玩家 0 的牌组之后开始分配，保证全局唯一
  const secondDeck = shuffle(buildDeck(aiSpecies, firstDeck.items.length), firstDeck.state)

  const makePlayer = (index: PlayerIndex, species: SpeciesId, deck: Card[]): PlayerState => ({
    index,
    species,
    hp: SPECIES[species].maxHp,
    maxHp: SPECIES[species].maxHp,
    alive: true,
    hand: [],
    deck,
    discard: [],
    // 能量上限由技能决定（见 rules/energy.ts），因此先置 0 再统一回满
    energy: 0,
    threat: 0,
    usedCardsThisTurn: newCardUseRecord(),
    usedSkillsThisTurn: [],
  })

  const state: GameState = {
    seed,
    rngState: secondDeck.state,
    processing: [],
    players: [
      makePlayer(PLAYER, playerSpecies, firstDeck.items),
      makePlayer(AI, aiSpecies, secondDeck.items),
    ],
    active: firstPlayer,
    firstPlayer,
    turn: 1,
    phase: 'turn-start',
    phaseStage: 'start',
    phaseQueue: buildTurnPlan(),
    pending: null,
    stack: [],
    lastDamage: null,
    log: [],
    result: null,
  }

  log(state, `对局开始：${playerLabel(state, PLAYER)} 对阵 ${playerLabel(state, AI)}`)
  // 开局双方能量回满（此后每个回合开始时各自回满）
  refillEnergy(state, PLAYER)
  refillEnergy(state, AI)
  drawCards(state, PLAYER, INITIAL_HAND)
  drawCards(state, AI, INITIAL_HAND)
  log(state, `双方各摸 ${INITIAL_HAND} 张起手牌`)

  advance(state)
  assertConservation(state)
  assertEnergyBounds(state)
  assertThreatBounds(state)
  return state
}

export function getPending(state: GameState): Prompt | null {
  return state.pending
}

export function isOver(state: GameState): boolean {
  return state.result !== null
}

/**
 * 提交一个动作：先校验（不通过则抛规则错误且状态不变）→ 应用 → 自动推进
 * → 校验牌数守恒与能量不变式。
 */
export function submit(state: GameState, action: Action): void {
  if (state.result) throw new RuleError('对局已经结束')
  applyAction(state, action)
  advance(state)
  assertConservation(state)
  assertEnergyBounds(state)
  assertThreatBounds(state)
}

/**
 * 自动推进：反复处理结算栈顶与回合流程，
 * 直到停在需要（人或 AI）输入的点上或对局结束。
 */
export function advance(state: GameState): void {
  let guard = 0
  while (true) {
    if (++guard > MAX_ADVANCE_STEPS) {
      throw new Error('结算推进步数超限，疑似死循环')
    }
    if (state.result) {
      state.pending = null
      return
    }

    const top = state.stack[state.stack.length - 1]
    if (top) {
      if (stepFrame(state, top)) return
      continue
    }

    // 结算栈已空，交给回合流程；回合流程可能又压入结算帧（例如消耗战导致濒死）
    state.pending = null
    if (advanceTurn(state) === 'continue') continue
    return
  }
}

/** 推进栈顶帧；返回 true 表示已经生成待输入项（应立即返回给调用方） */
function stepFrame(state: GameState, top: Frame): boolean {
  switch (top.kind) {
    case 'contest': {
      // need 为 0 或已凑够响应牌，都视为对抗结束：结算收尾后返回
      if (top.need <= 0 || top.got >= top.need) {
        state.stack.pop()
        state.stack.push({ kind: 'flush', cards: top.spent })
        return false
      }
      state.pending = {
        kind: 'respond',
        player: top.target,
        expected: top.expected,
        need: top.need,
        got: top.got,
        source: top.source,
        card: top.card,
      }
      return true
    }

    case 'damage': {
      const trigger = top.triggers[0]
      if (trigger) {
        if (!trigger.optional) {
          // 不可选的触发立即执行（仍在濒死检查之前）
          top.triggers.shift()
          runTrigger(state, trigger, { damage: top.ctx })
          return false
        }
        state.pending = { kind: 'trigger', player: trigger.owner, skill: trigger.skill }
        return true
      }
      state.stack.pop()
      const target = state.players[top.ctx.target]
      if (target.alive && target.hp <= 0) pushDying(state, top.ctx.target)
      return false
    }

    case 'dying': {
      const next = top.ask[0]
      if (next === undefined) {
        // 无人救援：死亡结算
        state.stack.pop()
        killPlayer(state, top.dying)
        return false
      }
      state.pending = { kind: 'dying', player: next, dying: top.dying }
      return true
    }

    case 'flush': {
      flushProcessing(state, top.cards)
      state.stack.pop()
      return false
    }

    case 'effects': {
      // 延迟效果帧：当前结算链走完后执行（after 列表）
      state.stack.pop()
      runEffects(state, top.effects, top.ctx)
      return false
    }
  }
}

function requireInHand(state: GameState, p: PlayerIndex, card: Card): Card {
  const real = findInHand(state, p, card.uid)
  if (!real) throw new RuleError('这张牌不在你的手牌中')
  return real
}

function applyAction(state: GameState, action: Action): void {
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
  if (!top || top.kind !== 'damage') {
    throw new RuleError('结算栈异常：缺少伤害结算帧')
  }
  const trigger = top.triggers.shift()
  if (trigger === undefined || trigger.skill !== pending.skill) {
    throw new RuleError('结算栈异常：待应答技能不匹配')
  }

  if (!action.accept) {
    log(state, `${playerLabel(state, p)} 放弃发动【${skillDef(trigger.skill).name}】`)
    return
  }

  runTrigger(state, trigger, { damage: top.ctx })
}

function applyDiscard(state: GameState, action: Extract<Action, { kind: 'discard-cards' }>): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'discard') throw new RuleError('当前不是弃牌阶段')
  const p = pending.player
  ensure(checkDiscard(state, p, action.cards))

  const names: string[] = []
  for (const card of action.cards) {
    const real = requireInHand(state, p, card)
    moveHandToDiscard(state, p, real)
    names.push(plainLabel(real))
  }
  log(state, `${playerLabel(state, p)} 弃置了 ${action.cards.length} 张手牌：${names.join('、')}`)
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
