import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { makeState } from '../testUtils'
import { assertConservation } from './cardZones'
import { skillUsed } from './usage'
import { addThreat, assertThreatBounds, resolveThreatAtTurnEnd } from './threat'

/**
 * 威胁机制（基础伤害机制）：
 * 攻击只叠加威胁；威胁在承受者自己的回合结束时按剩余点数结算为伤害（走伤害帧：
 * 「受到伤害后」技能 → 濒死检查），随后归零。
 */

describe('威胁结算', () => {
  it('回合结束时：剩余威胁结算为等量伤害并归零', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerThreat: 2,
      phase: 'turn-end',
    })

    advance(state)

    expect(state.players[0].hp).toBe(8)
    expect(state.players[0].threat).toBe(0)
    // 伤害来源按 1v1 的唯一对手记录
    expect(state.lastDamage).toMatchObject({ source: 1, target: 0, amount: 2 })
    // 结算完才切换回合
    expect(state.active).toBe(1)
    assertConservation(state)
  })

  it('威胁为 0 时不结算、不产生伤害帧', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'turn-end',
    })

    resolveThreatAtTurnEnd(state, 0)

    expect(state.players[0].hp).toBe(10)
    expect(state.lastDamage).toBeNull()
    expect(state.stack).toHaveLength(0)
  })

  it('先在出牌阶段抵消，回合结束时只结算剩余的威胁', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
      playerThreat: 3,
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    expect(state.players[0].threat).toBe(2)

    // 结束出牌阶段 → 弃牌阶段（手牌为空）→ 回合结束时结算剩余 2 点
    submit(state, { kind: 'end-phase' })
    expect(state.players[0].hp).toBe(8)
    expect(state.players[0].threat).toBe(0)
    expect(state.active).toBe(1)
    assertConservation(state)
  })

  it('受到威胁后会询问可选技能：【反击】把 1 点威胁还给来源', () => {
    const state = makeState({ playerSpecies: 'counter', aiSpecies: 'defensive' })

    // 对手（1 号）给反击型（0 号）叠 1 点威胁 → 触发【受到威胁后】
    addThreat(state, 0, 1, 1)
    advance(state)

    expect(state.pending).toMatchObject({ kind: 'trigger', player: 0, skill: 'riposte' })
    submit(state, { kind: 'trigger-choice', accept: true })
    expect(state.players[1].threat).toBe(1)
    assertConservation(state)
  })

  it('反击造成的新威胁不会再触发一次反击（避免无限连锁）', () => {
    // 双方都是反击型：0 号受威胁 → 反击 1 号 → 这次威胁不再触发 1 号的反击
    const state = makeState({ playerSpecies: 'counter', aiSpecies: 'counter' })

    addThreat(state, 0, 1, 1)
    advance(state)
    expect(state.pending).toMatchObject({ kind: 'trigger', player: 0, skill: 'riposte' })
    submit(state, { kind: 'trigger-choice', accept: true })

    expect(state.players[1].threat).toBe(1)
    expect(state.pending).not.toMatchObject({ kind: 'trigger' })
    assertConservation(state)
  })

  it('【反击】每回合限一次：同一回合的第二次威胁不再询问', () => {
    const state = makeState({ playerSpecies: 'counter', aiSpecies: 'defensive' })

    addThreat(state, 0, 1, 1)
    advance(state)
    expect(state.pending).toMatchObject({ kind: 'trigger', player: 0, skill: 'riposte' })
    submit(state, { kind: 'trigger-choice', accept: true })
    expect(state.players[1].threat).toBe(1)
    expect(skillUsed(state, 0, 'riposte')).toBe(true)

    // 同一回合内再来一次威胁：技能已用过，不再收集触发、也不再询问
    addThreat(state, 0, 1, 1)
    advance(state)
    expect(state.pending).not.toMatchObject({ kind: 'trigger' })
    assertConservation(state)
  })

  it('威胁致死会进入濒死结算', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
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
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'storm' }],
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    expect(state.players[0].threat).toBe(2)
    expect(state.players[1].threat).toBe(2)

    submit(state, { kind: 'end-phase' })
    // 自己的 2 点威胁已经兑现，对手的 2 点仍留到他的回合结束时
    expect(state.players[0].hp).toBe(8)
    expect(state.players[0].threat).toBe(0)
    expect(state.players[1].threat).toBe(2)
    assertConservation(state)
  })

  it('威胁不变式：非负整数', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    state.players[0].threat = -1
    expect(() => assertThreatBounds(state)).toThrow('威胁越界')
  })
})
