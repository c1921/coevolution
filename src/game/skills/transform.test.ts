import { describe, expect, it } from 'vitest'
import { SPECIES } from '../data/species'
import { createRegistry, registryToDocs, withRegistry } from '../dsl/registry'
import { submit } from '../engine'
import { assertConservation } from '../rules/cardZones'
import { cardUseCount } from '../rules/usage'
import { playOptions, useOptions } from '../skills'
import { makeState, snapshot } from '../testUtils'

describe('转化型技能', () => {
  it('疾影：【打击】可以当【防御】使用，抵消自己的威胁', () => {
    const state = makeState({
      playerSpecies: 'leopard',
      aiSpecies: 'lion',
      playerHand: [{ kind: 'strike' }],
      playerThreat: 1,
    })

    submit(state, {
      kind: 'use-card',
      card: state.players[0].hand[0]!,
      as: 'defend',
      via: 'flicker',
    })

    expect(state.players[0].threat).toBe(0)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
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

    expect(state.players[1].threat).toBe(1)
    // 转化牌按「当作的牌名」计数与付费：这一张算一次【打击】（1 点能量）
    expect(cardUseCount(state, 0, 'strike')).toBe(1)
    expect(cardUseCount(state, 0, 'defend')).toBe(0)
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

  it('虎不带转化技（【猛扑】是主动技），鹿只有【疗愈】', () => {
    expect(SPECIES.tiger.skills.map((s) => s.id)).toEqual(['pounce'])
    expect(SPECIES.deer.skills.map((s) => s.id)).toEqual(['mend'])

    // 虎拿着【防御】只有「抵消自己的威胁」这一种用法，没有当【打击】的转化
    const tiger = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend' }],
    })
    expect(useOptions(tiger, 0, tiger.players[0].hand[0]!)).toEqual([{ as: 'defend' }])
  })
})

describe('转化由文档描述', () => {
  it('换一份技能文档即可新增一条转化，引擎与 legality 都不用改', () => {
    // 以完整内容集为底，只替换 roar 这一份文档
    const synthetic = createRegistry([
      ...registryToDocs().filter((doc) => (doc.value as { id?: string }).id !== 'roar'),
      {
        path: 'skills/roar.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'roar',
          name: '怒吼',
          text: '你每回合的能量上限 +2；你可以将【回复】当【打击】使用。',
          // 保留原有的能量修正，否则换掉文档后 bear 的能量上限会从 5 变回 3
          modifiers: [
            { channel: 'energy-max', op: 'add', value: { kind: 'const', value: 2 } },
          ],
          transforms: [{ from: 'heal', to: 'strike', contexts: ['use'] }],
        },
      },
    ])

    // 熊拥有 roar；虎没有技能，作为对手
    const state = makeState({
      playerSpecies: 'bear',
      aiSpecies: 'tiger',
      playerHand: [{ kind: 'heal' }],
    })
    const heal = state.players[0].hand[0]!

    // 熊的怒吼本来只是常驻修正：只有"使用【回复】"这一种牌面
    expect(useOptions(state, 0, heal).map((o) => o.as)).toEqual(['heal'])

    withRegistry(synthetic, () => {
      expect(useOptions(state, 0, heal)).toEqual([{ as: 'heal' }, { as: 'strike', via: 'roar' }])
      // 端到端：把【回复】当【打击】使用，对手获得 1 点威胁
      submit(state, { kind: 'use-card', card: heal, as: 'strike', via: 'roar' })
      expect(state.players[1].threat).toBe(1)
      expect(state.players[1].hp).toBe(4)
    })
    assertConservation(state)
  })
})
