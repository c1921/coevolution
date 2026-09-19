import { describe, expect, it } from 'vitest'
import { shuffle } from '../rng'
import { speciesDoc } from '../dsl/registry'
import { SPECIES_IDS } from './species'
import { buildDeck, DECK_SIZE, speciesDeck, speciesDeckSize, totalDeckSize } from './deck'
import type { SpeciesId } from '../types'

/** 某个物种牌组的牌种计数（kind → 张数） */
function compositionOf(species: SpeciesId): Record<string, number> {
  const out: Record<string, number> = {}
  for (const card of buildDeck(species)) out[card.kind] = (out[card.kind] ?? 0) + 1
  return out
}

describe('私有牌组', () => {
  it('每个物种一副，共 12 张', () => {
    expect(DECK_SIZE).toBe(12)
    for (const id of SPECIES_IDS) {
      expect(buildDeck(id), `${id} 的牌组`).toHaveLength(12)
      expect(speciesDeck(id)).toHaveLength(12)
      expect(speciesDeckSize(id)).toBe(12)
    }
  })

  it('三套牌组的构成：基础 8/4、攻击 8/3/1、防守 7/5（均不含回血牌）', () => {
    // 基础：打击 8 / 防御 4（反击型）
    expect(compositionOf('counter')).toEqual({ strike: 8, defend: 4 })
    // 攻击：少一张防御，换入【风暴】（进攻型、转化型）
    expect(compositionOf('offensive')).toEqual({ strike: 8, defend: 3, storm: 1 })
    // 防守：更多【防御】（防御型）
    expect(compositionOf('defensive')).toEqual({ strike: 7, defend: 5 })
    // 回血牌已从内容里删除：任何牌组都不该再出现
    for (const id of SPECIES_IDS) {
      expect(Object.keys(compositionOf(id)).sort()).not.toContain('heal')
      expect(Object.keys(compositionOf(id)).sort()).not.toContain('first-aid')
    }
  })

  it('物种按设定分到各自的牌组（改物种文档的 deck 字段即可改配牌）', () => {
    const mapping: Record<string, SpeciesId[]> = {
      basic: ['counter'],
      aggressive: ['offensive', 'morph'],
      guarded: ['defensive'],
    }
    for (const id of SPECIES_IDS) {
      const expected = Object.entries(mapping).find(([, list]) => list.includes(id))?.[0]
      expect(speciesDoc(id).deck, `${id} 的牌组`).toBe(expected)
    }
  })

  it('同牌组的物种共用同一份牌组文档', () => {
    expect(speciesDeck('offensive')).toEqual(speciesDeck('morph'))
    expect(speciesDeck('counter')).not.toEqual(speciesDeck('offensive'))
  })

  it('卡牌只有 uid 与牌种：没有花色、没有点数', () => {
    for (const card of buildDeck('offensive')) {
      expect(Object.keys(card).sort()).toEqual(['kind', 'uid'])
      expect(card.kind.length).toBeGreaterThan(0)
    }
  })

  it('uid 从 uidBase 起连续分配', () => {
    const base = buildDeck('offensive', 0)
    expect(base.map((c) => c.uid)).toEqual(Array.from({ length: DECK_SIZE }, (_, i) => i))

    const offset = buildDeck('defensive', DECK_SIZE)
    expect(offset.map((c) => c.uid)).toEqual(
      Array.from({ length: DECK_SIZE }, (_, i) => i + DECK_SIZE),
    )
  })

  it('双方牌组的 uid 不重叠（处理区是共享的，uid 必须全局唯一）', () => {
    const p0 = buildDeck('offensive', 0)
    const p1 = buildDeck('defensive', p0.length)
    const uids = [...p0, ...p1].map((c) => c.uid)
    expect(new Set(uids).size).toBe(DECK_SIZE * 2)
    expect(totalDeckSize('offensive', 'defensive')).toBe(DECK_SIZE * 2)
  })

  it('洗牌不增删牌，且同种子结果一致、异种子结果不同', () => {
    const deck = buildDeck('offensive')
    const a = shuffle(deck, 12345)
    const b = shuffle(deck, 12345)
    const c = shuffle(deck, 999)

    expect(a.items).toHaveLength(DECK_SIZE)
    expect([...a.items].map((x) => x.uid).sort((x, y) => x - y)).toEqual(
      Array.from({ length: DECK_SIZE }, (_, i) => i),
    )
    expect(a.items.map((x) => x.uid)).toEqual(b.items.map((x) => x.uid))
    expect(a.items.map((x) => x.uid)).not.toEqual(c.items.map((x) => x.uid))
    // 不修改入参
    expect(deck.map((x) => x.uid)).toEqual(Array.from({ length: DECK_SIZE }, (_, i) => i))
  })
})
