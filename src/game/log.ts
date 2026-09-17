import { CARD_NAME } from './data/cardDefs'
import { cardLabel } from './data/deck'
import { SPECIES } from './data/species'
import type { Card, GameState, PlayerIndex, VirtualCard } from './types'

/** 追加一条中文战报 */
export function log(s: GameState, text: string): void {
  s.log.push({ turn: s.turn, text })
}

/** 「🐯 虎」 */
export function playerLabel(s: GameState, p: PlayerIndex): string {
  const player = s.players[p]
  const species = SPECIES[player.species]
  return `${species.emoji} ${species.name}`
}

/** 「【打击】♠7」；经技能转化时附带来源，如「【防御】♠7(由打击转化)」 */
export function virtualLabel(v: VirtualCard): string {
  const base = `【${CARD_NAME[v.as]}】${cardLabel(v.source)}`
  if (!v.via || v.source.kind === v.as) return base
  return `${base}(由${CARD_NAME[v.source.kind]}转化)`
}

/** 「【防御】♦4」 */
export function plainLabel(card: Card): string {
  return `【${CARD_NAME[card.kind]}】${cardLabel(card)}`
}
