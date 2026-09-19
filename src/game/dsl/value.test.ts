import { describe, expect, it } from 'vitest'
import { makeState } from '../testUtils'
import type { MakeStateOptions } from '../testUtils'
import { baseContext } from './runtime'
import type { EvalEnv } from './runtime'
import type { SpeciesId } from '../types'
import { createRegistry, withRegistry } from './registry'
import { baseChannel, channelValue, modifierValue } from './modifier'
import { evalValue } from './value'
import { baseDocs } from './fixtures'
import type { Value } from './types'

const CONST = (value: number): Value => ({ kind: 'const', value })

type ScenarioOptions = Omit<MakeStateOptions, 'playerSpecies' | 'aiSpecies'>

function envOf(
  playerSpecies: SpeciesId,
  aiSpecies: SpeciesId,
  opts: ScenarioOptions = {},
): EvalEnv {
  const state = makeState({ playerSpecies, aiSpecies, ...opts })
  return { state, ctx: baseContext(state, 0) }
}

describe('数值表达式', () => {
  const env = envOf('bear', 'tiger')

  it('常量与四则运算', () => {
    expect(evalValue(env, CONST(5))).toBe(5)
    expect(evalValue(env, { kind: 'add', of: [CONST(1), CONST(2), CONST(3)] })).toBe(6)
    expect(evalValue(env, { kind: 'sub', of: [CONST(10), CONST(4)] })).toBe(6)
    expect(evalValue(env, { kind: 'sub', of: [CONST(3)] })).toBe(3)
    expect(evalValue(env, { kind: 'mul', of: [CONST(3), CONST(4)] })).toBe(12)
    expect(evalValue(env, { kind: 'min', of: [CONST(3), CONST(4)] })).toBe(3)
    expect(evalValue(env, { kind: 'max', of: [CONST(3), CONST(4)] })).toBe(4)
  })

  it('向下取整除法与 clamp', () => {
    expect(evalValue(env, { kind: 'floor-div', of: CONST(7), by: CONST(2) })).toBe(3)
    expect(evalValue(env, { kind: 'floor-div', of: CONST(9), by: CONST(5) })).toBe(1)
    expect(evalValue(env, { kind: 'clamp', of: CONST(9), min: 0, max: 5 })).toBe(5)
    expect(evalValue(env, { kind: 'clamp', of: CONST(-3), min: 0, max: 5 })).toBe(0)
    expect(() => evalValue(env, { kind: 'floor-div', of: CONST(1), by: CONST(0) })).toThrow(
      '除数不能为 0',
    )
  })

  it('读取角色数值', () => {
    const wounded = envOf('deer', 'bear', { playerHp: 2, playerHand: [{ kind: 'strike' }] })
    wounded.ctx.target = 1
    expect(evalValue(wounded, { kind: 'ref', ref: 'hp' })).toBe(2)
    expect(evalValue(wounded, { kind: 'ref', ref: 'maxHp' })).toBe(3)
    expect(evalValue(wounded, { kind: 'ref', ref: 'handCount' })).toBe(1)
    expect(evalValue(wounded, { kind: 'ref', ref: 'hp', of: 'target' })).toBe(4)
    expect(evalValue(wounded, { kind: 'ref', ref: 'turn' })).toBe(1)
  })

  it('消耗战的流失量表达式：1 + ⌊(回合 − 21) / 5⌋', () => {
    const attrition: Value = {
      kind: 'add',
      of: [
        CONST(1),
        {
          kind: 'floor-div',
          of: { kind: 'sub', of: [{ kind: 'ref', ref: 'turn' }, CONST(21)] },
          by: CONST(5),
        },
      ],
    }
    const env = envOf('tiger', 'bear')
    env.state.turn = 21
    expect(evalValue(env, attrition)).toBe(1)
    env.state.turn = 26
    expect(evalValue(env, attrition)).toBe(2)
    env.state.turn = 31
    expect(evalValue(env, attrition)).toBe(3)
  })
})

describe('修正通道', () => {
  it('通道基准值来自 ruleset', () => {
    expect(baseChannel('energy-max')).toBe(3)
    expect(baseChannel('defend-need-against')).toBe(1)
    expect(baseChannel('threat-per-attack')).toBe(1)
    expect(baseChannel('attack-range')).toBe(1)
  })

  it('怒吼：energy-max 基准 3 + add 2 = 5', () => {
    const bear = envOf('bear', 'tiger').state
    const tiger = envOf('tiger', 'bear').state
    expect(channelValue(bear, 'energy-max', 0)).toBe(5)
    expect(channelValue(tiger, 'energy-max', 0)).toBe(3)
    expect(modifierValue(bear, 'energy-max', 0)).toBe(5)
    // 自身数值 energyMax 走同一通道
    expect(evalValue({ state: bear, ctx: baseContext(bear, 0) }, { kind: 'ref', ref: 'energyMax' }))
      .toBe(5)
  })

  it('威压：threat-per-attack 被 set 覆盖为 2', () => {
    const lion = envOf('lion', 'tiger').state
    const tiger = envOf('tiger', 'lion').state
    expect(channelValue(lion, 'threat-per-attack', 0)).toBe(2)
    expect(channelValue(tiger, 'threat-per-attack', 0)).toBe(1)
    // 通道读取走 subject 的技能，与谁是回合角色无关
    expect(
      evalValue(
        { state: lion, ctx: baseContext(lion, 0) },
        { kind: 'channel', channel: 'threat-per-attack', of: 'self' },
      ),
    ).toBe(2)
  })

  it('修正值可以是表达式', () => {
    const synthetic = createRegistry([
      ...baseDocs().filter((doc) => doc.path !== 'skills/roar.json'),
      {
        path: 'skills/roar.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'roar',
          name: '怒吼',
          text: '能量上限 = 体力值。',
          modifiers: [
            {
              channel: 'energy-max',
              op: 'set',
              value: { kind: 'ref', ref: 'hp', of: 'self' },
            },
          ],
        },
      },
    ])
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', playerHp: 2 })
    expect(withRegistry(synthetic, () => channelValue(state, 'energy-max', 0))).toBe(2)
  })

  it('通道自引用会报错而不是栈溢出', () => {
    const synthetic = createRegistry([
      ...baseDocs().filter((doc) => doc.path !== 'skills/roar.json'),
      {
        path: 'skills/roar.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'roar',
          name: '怒吼',
          text: '自引用。',
          modifiers: [
            {
              channel: 'energy-max',
              op: 'add',
              value: { kind: 'channel', channel: 'energy-max', of: 'self' },
            },
          ],
        },
      },
    ])
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    expect(() => withRegistry(synthetic, () => channelValue(state, 'energy-max', 0))).toThrow(
      /递归过深/,
    )
  })
})
