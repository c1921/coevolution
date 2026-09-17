import type { Card, CardKind, Suit } from '../types'

export const SUIT_SYMBOL: Record<Suit, string> = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
}

export const SUIT_NAME: Record<Suit, string> = {
  spade: '黑桃',
  heart: '红桃',
  club: '梅花',
  diamond: '方块',
}

/** 红色花色 —— 猛扑与灵草的判定依据 */
export function isRedSuit(suit: Suit): boolean {
  return suit === 'heart' || suit === 'diamond'
}

export function isRedCard(card: Card): boolean {
  return isRedSuit(card.suit)
}

/** 1=A，11=J，12=Q，13=K */
export function rankLabel(rank: number): string {
  if (rank === 1) return 'A'
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  return String(rank)
}

/**
 * 完整牌表：共 53 张。
 *  - 打击 ×30：♠10 + ♣13 + ♥3 + ♦4（红 7 / 黑 23，整体以黑为主）
 *  - 防御 ×15：♦10 + ♥5（全红）
 *  - 回复 ×8 ：♥7 + ♦1（全红）
 * 合计 红 30 / 黑 23。
 *
 * 防御与回复全红是刻意设计：它们是【猛扑】【灵草】转化的唯一来源，
 * 全红可保证红牌占到 30/53，让转化型技能始终有牌可用。
 * 这是唯一的平衡旋钮：改动后同步 deck.test.ts 的期望值。
 */
const DECK_TABLE: { kind: CardKind; suit: Suit; ranks: number[] }[] = [
  { kind: 'strike', suit: 'spade', ranks: [7, 8, 8, 8, 9, 9, 9, 10, 10, 10] },
  { kind: 'strike', suit: 'club', ranks: [2, 3, 4, 5, 6, 7, 8, 8, 9, 9, 10, 10, 11] },
  { kind: 'strike', suit: 'heart', ranks: [10, 10, 11] },
  { kind: 'strike', suit: 'diamond', ranks: [6, 7, 8, 9] },
  { kind: 'defend', suit: 'diamond', ranks: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { kind: 'defend', suit: 'heart', ranks: [2, 2, 3, 4, 5] },
  { kind: 'heal', suit: 'heart', ranks: [3, 4, 6, 7, 8, 9, 12] },
  { kind: 'heal', suit: 'diamond', ranks: [12] },
]

/** 牌堆总张数（测试与守恒校验的基准） */
export const DECK_SIZE = DECK_TABLE.reduce((sum, row) => sum + row.ranks.length, 0)

/** 构建 53 张牌，uid 按牌表顺序从 0 开始分配 */
export function buildDeck(): Card[] {
  const cards: Card[] = []
  for (const row of DECK_TABLE) {
    for (const rank of row.ranks) {
      cards.push({ uid: cards.length, kind: row.kind, suit: row.suit, rank })
    }
  }
  return cards
}

/** 「♠7」这样的短标签 */
export function cardLabel(card: Card): string {
  return `${SUIT_SYMBOL[card.suit]}${rankLabel(card.rank)}`
}
