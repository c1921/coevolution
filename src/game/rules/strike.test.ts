import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { makeState, snapshot } from '../testUtils'
import { assertConservation } from './cardZones'
import { BASE_ENERGY_MAX, energyMax } from './energy'
import { cardUseCount } from './usage'

describe('【打击】结算', () => {
  it('目标打出【防御】即抵消，双方无伤害且两张牌都进弃牌堆', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
      aiHand: [{ kind: 'defend' }],
    })
    const strike = state.players[0].hand[0]!
    const dodge = state.players[1].hand[0]!

    submit(state, { kind: 'use-card', card: strike })
    expect(state.pending).toMatchObject({ kind: 'respond', player: 1, need: 1, got: 0 })

    submit(state, { kind: 'play-card', card: dodge })

    expect(state.players[0].hp).toBe(4)
    expect(state.players[1].hp).toBe(4)
    expect(state.processing).toHaveLength(0)
    // 牌组私有化：打击牌进使用者的弃牌堆，防御牌进响应者的弃牌堆
    expect(state.players[0].discard.map((c) => c.uid)).toEqual([strike.uid])
    expect(state.players[1].discard.map((c) => c.uid)).toEqual([dodge.uid])
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('目标放弃打出【防御】则受到 1 点伤害', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
      aiHand: [{ kind: 'strike' }],
    })
    const strike = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card: strike })
    submit(state, { kind: 'cancel' })

    expect(state.players[1].hp).toBe(3)
    expect(state.processing).toHaveLength(0)
    expect(state.players[0].discard.map((c) => c.uid)).toContain(strike.uid)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('【打击】没有次数限制：能量足够就能连续使用', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
      aiHand: [{ kind: 'defend' }, { kind: 'defend' }],
    })
    const first = state.players[0].hand[0]!
    submit(state, { kind: 'use-card', card: first })
    submit(state, { kind: 'play-card', card: state.players[1].hand[0]! })
    expect(cardUseCount(state, 0, 'strike')).toBe(1)

    const second = state.players[0].hand[0]!
    submit(state, { kind: 'use-card', card: second })
    submit(state, { kind: 'play-card', card: state.players[1].hand[0]! })

    // 两次【打击】都被抵消，账面上只花掉 2 点能量
    expect(cardUseCount(state, 0, 'strike')).toBe(2)
    expect(state.players[0].energy).toBe(BASE_ENERGY_MAX - 2)
    expect(state.players[1].hp).toBe(4)
    assertConservation(state)
  })

  it('能量耗尽后无法再使用【打击】', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
      ],
      aiHand: [{ kind: 'defend' }, { kind: 'defend' }, { kind: 'defend' }],
    })

    // 3 点能量正好打三张【打击】，第三张之后能量见底
    for (let i = 0; i < BASE_ENERGY_MAX; i++) {
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'strike' })
      submit(state, { kind: 'play-card', card: state.players[1].hand[0]!, as: 'defend' })
    }
    expect(state.players[0].energy).toBe(0)
    expect(state.players[1].hand).toHaveLength(0)
    expect(state.players[0].hand).toHaveLength(1)
    expect(state.players[1].hp).toBe(4)

    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'strike' }),
    ).toThrow('能量不足')
    expect(state).toEqual(before)
    assertConservation(state)
  })

  it('怒吼：能量上限 +2，同一回合可以打出更多【打击】', () => {
    const state = makeState({
      playerSpecies: 'bear',
      aiSpecies: 'tiger',
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }],
      aiHand: [{ kind: 'defend' }, { kind: 'defend' }, { kind: 'defend' }],
    })

    for (let i = 0; i < 3; i++) {
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'strike' })
      submit(state, { kind: 'play-card', card: state.players[1].hand[0]!, as: 'defend' })
    }

    // 熊的上限是 5（怒吼 +2），打完三张还剩 2 点（虎的上限只有 3）
    expect(cardUseCount(state, 0, 'strike')).toBe(3)
    expect(energyMax(state, 0)).toBe(BASE_ENERGY_MAX + 2)
    expect(state.players[0].energy).toBe(energyMax(state, 0) - 3)
    expect(state.players[1].hp).toBe(4)
    assertConservation(state)
  })

  it('威压：目标需依次打出两张【防御】，只出一张仍会受伤', () => {
    const state = makeState({
      playerSpecies: 'lion',
      aiSpecies: 'tiger',
      playerHand: [{ kind: 'strike' }],
      aiHand: [{ kind: 'defend' }, { kind: 'defend' }],
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    expect(state.pending).toMatchObject({ kind: 'respond', need: 2, got: 0 })

    submit(state, { kind: 'play-card', card: state.players[1].hand[0]! })
    expect(state.pending).toMatchObject({ kind: 'respond', need: 2, got: 1 })

    submit(state, { kind: 'cancel' })
    expect(state.players[1].hp).toBe(3)
    assertConservation(state)
  })

  it('威压：连续打出两张【防御】可以完全抵消', () => {
    const state = makeState({
      playerSpecies: 'lion',
      aiSpecies: 'tiger',
      playerHand: [{ kind: 'strike' }],
      aiHand: [{ kind: 'defend' }, { kind: 'defend' }],
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    submit(state, { kind: 'play-card', card: state.players[1].hand[0]! })
    submit(state, { kind: 'play-card', card: state.players[1].hand[0]! })

    expect(state.players[1].hp).toBe(4)
    expect(state.processing).toHaveLength(0)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('满血时不能使用【回复】', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'heal' }],
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]! }),
    ).toThrow('体力已满')
    expect(state).toEqual(before)
  })

  it('已受伤时使用【回复】回复 1 点体力', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'heal' }],
      playerHp: 2,
    })
    const heal = state.players[0].hand[0]!
    submit(state, { kind: 'use-card', card: heal })
    expect(state.players[0].hp).toBe(3)
    expect(state.players[0].discard.map((c) => c.uid)).toContain(heal.uid)
    assertConservation(state)
  })

  it('出牌阶段不能主动使用【防御】', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend' }],
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]! }),
    ).toThrow('【防御】只能在响应【打击】时打出')
    expect(state).toEqual(before)
  })

  it('使用不在手牌中的牌会被拒绝且状态不变', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
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
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
      active: 1,
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]! }),
    ).toThrow()
    expect(state).toEqual(before)
  })

  it('结束出牌阶段后进入弃牌阶段', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHp: 2,
      playerHand: [
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
      ],
    })
    submit(state, { kind: 'end-phase' })
    expect(state.pending).toEqual({ kind: 'discard', player: 0, count: 2 })
  })
})
