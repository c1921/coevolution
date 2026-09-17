import { describe, expect, it } from 'vitest'
import { SPECIES } from '../data/species'
import { submit } from '../engine'
import { assertConservation } from '../rules/cardZones'
import { cardUseCount } from '../rules/usage'
import { playOptions, useOptions } from '../skills'
import { makeState, snapshot } from '../testUtils'

describe('转化型技能', () => {
  it('疾影：【打击】可以当【防御】打出', () => {
    const state = makeState({
      playerSpecies: 'leopard',
      aiSpecies: 'lion',
      active: 1,
      playerHand: [{ kind: 'strike' }],
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
      playerHand: [{ kind: 'defend' }],
    })
    const card = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card, as: 'strike', via: 'flicker' })
    submit(state, { kind: 'cancel' })

    expect(state.players[1].hp).toBe(3)
    // 转化牌按「当作的牌名」计数与付费：这一张算一次【打击】（1 点能量）
    expect(cardUseCount(state, 0, 'strike')).toBe(1)
    assertConservation(state)
  })

  it('疾影只能双向转化，不能把【回复】当【打击】', () => {
    const state = makeState({
      playerSpecies: 'leopard',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'heal' }],
    })
    const heal = state.players[0].hand[0]!

    expect(useOptions(state, 0, heal).some((o) => o.via === 'flicker')).toBe(false)
    expect(playOptions(state, 0, heal)).toHaveLength(0)

    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: heal, as: 'strike', via: 'flicker' }),
    ).toThrow('无法发动【疾影】')
    expect(state).toEqual(before)
  })

  it('没有对应技能时不能冒用转化', () => {
    const state = makeState({
      playerSpecies: 'bear',
      aiSpecies: 'leopard',
      playerHand: [{ kind: 'defend' }],
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, {
        kind: 'use-card',
        card: state.players[0].hand[0]!,
        as: 'strike',
        via: 'flicker',
      }),
    ).toThrow('无法发动【疾影】')
    expect(state).toEqual(before)
  })

  it('虎与鹿暂时没有转化技（猛扑 / 灵草因卡牌移除花色而移除）', () => {
    expect(SPECIES.tiger.skills).toHaveLength(0)
    expect(SPECIES.deer.skills.map((s) => s.id)).toEqual(['mend'])

    // 虎拿着【防御】也只有「打出【防御】」这一种用法，没有当【打击】的转化
    const tiger = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend' }],
    })
    expect(useOptions(tiger, 0, tiger.players[0].hand[0]!)).toHaveLength(0)
  })
})
