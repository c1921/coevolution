import type { PlayerIndex } from '../types'

/**
 * 1v1 中双方座位距离恒为 1，攻击范围恒为 1，因此【打击】总是能打到对手。
 * 本模块保留完整接口，将来支持多人、坐骑与武器时只需改这里。
 */
export const BASE_ATTACK_RANGE = 1

export function distance(from: PlayerIndex, to: PlayerIndex): number {
  return from === to ? 0 : 1
}

export function attackRange(_from: PlayerIndex): number {
  return BASE_ATTACK_RANGE
}

export function isInRange(from: PlayerIndex, to: PlayerIndex): boolean {
  return distance(from, to) <= attackRange(from)
}
