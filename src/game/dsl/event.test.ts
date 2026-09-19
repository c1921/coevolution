import { describe, expect, it } from 'vitest'
import { makeState } from '../testUtils'
import { moveHandToProcessing } from '../rules/cardZones'
import { baseDocs } from './fixtures'
import { createRegistry, withRegistry } from './registry'
import type { DamageCtx } from '../types'
import type { TriggerSpec } from './types'
import { applyTimingRules, collectTriggers, emitTiming, runTrigger, sameTiming } from './event'

/** 用合成文档替换 roar（tiger 唯一的技能），便于测试各种触发形态 */
function registryWithTrigger(trigger: TriggerSpec) {
  return createRegistry([
    ...baseDocs().filter((doc) => doc.path !== 'skills/roar.json'),
    {
      path: 'skills/roar.json',
      value: {
        dslVersion: 1,
        kind: 'skill',
        id: 'roar',
        name: '怒吼',
        text: '测试用触发技。',
        trigger,
      },
    },
  ])
}

function registryWithRule(effects: unknown[]) {
  return createRegistry([
    ...baseDocs().filter((doc) => doc.path !== 'skills/roar.json'),
    // 保留一个被物种引用的技能，避免 dead-doc
    {
      path: 'skills/roar.json',
      value: {
        dslVersion: 1,
        kind: 'skill',
        id: 'roar',
        name: '怒吼',
        text: '占位。',
        modifiers: [
          { channel: 'energy-max', op: 'add', value: { kind: 'const', value: 0 } },
        ],
      },
    },
    {
      path: 'rules/extra.json',
      value: {
        dslVersion: 1,
        kind: 'rule',
        id: 'extra',
        priority: 20,
        on: { at: 'turn-start' },
        effects,
      },
    },
  ])
}

describe('时机派发', () => {
  it('sameTiming：区分阶段与事件时机', () => {
    expect(sameTiming({ at: 'turn-start' }, { at: 'turn-start' })).toBe(true)
    expect(sameTiming({ at: 'turn-start' }, { at: 'turn-end' })).toBe(false)
    expect(sameTiming({ at: 'phase-start', phase: 'draw' }, { at: 'phase-start', phase: 'draw' })).toBe(
      true,
    )
    expect(sameTiming({ at: 'phase-start', phase: 'draw' }, { at: 'phase-start', phase: 'play' })).toBe(
      false,
    )
    expect(sameTiming({ at: 'phase-start', phase: 'draw' }, { at: 'phase-end', phase: 'draw' })).toBe(
      false,
    )
  })

  it('规则文档：消耗战在回合开始时生效，并按回合递增', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', phase: 'turn-start' })
    state.turn = 21
    state.active = 0

    applyTimingRules(state, { at: 'turn-start' })
    expect(state.players[0].hp).toBe(3)
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('消耗战开始')

    // 未到 21 回合时 when 条件不成立
    const early = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', phase: 'turn-start' })
    early.turn = 20
    applyTimingRules(early, { at: 'turn-start' })
    expect(early.players[early.active].hp).toBe(early.players[early.active].maxHp)
    expect(early.log).toHaveLength(0)
  })

  it('规则文档：只在与自己时机相同时执行', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', phase: 'turn-start' })
    applyTimingRules(state, { at: 'turn-end' })
    expect(state.log).toHaveLength(0)
  })

  it('技能触发：按 when 条件收集，可选发动只入队不执行', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
    })
    const card = state.players[0].hand[0]!
    const damage: DamageCtx = {
      source: 1,
      target: 0,
      amount: 1,
      card: { as: 'strike', source: card },
    }
    const synthetic = registryWithTrigger({
      on: { at: 'after-damage' },
      optional: true,
      when: [{ kind: 'in-processing', card: 'event-card' }],
      effects: [{ kind: 'log', template: '{self} 的伤害后触发' }],
    })

    withRegistry(synthetic, () => {
      // 造成伤害的牌还在手牌（不在处理区）→ 条件不成立
      expect(collectTriggers(state, { at: 'after-damage' }, 0, { damage })).toEqual([])

      moveHandToProcessing(state, 0, card)
      const refs = collectTriggers(state, { at: 'after-damage' }, 0, { damage })
      expect(refs).toEqual([{ owner: 0, skill: 'roar', optional: true }])

      // emitTiming 只把可选触发返回给调用方，不立即执行
      const pending = emitTiming(state, { at: 'after-damage' }, 0, { damage })
      expect(pending).toEqual([{ owner: 0, skill: 'roar', optional: true }])
      expect(state.processing).toHaveLength(1)
    })
  })

  it('技能触发：when 不成立时不收集（【反扑】要求伤害来源存活）', () => {
    const state = makeState({ playerSpecies: 'wolf', aiSpecies: 'bear' })
    const damage: DamageCtx = { source: 1, target: 0, amount: 1, card: null }

    expect(collectTriggers(state, { at: 'after-damage' }, 0, { damage })).toEqual([
      { owner: 0, skill: 'retaliate', optional: true },
    ])

    state.players[1].alive = false
    expect(collectTriggers(state, { at: 'after-damage' }, 0, { damage })).toEqual([])
  })

  it('runTrigger：执行【反扑】，令伤害来源获得 1 点威胁', () => {
    const state = makeState({ playerSpecies: 'wolf', aiSpecies: 'bear' })
    const damage: DamageCtx = { source: 1, target: 0, amount: 1, card: null }

    runTrigger(state, { owner: 0, skill: 'retaliate', optional: true }, { damage })

    expect(state.players[1].threat).toBe(1)
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('发动【反扑】')
  })

  it('runTrigger：执行【狡黠】，摸一张牌', () => {
    const state = makeState({ playerSpecies: 'fox', aiSpecies: 'bear' })
    const damage: DamageCtx = { source: 1, target: 0, amount: 1, card: null }

    runTrigger(state, { owner: 0, skill: 'cunning', optional: true }, { damage })

    expect(state.players[0].hand).toHaveLength(1)
    expect(state.players[1].hand).toHaveLength(0)
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('发动【狡黠】')
  })

  it('不可选的技能触发在 emitTiming 中立即执行', () => {
    const synthetic = registryWithTrigger({
      on: { at: 'turn-start' },
      effects: [{ kind: 'log', template: '{self} 的回合开始触发' }],
    })
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', phase: 'turn-start' })
    withRegistry(synthetic, () => {
      const pending = emitTiming(state, { at: 'turn-start' }, 0)
      expect(pending).toEqual([])
    })
    expect(state.log[state.log.length - 1]?.text).toBe('🐯 虎 的回合开始触发')
  })

  it('可选触发只在 after-damage 上被支持（其余时机会被校验器拒绝）', () => {
    expect(() =>
      registryWithTrigger({
        on: { at: 'turn-start' },
        optional: true,
        effects: [{ kind: 'log', template: 'x' }],
      }),
    ).toThrow()
  })

  it('规则与技能触发按时机各自执行，互不干扰', () => {
    const synthetic = registryWithRule([
      { kind: 'log', template: '附加规则：{active} 失去 1 点体力' },
      { kind: 'lose-hp', target: 'active', amount: { kind: 'const', value: 1 } },
    ])
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', phase: 'turn-start' })
    withRegistry(synthetic, () => {
      applyTimingRules(state, { at: 'turn-start' })
    })
    expect(state.players[0].hp).toBe(3)
    expect(state.log[0]?.text).toBe('附加规则：🐯 虎 失去 1 点体力')
  })
})
