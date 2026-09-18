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
  moveHandToProcessing,
} from './rules/cardZones'
import { killPlayer } from './rules/death'
import { pushDying } from './rules/dying'
import {
  assertEnergyBounds,
  energyTag,
  payEnergy,
  refillEnergy,
} from './rules/energy'
import {
  checkActivate,
  checkDiscard,
  checkEndPhase,
  checkPlayCardAsDefend,
  checkTriggerChoice,
  checkUseCard,
  ensure,
} from './rules/legality'
import { pushStrike } from './rules/respond'
import { buildTurnPlan, finishPhaseBody } from './rules/phase'
import { advanceTurn, INITIAL_HAND } from './rules/turn'
import { newCardUseRecord, recordCardUse } from './rules/usage'
import { runEffects } from './dsl/effect'
import { applyActiveSkill, applyTriggerSkill } from './skills/effects'
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
  SkillId,
} from './types'
import { otherPlayer, RuleError } from './util'

const DRAFT_SIZE = 3
/** 玩家固定使用下标 0，AI 使用下标 1 */
const PLAYER: PlayerIndex = 0
const AI: PlayerIndex = 1
/** 结算推进步数上限，用于把死循环变成显式报错 */
const MAX_ADVANCE_STEPS = 10000

export interface DraftRoll {
  playerOptions: SpeciesId[]
  aiOptions: SpeciesId[]
  rngState: number
}

/**
 * 随机抽将：玩家先抽 3 个物种，AI 从剩余池再抽 3 个（双方候选互不重复）。
 * 纯函数，同 seed 必定同结果。
 *
 * 这里只负责抽样物种：牌组是每个物种私有的，只有在双方物种都确定之后
 * （createGame）才能构建并洗牌，所以抽将阶段不再预洗任何牌组。
 */
export function rollDraft(seed: number): DraftRoll {
  const first = sample(SPECIES_IDS, DRAFT_SIZE, seed)
  const rest = SPECIES_IDS.filter((id) => !first.values.includes(id))
  const second = sample(rest, DRAFT_SIZE, first.state)

  return { playerOptions: first.values, aiOptions: second.values, rngState: second.state }
}

export interface CreateGameOptions {
  seed: number
  /** 玩家选定的物种，必须属于 rollDraft(seed).playerOptions */
  playerSpecies: SpeciesId
  /** 指定 AI 的物种；缺省时由 AI 从自己的候选里随机选 1 个（测试与调试用） */
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
    if (!draft.aiOptions.includes(options.aiSpecies)) {
      throw new RuleError(`AI 选将非法：${options.aiSpecies} 不在本次候选之中`)
    }
    aiSpecies = options.aiSpecies
  } else {
    const aiPick = pickOne(draft.aiOptions, rngState)
    aiSpecies = aiPick.value
    rngState = aiPick.state
  }

  const firstDeck = shuffle(buildDeck(playerSpecies, 0), rngState)
  // 玩家 1 的 uid 从玩家 0 的牌组之后开始分配，保证全局唯一
  const secondDeck = shuffle(buildDeck(aiSpecies, firstDeck.items.length), firstDeck.state)

  const makePlayer = (
    index: PlayerIndex,
    species: SpeciesId,
    deck: Card[],
  ): PlayerState => ({
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

function describeUse(
  state: GameState,
  p: PlayerIndex,
  target: PlayerIndex,
  card: Card,
  as: CardKind,
  via?: SkillId,
): string {
  const who = playerLabel(state, p)
  const whom = playerLabel(state, target)
  if (via) {
    return `${who} 发动【${skillDef(via).name}】，将 ${plainLabel(card)} 当【${CARD_NAME[as]}】对 ${whom} 使用`
  }
  return `${who} 对 ${whom} 使用${plainLabel(card)}`
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

function applyUseCard(
  state: GameState,
  action: Extract<Action, { kind: 'use-card' }>,
): void {
  const pending = state.pending
  if (!pending || (pending.kind !== 'play' && pending.kind !== 'dying')) {
    throw new RuleError('当前不是使用牌的时机')
  }
  const p = pending.player
  const as: CardKind = action.as ?? action.card.kind
  ensure(checkUseCard(state, p, action.card, as, action.via))
  const card = requireInHand(state, p, action.card)
  // 付费按「当作的牌面」：转化牌付转化后那张牌的费用
  payEnergy(state, p, as)

  if (pending.kind === 'dying') {
    moveHandToDiscard(state, p, card)
    const dying = state.players[pending.dying]
    dying.hp = Math.min(dying.hp + 1, dying.maxHp)
    log(
      state,
      `${playerLabel(state, p)} 使用${plainLabel(card)}救援 ${playerLabel(state, pending.dying)}（体力 ${dying.hp}/${dying.maxHp}）${energyTag(state, p)}`,
    )
    if (dying.hp > 0) {
      const top = state.stack[state.stack.length - 1]
      if (top && top.kind === 'dying') state.stack.pop()
      log(state, `${playerLabel(state, pending.dying)} 脱离濒死状态`)
    }
    return
  }

  const player = state.players[p]

  if (as === 'strike') {
    const target = otherPlayer(p)
    moveHandToProcessing(state, p, card)
    // 记录「使用次数」（只作统计，【打击】已无次数限制）；转化牌按当作的牌名计数
    recordCardUse(state, p, 'strike')
    log(state, `${describeUse(state, p, target, card, 'strike', action.via)}${energyTag(state, p)}`)
    // S8：这段「未抵消即造成 1 点伤害」改由 cards/strike.json 的 contest.onUnmet 提供
    pushStrike(
      state,
      p,
      target,
      action.via ? { as: 'strike', source: card, via: action.via } : { as: 'strike', source: card },
      [{ kind: 'damage', target: 'target', amount: { kind: 'const', value: 1 } }],
    )
    return
  }

  if (as === 'heal') {
    moveHandToDiscard(state, p, card)
    player.hp = Math.min(player.hp + 1, player.maxHp)
    if (action.via) {
      log(
        state,
        `${playerLabel(state, p)} 发动【${skillDef(action.via).name}】，将 ${plainLabel(card)} 当【回复】使用，体力回复至 ${player.hp}/${player.maxHp}${energyTag(state, p)}`,
      )
    } else {
      log(
        state,
        `${playerLabel(state, p)} 使用${plainLabel(card)}，体力回复至 ${player.hp}/${player.maxHp}${energyTag(state, p)}`,
      )
    }
    return
  }

  throw new RuleError(`无法在出牌阶段使用【${CARD_NAME[as]}】`)
}

function applyPlayCard(
  state: GameState,
  action: Extract<Action, { kind: 'play-card' }>,
): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'respond') {
    throw new RuleError('当前不是打出【防御】的时机')
  }
  const p = pending.player
  const as: CardKind = action.as ?? action.card.kind
  ensure(checkPlayCardAsDefend(state, p, action.card, as, action.via))
  const card = requireInHand(state, p, action.card)
  // 响应【打击】也要付费：能量不足就只能放弃响应
  payEnergy(state, p, as)

  const top = state.stack[state.stack.length - 1]
  if (!top || top.kind !== 'contest') {
    throw new RuleError('结算栈异常：缺少对抗结算帧')
  }

  moveHandToProcessing(state, p, card)
  top.spent.push({ card, owner: p })
  top.got += 1

  if (action.via) {
    log(
      state,
      `${playerLabel(state, p)} 发动【${skillDef(action.via).name}】，将 ${plainLabel(card)} 当【防御】打出${energyTag(state, p)}`,
    )
  } else {
    log(state, `${playerLabel(state, p)} 打出${plainLabel(card)}${energyTag(state, p)}`)
  }

  if (top.got >= top.need) {
    log(state, `【${CARD_NAME[top.expected]}】被抵消`)
  } else {
    log(
      state,
      `${playerLabel(state, p)} 还需再打出 ${top.need - top.got} 张【${CARD_NAME[top.expected]}】才能抵消`,
    )
  }
}

function applyActivate(
  state: GameState,
  action: Extract<Action, { kind: 'activate' }>,
): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'play') throw new RuleError('现在不是你的出牌阶段')
  const p = pending.player
  ensure(checkActivate(state, p, action.skill, action.cards, action.target))
  applyActiveSkill(state, p, action.skill, action.cards?.[0], action.target ?? p)
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

  applyTriggerSkill(state, p, trigger.skill, top.ctx)
}

function applyDiscard(
  state: GameState,
  action: Extract<Action, { kind: 'discard-cards' }>,
): void {
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
  log(
    state,
    `${playerLabel(state, p)} 弃置了 ${action.cards.length} 张手牌：${names.join('、')}`,
  )
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
