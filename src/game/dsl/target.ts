import type { PlayerIndex } from '../types'
import { otherPlayer } from '../util'
import { isInRange } from '../rules/distance'
import { evalCondition, firstFailed } from './condition'
import type { EvalEnv } from './runtime'
import type { TargetSpec } from './types'
import { evalValue } from './value'

/**
 * 目标选取：把 TargetSpec 解析成具体候选与最终目标。
 *
 * 合法性判定与结算共用这里的同一套规则，避免"校验通过但结算取到别的目标"。
 */

/**
 * scope 的成员集合（尚未按 alive / 距离 / 条件过滤）。
 *
 * 目标选择器需要把"被条件挡掉的候选"也列出来并附上文档 reason，
 * 所以过滤前的成员集必须与过滤共用同一个 scope 定义。
 */
export function targetScopeMembers(env: EvalEnv, spec: TargetSpec): PlayerIndex[] {
  const self = env.ctx.self
  const all = env.state.players.map((player) => player.index)
  switch (spec.scope) {
    case 'self':
      return [self]
    case 'any':
      return all
    case 'others':
      return all.filter((index) => index !== self)
    case 'opponent':
      return [otherPlayer(self)]
    case 'dying':
      return env.ctx.dying === undefined ? [] : [env.ctx.dying]
  }
}

/** 全部候选目标（按 scope 过滤 alive / 距离 / 条件） */
export function targetCandidates(env: EvalEnv, spec: TargetSpec): PlayerIndex[] {
  return targetScopeMembers(env, spec).filter((index) => {
    const player = env.state.players[index]
    if (spec.alive && !player.alive) return false
    if (spec.range && !isInRange(env.state, env.ctx.self, index)) return false
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

/** 多目标解析结果（单目标也会返回长度为 1 的列表） */
export type TargetsResolution = { ok: true; targets: PlayerIndex[] } | { ok: false; reason: string }

/** 某个具体目标为什么不合格：优先用条件自带的 reason（界面选择器与报错共用） */
export function targetFailureReason(
  env: EvalEnv,
  spec: TargetSpec,
  target: PlayerIndex,
): string | undefined {
  const scoped: EvalEnv = { state: env.state, ctx: { ...env.ctx, target } }
  const failed = firstFailed(scoped, spec.conditions)
  return failed?.reason
}

/** 两个目标集合是否完全一致（不看重数，targets 已保证无重复） */
function sameTargets(a: PlayerIndex[], b: PlayerIndex[]): boolean {
  return a.length === b.length && a.every((index) => b.includes(index))
}

/**
 * 解析最终目标集合。三种形态：
 *  - 缺省（无 count）：单选，语义与历史完全一致（显式目标 / required / default / 唯一候选 / 自己）
 *  - count.mode = all：作用于全部合法候选；显式目标必须与候选集一致
 *  - count.mode = exactly：必须显式指定恰好 N 个互不重复的合法目标
 *
 * 候选为空时一律拒绝——声明了 target 就不能"无目标地"继续结算，
 * 否则效果里引用 target 时会在更深处抛错（攻击范围、存活条件都能让候选变空）。
 */
export function resolveTargetChoices(
  env: EvalEnv,
  spec: TargetSpec,
  chosen?: PlayerIndex[],
): TargetsResolution {
  const candidates = targetCandidates(env, spec)

  if (spec.count?.mode === 'all') {
    if (candidates.length === 0) return { ok: false, reason: '没有符合条件的目标' }
    if (chosen !== undefined && !sameTargets(chosen, candidates)) {
      return { ok: false, reason: '该效果作用于全部合法目标，不能只指定其中一部分' }
    }
    return { ok: true, targets: candidates }
  }

  if (spec.count?.mode === 'exactly') {
    const size = Math.max(1, Math.floor(evalValue(env, spec.count.count)))
    const picked = chosen ?? []
    if (picked.length !== size) {
      return {
        ok: false,
        reason:
          candidates.length < size ? `符合条件的目标不足 ${size} 个` : `必须指定 ${size} 个目标`,
      }
    }
    if (new Set(picked).size !== picked.length) return { ok: false, reason: '目标有重复' }
    for (const target of picked) {
      if (!candidates.includes(target)) {
        return {
          ok: false,
          reason: targetFailureReason(env, spec, target) ?? '指定的目标不符合该效果的条件',
        }
      }
    }
    return { ok: true, targets: picked }
  }

  if (chosen !== undefined && chosen.length > 1) {
    return { ok: false, reason: '该效果只能指定一个目标' }
  }
  const single = chosen?.[0]
  if (single !== undefined) {
    if (!candidates.includes(single)) {
      return {
        ok: false,
        reason: targetFailureReason(env, spec, single) ?? '指定的目标不符合该效果的条件',
      }
    }
    return { ok: true, targets: [single] }
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
  return { ok: true, targets: [target] }
}

/** 单选解析：主动技与既有调用点的入口（多目标路径请用 resolveTargetChoices） */
export function resolveTargetChoice(
  env: EvalEnv,
  spec: TargetSpec,
  chosen?: PlayerIndex,
): TargetResolution {
  const resolved = resolveTargetChoices(env, spec, chosen === undefined ? undefined : [chosen])
  if (!resolved.ok) return resolved
  return { ok: true, target: resolved.targets[0] }
}
