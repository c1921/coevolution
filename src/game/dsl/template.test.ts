import { describe, expect, it } from 'vitest'
import { makeState } from '../testUtils'
import { baseContext } from './runtime'
import type { EvalEnv } from './runtime'
import { cardDoc, registry } from './registry'
import { renderLog } from './template'
import type { Effect, UseVariant } from './types'

type LogEffect = Extract<Effect, { kind: 'log' }>

/** 取卡牌某语境的用法变体，保证测试跟着内容文档走 */
function variantOf(id: string, context: 'play' | 'dying'): UseVariant {
  const variant = cardDoc(id).use?.find((item) => item.context === context)
  if (!variant) throw new Error(`卡牌 ${id} 缺少 ${context} 变体`)
  return variant
}

/** 变体里的 log：可能是直接的，也可能在 if 的 then / else 分支里 */
function logOf(effects: Effect[], branch?: 'then' | 'else'): LogEffect {
  for (const effect of effects) {
    if (effect.kind === 'log' && branch === undefined) return effect
    if (effect.kind === 'if') {
      const list = branch === 'else' ? effect.else : effect.then
      for (const inner of list ?? []) {
        if (inner.kind === 'log') return inner
      }
    }
  }
  throw new Error(`没有找到 ${branch ?? '直接'} 的 log`)
}

function ruleLog(id: string): LogEffect {
  const rule = registry.rules.find((item) => item.id === id)
  const effect = rule?.effects.find((item) => item.kind === 'log')
  if (!effect || effect.kind !== 'log') throw new Error(`规则 ${id} 没有 log`)
  return effect
}

describe('日志模板渲染', () => {
  it('普通使用：{self} 对 {target} 使用{usedAs}', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    const card = state.players[0].deck[0]!
    const env: EvalEnv = {
      state,
      ctx: {
        ...baseContext(state, 0),
        target: 1,
        usedUid: card.uid,
        usedCard: { as: 'strike', source: card },
      },
    }
    const effect = logOf(variantOf('strike', 'play').effects, 'else')
    expect(renderLog(env, effect)).toBe('进攻型 对 防御型 使用【打击】（能量 3/3）')
  })

  it('转化使用：{via} / {usedRaw} / {usedAs}', () => {
    const state = makeState({ playerSpecies: 'morph', aiSpecies: 'defensive' })
    const defend = state.players[0].deck.find((card) => card.kind === 'defend')!
    const env: EvalEnv = {
      state,
      ctx: {
        ...baseContext(state, 0),
        target: 1,
        usedUid: defend.uid,
        usedCard: { as: 'strike', source: defend, via: 'convert' },
      },
    }
    const effect = logOf(variantOf('strike', 'play').effects, 'then')
    expect(renderLog(env, effect)).toBe(
      '转化型 发动【转换】，将【防御】当【打击】对 防御型 使用（能量 3/3）',
    )
  })

  it('濒死救援：{target} 的体力与能量标签', () => {
    const state = makeState({ playerSpecies: 'counter', aiSpecies: 'defensive', playerEnergy: 2 })
    const heal = state.players[0].deck.find((card) => card.kind === 'heal')!
    state.players[1].hp = 1
    const env: EvalEnv = {
      state,
      ctx: {
        ...baseContext(state, 0),
        dying: 1,
        target: 1,
        usedUid: heal.uid,
        usedCard: { as: 'heal', source: heal },
      },
    }
    const effect = logOf(variantOf('heal', 'dying').effects)
    expect(renderLog(env, effect)).toBe('反击型 使用【回复】救援 防御型（体力 1/4）（能量 2/3）')
  })

  it('技能日志：{cost} 渲染费用牌', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    const hand = state.players[0].deck.find((card) => card.kind === 'strike')!
    state.players[0].hand = [hand]
    const env: EvalEnv = {
      state,
      ctx: { ...baseContext(state, 0), target: 1, costCards: [hand.uid] },
    }
    expect(
      renderLog(env, {
        template: '{self} 发动【强袭】，弃置{cost}，强攻 {target}',
      }),
    ).toBe('进攻型 发动【强袭】，弃置【打击】，强攻 防御型')
  })

  it('vars 绑定优先于自动绑定（消耗战的流失量）', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', active: 1 })
    state.turn = 26
    const env: EvalEnv = { state, ctx: baseContext(state, 1) }
    expect(renderLog(env, ruleLog('attrition'))).toBe('消耗战：防御型 失去 2 点体力')
  })

  it('蓄能的能量标签反映修正后的上限', () => {
    const state = makeState({ playerSpecies: 'defensive', aiSpecies: 'offensive' })
    const env: EvalEnv = { state, ctx: baseContext(state, 0) }
    expect(renderLog(env, { template: '{self}{self.energyTag}' })).toBe('防御型（能量 5/5）')
  })

  it('未定义的字段会抛错而不是渲染出 undefined', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    const env: EvalEnv = { state, ctx: baseContext(state, 0) }
    expect(() => renderLog(env, { template: '{self.nope}' })).toThrow(/字段无法解析/)
  })
})
