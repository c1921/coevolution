import type { DamageCtx, GameState, PlayerIndex, TriggerRef } from '../types'
import { RuleError } from '../util'
import { sameTiming } from '../rules/phase'
import { evalConditions } from './condition'
import { runEffectGroup } from './effect'
import { registry, skillDoc, skillsOf } from './registry'
import { baseContext } from './runtime'
import type { EffectContext } from './runtime'
import type { Timing } from './types'

/**
 * 统一时机/事件层：规则文档（rule）与技能的 trigger 都挂在同一套 Timing 上，
 * 这是 TURN_TIMING_EFFECTS 与旧 triggerSkillsFor 的合并点。
 *
 * 分工：
 *  - 规则文档没有"归属者"，在 applyTimingRules 里立即执行；
 *  - 技能触发要区分可选/不可选：不可选的立即执行，可选的在 after-damage 上交给
 *    调用方（伤害帧）逐个询问——这样"可选询问"与"未抵消伤害"的顺序由引擎掌控。
 */

export { sameTiming }

/** 事件负载（当前只有伤害事件；将来扩展新时机时在这里加字段） */
export interface EventPayload {
  damage?: DamageCtx
}

/** 时机语境：self = 技能归属者（规则效果为当前回合角色） */
function contextFor(state: GameState, self: PlayerIndex, payload?: EventPayload): EffectContext {
  return {
    ...baseContext(state, self),
    target: payload?.damage?.target,
    source: payload?.damage?.source,
    damage: payload?.damage,
  }
}

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

/** 收集主体在该时机上的技能触发（按技能优先级顺序，条件已求值） */
export function collectTriggers(
  state: GameState,
  timing: Timing,
  subject: PlayerIndex,
  payload?: EventPayload,
): TriggerRef[] {
  const refs: TriggerRef[] = []
  for (const skill of skillsOf(state.players[subject].species)) {
    const trigger = skill.trigger
    if (!trigger || !sameTiming(trigger.on, timing)) continue
    const ctx = contextFor(state, subject, payload)
    if (!evalConditions({ state, ctx }, trigger.when)) continue
    refs.push({ owner: subject, skill: skill.id, optional: trigger.optional === true })
  }
  return refs
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
