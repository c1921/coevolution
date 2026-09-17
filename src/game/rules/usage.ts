import type { CardKind, GameState, PlayerIndex, SkillId } from '../types'

/**
 * 使用次数记录。
 *
 * 「使用次数」按角色、按牌名统计，并在**回合开始时**重置；
 * 【打击】的默认上限为每回合 1 张，技能可以修改这个上限（【怒吼】改为无限制，
 * 见 skills/index.ts 的 strikeLimit）。转化牌按其「当作的牌名」计数：
 * 把【防御】当【打击】用掉，消耗的同样是【打击】本回合的使用次数。
 *
 * 简化说明：本作的回合外使用（濒死救援【回复】）也记在同一份记录里，
 * 并随该角色下个回合开始时清零——因为当前没有需要区分回合内外次数的牌。
 */

/** 一份空的使用记录（新建玩家状态与回合重置时共用） */
export function newCardUseRecord(): Record<CardKind, number> {
  return { strike: 0, defend: 0, heal: 0 }
}

/** 本回合某牌名已使用的次数 */
export function cardUseCount(state: GameState, p: PlayerIndex, kind: CardKind): number {
  return state.players[p].usedCardsThisTurn[kind]
}

/** 记录一次「使用」（转化牌传入它当作的牌名） */
export function recordCardUse(state: GameState, p: PlayerIndex, kind: CardKind): void {
  state.players[p].usedCardsThisTurn[kind] += 1
}

/** 本回合该「每回合限一次」技能是否已发动过 */
export function skillUsed(state: GameState, p: PlayerIndex, skill: SkillId): boolean {
  return state.players[p].usedSkillsThisTurn.includes(skill)
}

/** 记录一次技能发动 */
export function recordSkillUse(state: GameState, p: PlayerIndex, skill: SkillId): void {
  const used = state.players[p].usedSkillsThisTurn
  if (!used.includes(skill)) used.push(skill)
}

/** 回合开始时清空该角色的使用记录 */
export function resetTurnUsage(state: GameState, p: PlayerIndex): void {
  state.players[p].usedCardsThisTurn = newCardUseRecord()
  state.players[p].usedSkillsThisTurn = []
}
