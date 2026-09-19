import { describe, expect, it } from 'vitest'
import { makeState } from '../testUtils'
import { cardTargetChoice, defaultTargets, targetsSatisfied, useVariantOf } from './index'
import type { TargetChoice } from './index'

/**
 * 卡牌使用时的目标解析（`cardTargetChoice`）：与主动技共用同一入口，
 * 界面、AI 与合法性判定都从这里取同一份结论。
 */

describe('卡牌目标选择入口', () => {
  it('打击：唯一候选的对手，不需要玩家选择', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(cardTargetChoice(state, 0, 'strike', 'play')).toMatchObject({
      candidates: [1],
      fallback: 1,
      mustChoose: false,
      multi: false,
      size: 1,
    })
  })

  it('回复：候选是自己（满血与否由变体的 requires 把关，候选本身不变）', () => {
    const wounded = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', playerHp: 2 })
    expect(cardTargetChoice(wounded, 0, 'heal', 'play')).toMatchObject({
      candidates: [0],
      fallback: 0,
      mustChoose: false,
    })

    // 满血时「能不能用」由 requires 决定（legalOptions 会因此隐藏按钮），
    // 目标解析本身仍给出唯一候选
    const healthy = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(cardTargetChoice(healthy, 0, 'heal', 'play')).toMatchObject({ candidates: [0] })
  })

  it('急救：候选随受伤情况变化，双候选时要求选择', () => {
    const bothWounded = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHp: 2,
      aiHp: 2,
    })
    expect(cardTargetChoice(bothWounded, 0, 'first-aid', 'play')).toMatchObject({
      candidates: [0, 1],
      fallback: 0,
      mustChoose: true,
      multi: false,
      size: 1,
    })

    // 自己满血、只有对手受伤：缺省目标不合格，必须显式选对手
    const onlyOpponent = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', aiHp: 2 })
    expect(cardTargetChoice(onlyOpponent, 0, 'first-aid', 'play')).toMatchObject({
      candidates: [1],
      mustChoose: true,
    })
    expect(cardTargetChoice(onlyOpponent, 0, 'first-aid', 'play')?.fallback).toBeUndefined()

    // 谁都没受伤 → 一个候选都没有
    const healthy = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(cardTargetChoice(healthy, 0, 'first-aid', 'play')).toBeNull()
  })

  it('风暴：all 模式作用于全部候选，不需要选择', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(cardTargetChoice(state, 0, 'storm', 'play')).toMatchObject({
      candidates: [0, 1],
      mustChoose: false,
      multi: false,
      size: 2,
    })

    // 对手阵亡后候选只剩自己，size 随之变为 1
    state.players[1].alive = false
    expect(cardTargetChoice(state, 0, 'storm', 'play')).toMatchObject({
      candidates: [0],
      size: 1,
    })
  })

  it('【防御】有出牌阶段的 use 变体（作用于自己），没有濒死变体', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(cardTargetChoice(state, 0, 'defend', 'play')).toMatchObject({
      candidates: [0],
      fallback: 0,
      mustChoose: false,
    })

    // 同一种牌在不同语境下可以完全没有用法
    expect(useVariantOf('defend', 'dying')).toBeUndefined()
    expect(cardTargetChoice(state, 0, 'defend', 'dying', 0)).toBeNull()
  })

  it('濒死语境用 dying 变体的目标规格，并绑定濒死者', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', playerHp: 0 })
    state.pending = { kind: 'dying', player: 0, dying: 0 }
    // 不传濒死者时 scope=dying 没有候选
    expect(cardTargetChoice(state, 0, 'heal', 'dying')).toBeNull()
    expect(cardTargetChoice(state, 0, 'heal', 'dying', 0)).toMatchObject({
      candidates: [0],
      mustChoose: true,
    })
  })
})

/**
 * `defaultTargets` / `targetsSatisfied`：可用性判定与提交共用同一份缺省目标集，
 * 这是「按钮可用 ⟺ 提交必成功」这条不变量的唯一实现（界面与 AI 都走它）。
 *
 * 多目标（count.mode = exactly）当前没有内置内容使用，用直接构造的 TargetChoice
 * 锁住契约——`TargetChoice` 是普通接口，不需要为了测它而伪造一份内容文档。
 */
describe('缺省目标集与可满足性', () => {
  it('不需要选择时返回空数组（all 模式与缺省目标合格都走这条）', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })

    // 风暴：count.mode = all，引擎自己作用于全部候选
    const storm = cardTargetChoice(state, 0, 'storm', 'play')
    expect(storm).not.toBeNull()
    expect(defaultTargets(storm as TargetChoice)).toEqual([])
    expect(targetsSatisfied(storm)).toBe(true)

    // 打击：唯一候选就是合格的文档缺省目标，提交时不必带目标
    const strike = cardTargetChoice(state, 0, 'strike', 'play')
    expect(defaultTargets(strike as TargetChoice)).toEqual([])
    expect(targetsSatisfied(strike)).toBe(true)
  })

  it('单选且必须选择时用缺省目标，缺省不合格时退回第一个候选', () => {
    // 自己满血、只有对手受伤：缺省目标不合格 → mustChoose，候选只剩对手
    const onlyOpponent = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      aiHp: 2,
    })
    const choice = cardTargetChoice(onlyOpponent, 0, 'first-aid', 'play')
    expect(choice?.mustChoose).toBe(true)
    expect(choice?.fallback).toBeUndefined()
    expect(defaultTargets(choice as TargetChoice)).toEqual([1])
    expect(targetsSatisfied(choice)).toBe(true)
  })

  it('多目标候选足够时取前 N 个，候选不足时如实返回少于 N 个并判定为不可满足', () => {
    const enough: TargetChoice = { candidates: [0, 1], mustChoose: true, multi: true, size: 2 }
    expect(defaultTargets(enough)).toEqual([0, 1])
    expect(targetsSatisfied(enough)).toBe(true)

    const short: TargetChoice = { candidates: [1], mustChoose: true, multi: true, size: 2 }
    expect(defaultTargets(short)).toEqual([1])
    expect(targetsSatisfied(short)).toBe(false)
  })

  it('声明了 target 却一个候选都没有：choice 为 null，判定为不可满足', () => {
    const healthy = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(cardTargetChoice(healthy, 0, 'first-aid', 'play')).toBeNull()
    expect(targetsSatisfied(null)).toBe(false)
  })
})
