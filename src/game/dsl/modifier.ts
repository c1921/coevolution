/**
 * 修正通道的对外入口。
 *
 * 聚合实现放在 value.ts（修正值本身是表达式，与求值互相递归），
 * 这里只暴露稳定的 API：引擎与规则模块都从这里读通道，不再直接看技能 id。
 */
import { channelValue } from './value'

export { channelValue }

export { baseChannel } from './registry'

/** 语义别名：读取某角色在某通道上的最终数值 */
export const modifierValue = channelValue
