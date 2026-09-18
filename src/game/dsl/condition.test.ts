import { describe, expect, it } from 'vitest'
import { makeState } from '../testUtils'
import type { MakeStateOptions } from '../testUtils'
import { evalCondition, evalConditions } from './condition'
import { baseContext } from './runtime'
import type { EvalEnv } from './runtime'
import type { SpeciesId } from '../types'
import type { Condition, Value } from './types'

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

describe('条件求值', () => {
  it('always / not / all / any', () => {
    const env = envOf('tiger', 'bear')
    expect(evalCondition(env, { kind: 'always' })).toBe(true)
    expect(evalCondition(env, { kind: 'not', of: { kind: 'always' } })).toBe(false)
    expect(evalCondition(env, { kind: 'all', of: [{ kind: 'always' }] })).toBe(true)
    expect(evalCondition(env, { kind: 'any', of: [{ kind: 'not', of: { kind: 'always' } }] })).toBe(
      false,
    )
    // 空条件列表视为成立
    expect(evalConditions(env, [])).toBe(true)
    expect(evalConditions(env, undefined)).toBe(true)
  })

  it('compare：体力是否已受伤', () => {
    const wounded = envOf('deer', 'bear', { playerHp: 2 })
    const full = envOf('deer', 'bear')
    const spec: Condition = {
      kind: 'compare',
      op: 'lt',
      left: { kind: 'ref', ref: 'hp' },
      right: { kind: 'ref', ref: 'maxHp' },
    }
    expect(evalCondition(wounded, spec)).toBe(true)
    expect(evalCondition(full, spec)).toBe(false)
    expect(
      evalCondition(wounded, {
        kind: 'compare',
        op: 'eq',
        left: { kind: 'ref', ref: 'hp' },
        right: CONST(2),
      }),
    ).toBe(true)
    expect(
      evalCondition(wounded, {
        kind: 'compare',
        op: 'gte',
        left: { kind: 'ref', ref: 'turn' },
        right: CONST(21),
      }),
    ).toBe(false)
  })

  it('alive / has-cards / card-kind-count', () => {
    const env = envOf('tiger', 'bear', {
      playerHand: [{ kind: 'strike' }, { kind: 'defend' }],
    })
    expect(evalCondition(env, { kind: 'alive', of: 'self' })).toBe(true)
    expect(
      evalCondition(env, { kind: 'has-cards', of: 'self', zone: 'hand', atLeast: CONST(2) }),
    ).toBe(true)
    expect(
      evalCondition(env, { kind: 'has-cards', of: 'self', zone: 'hand', atLeast: CONST(3) }),
    ).toBe(false)
    expect(
      evalCondition(env, {
        kind: 'card-kind-count',
        of: 'self',
        zone: 'hand',
        cardKind: 'defend',
        atLeast: CONST(1),
      }),
    ).toBe(true)
    expect(
      evalCondition(env, {
        kind: 'card-kind-count',
        of: 'self',
        zone: 'hand',
        cardKind: 'heal',
        atLeast: CONST(1),
      }),
    ).toBe(false)
    // 对手的牌区互不干扰
    expect(
      evalCondition(env, { kind: 'has-cards', of: 'opponent', zone: 'hand', atLeast: CONST(1) }),
    ).toBe(false)
  })

  it('in-processing：指向造成伤害的牌', () => {
    const env = envOf('wolf', 'bear', { playerHand: [{ kind: 'strike' }] })
    const card = env.state.players[0].hand[0]!
    const spec: Condition = { kind: 'in-processing', card: 'event-card' }
    // 还没进处理区
    env.ctx.damage = { source: 0, target: 1, amount: 1, card: { as: 'strike', source: card } }
    expect(evalCondition(env, spec)).toBe(false)
    env.state.processing.push({ card, owner: 0 })
    expect(evalCondition(env, spec)).toBe(true)
  })

  it('card-transformed / picked-count', () => {
    const env = envOf('leopard', 'bear', { playerHand: [{ kind: 'defend' }] })
    const card = env.state.players[0].hand[0]!
    expect(evalCondition(env, { kind: 'card-transformed' })).toBe(false)
    env.ctx.usedCard = { as: 'strike', source: card, via: 'flicker' }
    expect(evalCondition(env, { kind: 'card-transformed' })).toBe(true)

    expect(
      evalCondition(env, { kind: 'picked-count', atLeast: CONST(1) }),
    ).toBe(false)
    env.ctx.picked = [card.uid]
    expect(evalCondition(env, { kind: 'picked-count', atLeast: CONST(1) })).toBe(true)
    expect(evalCondition(env, { kind: 'picked-count', atLeast: CONST(2) })).toBe(false)
  })

  it('skill-unused / is-active / phase-is', () => {
    const env = envOf('deer', 'bear')
    expect(evalCondition(env, { kind: 'skill-unused', skill: 'mend' })).toBe(true)
    env.state.players[0].usedSkillsThisTurn.push('mend')
    expect(evalCondition(env, { kind: 'skill-unused', skill: 'mend' })).toBe(false)

    expect(evalCondition(env, { kind: 'is-active' })).toBe(true)
    env.state.active = 1
    expect(evalCondition(env, { kind: 'is-active' })).toBe(false)

    expect(evalCondition(env, { kind: 'phase-is', phase: 'play' })).toBe(true)
    expect(evalCondition(env, { kind: 'phase-is', phase: 'draw' })).toBe(false)
  })
})
