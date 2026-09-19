import { deckOf, speciesIds } from '../dsl/registry'
import type { DeckDoc } from '../dsl/types'
import type { Card, CardKind, SpeciesId } from '../types'

/**
 * 私有牌组（由 DSL 的 deck 文档与物种引用派生）。
 *
 * 牌组构成是平衡旋钮：改 `data/dsl/decks/*.json` 即可，校验器与守恒逻辑都不用动。
 * 当前三套（各 20 张）：
 *  - `basic`（反击型）    ：打击 11 / 防御 6 / 回复 3
 *  - `aggressive`（进攻型、转化型）：打击 11 / 防御 5 / 回复 2 / 急救 1 / 风暴 1
 *  - `guarded`（防御型）  ：打击 10 / 防御 7 / 回复 3
 * 打击是主要输出（1 点能量），防御用于响应，回复用于回血与濒死自救（2 点能量）。
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
