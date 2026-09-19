import { channelValue } from '../dsl/modifier'
import type { GameState, PlayerIndex } from '../types'

/**
 * 1v1 中双方座位距离恒为 1，攻击范围默认 1（`attack-range` 通道的基准值），
 * 因此【打击】总是能打到对手。本模块保留完整接口，将来支持多人、坐骑与武器时只需改这里。
 */
export const BASE_ATTACK_RANGE = 1

export function distance(from: PlayerIndex, to: PlayerIndex): number {
  return from === to ? 0 : 1
}

/**
 * 某角色当前的攻击范围：`attack-range` 通道（基准值 + 技能修正），夹到非负。
 * 与费用、摸牌数一样是"按角色求值"，所以签名必须带 state，不能缓存。
 */
export function attackRange(state: GameState, from: PlayerIndex): number {
  return Math.max(0, channelValue(state, 'attack-range', from))
}

export function isInRange(state: GameState, from: PlayerIndex, to: PlayerIndex): boolean {
  return distance(from, to) <= attackRange(state, from)
}
