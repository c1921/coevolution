import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { makeState, snapshot } from '../testUtils'
import { assertConservation } from './cardZones'
import { BASE_ENERGY_MAX, energyMax } from './energy'
import { cardUseCount } from './usage'

/**
 * 【打击】不再直接扣血，而是给目标叠加威胁（见 rules/threat.ts）。
 * 威胁由目标在自己的出牌阶段打出【防御】抵消，在自己的回合结束时结算为伤害。
 * 这里只覆盖攻击侧的施加与能量约束；结算与濒死见 threat.test.ts。
 */

describe('【打击】结算', () => {
  it('给对手叠加 1 点威胁：对手不掉血，打击牌进自己的弃牌堆', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }],
    })
    const strike = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card: strike })

    // 攻击只施加威胁，不产生响应窗口，也不扣体力
    expect(state.players[1].threat).toBe(1)
    expect(state.players[1].hp).toBe(10)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    expect(state.processing).toHaveLength(0)
    expect(state.players[0].discard.map((c) => c.uid)).toEqual([strike.uid])
    expect(state.players[0].energy).toBe(BASE_ENERGY_MAX - 1)
    assertConservation(state)
  })

  it('【打击】没有次数限制：能量足够就能连续使用，威胁逐张叠加', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })

    expect(cardUseCount(state, 0, 'strike')).toBe(2)
    expect(state.players[0].energy).toBe(BASE_ENERGY_MAX - 2)
    expect(state.players[1].threat).toBe(2)
    expect(state.players[1].hp).toBe(10)
    assertConservation(state)
  })

  it('能量耗尽后无法再使用【打击】', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }],
    })

    // 3 点能量正好打三张【打击】，第三张之后能量见底
    for (let i = 0; i < BASE_ENERGY_MAX; i++) {
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'strike' })
    }
    expect(state.players[0].energy).toBe(0)
    expect(state.players[0].hand).toHaveLength(1)
    expect(state.players[1].threat).toBe(BASE_ENERGY_MAX)

    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'strike' }),
    ).toThrow('能量不足')
    expect(state).toEqual(before)
    assertConservation(state)
  })

  it('蓄能：能量上限 +2，同一回合可以打出更多【打击】', () => {
    const state = makeState({
      playerSpecies: 'defensive',
      aiSpecies: 'offensive',
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }],
    })

    for (let i = 0; i < 3; i++) {
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'strike' })
    }

    // 防御型的上限是 5（蓄能 +2），打完三张还剩 2 点（进攻型的上限只有 3）
    expect(cardUseCount(state, 0, 'strike')).toBe(3)
    expect(energyMax(state, 0)).toBe(BASE_ENERGY_MAX + 2)
    expect(state.players[0].energy).toBe(energyMax(state, 0) - 3)
    expect(state.players[1].threat).toBe(3)
    assertConservation(state)
  })

  it('【防御】：在自己的出牌阶段抵消自己 1 点威胁并支付 1 点能量', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
      playerThreat: 2,
    })
    const card = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card })

    expect(state.players[0].threat).toBe(1)
    expect(state.players[0].energy).toBe(BASE_ENERGY_MAX - 1)
    expect(state.players[0].discard.map((c) => c.uid)).toEqual([card.uid])
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('没有威胁时不能使用【防御】（文档 reason 直接作为报错）', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
    })
    const before = snapshot(state)
    expect(() => submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })).toThrow(
      '你没有需要抵消的威胁',
    )
    expect(state).toEqual(before)
  })

  it('【防御】只能作用于自己，指定对手为目标会被拒绝', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
      playerThreat: 1,
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, targets: [1] }),
    ).toThrow()
    expect(state).toEqual(before)
  })

  it('满血时不能使用【回复】', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'heal' }],
    })
    const before = snapshot(state)
    expect(() => submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })).toThrow(
      '体力已满',
    )
    expect(state).toEqual(before)
  })

  it('已受伤时使用【回复】回复 1 点体力', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'heal' }],
      playerHp: 2,
    })
    const heal = state.players[0].hand[0]!
    submit(state, { kind: 'use-card', card: heal })
    expect(state.players[0].hp).toBe(3)
    expect(state.players[0].discard.map((c) => c.uid)).toContain(heal.uid)
    assertConservation(state)
  })

  it('使用不在手牌中的牌会被拒绝且状态不变', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    const before = snapshot(state)
    expect(() =>
      submit(state, {
        kind: 'use-card',
        card: { uid: 9999, kind: 'strike' },
      }),
    ).toThrow('不在你的手牌中')
    expect(state).toEqual(before)
  })

  it('不是自己的出牌阶段时无法使用牌', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }],
      active: 1,
    })
    const before = snapshot(state)
    expect(() => submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })).toThrow()
    expect(state).toEqual(before)
  })

  it('结束出牌阶段后进入弃牌阶段', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHp: 2,
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }],
    })
    submit(state, { kind: 'end-phase' })
    expect(state.pending).toEqual({ kind: 'discard', player: 0, count: 2 })
  })
})
