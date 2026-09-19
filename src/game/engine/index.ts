import { assertConservation } from '../rules/cardZones'
import { assertEnergyBounds } from '../rules/energy'
import { assertThreatBounds } from '../rules/threat'
import type { Action, GameState } from '../types'
import { RuleError } from '../util'
import { applyAction } from './actions'
import { advance } from './stack'

/**
 * 规则引擎门面：对外只有 `createGame` / `rollDraft` / `submit` / `advance` / `isOver`，
 * 其余都是实现细节（按路径直接 import 即可，不要从这里二次转出）。
 *
 * 引擎以 **prompt 驱动的状态机**对外：`submit(state, action)` 先校验再应用，
 * 然后 `advance()` 自动推进系统步骤，直到停在需要人或 AI 决策的点上或对局结束。
 * 引擎就地修改状态且不 import Vue（界面用 `reactive()` 包裹同一份对象）。
 *
 * 模块划分（本目录）：
 *  - `setup.ts`   `rollDraft` / `createGame`（抽将、建局、开局推进）
 *  - `actions.ts` `applyAction` 与各动作的 applier（校验 → 应用 → 交回回合循环）
 *  - `stack.ts`   `advance` / `stepFrame`（结算帧栈与回合流程的驱动循环）
 *  - `index.ts`   本文件：门面 + 三处硬不变式的统一校验
 *
 * 不变式（牌数守恒、能量边界、威胁边界）只在**入口**校验：`createGame` 与
 * `submit` 各做一次，动作内部不重复校验，避免把 O(n) 检查摊到每一步结算里。
 */

export { advance } from './stack'
export { createGame, rollDraft } from './setup'
export type { CreateGameOptions, DraftRoll } from './setup'
export { applyAction } from './actions'

export function isOver(state: GameState): boolean {
  return state.result !== null
}

/**
 * 提交一个动作：先校验（不通过则抛规则错误且状态不变）→ 应用 → 自动推进
 * → 校验牌数守恒与能量不变式。
 */
export function submit(state: GameState, action: Action): void {
  if (state.result) throw new RuleError('对局已经结束')
  applyAction(state, action)
  advance(state)
  assertConservation(state)
  assertEnergyBounds(state)
  assertThreatBounds(state)
}
