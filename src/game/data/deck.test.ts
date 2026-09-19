import { describe, expect, it } from 'vitest'
import { shuffle } from '../rng'
import { speciesDoc } from '../dsl/registry'
import { SPECIES_IDS } from './species'
import {
  buildDeck,
  DECK_SIZE,
  speciesDeck,
  speciesDeckSize,
  totalDeckSize,
} from './deck'
import type { SpeciesId } from '../types'

/** 某个物种牌组的牌种计数（kind → 张数） */
function compositionOf(species: SpeciesId): Record<string, number> {
  const out: Record<string, number> = {}
  for (const card of buildDeck(species)) out[card.kind] = (out[card.kind] ?? 0) + 1
  return out
}

describe('私有牌组', () => {
  it('每个物种一副，共 20 张', () => {
    expect(DECK_SIZE).toBe(20)
    for (const id of SPECIES_IDS) {
      expect(buildDeck(id), `${id} 的牌组`).toHaveLength(20)
      expect(speciesDeck(id)).toHaveLength(20)
      expect(speciesDeckSize(id)).toBe(20)
    }
  })

  it('三套牌组的构成：基础 11/6/3、攻击 11/5/2/1/1、防守 10/7/3', () => {
    // 基础：打击 11 / 防御 6 / 回复 3（鹿、狼、狐）
    expect(compositionOf('deer')).toEqual({ strike: 11, defend: 6, heal: 3 })
    // 攻击：少一张防御与回复，换入【急救】与【风暴】（虎、豹、狮）
    expect(compositionOf('tiger')).toEqual({
      strike: 11,
      defend: 5,
      heal: 2,
      'first-aid': 1,
      storm: 1,
    })
    // 防守：更多【防御】（熊、牛）
    expect(compositionOf('bear')).toEqual({ strike: 10, defend: 7, heal: 3 })
  })

  it('物种按设定分到各自的牌组（改物种文档的 deck 字段即可改配牌）', () => {
    const mapping: Record<string, SpeciesId[]> = {
      basic: ['deer', 'wolf', 'fox'],
      aggressive: ['tiger', 'leopard', 'lion'],
      guarded: ['bear', 'ox'],
    }
    for (const id of SPECIES_IDS) {
      const expected = Object.entries(mapping).find(([, list]) => list.includes(id))?.[0]
      expect(speciesDoc(id).deck, `${id} 的牌组`).toBe(expected)
    }
  })

  it('同牌组的物种共用同一份牌组文档', () => {
    expect(speciesDeck('tiger')).toEqual(speciesDeck('lion'))
    expect(speciesDeck('bear')).toEqual(speciesDeck('ox'))
    expect(speciesDeck('deer')).not.toEqual(speciesDeck('tiger'))
  })

  it('卡牌只有 uid 与牌种：没有花色、没有点数', () => {
    for (const card of buildDeck('tiger')) {
      expect(Object.keys(card).sort()).toEqual(['kind', 'uid'])
      expect(card.kind.length).toBeGreaterThan(0)
    }
  })

  it('uid 从 uidBase 起连续分配', () => {
    const base = buildDeck('tiger', 0)
    expect(base.map((c) => c.uid)).toEqual(Array.from({ length: 20 }, (_, i) => i))

    const offset = buildDeck('bear', 20)
    expect(offset.map((c) => c.uid)).toEqual(Array.from({ length: 20 }, (_, i) => i + 20))
  })

  it('双方牌组的 uid 不重叠（处理区是共享的，uid 必须全局唯一）', () => {
    const p0 = buildDeck('tiger', 0)
    const p1 = buildDeck('bear', p0.length)
    const uids = [...p0, ...p1].map((c) => c.uid)
    expect(new Set(uids).size).toBe(40)
    expect(totalDeckSize('tiger', 'bear')).toBe(40)
  })

  it('洗牌不增删牌，且同种子结果一致、异种子结果不同', () => {
    const deck = buildDeck('tiger')
    const a = shuffle(deck, 12345)
    const b = shuffle(deck, 12345)
    const c = shuffle(deck, 999)

    expect(a.items).toHaveLength(20)
    expect([...a.items].map((x) => x.uid).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    )
    expect(a.items.map((x) => x.uid)).toEqual(b.items.map((x) => x.uid))
    expect(a.items.map((x) => x.uid)).not.toEqual(c.items.map((x) => x.uid))
    // 不修改入参
    expect(deck.map((x) => x.uid)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })
})
