import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { makeState } from '../testUtils'
import { assertConservation } from './cardZones'
import { dealDamage } from './damage'

describe('伤害结算', () => {
  it('造成伤害会扣减体力并写入战报', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
    advance(state)

    expect(state.players[1].hp).toBe(3)
    expect(state.lastDamage).toMatchObject({ source: 0, target: 1, amount: 1 })
    expect(state.log.map((e) => e.text).join()).toContain('受到 1 点伤害')
    assertConservation(state)
  })

  it('时机顺序：扣减体力 → 受到伤害后技能 → 濒死检查', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'wolf',
      playerHand: [{ kind: 'strike', suit: 'spade' }],
      aiHp: 1,
    })
    const strike = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card: strike })
    submit(state, { kind: 'cancel' })

    // 先询问夺食，此时造成伤害的牌仍在处理区
    expect(state.players[1].hp).toBe(0)
    expect(state.pending).toMatchObject({ kind: 'trigger', player: 1, skill: 'snatch' })
    expect(state.processing.map((c) => c.uid)).toContain(strike.uid)

    submit(state, { kind: 'trigger-choice', accept: true })

    // 夺食拿到牌之后才进入濒死
    expect(state.players[1].hand.map((c) => c.uid)).toContain(strike.uid)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })
    assertConservation(state)
  })

  it('放弃发动夺食则伤害牌进入弃牌堆', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'wolf',
      playerHand: [{ kind: 'strike' }],
    })
    const strike = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card: strike })
    submit(state, { kind: 'cancel' })
    expect(state.pending).toMatchObject({ kind: 'trigger', skill: 'snatch' })

    submit(state, { kind: 'trigger-choice', accept: false })

    expect(state.players[1].hp).toBe(3)
    expect(state.processing).toHaveLength(0)
    expect(state.discard.map((c) => c.uid)).toContain(strike.uid)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('狡计获得伤害来源的一张手牌', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'fox',
      playerHand: [{ kind: 'strike' }, { kind: 'heal' }],
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    submit(state, { kind: 'cancel' })
    expect(state.pending).toMatchObject({ kind: 'trigger', player: 1, skill: 'guile' })
    expect(state.players[0].hand).toHaveLength(1)

    submit(state, { kind: 'trigger-choice', accept: true })

    expect(state.players[1].hand).toHaveLength(1)
    expect(state.players[0].hand).toHaveLength(0)
    expect(state.players[1].hp).toBe(2)
    assertConservation(state)
  })

  it('伤害来源没有手牌时不会询问狡计', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'fox',
      playerHand: [{ kind: 'strike' }],
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    submit(state, { kind: 'cancel' })

    expect(state.players[1].hp).toBe(2)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })
})
