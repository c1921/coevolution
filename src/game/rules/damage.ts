import { log, playerLabel } from '../log'
import { triggerSkillsFor } from '../skills'
import type { DamageCtx, GameState, PlayerIndex } from '../types'
import { pushDying } from './dying'

function hpText(hp: number, maxHp: number): string {
  return `${Math.max(0, hp)}/${maxHp}`
}

/**
 * 造成伤害：先扣减体力，再压入伤害帧。
 * 伤害帧负责依次询问「受到伤害后」技能，然后做濒死检查。
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

  state.stack.push({ kind: 'damage', ctx, triggers: triggerSkillsFor(state, ctx) })
}

/**
 * 失去体力：与「受到伤害」不同，不会触发夺食 / 狡计等受到伤害后技能，
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
