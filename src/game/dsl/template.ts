import { RuleError } from '../util'
import type { RoleRef } from './kinds'
import { cardDoc, skillDoc, speciesDoc } from './registry'
import { findCardByUid, requireRole } from './runtime'
import type { EvalEnv } from './runtime'
import type { Value } from './types'
import { channelValue, evalValue } from './value'

/**
 * 日志模板渲染。
 *
 * 占位符词汇见 kinds.ts 的 LOG_ROOTS，校验器已在加载期检查拼写与角色可用性；
 * 这里只负责取值。effect.vars 的显式绑定优先于自动绑定（消耗战用它打印计算出的流失量）。
 */

/** 把牌 uid 渲染成「【打击】、【防御】」 */
export function renderCards(env: EvalEnv, uids: number[]): string {
  return uids
    .map((uid) => {
      const card = findCardByUid(env.state, uid)
      return card ? `【${cardDoc(card.kind).name}】` : '一张牌'
    })
    .join('、')
}

export function renderLog(
  env: EvalEnv,
  effect: { template: string; vars?: Record<string, Value> },
): string {
  return effect.template.replace(/\{([^{}]*)\}/g, (_match, token: string) => {
    const [root, field] = token.split('.')
    if (root === undefined) return ''

    const bound = effect.vars?.[root]
    if (bound !== undefined) return String(evalValue(env, bound))

    if (root === 'turn') return String(env.state.turn)
    if (root === 'amount') return String(env.ctx.lastAmount ?? 0)
    if (root === 'via') {
      const via = env.ctx.usedCard?.via
      return via === undefined ? '' : skillDoc(via).name
    }
    if (root === 'usedRaw') {
      const source = env.ctx.usedCard?.source
      return source === undefined ? '' : `【${cardDoc(source.kind).name}】`
    }
    if (root === 'usedAs') {
      const as = env.ctx.usedCard?.as
      return as === undefined ? '' : `【${cardDoc(as).name}】`
    }
    if (root === 'cost') return renderCards(env, env.ctx.costCards)
    if (root === 'picked') return renderCards(env, env.ctx.picked ?? [])

    const p = requireRole(env, root as RoleRef)
    const player = env.state.players[p]
    const species = speciesDoc(player.species)
    const label = species.name
    if (field === undefined) return label

    switch (field) {
      case 'hp':
        return String(player.hp)
      case 'maxHp':
        return String(player.maxHp)
      case 'energy':
        return String(player.energy)
      case 'energyMax':
        return String(channelValue(env.state, 'energy-max', p))
      case 'threat':
        return String(player.threat)
      case 'handCount':
        return String(player.hand.length)
      case 'energyTag':
        return `（能量 ${player.energy}/${channelValue(env.state, 'energy-max', p)}）`
      default:
        throw new RuleError(`日志占位符 {${token}} 的字段无法解析`)
    }
  })
}
