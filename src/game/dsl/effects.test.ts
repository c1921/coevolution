import { describe, expect, it } from 'vitest'
import { effectsHarmChosenTarget, effectsInclude, findEffect } from './effects'
import type { Effect, Value } from './types'

/**
 * 效果树结构查询（`dsl/effects.ts`）：AI 的用途判定与注册表的卡牌角色派生
 * 共用这一份递归形状，因此这里锁住三件事：
 *
 *  1. 递归确实进得了 if / contest / for-each-target 三个分支；
 *  2. "打向选定目标"与"打向自己"必须区分开——
 *     用 `effectsInclude(effects, 'threat')` 代替 `effectsHarmChosenTarget`
 *     会把自伤牌误判成进攻牌，这是本模块最容易被改错的地方；
 *  3. 问的是"有没有"，不是"有多少"。
 */

const ONE: Value = { kind: 'const', value: 1 }

function threat(target: 'self' | 'target'): Effect {
  return { kind: 'threat', target, amount: ONE }
}

/** 包一层总是成立的 if，用来验证分支递归 */
function insideIf(inner: Effect): Effect {
  return { kind: 'if', condition: { kind: 'always' }, then: [inner] }
}

function insideElse(inner: Effect): Effect {
  return { kind: 'if', condition: { kind: 'always' }, then: [], else: [inner] }
}

function insideForEach(inner: Effect): Effect {
  return { kind: 'for-each-target', effects: [inner] }
}

function insideContest(inner: Effect, branch: 'onMet' | 'onUnmet'): Effect {
  return {
    kind: 'contest',
    responder: 'target',
    expectedCard: 'defend',
    need: ONE,
    [branch]: [inner],
  }
}

describe('效果树查询：effectsInclude', () => {
  it('命中顶层指令', () => {
    expect(effectsInclude([threat('target')], 'threat')).toBe(true)
    expect(effectsInclude([threat('target')], 'heal')).toBe(false)
    expect(effectsInclude(undefined, 'threat')).toBe(false)
    expect(effectsInclude([], 'threat')).toBe(false)
  })

  it('递归进 if 的两个分支、contest 的两个分支与 for-each-target', () => {
    expect(effectsInclude([insideIf(threat('target'))], 'threat')).toBe(true)
    expect(effectsInclude([insideElse(threat('target'))], 'threat')).toBe(true)
    expect(effectsInclude([insideContest(threat('target'), 'onMet')], 'threat')).toBe(true)
    expect(effectsInclude([insideContest(threat('target'), 'onUnmet')], 'threat')).toBe(true)
    expect(effectsInclude([insideForEach(threat('target'))], 'threat')).toBe(true)
    // 嵌套两层也要进得去
    expect(effectsInclude([insideIf(insideForEach(threat('target')))], 'threat')).toBe(true)
  })

  it('问到的是指令名，与目标角色无关', () => {
    // 只打自己的效果同样"包含 threat 指令"——所以它不能替代 effectsHarmChosenTarget
    expect(effectsInclude([threat('self')], 'threat')).toBe(true)
    expect(effectsHarmChosenTarget([threat('self')])).toBe(false)
  })
})

describe('效果树查询：effectsHarmChosenTarget', () => {
  it('只认打向选定目标的伤害类指令', () => {
    expect(effectsHarmChosenTarget([threat('target')])).toBe(true)
    expect(effectsHarmChosenTarget([threat('self')])).toBe(false)
    expect(effectsHarmChosenTarget([{ kind: 'lose-hp', target: 'target', amount: ONE }])).toBe(true)
    expect(effectsHarmChosenTarget([{ kind: 'pay-energy', target: 'target', amount: ONE }])).toBe(
      true,
    )
  })

  it('治疗 / 抵消威胁 / 抽牌都不算"打向选定目标"', () => {
    expect(effectsHarmChosenTarget([{ kind: 'heal', target: 'target', amount: ONE }])).toBe(false)
    expect(
      effectsHarmChosenTarget([{ kind: 'offset-threat', target: 'target', amount: ONE }]),
    ).toBe(false)
    expect(effectsHarmChosenTarget([{ kind: 'draw', target: 'target', count: ONE }])).toBe(false)
    expect(effectsHarmChosenTarget([])).toBe(false)
    expect(effectsHarmChosenTarget(undefined)).toBe(false)
  })

  it('递归进三分支：藏在 for-each-target 里（多目标牌）也照样命中', () => {
    expect(effectsHarmChosenTarget([insideForEach(threat('target'))])).toBe(true)
    expect(effectsHarmChosenTarget([insideIf(threat('target'))])).toBe(true)
    expect(effectsHarmChosenTarget([insideContest(threat('target'), 'onUnmet')])).toBe(true)
    // 分支里只有自伤 → 不是"打向选定目标"
    expect(effectsHarmChosenTarget([insideForEach(threat('self'))])).toBe(false)
  })
})

describe('效果树查询：findEffect', () => {
  it('返回第一个命中的节点本身，便于调用方读取它的字段', () => {
    const hit = findEffect(
      [{ kind: 'log', template: 'x' }, threat('self')],
      (e) => e.kind === 'threat',
    )
    expect(hit).toEqual(threat('self'))
    expect(findEffect([threat('self')], (e) => e.kind === 'heal')).toBeUndefined()
  })
})
