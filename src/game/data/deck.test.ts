import { describe, expect, it } from 'vitest'
import { shuffle } from '../rng'
import { buildDeck, DECK_SIZE, isRedCard, rankLabel } from './deck'
import type { CardKind } from '../types'

function countBy(kind: CardKind): number {
  return buildDeck().filter((c) => c.kind === kind).length
}

describe('牌堆', () => {
  it('共 53 张', () => {
    expect(buildDeck()).toHaveLength(53)
    expect(DECK_SIZE).toBe(53)
  })

  it('分类计数为 打击 30 / 防御 15 / 回复 8', () => {
    expect(countBy('strike')).toBe(30)
    expect(countBy('defend')).toBe(15)
    expect(countBy('heal')).toBe(8)
  })

  it('uid 唯一且恰好覆盖 0..52', () => {
    const uids = buildDeck().map((c) => c.uid)
    expect(new Set(uids).size).toBe(53)
    expect([...uids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 53 }, (_, i) => i),
    )
  })

  it('花色与点数均合法', () => {
    const suits = new Set(['spade', 'heart', 'club', 'diamond'])
    for (const card of buildDeck()) {
      expect(suits.has(card.suit)).toBe(true)
      expect(Number.isInteger(card.rank)).toBe(true)
      expect(card.rank).toBeGreaterThanOrEqual(1)
      expect(card.rank).toBeLessThanOrEqual(13)
    }
  })

  it('红 30 / 黑 23', () => {
    const deck = buildDeck()
    const red = deck.filter(isRedCard).length
    expect(red).toBe(30)
    expect(deck.length - red).toBe(23)
  })

  it('防御与回复全部为红色（转化型技能的牌源）', () => {
    for (const card of buildDeck()) {
      if (card.kind === 'defend' || card.kind === 'heal') {
        expect(isRedCard(card)).toBe(true)
      }
    }
  })

  it('洗牌不增删牌，且同种子结果一致、异种子结果不同', () => {
    const deck = buildDeck()
    const a = shuffle(deck, 12345)
    const b = shuffle(deck, 12345)
    const c = shuffle(deck, 999)

    expect(a.items).toHaveLength(53)
    expect([...a.items].map((x) => x.uid).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 53 }, (_, i) => i),
    )
    expect(a.items.map((x) => x.uid)).toEqual(b.items.map((x) => x.uid))
    expect(a.items.map((x) => x.uid)).not.toEqual(c.items.map((x) => x.uid))
    // 不修改入参
    expect(deck.map((x) => x.uid)).toEqual(Array.from({ length: 53 }, (_, i) => i))
  })

  it('rankLabel 映射 A/J/Q/K', () => {
    expect(rankLabel(1)).toBe('A')
    expect(rankLabel(7)).toBe('7')
    expect(rankLabel(11)).toBe('J')
    expect(rankLabel(12)).toBe('Q')
    expect(rankLabel(13)).toBe('K')
  })
})
