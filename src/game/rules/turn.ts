import { log, playerLabel } from '../log'
import type { GameState, PlayerIndex, TurnPhase } from '../types'
import { otherPlayer } from '../util'
import { drawCards } from './cardZones'
import { loseHp } from './damage'
import { energyTag, refillEnergy } from './energy'
import { buildTurnPlan, finishPhaseBody, runTiming, takeNextPhase } from './phase'
import type { TimingEffect } from './phase'
import { resetTurnUsage } from './usage'

/** 摸牌数：摸牌阶段默认摸两张牌 */
export const DRAW_PER_TURN = 2
/** 先手玩家第一回合的摸牌数：先手补偿，先手少摸一张 */
export const FIRST_TURN_DRAW = 1
/** 起手手牌数 */
export const INITIAL_HAND = 4

/**
 * 消耗战（加时规则）：从这一回合开始，每回合开始时回合角色失去体力。
 * 三张基本牌的 1v1 里双方可以互相抵消到天荒地老（例如鹿每回合回 1 点、
 * 疾影把每次【打击】都挡掉），牌堆又会无限洗回，因此必须有一条终止压力。
 * 体力流失每 ATTRITION_STEP 回合 +1，最终必定超过任何回复能力，保证对局必然结束。
 */
export const ATTRITION_TURN = 21
export const ATTRITION_STEP = 5

/** 第 turn 回合的消耗战体力流失量（0 表示尚未进入消耗战） */
export function attritionLoss(turn: number): number {
  if (turn < ATTRITION_TURN) return 0
  return 1 + Math.floor((turn - ATTRITION_TURN) / ATTRITION_STEP)
}

/** 「回合开始时」时机上的消耗战效果（本作自有的终止规则） */
function applyAttrition(state: GameState): void {
  const loss = attritionLoss(state.turn)
  if (loss <= 0) return
  if (state.turn === ATTRITION_TURN) {
    log(
      state,
      `消耗战开始：此后每回合开始时，回合角色失去体力（每 ${ATTRITION_STEP} 回合递增 1 点）`,
    )
  }
  log(state, `消耗战：${playerLabel(state, state.active)} 失去 ${loss} 点体力`)
  loseHp(state, state.active, loss)
}

/**
 * 已注册的规则效果表。回合开始时目前只有消耗战；
 * 将来的判定类效果、「阶段开始时」类技能都挂在这张表上。
 */
export const TURN_TIMING_EFFECTS: readonly TimingEffect[] = [
  { id: 'attrition', at: { at: 'turn-start' }, run: applyAttrition },
]

/**
 * 摸牌数：默认 DRAW_PER_TURN；先手角色的第一个回合为 FIRST_TURN_DRAW（先手补偿）。
 * 将来出现「摸牌数 +1」类技能或效果时在这里叠加修正，并保证结果不为负。
 */
export function drawCount(state: GameState, p: PlayerIndex): number {
  const base =
    state.turn === 1 && p === state.firstPlayer ? FIRST_TURN_DRAW : DRAW_PER_TURN
  return Math.max(0, base)
}

/** 手牌上限：默认等于当前体力值（体力值按不小于 0 计算） */
export function handLimit(state: GameState, p: PlayerIndex): number {
  return Math.max(0, state.players[p].hp)
}

/** 弃牌阶段需要弃置的张数：手牌数超过手牌上限的部分 */
export function discardCount(state: GameState, p: PlayerIndex): number {
  return Math.max(0, state.players[p].hand.length - handLimit(state, p))
}

/** advanceTurn 的推进结果 */
export type TurnProgress =
  /** 已生成待输入项，等待人或 AI 决策 */
  | 'pending'
  /** 推进过程中压入了结算帧（例如消耗战导致濒死），调用方应继续处理结算栈 */
  | 'continue'
  /** 对局已结束 */
  | 'over'

/**
 * 一个回合最多经过的子步骤数：回合开始时(3) + 六个阶段(各 3) + 回合结束时(3)。
 * 额外阶段会加长流程，所以留出充裕余量，只用于把死循环变成显式报错。
 */
const MAX_TURN_STEPS = 256

/**
 * 推进回合流程（六个阶段）。
 * 遇到需要决策的点返回 'pending'；压入结算帧返回 'continue'；终局返回 'over'。
 *
 * 核心约定：每个子步骤都**先把游标前移，再产生效果**。
 * 因此效果导致的濒死等结算把流程打断后，恢复时只会从下一个子步骤继续，
 * 不会重复执行已经结算过的步骤（例如消耗战不会在同一个回合扣两次体力）。
 */
export function advanceTurn(
  state: GameState,
  effects: readonly TimingEffect[] = TURN_TIMING_EFFECTS,
): TurnProgress {
  let guard = 0
  while (true) {
    if (++guard > MAX_TURN_STEPS) throw new Error('回合推进步数超限，疑似死循环')
    if (state.result) return 'over'
    if (state.phase === 'game-over') return 'over'
    // 上一子步骤压入了结算帧：交还给结算栈，等它结算完再继续推进回合
    if (state.stack.length > 0) return 'continue'

    switch (state.phase) {
      case 'turn-start':
      case 'turn-end':
        stepTurnTiming(state, state.phase, effects)
        break

      default: {
        const progress = stepPhase(state, state.phase, effects)
        if (progress === 'pending') return 'pending'
        break
      }
    }
  }
}

/** 「回合开始时」「回合结束时」两个时机（位于准备阶段之前 / 结束阶段之后） */
function stepTurnTiming(
  state: GameState,
  timing: 'turn-start' | 'turn-end',
  effects: readonly TimingEffect[],
): void {
  switch (state.phaseStage) {
    case 'start': {
      state.phaseStage = 'body'
      if (timing === 'turn-start') {
        const active = state.players[state.active]
        if (!active.alive) {
          // 防御性兜底：正常路径下阵亡会立即终局（见 death.ts），这里避免给阵亡角色开回合
          const winner = otherPlayer(state.active)
          state.result = { winner }
          state.phase = 'game-over'
          log(state, `${playerLabel(state, winner)} 获胜！`)
          return
        }
        // 使用次数在回合开始时重置，能量在回合开始时回复至上限（先回满再写回合标题，
        // 标题里的能量才是本回合的起始值）。位置在「回合开始时」的规则效果（消耗战等）
        // 之前，因此因消耗战进入濒死的角色看到的是回满后的能量。
        resetTurnUsage(state, state.active)
        refillEnergy(state, state.active)
        log(
          state,
          `—— 第 ${state.turn} 回合 · ${playerLabel(state, state.active)}${energyTag(state, state.active)} ——`,
        )
        // 本回合的阶段计划：可被「跳过阶段」删减，也可插入「额外的阶段」
        state.phaseQueue = buildTurnPlan()
      }
      break
    }

    case 'body': {
      state.phaseStage = 'end'
      // 回合开始时：消耗战等规则效果；回合结束时：本作暂无（将来的时机类技能挂这里）
      runTiming(state, { at: timing }, effects)
      break
    }

    case 'end': {
      state.phaseStage = 'start'
      if (timing === 'turn-start') {
        state.phase = takeNextPhase(state)
      } else {
        // 回合结束后由下一名角色开始回合（将来若有额外回合，在此优先插入）
        state.active = otherPlayer(state.active)
        state.turn += 1
        state.phase = 'turn-start'
      }
      break
    }
  }
}

/** 六个阶段：阶段开始时 → 阶段进行 → 阶段结束时 */
function stepPhase(
  state: GameState,
  phase: TurnPhase,
  effects: readonly TimingEffect[],
): 'pending' | 'done' {
  switch (state.phaseStage) {
    case 'start': {
      state.phaseStage = 'body'
      runTiming(state, { at: 'phase-start', phase }, effects)
      return 'done'
    }

    case 'body':
      return runPhaseBody(state, phase)

    case 'end': {
      // 游标先移出本阶段，再执行「阶段结束时」的规则效果
      state.phaseStage = 'start'
      state.phase = takeNextPhase(state)
      runTiming(state, { at: 'phase-end', phase }, effects)
      return 'done'
    }
  }
}

/** 各阶段的默认效果（规则规定的结算内容） */
function runPhaseBody(state: GameState, phase: TurnPhase): 'pending' | 'done' {
  switch (phase) {
    case 'prepare':
    case 'judge':
    case 'end':
      // 准备阶段 / 结束阶段：本作没有需要在此结算的效果。
      // 判定阶段：本作没有需要判定的内容，保留为空阶段作为扩展点。
      finishPhaseBody(state)
      return 'done'

    case 'draw': {
      // 先移游标再摸牌：摸牌本身不会压栈，但仍遵守「先移游标、后产生效果」的约定
      finishPhaseBody(state)
      const p = state.active
      const drawn = drawCards(state, p, drawCount(state, p))
      log(state, `${playerLabel(state, p)} 摸了 ${drawn.length} 张牌`)
      return 'done'
    }

    case 'play':
      // 出牌阶段由回合角色自行结束（end-phase），阶段游标停在「阶段进行」
      state.pending = { kind: 'play', player: state.active }
      return 'pending'

    case 'discard': {
      const p = state.active
      const count = discardCount(state, p)
      if (count > 0) {
        state.pending = { kind: 'discard', player: p, count }
        return 'pending'
      }
      finishPhaseBody(state)
      return 'done'
    }
  }
}
