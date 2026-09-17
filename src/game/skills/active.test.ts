import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { assertConservation } from '../rules/cardZones'
import { skillUsed } from '../rules/usage'
import { activeOptions } from '../skills'
import { makeState, snapshot } from '../testUtils'

describe('主动技', () => {
  it('透支：失去 1 点体力并摸两张牌，且不算「受到伤害」', () => {
    const state = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      playerHp: 4,
      playerHand: [{ kind: 'strike' }],
    })

    submit(state, { kind: 'activate', skill: 'overexert' })

    expect(state.players[0].hp).toBe(3)
    expect(state.players[0].hand).toHaveLength(3)
    expect(state.lastDamage).toBeNull()
    expect(state.stack).toHaveLength(0)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('透支：体力降到 0 时先结算濒死，存活后才摸两张牌', () => {
    const state = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      playerHp: 1,
      playerHand: [{ kind: 'heal' }],
    })

    submit(state, { kind: 'activate', skill: 'overexert' })

    expect(state.players[0].hp).toBe(0)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 0 })
    // 濒死尚未结算，摸牌还没有发生
    expect(state.players[0].hand).toHaveLength(1)

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'heal' })

    expect(state.players[0].hp).toBe(1)
    expect(state.players[0].alive).toBe(true)
    // 回复牌已用掉，随后摸两张
    expect(state.players[0].hand).toHaveLength(2)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('透支：濒死时无人救援则阵亡', () => {
    const state = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      playerHp: 1,
      playerHand: [{ kind: 'strike' }],
    })

    submit(state, { kind: 'activate', skill: 'overexert' })
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0 })

    submit(state, { kind: 'cancel' })
    submit(state, { kind: 'cancel' })

    expect(state.players[0].alive).toBe(false)
    expect(state.result).toEqual({ winner: 1 })
    assertConservation(state)
  })

  it('透支：出牌阶段可以反复发动', () => {
    const state = makeState({ playerSpecies: 'ox', aiSpecies: 'bear', playerHp: 4 })

    submit(state, { kind: 'activate', skill: 'overexert' })
    submit(state, { kind: 'activate', skill: 'overexert' })

    expect(state.players[0].hp).toBe(2)
    expect(state.players[0].hand).toHaveLength(4)
    assertConservation(state)
  })

  it('疗愈：弃一张手牌回复 1 点体力', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 2,
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
    })
    const discard = state.players[0].hand[0]!

    submit(state, { kind: 'activate', skill: 'mend', cards: [discard] })

    expect(state.players[0].hp).toBe(3)
    expect(state.players[0].discard.map((c) => c.uid)).toContain(discard.uid)
    expect(state.players[0].hand).toHaveLength(1)
    assertConservation(state)
  })

  it('疗愈：每回合限一次', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 1,
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
    })

    submit(state, { kind: 'activate', skill: 'mend', cards: [state.players[0].hand[0]!] })
    expect(state.players[0].hp).toBe(2)
    expect(skillUsed(state, 0, 'mend')).toBe(true)

    const before = snapshot(state)
    expect(() =>
      submit(state, {
        kind: 'activate',
        skill: 'mend',
        cards: [state.players[0].hand[0]!],
      }),
    ).toThrow('当前无法发动【疗愈】')
    expect(state).toEqual(before)
  })

  it('疗愈：没有任何已受伤角色时不可发动', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
    })

    expect(activeOptions(state, 0)).not.toContain('mend')

    const before = snapshot(state)
    expect(() =>
      submit(state, {
        kind: 'activate',
        skill: 'mend',
        cards: [state.players[0].hand[0]!],
      }),
    ).toThrow()
    expect(state).toEqual(before)
  })

  it('疗愈：也可以指定已受伤的对手为目标', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      aiHp: 2,
      playerHand: [{ kind: 'strike' }],
    })

    submit(state, {
      kind: 'activate',
      skill: 'mend',
      cards: [state.players[0].hand[0]!],
      target: 1,
    })

    expect(state.players[1].hp).toBe(3)
    expect(state.players[0].hp).toBe(3)
    assertConservation(state)
  })

  it('不是自己的回合时无法发动主动技', () => {
    const state = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      active: 1,
      playerHp: 4,
    })

    const before = snapshot(state)
    expect(() => submit(state, { kind: 'activate', skill: 'overexert' })).toThrow()
    expect(state).toEqual(before)
  })
})
