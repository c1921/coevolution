import { CARD_DEFS } from '../data/cardDefs'
import { baseChannel, channelBonus, channelValue } from '../dsl/modifier'
import type { CardKind, GameState, PlayerIndex } from '../types'
import { RuleError } from '../util'

/**
 * 能量系统。
 *
 * 每位角色有一份能量，上限 = energy-max 通道（基准值 + 技能修正，见 data/dsl/rules/base.json），
 * 并在**回合开始时**回复至上限——没有花完的能量会留在池中（不超过上限），
 * 因此「这一回合多打几张」与「留能量拦下对手下回合的【打击】」是一对取舍。
 *
 * 付费范围是**所有使用与打出**：出牌阶段主动使用、响应【打击】时打出【防御】、
 * 濒死时使用【回复】都要支付能量。费用 = 牌种文档的固定费用 + `card-cost` 通道修正
 * （基准值 0 = 不改变牌种费用），按「**当作的牌面**」与**付费者**求值，
 * 所以转化牌（转换）付的是转化后那张牌的费用（当前【打击】与【防御】同费，都是 1 点）。
 *
 * 不消耗能量的行为：主动技（如强袭）、弃牌阶段的弃置、主动技的费用弃牌——
 * 它们都不是「使用 / 打出」一张牌。
 *
 * 重要不变量：**任何牌面的费用都必须 ≥ 1**（MIN_CARD_COST）。费用一旦可以为 0，
 * 与「【打击】没有次数限制」组合就是无限连击（energy.test.ts 对此有断言）。
 */

/** 能量上限的基础值：来自 data/dsl/rules/base.json 的 energy-max 通道基准 */
export const BASE_ENERGY_MAX = baseChannel('energy-max')

/**
 * 牌面费用的下限：**恒为 1**。
 * `card-cost` 通道可以把费用压低，但绝不允许压到 0——费用为 0 与
 * 「【打击】没有次数限制」组合就是无限连击（energy.test.ts 对此有断言）。
 */
export const MIN_CARD_COST = 1

/** 某角色当前的回合能量上限（基准值 + 该角色技能的 energy-max 修正） */
export function energyMax(state: GameState, p: PlayerIndex): number {
  return channelValue(state, 'energy-max', p)
}

/**
 * 某个角色使用 / 打出某牌面需要支付的能量：
 * 牌种文档的固定费用（`card.cost`）+ 该角色的 `card-cost` 通道修正，最后夹到 ≥ 1。
 * 费用按角色求值，所以界面与 AI 都必须传自己的 `p`，不能缓存某张牌的费用。
 */
export function energyCost(state: GameState, p: PlayerIndex, as: CardKind): number {
  const def = CARD_DEFS[as]
  if (!def) throw new RuleError(`未知牌种：${as}`)
  return Math.max(MIN_CARD_COST, def.cost + channelBonus(state, 'card-cost', p))
}

/** 能量是否够付这个牌面 */
export function canPayEnergy(state: GameState, p: PlayerIndex, as: CardKind): boolean {
  return state.players[p].energy >= energyCost(state, p, as)
}

/** 能量不足时的中文说明（合法性判定与引擎守卫共用同一份文案） */
export function shortfallReason(
  state: GameState,
  p: PlayerIndex,
  as: CardKind,
): string {
  return `能量不足：使用【${CARD_DEFS[as].name}】需要 ${energyCost(state, p, as)} 点能量（当前 ${state.players[p].energy} 点）`
}

/**
 * 支付一次使用 / 打出的能量。
 * 调用方保证已通过合法性校验；这里仍做一次守卫，避免结算途中出现负能量。
 */
export function payEnergy(state: GameState, p: PlayerIndex, as: CardKind): void {
  const player = state.players[p]
  if (!canPayEnergy(state, p, as)) throw new RuleError(shortfallReason(state, p, as))
  player.energy -= energyCost(state, p, as)
}

/** 回合开始时把能量回复至上限 */
export function refillEnergy(state: GameState, p: PlayerIndex): void {
  state.players[p].energy = energyMax(state, p)
}

/** 战报里的能量标签，如「（能量 2/3）」 */
export function energyTag(state: GameState, p: PlayerIndex): string {
  return `（能量 ${state.players[p].energy}/${energyMax(state, p)}）`
}

/**
 * 能量不变式：任意结算步之后，能量都必须落在 0..上限之内。
 * 与「牌数守恒」一样，是引擎每次 submit 后自动校验的硬约束。
 */
export function assertEnergyBounds(state: GameState): void {
  for (const player of state.players) {
    const max = energyMax(state, player.index)
    if (!Number.isInteger(player.energy) || player.energy < 0 || player.energy > max) {
      throw new Error(
        `能量越界：${player.index} 号角色的能量为 ${player.energy}，应是不超过 ${max} 的非负整数`,
      )
    }
  }
}
