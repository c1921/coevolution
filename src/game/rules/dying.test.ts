import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { makeState } from '../testUtils'
import { assertConservation } from './cardZones'
import { dealDamage } from './damage'

describe('濒死结算', () => {
  it('濒死时使用【回复】自救成功', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
      aiHand: [{ kind: 'heal' }],
      aiHp: 1,
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    submit(state, { kind: 'cancel' })
    expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })

    submit(state, { kind: 'use-card', card: state.players[1].hand[0]!, as: 'heal' })

    expect(state.players[1].hp).toBe(1)
    expect(state.players[1].alive).toBe(true)
    expect(state.result).toBeNull()
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('体力为负时需要连续使用多张【回复】才能脱离濒死', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      aiHand: [{ kind: 'heal' }, { kind: 'heal' }],
      aiHp: 2,
    })

    dealDamage(state, { source: 0, target: 1, amount: 3, card: null })
    advance(state)

    expect(state.players[1].hp).toBe(-1)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })

    submit(state, { kind: 'use-card', card: state.players[1].hand[0]!, as: 'heal' })
    expect(state.players[1].hp).toBe(0)
    // 仍未脱离濒死，同一角色继续被询问
    expect(state.pending).toMatchObject({ kind: 'dying', player: 1 })

    submit(state, { kind: 'use-card', card: state.players[1].hand[0]!, as: 'heal' })
    expect(state.players[1].hp).toBe(1)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    expect(state.players[1].alive).toBe(true)
    assertConservation(state)
  })

  it('自己与对手都放弃救援则死亡', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
      aiHp: 1,
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    submit(state, { kind: 'cancel' })
    expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })

    submit(state, { kind: 'cancel' })
    // 轮到对手（玩家）决定是否救援
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 1 })

    submit(state, { kind: 'cancel' })
    expect(state.players[1].alive).toBe(false)
    expect(state.result).toEqual({ winner: 0 })
    assertConservation(state)
  })

  it('濒死救援不受「仅自己 / 已受伤 / 出牌阶段」限制，可以救对手', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }, { kind: 'heal' }],
      aiHp: 1,
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    submit(state, { kind: 'cancel' })
    submit(state, { kind: 'cancel' })
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 1 })

    const heal = state.players[0].hand[0]!
    submit(state, { kind: 'use-card', card: heal })

    expect(state.players[1].hp).toBe(1)
    expect(state.players[1].alive).toBe(true)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('濒死结算中不能使用【打击】', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
      aiHp: 1,
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    submit(state, { kind: 'cancel' })
    submit(state, { kind: 'cancel' })
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 1 })

    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]! }),
    ).toThrow('濒死结算中只能使用【回复】')
    assertConservation(state)
  })
})
