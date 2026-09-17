import { log, playerLabel } from '../log'
import type { GameState, PlayerIndex } from '../types'
import { aliveOrderFrom } from '../util'

/**
 * 进入濒死：压入濒死询问帧。
 * 询问顺序为「从濒死者开始、按座次遍历全部存活角色」，1v1 即 濒死者 → 对手。
 * 队列耗尽仍无人救援则死亡。
 */
export function pushDying(state: GameState, dying: PlayerIndex): void {
  log(state, `${playerLabel(state, dying)} 进入濒死状态，等待【回复】救援`)
  state.stack.push({ kind: 'dying', dying, ask: aliveOrderFrom(state, dying) })
}
