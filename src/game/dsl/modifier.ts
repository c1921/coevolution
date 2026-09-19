/**
 * 修正通道的对外入口。
 *
 * 聚合实现放在 value.ts（修正值本身是表达式，与求值互相递归），
 * 这里只暴露稳定的 API：引擎与规则模块都从这里读通道，不再直接看技能 id。
 */
import type { PlayerIndex, GameState } from '../types'
import type { Channel } from './kinds'
import { channelValue } from './value'
import { baseChannel } from './registry'

export { channelValue }

export { baseChannel } from './registry'

/** 语义别名：读取某角色在某通道上的最终数值 */
export const modifierValue = channelValue

/**
 * 通道修正量：聚合值 − 基准值。
 *
 * 「默认值 + 修正」两段合成的规则（摸牌数、手牌上限、牌面费用、攻击范围）都读它：
 * 默认值只写在 ruleset 文档里一份，技能只表达"相对默认的偏移"，
 * 于是既不会出现两份默认值，也不会让 `set` 类修正在改基准后失去意义。
 */
export function channelBonus(state: GameState, channel: Channel, subject: PlayerIndex): number {
  return channelValue(state, channel, subject) - baseChannel(channel)
}
