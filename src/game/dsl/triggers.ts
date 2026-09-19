import { evalConditions } from './condition'
import { sameTiming } from '../rules/phase'
import { skillsOf } from './registry'
import { baseContext } from './runtime'
import type { EffectContext } from './runtime'
import type { Timing } from './types'
import type { DamageCtx, GameState, PlayerIndex, TriggerRef } from '../types'

/**
 * 触发收集：把「谁在什么时机因为什么被触发」算出来，交给调用方决定何时询问。
 *
 * **为什么单独一个模块**：这是 engine 原语（`rules/damage.ts`）唯一需要从
 * DSL 侧拿的东西。如果它和 `dsl/event.ts`（要执行效果、因此 import 解释器）
 * 放在一起，就会形成 `rules/damage → dsl/event → dsl/effect → rules/damage`
 * 的运行时循环依赖。这里只依赖注册表与条件求值，不依赖解释器，
 * 于是 `damage → triggers` 是一条指向叶子的边（`guards.test.ts` 守卫零环）。
 *
 * 分工不变：
 *  - 规则文档没有"归属者"，在 `dsl/event.ts` 的 applyTimingRules 里立即执行；
 *  - 技能触发要区分可选/不可选：不可选的立即执行，可选的在 after-damage 上
 *    交给伤害帧逐个询问——这样"可选询问"与"未抵消伤害"的顺序由引擎掌控。
 */

/** 事件负载（当前只有伤害事件；将来扩展新时机时在这里加字段） */
export interface EventPayload {
  damage?: DamageCtx
}

/** 时机语境：self = 技能归属者（规则效果为当前回合角色） */
export function contextFor(
  state: GameState,
  self: PlayerIndex,
  payload?: EventPayload,
): EffectContext {
  return {
    ...baseContext(state, self),
    target: payload?.damage?.target,
    source: payload?.damage?.source,
    damage: payload?.damage,
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
