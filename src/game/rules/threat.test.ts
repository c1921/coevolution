import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { makeState } from '../testUtils'
import { assertConservation } from './cardZones'
import { assertThreatBounds, resolveThreatAtTurnEnd } from './threat'

/**
 * 威胁机制（基础伤害机制）：
 * 攻击只叠加威胁；威胁在承受者自己的回合结束时按剩余点数结算为伤害（走伤害帧：
 * 「受到伤害后」技能 → 濒死检查），随后归零。
 */

describe('威胁结算', () => {
  it('回合结束时：剩余威胁结算为等量伤害并归零', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerThreat: 2,
      phase: 'turn-end',
    })

    advance(state)

    expect(state.players[0].hp).toBe(2)
    expect(state.players[0].threat).toBe(0)
    // 伤害来源按 1v1 的唯一对手记录
    expect(state.lastDamage).toMatchObject({ source: 1, target: 0, amount: 2 })
    // 结算完才切换回合
    expect(state.active).toBe(1)
    assertConservation(state)
  })

  it('威胁为 0 时不结算、不产生伤害帧', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      phase: 'turn-end',
    })

    resolveThreatAtTurnEnd(state, 0)

    expect(state.players[0].hp).toBe(4)
    expect(state.lastDamage).toBeNull()
    expect(state.stack).toHaveLength(0)
  })

  it('先在出牌阶段抵消，回合结束时只结算剩余的威胁', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend' }],
      playerThreat: 3,
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    expect(state.players[0].threat).toBe(2)

    // 结束出牌阶段 → 弃牌阶段（手牌为空）→ 回合结束时结算剩余 2 点
    submit(state, { kind: 'end-phase' })
    expect(state.players[0].hp).toBe(2)
    expect(state.players[0].threat).toBe(0)
    expect(state.active).toBe(1)
    assertConservation(state)
  })

  it('受到伤害后会询问可选技能：【反扑】把威胁还给伤害来源', () => {
    const state = makeState({
      playerSpecies: 'wolf',
      aiSpecies: 'bear',
      playerThreat: 1,
      phase: 'turn-end',
    })

    advance(state)

    // 伤害来源是唯一对手，狼可以令其获得 1 点威胁
    expect(state.pending).toMatchObject({ kind: 'trigger', player: 0, skill: 'retaliate' })
    submit(state, { kind: 'trigger-choice', accept: true })
    expect(state.players[1].threat).toBe(1)
    assertConservation(state)
  })

  it('受到伤害后会询问可选技能：【狡黠】摸一张牌', () => {
    const state = makeState({
      playerSpecies: 'fox',
      aiSpecies: 'bear',
      playerThreat: 1,
      phase: 'turn-end',
    })
    const before = state.players[0].hand.length

    advance(state)
    expect(state.pending).toMatchObject({ kind: 'trigger', player: 0, skill: 'cunning' })

    submit(state, { kind: 'trigger-choice', accept: true })
    expect(state.players[0].hand).toHaveLength(before + 1)
    assertConservation(state)
  })

  it('威胁致死会进入濒死结算', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHp: 1,
      playerThreat: 2,
      phase: 'turn-end',
    })

    advance(state)

    expect(state.players[0].hp).toBe(-1)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 0 })
  })

  it('【风暴】对自己造成的威胁在自己的回合结束时结算', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'storm' }],
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    expect(state.players[0].threat).toBe(2)
    expect(state.players[1].threat).toBe(2)

    submit(state, { kind: 'end-phase' })
    // 自己的 2 点威胁已经兑现，对手的 2 点仍留到他的回合结束时
    expect(state.players[0].hp).toBe(2)
    expect(state.players[0].threat).toBe(0)
    expect(state.players[1].threat).toBe(2)
    assertConservation(state)
  })

  it('威胁不变式：非负整数', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    state.players[0].threat = -1
    expect(() => assertThreatBounds(state)).toThrow('威胁越界')
  })
})
