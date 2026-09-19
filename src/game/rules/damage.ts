import { log, playerLabel } from '../log'
// 触发收集住在 dsl/triggers（不依赖解释器）：damage 依赖 dsl/event 会形成循环依赖
import { collectTriggers } from '../dsl/triggers'
import type { DamageCtx, GameState, PlayerIndex } from '../types'
import { pushDying } from './dying'

function hpText(hp: number, maxHp: number): string {
  return `${Math.max(0, hp)}/${maxHp}`
}

/**
 * 造成伤害：先扣减体力，再压入伤害帧。
 * 伤害帧负责依次处理「受到伤害后」触发（可选发动逐个询问），然后做濒死检查。
 * 触发集合来自 DSL：技能文档里的 trigger.on = after-damage + when 条件。
 */
export function dealDamage(state: GameState, ctx: DamageCtx): void {
  const target = state.players[ctx.target]
  const before = target.hp
  target.hp -= ctx.amount
  state.lastDamage = ctx

  log(
    state,
    `${playerLabel(state, ctx.target)} 受到 ${ctx.amount} 点伤害（体力 ${hpText(before, target.maxHp)} → ${hpText(target.hp, target.maxHp)}）`,
  )

  state.stack.push({
    kind: 'damage',
    ctx,
    triggers: collectTriggers(state, { at: 'after-damage' }, ctx.target, { damage: ctx }),
  })
}

/**
 * 失去体力：与「受到伤害」不同，不会触发「受到伤害后」技能，
 * 但同样会在体力降到 0 及以下时进入濒死。
 */
export function loseHp(state: GameState, p: PlayerIndex, amount: number): void {
  const player = state.players[p]
  const before = player.hp
  player.hp -= amount

  log(
    state,
    `${playerLabel(state, p)} 失去 ${amount} 点体力（体力 ${hpText(before, player.maxHp)} → ${hpText(player.hp, player.maxHp)}）`,
  )

  if (player.alive && player.hp <= 0) pushDying(state, p)
}
