import type { PlayerIndex } from '../types'
import { otherPlayer } from '../util'
import { isInRange } from '../rules/distance'
import { evalCondition, firstFailed } from './condition'
import type { EvalEnv } from './runtime'
import type { TargetSpec } from './types'

/**
 * 目标选取：把 TargetSpec 解析成具体候选与最终目标。
 *
 * 合法性判定与结算共用这里的同一套规则，避免"校验通过但结算取到别的目标"。
 */

/** 全部候选目标（按 scope 过滤 alive / 距离 / 条件） */
export function targetCandidates(env: EvalEnv, spec: TargetSpec): PlayerIndex[] {
  const self = env.ctx.self
  const all = env.state.players.map((player) => player.index)
  let list: PlayerIndex[]
  switch (spec.scope) {
    case 'self':
      list = [self]
      break
    case 'any':
      list = all
      break
    case 'others':
      list = all.filter((index) => index !== self)
      break
    case 'opponent':
      list = [otherPlayer(self)]
      break
    case 'dying':
      list = env.ctx.dying === undefined ? [] : [env.ctx.dying]
      break
  }

  return list.filter((index) => {
    const player = env.state.players[index]
    if (spec.alive && !player.alive) return false
    if (spec.range && !isInRange(env.state, self, index)) return false
    if (!spec.conditions || spec.conditions.length === 0) return true
    // 条件的 of:'target' 在候选语境下求值
    const scoped: EvalEnv = { state: env.state, ctx: { ...env.ctx, target: index } }
    return spec.conditions.every((condition) => evalCondition(scoped, condition))
  })
}

/** 是否存在候选目标（决定技能/卡牌是否可用） */
export function hasTargetCandidate(env: EvalEnv, spec: TargetSpec): boolean {
  return targetCandidates(env, spec).length > 0
}

/** 未显式指定目标时的缺省值：先看 default，再看唯一候选，最后回退自己 */
export function defaultTarget(env: EvalEnv, spec: TargetSpec): PlayerIndex | undefined {
  if (spec.required) return undefined
  if (spec.default === 'self') return env.ctx.self
  if (spec.default === 'opponent') return otherPlayer(env.ctx.self)
  const candidates = targetCandidates(env, spec)
  if (candidates.length === 1) return candidates[0]
  if (candidates.includes(env.ctx.self)) return env.ctx.self
  return candidates[0]
}

export type TargetResolution = { ok: true; target?: PlayerIndex } | { ok: false; reason: string }

/** 某个具体目标为什么不合格：优先用条件自带的 reason */
function targetFailureReason(
  env: EvalEnv,
  spec: TargetSpec,
  target: PlayerIndex,
): string | undefined {
  const scoped: EvalEnv = { state: env.state, ctx: { ...env.ctx, target } }
  const failed = firstFailed(scoped, spec.conditions)
  return failed?.reason
}

/** 解析最终目标：显式目标必须在候选内；可省略时必须能得到合法缺省 */
export function resolveTargetChoice(
  env: EvalEnv,
  spec: TargetSpec,
  chosen?: PlayerIndex,
): TargetResolution {
  const candidates = targetCandidates(env, spec)
  if (chosen !== undefined) {
    if (!candidates.includes(chosen)) {
      return {
        ok: false,
        reason: targetFailureReason(env, spec, chosen) ?? '指定的目标不符合该效果的条件',
      }
    }
    return { ok: true, target: chosen }
  }
  if (spec.required) {
    if (candidates.length === 0) return { ok: false, reason: '没有符合条件的目标' }
    return { ok: false, reason: '必须指定一个目标' }
  }
  const target = defaultTarget(env, spec)
  if (target === undefined) {
    // 声明了 target 却一个候选都没有：**不能"无目标地"继续结算**。
    // 否则效果里引用 target 时会在更深处抛错（报错离开内容文档很远），
    // 而攻击范围、存活条件这类修正恰恰能让候选变空。
    return { ok: false, reason: '没有符合条件的目标' }
  }
  if (!candidates.includes(target)) {
    return {
      ok: false,
      reason: targetFailureReason(env, spec, target) ?? '缺省目标不符合该效果的条件',
    }
  }
  return { ok: true, target }
}
