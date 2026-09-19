import { describe, expect, it } from 'vitest'
import { logTexts, makeState } from '../testUtils'
import type { GameState } from '../types'
import { loseHp } from './damage'
import {
  PHASE_NAME,
  TURN_PHASES,
  addExtraPhase,
  buildTurnPlan,
  finishPhaseBody,
  sameTiming,
  skipPhase,
} from './phase'
import { advanceTurn } from './turn'
import type { TimingRunner } from './turn'

/**
 * 探针：记录引擎在整局流程中触发过的全部时机，用于验证阶段顺序。
 * 时机派发已由 DSL 注册表承担，测试通过注入 TimingRunner 观察时机序列。
 */
function makeProbe(): { seen: string[]; run: TimingRunner } {
  const seen: string[] = []
  const run: TimingRunner = (_state, timing) => {
    if (timing.at === 'phase-start' || timing.at === 'phase-end') {
      const prefix = timing.at === 'phase-start' ? 'start' : 'end'
      seen.push(`${prefix}:${timing.phase}`)
      return
    }
    seen.push(timing.at)
  }
  return { seen, run }
}

/** 出牌阶段由回合角色自行结束（对应引擎里的 end-phase 动作） */
function endPlayPhase(state: GameState): void {
  finishPhaseBody(state)
  state.pending = null
}

describe('回合阶段模型', () => {
  it('六个阶段的顺序固定，且每回合的阶段计划都是新数组', () => {
    expect(TURN_PHASES).toEqual(['prepare', 'judge', 'draw', 'play', 'discard', 'end'])
    expect(PHASE_NAME.prepare).toBe('准备阶段')
    expect(PHASE_NAME['turn-start']).toBe('回合开始时')

    const first = buildTurnPlan()
    const second = buildTurnPlan()
    expect(first).toEqual([...TURN_PHASES])
    expect(first).not.toBe(second)
    // 一份计划被「跳过阶段」修改后不能影响另一份（回合之间不共享计划）
    first.shift()
    expect(second).toHaveLength(TURN_PHASES.length)
  })

  it('一个回合按顺序经过六个阶段，并在阶段前后触发时机', () => {
    const { seen, run } = makeProbe()
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', phase: 'turn-start' })

    expect(advanceTurn(state, run)).toBe('pending')
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    expect(state.phase).toBe('play')
    expect(seen).toEqual([
      'turn-start',
      'start:prepare',
      'end:prepare',
      'start:judge',
      'end:judge',
      'start:draw',
      'end:draw',
      'start:play',
    ])

    endPlayPhase(state)
    expect(advanceTurn(state, run)).toBe('pending')
    // 出牌阶段之后依次是弃牌、结束、回合结束时，然后轮到对手
    expect(seen.slice(8)).toEqual([
      'end:play',
      'start:discard',
      'end:discard',
      'start:end',
      'end:end',
      'turn-end',
      'turn-start',
      'start:prepare',
      'end:prepare',
      'start:judge',
      'end:judge',
      'start:draw',
      'end:draw',
      'start:play',
    ])
    expect(state.active).toBe(1)
    expect(state.turn).toBe(2)
    expect(state.pending).toEqual({ kind: 'play', player: 1 })
  })

  it('跳过阶段：跳过出牌阶段后，本回合不再产生该阶段的待输入项', () => {
    const { seen, run } = makeProbe()
    // 设想一个在判定阶段结算的「跳过出牌阶段」效果
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', phase: 'judge' })

    expect(skipPhase(state, 'play')).toBe(true)
    expect(logTexts(state)).toContain('跳过了出牌阶段')

    // 出牌阶段被跳过后直接推进到对手的出牌阶段
    expect(advanceTurn(state, run)).toBe('pending')
    expect(state.pending).toEqual({ kind: 'play', player: 1 })
    expect(state.active).toBe(1)
    // 本回合的 start:play 出现在 turn-end 之后，说明它属于对手的回合
    expect(seen.indexOf('turn-end')).toBeLessThan(seen.indexOf('start:play'))
  })

  it('跳过阶段：进行中的阶段不能被跳过，同一个阶段也只能跳过一次', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', phase: 'play' })

    expect(skipPhase(state, 'play')).toBe(false)
    expect(skipPhase(state, 'discard')).toBe(true)
    expect(skipPhase(state, 'discard')).toBe(false)
    expect(state.phaseQueue).toEqual(['end'])
  })

  it('跳过阶段：回合开始时重新生成本回合的计划', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', phase: 'turn-start' })
    skipPhase(state, 'play')

    advanceTurn(state)

    // 计划在「回合开始时」生成，回合开始之前的跳过不会影响这个回合
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
  })

  it('额外的阶段：插入额外的出牌阶段后，本回合可以再次进入出牌阶段', () => {
    const { seen, run } = makeProbe()
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', phase: 'play' })

    // 在出牌阶段获得一个额外的出牌阶段
    addExtraPhase(state, 'play')
    expect(logTexts(state)).toContain('获得一个额外的出牌阶段')

    endPlayPhase(state)
    expect(advanceTurn(state, run)).toBe('pending')
    // 第一个出牌阶段结束后，进入的是「额外的出牌阶段」（仍由同一角色进行）
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    expect(state.active).toBe(0)

    endPlayPhase(state)
    expect(advanceTurn(state, run)).toBe('pending')
    expect(state.pending).toEqual({ kind: 'play', player: 1 })
    // 本回合的出牌阶段结束了两次：原本的一次 + 额外的一次
    expect(seen.filter((s) => s === 'end:play')).toHaveLength(2)
  })

  it('时机会在效果产生前提早移动游标：被濒死打断后不会重复执行', () => {
    const runs: string[] = []
    const run: TimingRunner = (state, timing) => {
      if (timing.at !== 'turn-start') return
      runs.push('turn-start')
      loseHp(state, 0, 5) // 体力降到 0 以下 → 压入濒死结算帧
    }
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'turn-start',
      playerHp: 1,
    })

    expect(advanceTurn(state, run)).toBe('continue')
    expect(runs).toHaveLength(1)
    expect(state.stack[0]).toMatchObject({ kind: 'dying', dying: 0 })
    // 游标已经越过「回合开始时」，所以结算结束后不会重复扣体力
    expect(state.phase).toBe('turn-start')
    expect(state.phaseStage).toBe('end')

    state.stack.pop()
    expect(advanceTurn(state, run)).toBe('pending')
    expect(runs).toHaveLength(1)
  })

  it('时机匹配：sameTiming 区分回合/阶段/事件时机（派发逻辑见 dsl/event.test.ts）', () => {
    expect(sameTiming({ at: 'turn-start' }, { at: 'turn-start' })).toBe(true)
    expect(sameTiming({ at: 'after-damage' }, { at: 'after-damage' })).toBe(true)
    expect(sameTiming({ at: 'after-damage' }, { at: 'turn-start' })).toBe(false)
    expect(
      sameTiming({ at: 'phase-start', phase: 'draw' }, { at: 'phase-start', phase: 'play' }),
    ).toBe(false)
    expect(
      sameTiming({ at: 'phase-end', phase: 'draw' }, { at: 'phase-start', phase: 'draw' }),
    ).toBe(false)
  })
})
