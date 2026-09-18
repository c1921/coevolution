import { CARD_NAME } from './data/cardDefs'
import { SPECIES } from './data/species'
import type { Card, GameState, PlayerIndex } from './types'

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

/** 「【防御】」 */
export function plainLabel(card: Card): string {
  return `【${CARD_NAME[card.kind]}】`
}
