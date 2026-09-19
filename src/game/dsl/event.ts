import { sameTiming } from '../rules/phase'
import type { GameState, PlayerIndex, TriggerRef } from '../types'
import { RuleError } from '../util'
import { evalConditions } from './condition'
import { runEffectGroup } from './effect'
import { collectTriggers, contextFor } from './triggers'
import type { EventPayload } from './triggers'
import { registry, skillDoc } from './registry'
import type { Timing } from './types'

/**
 * 统一时机/事件层：规则文档（rule）与技能的 trigger 都挂在同一套 Timing 上，
 * 这是 TURN_TIMING_EFFECTS 与旧 triggerSkillsFor 的合并点。
 *
 * 分工：
 *  - 规则文档没有"归属者"，在 applyTimingRules 里立即执行；
 *  - 技能触发要区分可选/不可选：不可选的立即执行，可选的在 after-damage 上交给
 *    调用方（伤害帧）逐个询问——这样"可选询问"与"未抵消伤害"的顺序由引擎掌控。
 *
 * 触发的**收集**（`collectTriggers` / `contextFor` / `EventPayload`）住在 `./triggers`：
 * 引擎原语 `rules/damage.ts` 需要它，却不能依赖本模块（本模块 import 解释器
 * `./effect`），否则会形成 `damage → event → effect → damage` 的运行时循环依赖。
 * 这里把三者原样转出，既有调用点（含 `dsl/event.test.ts`）无需改动。
 */

export { collectTriggers, contextFor }
export type { EventPayload }
export { sameTiming }

/** 执行挂在某时机上的规则文档（与角色无关，按注册表顺序） */
export function applyTimingRules(state: GameState, timing: Timing): void {
  const ctx = contextFor(state, state.active)
  const env = { state, ctx }
  for (const rule of registry.rules) {
    if (!sameTiming(rule.on, timing)) continue
    if (!evalConditions(env, rule.when)) continue
    runEffectGroup(state, rule, ctx)
  }
}

/** 执行一条技能触发 */
export function runTrigger(state: GameState, ref: TriggerRef, payload?: EventPayload): void {
  const trigger = skillDoc(ref.skill).trigger
  if (!trigger) throw new RuleError(`技能 ${ref.skill} 没有 trigger 定义`)
  const ctx = contextFor(state, ref.owner, payload)
  runEffectGroup(state, trigger, ctx)
}

/**
 * 通用时机派发：规则立即执行；技能触发中不可选的立即执行，可选的返回给调用方。
 * after-damage 由伤害帧调用 collectTriggers/runTrigger 自己控制询问顺序。
 */
export function emitTiming(
  state: GameState,
  timing: Timing,
  subject?: PlayerIndex,
  payload?: EventPayload,
): TriggerRef[] {
  applyTimingRules(state, timing)
  if (subject === undefined) return []
  const pending: TriggerRef[] = []
  for (const ref of collectTriggers(state, timing, subject, payload)) {
    if (ref.optional) pending.push(ref)
    else runTrigger(state, ref, payload)
  }
  return pending
}
