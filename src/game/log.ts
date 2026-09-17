import { CARD_NAME } from './data/cardDefs'
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

/**
 * 「【防御】(由【打击】转化)」。
 * 卡牌没有花色与点数，同名牌之间完全等价，所以标签只含牌名。
 */
export function virtualLabel(v: VirtualCard): string {
  const base = `【${CARD_NAME[v.as]}】`
  if (!v.via || v.source.kind === v.as) return base
  return `${base}(由${CARD_NAME[v.source.kind]}转化)`
}

/** 「【防御】」 */
export function plainLabel(card: Card): string {
  return `【${CARD_NAME[card.kind]}】`
}
