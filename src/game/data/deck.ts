import type { Card, CardKind, SpeciesId } from '../types'

/**
 * 每个物种私有牌组的构成：共 20 张。
 *  - 打击 ×11：主要输出，1 点能量
 *  - 防御 ×6 ：响应【打击】，1 点能量
 *  - 回复 ×3 ：回血与濒死自救，2 点能量
 *
 * 比例沿用此前 53 张公共牌堆的 30 : 15 : 8，因此攻防节奏基本不变。
 * 这是牌组侧唯一的平衡旋钮：改动后同步 deck.test.ts 的期望值。
 */
const DECK_TABLE: { kind: CardKind; count: number }[] = [
  { kind: 'strike', count: 11 },
  { kind: 'defend', count: 6 },
  { kind: 'heal', count: 3 },
]

/** 每副私有牌组的张数（测试与守恒校验的基准） */
export const DECK_SIZE = DECK_TABLE.reduce((sum, row) => sum + row.count, 0)

/** 牌组的牌种序列，按牌表顺序展开 */
const BASIC_DECK: CardKind[] = DECK_TABLE.flatMap((row) =>
  Array.from({ length: row.count }, () => row.kind),
)

/**
 * 每个物种的私有牌组（牌种序列）。
 * 暂时 8 个物种共用同一套 20 张；将来要按物种分化时，把 BASIC_DECK 换成各自的序列即可，
 * uid 分配、守恒校验（speciesDeckSize）与洗牌逻辑都不需要改。
 */
export const SPECIES_DECKS: Record<SpeciesId, CardKind[]> = {
  tiger: BASIC_DECK,
  bear: BASIC_DECK,
  leopard: BASIC_DECK,
  wolf: BASIC_DECK,
  deer: BASIC_DECK,
  lion: BASIC_DECK,
  ox: BASIC_DECK,
  fox: BASIC_DECK,
}

/** 某个物种私有牌组的牌种序列（返回副本，避免调用方改到牌表本身） */
export function speciesDeck(species: SpeciesId): CardKind[] {
  return [...SPECIES_DECKS[species]]
}

/** 某个物种私有牌组的张数（「牌数守恒」按它求和） */
export function speciesDeckSize(species: SpeciesId): number {
  return SPECIES_DECKS[species].length
}

/**
 * 构建某个物种的私有牌组。
 * uidBase 让双方的牌张 uid 全局唯一（处理区由双方共享，uid 不能撞车）。
 */
export function buildDeck(species: SpeciesId, uidBase = 0): Card[] {
  return speciesDeck(species).map((kind, i) => ({ uid: uidBase + i, kind }))
}

/** 双方私有牌组合计的张数：全局「牌数守恒」的基准 */
export function totalDeckSize(speciesA: SpeciesId, speciesB: SpeciesId): number {
  return speciesDeckSize(speciesA) + speciesDeckSize(speciesB)
}
