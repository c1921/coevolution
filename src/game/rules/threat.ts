import { log, playerLabel } from '../log'
import type { GameState, PlayerIndex } from '../types'
import { otherPlayer } from '../util'
import { dealDamage } from './damage'

/**
 * 威胁：本作**唯一**的攻击结算途径。
 *
 * A 攻击 B 时不再直接扣体力，而是给 B 叠「威胁」；B 在自己的出牌阶段可以打出
 * 【防御】抵消威胁；**B 的回合结束时**剩余多少威胁就结算为多少点伤害（走伤害帧：
 * 「受到伤害后」技能 → 濒死检查），随后威胁归零。
 *
 * 不跨回合累积：威胁只在「施加者回合」与「承受者回合结束」之间存活一轮，
 * 因此不需要给威胁记录来源之外的历史。
 *
 * 「失去体力」（rules/damage.ts 的 loseHp）不属于伤害，仍由内容直接扣血
 * （【透支】的自伤与【消耗战】的流失），不经过这里。
 */

/** 给目标叠加威胁；source 是施加者（用于伤害帧的来源与日志语义） */
export function addThreat(
  state: GameState,
  target: PlayerIndex,
  source: PlayerIndex,
  amount: number,
): void {
  const value = Math.floor(amount)
  if (value <= 0) return
  const player = state.players[target]
  const before = player.threat
  player.threat = before + value
  log(
    state,
    `${playerLabel(state, source)} 使 ${playerLabel(state, target)} 获得 ${value} 点威胁（威胁 ${before} → ${player.threat}）`,
  )
}

/** 抵消威胁，返回实际抵消的点数（不会低于 0） */
export function offsetThreat(state: GameState, p: PlayerIndex, amount: number): number {
  const value = Math.max(0, Math.floor(amount))
  const player = state.players[p]
  const before = player.threat
  const actual = Math.min(before, value)
  if (actual > 0) player.threat = before - actual
  log(
    state,
    `${playerLabel(state, p)} 抵消 ${actual} 点威胁（威胁 ${before} → ${player.threat}）`,
  )
  return actual
}

/**
 * 回合结束时的威胁结算：剩余威胁转为等量伤害。
 *
 * 伤害来源按 1v1 的唯一对手记（威胁来源不逐笔追踪，属已知简化）；
 * 体力扣减立即发生，触发与濒死由伤害帧按既有顺序处理。
 */
export function resolveThreatAtTurnEnd(state: GameState, p: PlayerIndex): void {
  const player = state.players[p]
  if (!player.alive) return
  const amount = player.threat
  if (amount <= 0) return

  log(state, `${playerLabel(state, p)} 的回合结束：剩余 ${amount} 点威胁结算为伤害`)
  player.threat = 0
  dealDamage(state, {
    source: otherPlayer(p),
    target: p,
    amount,
    card: null,
  })
}

/**
 * 威胁不变式：任意结算步之后，威胁都必须是非负整数。
 * 与「牌数守恒」「能量不变式」一样，是引擎每次 submit 后自动校验的硬约束。
 */
export function assertThreatBounds(state: GameState): void {
  for (const player of state.players) {
    if (!Number.isInteger(player.threat) || player.threat < 0) {
      throw new Error(
        `威胁越界：${player.index} 号角色的威胁为 ${player.threat}，应为非负整数`,
      )
    }
  }
}
