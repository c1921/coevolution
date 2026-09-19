import { log, playerLabel } from '../log'
import type { GameState, PlayerIndex } from '../types'
import { aliveOrderFrom } from '../util'

/**
 * 濒死救援开关：当前**禁用**。
 *
 * 禁用时进入濒死不再询问任何角色（`engine/stack.ts` 直接走向死亡结算），
 * 因此体力归零必定阵亡；`dying` 帧仍然保留，用于把死亡结算排在当前效果之后。
 * 把这里改为 `true` 即可恢复「从濒死者起按座次逐个询问 `dying` 语境牌」的救援链路，
 * 濒死询问、合法性校验、界面与 AI 的分支都还在，不需要重新接线。
 */
export const DYING_RESCUE_ENABLED: boolean = false

/**
 * 进入濒死：压入濒死询问帧。
 * 询问顺序为「从濒死者开始、按座次遍历全部存活角色」，1v1 即 濒死者 → 对手。
 * 队列耗尽仍无人救援则死亡；救援禁用时该队列不再被消费，直接死亡。
 */
export function pushDying(state: GameState, dying: PlayerIndex): void {
  log(
    state,
    DYING_RESCUE_ENABLED
      ? `${playerLabel(state, dying)} 进入濒死状态，等待【回复】救援`
      : `${playerLabel(state, dying)} 进入濒死状态`,
  )
  state.stack.push({ kind: 'dying', dying, ask: aliveOrderFrom(state, dying) })
}
