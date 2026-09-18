import type { Timing } from '../dsl/types'
import { log, playerLabel } from '../log'
import type { GameState, Phase, TurnPhase } from '../types'

/**
 * 回合阶段与时机。
 *
 * 一个回合由六个阶段按固定顺序组成：
 *   准备阶段 → 判定阶段 → 摸牌阶段 → 出牌阶段 → 弃牌阶段 → 结束阶段
 * 「回合开始时」位于准备阶段之前，「回合结束时」位于结束阶段之后；
 * 每个阶段本身又分为「阶段开始时 → 阶段进行 → 阶段结束时」三个子步骤。
 * 本作的判定阶段没有需要判定的内容，保留为空阶段作为扩展点。
 */

/** 六个阶段，顺序固定 */
export const TURN_PHASES: readonly TurnPhase[] = [
  'prepare',
  'judge',
  'draw',
  'play',
  'discard',
  'end',
]

/** 阶段/时机的中文名：战报与界面共用同一份命名 */
export const PHASE_NAME: Record<Phase, string> = {
  'turn-start': '回合开始时',
  prepare: '准备阶段',
  judge: '判定阶段',
  draw: '摸牌阶段',
  play: '出牌阶段',
  discard: '弃牌阶段',
  end: '结束阶段',
  'turn-end': '回合结束时',
  'game-over': '对局结束',
}

/**
 * 一个回合的阶段计划。每次调用都新建数组——计划会被「跳过阶段」与
 * 「额外的阶段」就地修改，绝不能跨回合共享同一个数组。
 */
export function buildTurnPlan(): TurnPhase[] {
  return [...TURN_PHASES]
}

/** 取计划中的下一个阶段；计划已空则进入「回合结束时」 */
export function takeNextPhase(state: GameState): Phase {
  return state.phaseQueue.shift() ?? 'turn-end'
}

/**
 * 跳过本回合尚未开始的某个阶段（如「跳过出牌阶段」这类效果）。
 * 规范做法是在同一回合更早的阶段里调用它，例如判定类效果结算完成后。
 *
 * 本回合的阶段计划在「回合开始时」生成，因此：
 *  - 只能跳过当前回合尚未进行的阶段，已经进行中的阶段返回 false；
 *  - 在回合开始之前调用不会影响新回合（新回合会重新生成计划）。
 */
export function skipPhase(state: GameState, phase: TurnPhase): boolean {
  if (state.phase === phase) return false
  const at = state.phaseQueue.indexOf(phase)
  if (at < 0) return false
  state.phaseQueue.splice(at, 1)
  log(state, `${playerLabel(state, state.active)} 跳过了${PHASE_NAME[phase]}`)
  return true
}

/**
 * 插入一个额外阶段（如额外的摸牌阶段 / 额外的出牌阶段）。
 * position='next' 紧接当前阶段之后，'last' 放在本回合最后；同样只作用于当前回合。
 */
export function addExtraPhase(
  state: GameState,
  phase: TurnPhase,
  position: 'next' | 'last' = 'next',
): void {
  if (position === 'last') state.phaseQueue.push(phase)
  else state.phaseQueue.unshift(phase)
  log(state, `${playerLabel(state, state.active)} 获得一个额外的${PHASE_NAME[phase]}`)
}

/**
 * 当前阶段的「阶段进行」已完成（出牌阶段由「结束出牌阶段」结束、弃牌阶段由弃牌完成），
 * 交回回合循环去执行「阶段结束时」并推进到下一个阶段。
 */
export function finishPhaseBody(state: GameState): void {
  state.phaseStage = 'end'
}

/**
 * 时机：引擎在这些固定时点依次执行已注册的规则效果。
 * 定义在 dsl/types.ts（DSL 的规则与技能都挂在同一套时机上，含 after-damage），
 * 这里复用以免两处漂移。
 */
export type { Timing }

export function sameTiming(a: Timing, b: Timing): boolean {
  if (a.at !== b.at) return false
  if (a.at === 'phase-start' && b.at === 'phase-start') return a.phase === b.phase
  if (a.at === 'phase-end' && b.at === 'phase-end') return a.phase === b.phase
  return true
}

