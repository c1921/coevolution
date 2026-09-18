import { deckOf, speciesIds } from '../dsl/registry'
import type { DeckDoc } from '../dsl/types'
import type { Card, CardKind, SpeciesId } from '../types'

/**
 * 私有牌组（由 DSL 的 deck 文档与物种引用派生）。
 *
 * 牌组构成是平衡旋钮：改 `data/dsl/decks/basic.json` 即可，校验器与守恒逻辑都不用动。
 *  - 打击 ×11：主要输出，1 点能量
 *  - 防御 ×6 ：响应【打击】，1 点能量
 *  - 回复 ×3 ：回血与濒死自救，2 点能量
 */

/** 把一个牌组文档展开成牌种序列 */
function expandDeck(doc: DeckDoc): CardKind[] {
  return doc.cards.flatMap((entry) =>
    Array.from({ length: entry.count }, () => entry.kind),
  )
}

/** 某个物种私有牌组的牌种序列（返回副本，避免调用方改到牌表本身） */
export function speciesDeck(species: SpeciesId): CardKind[] {
  return expandDeck(deckOf(species))
}

/** 某个物种私有牌组的张数（「牌数守恒」按它求和） */
export function speciesDeckSize(species: SpeciesId): number {
  return expandDeck(deckOf(species)).length
}

/**
 * 每个物种的私有牌组（牌种序列）。
 * 暂时 8 个物种共用 `basic`；将来按物种分化时，在物种文档里指向各自的牌组即可，
 * uid 分配、守恒校验与洗牌逻辑都不需要改。
 */
export const SPECIES_DECKS: Record<SpeciesId, CardKind[]> = Object.fromEntries(
  speciesIds().map((id) => [id, speciesDeck(id)]),
)

/** 基准牌组的张数（首个注册牌组；物种分化后各物种以 speciesDeckSize 为准） */
export const DECK_SIZE = expandDeck(deckOf(speciesIds()[0] as SpeciesId)).length

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
