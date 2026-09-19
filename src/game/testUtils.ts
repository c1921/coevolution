import { buildDeck } from './data/deck'
import { SPECIES } from './data/species'
import { refillEnergy } from './rules/energy'
import { TURN_PHASES, buildTurnPlan } from './rules/phase'
import { newCardUseRecord } from './rules/usage'
import type {
  Card,
  CardKind,
  GameState,
  SpeciesId,
  Phase,
  PhaseStage,
  PlayerIndex,
  PlayerState,
  TurnPhase,
} from './types'

export interface HandSpec {
  kind: CardKind
}

/** 从牌池中取出一张指定牌种的牌（取出后牌池不再包含它） */
export function pullCard(pool: Card[], kind: CardKind): Card {
  const i = pool.findIndex((c) => c.kind === kind)
  if (i < 0) throw new Error(`牌池中没有 ${kind}`)
  return pool.splice(i, 1)[0] as Card
}

export interface MakeStateOptions {
  playerSpecies: SpeciesId
  aiSpecies: SpeciesId
  /** 玩家（下标 0）手牌，按给定顺序从自己的私有牌组取出 */
  playerHand?: HandSpec[]
  /** AI（下标 1）手牌，从自己的私有牌组取出 */
  aiHand?: HandSpec[]
  playerHp?: number
  aiHp?: number
  /** 玩家（下标 0）的当前能量；缺省为上限（回合开始时回满后的常态） */
  playerEnergy?: number
  /** AI（下标 1）的当前能量；缺省为上限 */
  aiEnergy?: number
  /** 玩家（下标 0）的当前威胁点数；缺省 0 */
  playerThreat?: number
  /** AI（下标 1）的当前威胁点数；缺省 0 */
  aiThreat?: number
  /** 当前回合角色，默认玩家 */
  active?: PlayerIndex
  phase?: Phase
  /** 当前阶段的子步骤，默认 'start'（状态处在阶段的起点） */
  phaseStage?: PhaseStage
  /** 本回合尚余的阶段计划，缺省按 phase 推导 */
  phaseQueue?: TurnPhase[]
  seed?: number
}

/** 按当前阶段推导「本回合尚余的阶段计划」 */
function defaultQueueFor(phase: Phase): TurnPhase[] {
  if (phase === 'turn-start') return buildTurnPlan()
  if (phase === 'turn-end' || phase === 'game-over') return []
  return TURN_PHASES.slice(TURN_PHASES.indexOf(phase) + 1)
}

/**
 * 构造一个手牌完全可控的对局状态，便于精确断言结算结果。
 * 双方各自拥有一副 20 张私有牌组：手牌从各自的牌组里取，剩下的留在各自的牌组中。
 */
export function makeState(o: MakeStateOptions): GameState {
  const playerDeck = buildDeck(o.playerSpecies, 0)
  const aiDeck = buildDeck(o.aiSpecies, playerDeck.length)
  const playerHand = (o.playerHand ?? []).map((s) => pullCard(playerDeck, s.kind))
  const aiHand = (o.aiHand ?? []).map((s) => pullCard(aiDeck, s.kind))

  const active: PlayerIndex = o.active ?? 0
  const phase: Phase = o.phase ?? 'play'
  const phaseStage: PhaseStage = o.phaseStage ?? 'start'
  const phaseQueue: TurnPhase[] = o.phaseQueue ?? defaultQueueFor(phase)

  const makePlayer = (
    index: PlayerIndex,
    species: SpeciesId,
    hand: Card[],
    deck: Card[],
    hp: number | undefined,
  ): PlayerState => ({
    index,
    species,
    hp: hp ?? SPECIES[species].maxHp,
    maxHp: SPECIES[species].maxHp,
    alive: true,
    hand,
    deck,
    discard: [],
    removed: [],
    // 先置 0，构造完 state 后统一回满（上限可能带技能修正）
    energy: 0,
    threat: 0,
    usedCardsThisTurn: newCardUseRecord(),
    usedSkillsThisTurn: [],
  })

  const state: GameState = {
    seed: o.seed ?? 1,
    rngState: o.seed ?? 1,
    processing: [],
    players: [
      makePlayer(0, o.playerSpecies, playerHand, playerDeck, o.playerHp),
      makePlayer(1, o.aiSpecies, aiHand, aiDeck, o.aiHp),
    ],
    nextUid: playerDeck.length + aiDeck.length + playerHand.length + aiHand.length,
    cardTotal: playerDeck.length + aiDeck.length + playerHand.length + aiHand.length,
    active,
    firstPlayer: 0,
    turn: 1,
    phase,
    phaseStage,
    phaseQueue,
    pending: phase === 'play' ? { kind: 'play', player: active } : null,
    stack: [],
    lastDamage: null,
    log: [],
    result: null,
  }

  // 默认双方能量都是满的（等价于「回合开始时回满」的常态），可按需覆盖
  refillEnergy(state, 0)
  refillEnergy(state, 1)
  if (o.playerEnergy !== undefined) state.players[0].energy = o.playerEnergy
  if (o.aiEnergy !== undefined) state.players[1].energy = o.aiEnergy
  if (o.playerThreat !== undefined) state.players[0].threat = o.playerThreat
  if (o.aiThreat !== undefined) state.players[1].threat = o.aiThreat

  return state
}

/** 把玩家 0 牌组中的某张牌移到牌组顶（drawCards 从数组末尾取牌） */
export function topOfDeck(state: GameState, kind: CardKind): Card {
  const card = pullCard(state.players[0].deck, kind)
  state.players[0].deck.push(card)
  return card
}

/** 深拷贝，用于断言"非法动作不修改状态" */
export function snapshot(state: GameState): GameState {
  return structuredClone(state)
}

export function handUids(state: GameState, p: PlayerIndex): number[] {
  return state.players[p].hand.map((c) => c.uid)
}

/** 最后一条战报，便于断言可读流程 */
export function lastLog(state: GameState): string {
  return state.log[state.log.length - 1]?.text ?? ''
}

export function logTexts(state: GameState): string {
  return state.log.map((e) => e.text).join('\n')
}
