import { RuleError } from '../util'
import type { Card, DamageCtx, GameState, PlayerIndex, VirtualCard } from '../types'
import type { CardRef, RoleRef } from './kinds'

/**
 * 效果运行时上下文。
 *
 * 这些字段会随结算帧一起进入 GameState（`Frame.effects` / `Frame.contest`），
 * 因此必须是可序列化的纯数据——不能放函数或类实例（测试用 structuredClone 快照）。
 */
export interface EffectContext {
  /** 技能或卡牌的归属者（规则的 self = 当前回合角色） */
  self: PlayerIndex
  /** 事件发生时的回合角色 */
  active: PlayerIndex
  /** 目标（主动技的选择结果 / 卡牌的使用目标） */
  target?: PlayerIndex
  /** 伤害来源 / 卡牌使用者 */
  source?: PlayerIndex
  /** 濒死者 */
  dying?: PlayerIndex
  /** 本次使用/打出的牌在手牌中的 uid */
  usedUid?: number
  /** 本次使用/打出的虚拟牌（含 via 转化信息） */
  usedCard?: VirtualCard
  /** 已支付的费用牌 uid */
  costCards: number[]
  /** 最近一次 move-cards 实际取到的牌 uid（供 {picked} 与 picked-count 使用） */
  picked?: number[]
  /** 最近一次数值效果的结果（日志 {amount} 使用） */
  lastAmount?: number
  /** 触发事件里的伤害上下文 */
  damage?: DamageCtx
}

/** 求值环境：状态 + 上下文 */
export interface EvalEnv {
  state: GameState
  ctx: EffectContext
}

/** 建立最简上下文（供规则效果与测试使用） */
export function baseContext(state: GameState, self: PlayerIndex = state.active): EffectContext {
  return { self, active: state.active, costCards: [] }
}

/** 解析角色；角色不存在时返回 undefined */
export function resolveRole(env: EvalEnv, role: RoleRef): PlayerIndex | undefined {
  switch (role) {
    case 'self':
      return env.ctx.self
    case 'target':
      return env.ctx.target
    case 'source':
      return env.ctx.source
    case 'active':
      return env.ctx.active
    case 'dying':
      return env.ctx.dying
    case 'opponent':
      return env.ctx.self === 0 ? 1 : 0
  }
}

/** 解析角色；缺失即抛规则错误（结算路径上不允许静默取值） */
export function requireRole(env: EvalEnv, role: RoleRef): PlayerIndex {
  const resolved = resolveRole(env, role)
  if (resolved === undefined) {
    throw new RuleError(`当前结算语境没有角色 ${role}，DSL 文档与调用点不匹配`)
  }
  return resolved
}

/** 某牌区中的牌 */
export function zoneCards(state: GameState, p: PlayerIndex, zone: string): Card[] {
  const player = state.players[p]
  switch (zone) {
    case 'hand':
      return player.hand
    case 'discard':
      return player.discard
    case 'deck':
      return player.deck
    case 'processing':
      return state.processing.map((entry) => entry.card)
    default:
      throw new RuleError(`未知牌区 ${zone}`)
  }
}

/** 在全部牌区里按 uid 找一张牌（费用牌付掉之后会离开手牌，所以不能只查手牌） */
export function findCardByUid(state: GameState, uid: number): Card | undefined {
  for (const player of state.players) {
    for (const zone of [player.hand, player.discard, player.deck]) {
      const found = zone.find((card) => card.uid === uid)
      if (found) return found
    }
  }
  return state.processing.find((entry) => entry.card.uid === uid)?.card
}

/** 解析牌引用：事件牌 / 已使用的牌 / 第一张费用牌 */
export function resolveCardRef(env: EvalEnv, ref: CardRef): Card | undefined {
  if (ref === 'event-card') return env.ctx.damage?.card?.source
  if (ref === 'used-card') return env.ctx.usedCard?.source
  const uid = env.ctx.costCards[0]
  return uid === undefined ? undefined : findCardByUid(env.state, uid)
}

/** 未覆盖的判别式分支：新增 kind 时在这里编译报错，而不是运行时静默漏算 */
export function assertNever(value: never, what = '值'): never {
  throw new RuleError(`未实现的 ${what}：${JSON.stringify(value)}`)
}
