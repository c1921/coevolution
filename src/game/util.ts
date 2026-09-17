import type { GameState, PlayerIndex } from './types'

/** 1v1 中的对手 */
export function otherPlayer(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0
}

/** 从 start 开始、按座次遍历全部存活角色（1v1 即 [start, 对手]） */
export function aliveOrderFrom(state: GameState, start: PlayerIndex): PlayerIndex[] {
  const order: PlayerIndex[] = []
  for (let i = 0; i < state.players.length; i++) {
    const index = ((start + i) % state.players.length) as PlayerIndex
    if (state.players[index].alive) order.push(index)
  }
  return order
}

/** 规则错误：非法动作一律抛出它，并且保证状态未被修改 */
export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}
