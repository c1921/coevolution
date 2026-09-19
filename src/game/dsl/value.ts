import { RuleError } from '../util'
import type { GameState, PlayerIndex } from '../types'
import type { Channel, RoleRef, ValueRefName } from './kinds'
import { baseChannel, skillsOf } from './registry'
import { baseContext, requireRole } from './runtime'
import type { EvalEnv } from './runtime'
import { assertNever } from './runtime'
import type { Value } from './types'

/**
 * 数值表达式求值。
 *
 * 通道聚合（channelValue）与表达式求值互相递归（修正值本身可以是表达式，
 * 表达式也可以读通道），所以两者放在同一个模块里，并带递归深度保护——
 * 通道自引用会变成显式报错而不是栈溢出。
 */

const MAX_DEPTH = 16

export function evalValue(env: EvalEnv, value: Value, depth = 0): number {
  if (depth > MAX_DEPTH) throw new RuleError('数值表达式递归过深（检查通道是否自引用）')
  switch (value.kind) {
    case 'const':
      return value.value
    case 'ref':
      return refValue(env, value.ref, value.of ?? 'self', depth)
    case 'add':
      return value.of.reduce((sum, item) => sum + evalValue(env, item, depth + 1), 0)
    case 'sub': {
      const [first, ...rest] = value.of
      let result = first === undefined ? 0 : evalValue(env, first, depth + 1)
      for (const item of rest) result -= evalValue(env, item, depth + 1)
      return result
    }
    case 'mul':
      return value.of.reduce((product, item) => product * evalValue(env, item, depth + 1), 1)
    case 'min':
      return Math.min(...value.of.map((item) => evalValue(env, item, depth + 1)))
    case 'max':
      return Math.max(...value.of.map((item) => evalValue(env, item, depth + 1)))
    case 'floor-div': {
      const by = evalValue(env, value.by, depth + 1)
      if (by === 0) throw new RuleError('floor-div 的除数不能为 0')
      return Math.floor(evalValue(env, value.of, depth + 1) / by)
    }
    case 'clamp':
      return Math.min(Math.max(evalValue(env, value.of, depth + 1), value.min), value.max)
    case 'channel':
      return channelValue(env.state, value.channel, requireRole(env, value.of), depth + 1)
    default:
      return assertNever(value, '数值表达式')
  }
}

function refValue(env: EvalEnv, ref: ValueRefName, role: RoleRef, depth: number): number {
  // 与角色无关的数值先处理，避免无意义地要求角色存在
  if (ref === 'turn') return env.state.turn
  if (ref === 'damageAmount') return env.ctx.damage?.amount ?? 0

  const p = requireRole(env, role)
  const player = env.state.players[p]
  switch (ref) {
    case 'hp':
      return player.hp
    case 'maxHp':
      return player.maxHp
    case 'handCount':
      return player.hand.length
    case 'deckCount':
      return player.deck.length
    case 'discardCount':
      return player.discard.length
    case 'energy':
      return player.energy
    case 'threat':
      return player.threat
    case 'energyMax':
      return channelValue(env.state, 'energy-max', p, depth + 1)
    default:
      throw new RuleError(`未知数值 ${ref}`)
  }
}

/**
 * 修正通道聚合：基准值 + Σ add，再按技能顺序应用 set / min / max。
 * subject 是"该数值属于谁"——蓄能看自己，攻击修正看打击使用者，都由调用方给出。
 */
export function channelValue(
  state: GameState,
  channel: Channel,
  subject: PlayerIndex,
  depth = 0,
): number {
  if (depth > MAX_DEPTH) throw new RuleError(`通道 ${channel} 的修正递归过深`)
  let result = baseChannel(channel)
  const env: EvalEnv = { state, ctx: baseContext(state, subject) }
  for (const skill of skillsOf(state.players[subject].species)) {
    for (const modifier of skill.modifiers ?? []) {
      if (modifier.channel !== channel) continue
      const amount = evalValue(env, modifier.value, depth + 1)
      switch (modifier.op) {
        case 'add':
          result += amount
          break
        case 'set':
          result = amount
          break
        case 'min':
          result = Math.min(result, amount)
          break
        case 'max':
          result = Math.max(result, amount)
          break
      }
    }
  }
  return result
}
