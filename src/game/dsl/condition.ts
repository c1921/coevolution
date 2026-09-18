import { evalValue } from './value'
import { assertNever, requireRole, resolveCardRef, resolveRole, zoneCards } from './runtime'
import type { EvalEnv } from './runtime'
import type { CompareOp } from './kinds'
import type { Condition } from './types'

/**
 * 条件求值。
 *
 * 所有条件都是纯数据，这里用一个封闭的 switch 解释；新增条件种类时
 * types.ts 的联合类型与 kinds.ts 的词表会一起报错，不会静默漏算。
 */
export function evalCondition(env: EvalEnv, condition: Condition): boolean {
  switch (condition.kind) {
    case 'always':
      return true
    case 'not':
      return !evalCondition(env, condition.of)
    case 'all':
      return condition.of.every((item) => evalCondition(env, item))
    case 'any':
      return condition.of.some((item) => evalCondition(env, item))
    case 'compare': {
      const left = evalValue(env, condition.left)
      const right = evalValue(env, condition.right)
      const table: Record<CompareOp, boolean> = {
        lt: left < right,
        lte: left <= right,
        gt: left > right,
        gte: left >= right,
        eq: left === right,
        neq: left !== right,
      }
      return table[condition.op]
    }
    case 'alive': {
      const p = resolveRole(env, condition.of)
      return p !== undefined && env.state.players[p].alive
    }
    case 'has-cards': {
      const p = requireRole(env, condition.of)
      return zoneCards(env.state, p, condition.zone).length >= evalValue(env, condition.atLeast)
    }
    case 'card-kind-count': {
      const p = requireRole(env, condition.of)
      const count = zoneCards(env.state, p, condition.zone).filter(
        (card) => card.kind === condition.cardKind,
      ).length
      return count >= evalValue(env, condition.atLeast)
    }
    case 'in-processing': {
      const card = resolveCardRef(env, condition.card)
      return card !== undefined && env.state.processing.some((entry) => entry.card.uid === card.uid)
    }
    case 'card-transformed':
      return env.ctx.usedCard?.via !== undefined
    case 'picked-count':
      return (env.ctx.picked?.length ?? 0) >= evalValue(env, condition.atLeast)
    case 'skill-unused':
      return !env.state.players[env.ctx.self].usedSkillsThisTurn.some(
        (used) => used === condition.skill,
      )
    case 'is-active':
      return env.ctx.self === env.state.active
    case 'phase-is':
      return env.state.phase === condition.phase
    default:
      return assertNever(condition, '条件')
  }
}

/**
 * 条件列表里第一个不成立的条件（都成立则返回 undefined）。
 * 合法性判定用它把文档里的 reason 回给玩家；嵌套条件只报最外层节点。
 */
export function firstFailed(
  env: EvalEnv,
  conditions: readonly Condition[] | undefined,
): Condition | undefined {
  for (const condition of conditions ?? []) {
    if (!evalCondition(env, condition)) return condition
  }
  return undefined
}

/** 条件列表全部成立（空列表视为成立） */
export function evalConditions(env: EvalEnv, conditions: Condition[] | undefined): boolean {
  return firstFailed(env, conditions) === undefined
}
