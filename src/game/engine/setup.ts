import { buildDeck } from '../data/deck'
import { SPECIES, SPECIES_IDS } from '../data/species'
import { log, playerLabel } from '../log'
import { pickOne, sample, shuffle } from '../rng'
import { assertConservation, drawCards } from '../rules/cardZones'
import { assertEnergyBounds, refillEnergy } from '../rules/energy'
import { buildTurnPlan } from '../rules/phase'
import { assertThreatBounds } from '../rules/threat'
import { INITIAL_HAND } from '../rules/turn'
import { newCardUseRecord } from '../rules/usage'
import type { Card, GameState, PlayerIndex, PlayerState, SpeciesId } from '../types'
import { RuleError } from '../util'
import { advance } from './stack'

/**
 * 开局：抽将、建局。
 *
 * 只负责"把一局摆好并推进到第一个待输入项"，不参与之后的动作应用与结算推进
 * （见 ./actions.ts 与 ./stack.ts）。这里也是唯一会调用 advance() 来做"开局推进"
 * 的地方——submit() 的那次调用在 ./index.ts。
 */

/** 玩家固定使用下标 0，AI 使用下标 1 */
const PLAYER: PlayerIndex = 0
const AI: PlayerIndex = 1

/** 抽将候选个数 */
const DRAFT_SIZE = 3

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
