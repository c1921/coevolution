import { describe, expect, it } from 'vitest'
import { SPECIES } from '../data/species'
import { createRegistry, registryToDocs, withRegistry } from '../dsl/registry'
import { submit } from '../engine'
import { assertConservation } from '../rules/cardZones'
import { cardUseCount } from '../rules/usage'
import { playOptions, useOptions } from '../skills'
import { makeState, snapshot } from '../testUtils'

describe('转化型技能', () => {
  it('转换：【打击】可以当【防御】使用，抵消自己的威胁', () => {
    const state = makeState({
      playerSpecies: 'morph',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }],
      playerThreat: 1,
    })

    submit(state, {
      kind: 'use-card',
      card: state.players[0].hand[0]!,
      as: 'defend',
      via: 'convert',
    })

    expect(state.players[0].threat).toBe(0)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('转换：【防御】可以当【打击】使用', () => {
    const state = makeState({
      playerSpecies: 'morph',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
    })
    const card = state.players[0].hand[0]!

    submit(state, { kind: 'use-card', card, as: 'strike', via: 'convert' })

    expect(state.players[1].threat).toBe(1)
    // 转化牌按「当作的牌名」计数与付费：这一张算一次【打击】（1 点能量）
    expect(cardUseCount(state, 0, 'strike')).toBe(1)
    expect(cardUseCount(state, 0, 'defend')).toBe(0)
    assertConservation(state)
  })

  it('转换：【回复】也可以当【打击】使用，但它没有 play 变体、不能作为响应打出', () => {
    const state = makeState({
      playerSpecies: 'morph',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'heal' }],
    })
    const heal = state.players[0].hand[0]!

    expect(useOptions(state, 0, heal).some((o) => o.via === 'convert')).toBe(true)
    expect(playOptions(state, 0, heal)).toHaveLength(0)

    submit(state, { kind: 'use-card', card: heal, as: 'strike', via: 'convert' })
    expect(state.players[1].threat).toBe(1)
    assertConservation(state)
  })

  it('没有对应技能时不能冒用转化', () => {
    const state = makeState({
      playerSpecies: 'defensive',
      aiSpecies: 'morph',
      playerHand: [{ kind: 'defend' }],
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, {
        kind: 'use-card',
        card: state.players[0].hand[0]!,
        as: 'strike',
        via: 'convert',
      }),
    ).toThrow('无法发动【转换】')
    expect(state).toEqual(before)
  })

  it('只有转化型带转化技（进攻型的【强袭】是主动技）', () => {
    expect(SPECIES.morph.skills.map((s) => s.id)).toEqual(['convert'])
    expect(SPECIES.offensive.skills.map((s) => s.id)).toEqual(['assault'])

    // 进攻型拿着【防御】只有「抵消自己的威胁」这一种用法，没有当【打击】的转化
    const offensive = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
    })
    expect(useOptions(offensive, 0, offensive.players[0].hand[0]!)).toEqual([{ as: 'defend' }])
  })
})

describe('转化由文档描述', () => {
  it('换一份技能文档即可新增一条转化，引擎与 legality 都不用改', () => {
    // 以完整内容集为底，只替换 charge 这一份文档
    const synthetic = createRegistry([
      ...registryToDocs().filter((doc) => (doc.value as { id?: string }).id !== 'charge'),
      {
        path: 'skills/charge.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'charge',
          name: '蓄能',
          text: '你每回合的能量上限 +2；你可以将【回复】当【打击】使用。',
          // 保留原有的能量修正，否则换掉文档后 defensive 的能量上限会从 5 变回 3
          modifiers: [{ channel: 'energy-max', op: 'add', value: { kind: 'const', value: 2 } }],
          transforms: [{ from: 'heal', to: 'strike', contexts: ['use'] }],
        },
      },
    ])

    // 防御型拥有 charge；进攻型没有技能，作为对手
    const state = makeState({
      playerSpecies: 'defensive',
      aiSpecies: 'offensive',
      playerHand: [{ kind: 'heal' }],
    })
    const heal = state.players[0].hand[0]!

    // 防御型的蓄能本来只是常驻修正：只有"使用【回复】"这一种牌面
    expect(useOptions(state, 0, heal).map((o) => o.as)).toEqual(['heal'])

    withRegistry(synthetic, () => {
      expect(useOptions(state, 0, heal)).toEqual([{ as: 'heal' }, { as: 'strike', via: 'charge' }])
      // 端到端：把【回复】当【打击】使用，对手获得 1 点威胁
      submit(state, { kind: 'use-card', card: heal, as: 'strike', via: 'charge' })
      expect(state.players[1].threat).toBe(1)
      expect(state.players[1].hp).toBe(10)
    })
    assertConservation(state)
  })
})
