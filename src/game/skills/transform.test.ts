import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { assertConservation } from '../rules/cardZones'
import { cardUseCount } from '../rules/usage'
import { playOptions, useOptions } from '../skills'
import { makeState, snapshot } from '../testUtils'

describe('转化型技能', () => {
  it('猛扑：红色牌可以当【打击】使用', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend', suit: 'diamond' }],
    })
    const card = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card, as: 'strike', via: 'pounce' })
    expect(state.pending).toMatchObject({ kind: 'respond', player: 1, need: 1 })

    submit(state, { kind: 'cancel' })
    expect(state.players[1].hp).toBe(3)
    expect(state.discard.map((c) => c.uid)).toContain(card.uid)
    assertConservation(state)
  })

  it('猛扑：只有红色牌能被转化', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [
        { kind: 'strike', suit: 'club' },
        { kind: 'defend', suit: 'diamond' },
      ],
    })
    const blackStrike = state.players[0].hand[0]!
    const redDefend = state.players[0].hand[1]!

    expect(useOptions(state, 0, blackStrike).some((o) => o.via === 'pounce')).toBe(false)
    expect(useOptions(state, 0, redDefend).some((o) => o.via === 'pounce')).toBe(true)
  })

  it('猛扑不能把非【防御】的牌当【防御】打出（猛扑只产出【打击】）', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'lion',
      active: 1,
      playerHand: [{ kind: 'heal', suit: 'heart' }],
      aiHand: [{ kind: 'strike' }],
    })

    submit(state, { kind: 'use-card', card: state.players[1].hand[0]! })
    expect(state.pending).toMatchObject({ kind: 'respond', player: 0, need: 2 })

    const redHeal = state.players[0].hand[0]!
    expect(playOptions(state, 0, redHeal)).toHaveLength(0)

    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'play-card', card: redHeal, as: 'defend', via: 'pounce' }),
    ).toThrow()
    expect(state).toEqual(before)
  })

  it('疾影：【打击】可以当【防御】打出', () => {
    const state = makeState({
      playerSpecies: 'leopard',
      aiSpecies: 'lion',
      active: 1,
      playerHand: [{ kind: 'strike', suit: 'spade' }],
      aiHand: [{ kind: 'strike' }],
    })

    submit(state, { kind: 'use-card', card: state.players[1].hand[0]! })
    // 威压：需要两张【防御】
    expect(state.pending).toMatchObject({ kind: 'respond', player: 0, need: 2, got: 0 })

    submit(state, {
      kind: 'play-card',
      card: state.players[0].hand[0]!,
      as: 'defend',
      via: 'flicker',
    })
    expect(state.pending).toMatchObject({ kind: 'respond', player: 0, need: 2, got: 1 })

    submit(state, { kind: 'cancel' })
    expect(state.players[0].hp).toBe(3)
    assertConservation(state)
  })

  it('疾影：【防御】可以当【打击】使用', () => {
    const state = makeState({
      playerSpecies: 'leopard',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend', suit: 'diamond' }],
    })
    const card = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card, as: 'strike', via: 'flicker' })
    submit(state, { kind: 'cancel' })

    expect(state.players[1].hp).toBe(3)
    // 转化牌按「当作的牌名」计入使用次数：用掉的是【打击】本回合的那一次
    expect(cardUseCount(state, 0, 'strike')).toBe(1)
    assertConservation(state)
  })

  it('灵草：回合外可以用红色牌当【回复】自救', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      active: 1,
      playerHand: [{ kind: 'strike', suit: 'heart' }],
      playerHp: 1,
      aiHand: [{ kind: 'strike' }],
    })

    submit(state, { kind: 'use-card', card: state.players[1].hand[0]! })
    submit(state, { kind: 'cancel' })

    expect(state.players[0].hp).toBe(0)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 0 })

    submit(state, {
      kind: 'use-card',
      card: state.players[0].hand[0]!,
      as: 'heal',
      via: 'herb',
    })

    expect(state.players[0].hp).toBe(1)
    expect(state.players[0].alive).toBe(true)
    assertConservation(state)
  })

  it('灵草：自己的回合内不能发动', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      active: 0,
      playerHand: [{ kind: 'strike', suit: 'heart' }],
      playerHp: 2,
    })
    const card = state.players[0].hand[0]!

    expect(useOptions(state, 0, card).some((o) => o.via === 'herb')).toBe(false)

    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card, as: 'heal', via: 'herb' }),
    ).toThrow()
    expect(state).toEqual(before)
  })

  it('没有对应技能时不能冒用转化', () => {
    const state = makeState({
      playerSpecies: 'bear',
      aiSpecies: 'tiger',
      playerHand: [{ kind: 'defend', suit: 'diamond' }],
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, {
        kind: 'use-card',
        card: state.players[0].hand[0]!,
        as: 'strike',
        via: 'pounce',
      }),
    ).toThrow('无法发动【猛扑】')
    expect(state).toEqual(before)
  })
})
