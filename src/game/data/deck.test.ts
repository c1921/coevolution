import { describe, expect, it } from 'vitest'
import { shuffle } from '../rng'
import { SPECIES_IDS } from './species'
import {
  buildDeck,
  DECK_SIZE,
  speciesDeck,
  speciesDeckSize,
  totalDeckSize,
} from './deck'
import type { CardKind } from '../types'

/** 取某个物种牌组的牌种计数 */
function countBy(species: Parameters<typeof buildDeck>[0], kind: CardKind): number {
  return buildDeck(species).filter((c) => c.kind === kind).length
}

describe('私有牌组', () => {
  it('每个物种一副，共 20 张', () => {
    expect(DECK_SIZE).toBe(20)
    expect(speciesDeckSize('tiger')).toBe(20)
    for (const id of SPECIES_IDS) {
      expect(buildDeck(id)).toHaveLength(20)
      expect(speciesDeck(id)).toHaveLength(20)
    }
  })

  it('分类计数为 打击 11 / 防御 6 / 回复 3', () => {
    expect(countBy('tiger', 'strike')).toBe(11)
    expect(countBy('tiger', 'defend')).toBe(6)
    expect(countBy('tiger', 'heal')).toBe(3)
  })

  it('暂时所有物种共用同一套牌', () => {
    const reference = speciesDeck('tiger')
    for (const id of SPECIES_IDS) {
      expect(speciesDeck(id)).toEqual(reference)
    }
  })

  it('卡牌只有 uid 与牌种：没有花色、没有点数', () => {
    for (const card of buildDeck('tiger')) {
      expect(Object.keys(card).sort()).toEqual(['kind', 'uid'])
      expect(['strike', 'defend', 'heal']).toContain(card.kind)
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
