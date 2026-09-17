import { isRedCard } from '../data/deck'
import { hasSkill } from '../data/species'
import { activeOptions, strikeLimit } from '../skills'
import type { Action, Card, GameState, PlayerIndex } from '../types'
import { otherPlayer, RuleError } from '../util'

/** AI 思考延迟（毫秒）：只影响界面节奏，引擎与单测不受影响 */
export const AI_DELAY_MS = 600

/**
 * 规则式 AI：读取当前待输入项并返回一个动作。
 * 完全确定性——同样的状态必定给出同样的动作，随机部分只走 state.rngState。
 */
export function aiDecide(state: GameState): Action {
  const pending = state.pending
  if (!pending) throw new RuleError('AI 无事可做：当前没有待输入项')

  const p = pending.player
  switch (pending.kind) {
    case 'play':
      return decidePlay(state, p)
    case 'respond':
      return decideRespond(state, p)
    case 'dying':
      return decideDying(state, p, pending.dying)
    case 'trigger':
      // 夺食 / 狡计总是纯收益，AI 一律发动
      return { kind: 'trigger-choice', accept: true }
    case 'discard':
      return decideDiscard(state, p, pending.count)
  }
}

/** 出牌阶段决策：回血 → 疗愈 → 透支 → 打击 → 结束阶段 */
function decidePlay(state: GameState, p: PlayerIndex): Action {
  const player = state.players[p]
  const skills = activeOptions(state, p)

  // 1. 疗愈：自己已受伤，且弃得起（留至少一张手牌）
  if (skills.includes('mend') && player.hp < player.maxHp && player.hand.length >= 2) {
    const fodder = worstCard(player.hand)
    if (fodder) {
      return { kind: 'activate', skill: 'mend', cards: [fodder], target: p }
    }
  }

  // 2. 体力告急就用【回复】
  if (player.hp <= 2 && player.hp < player.maxHp) {
    const heal = player.hand.find((c) => c.kind === 'heal')
    if (heal) return { kind: 'use-card', card: heal, as: 'heal' }
  }

  // 3. 透支：体力充裕但手牌太少时换牌
  if (skills.includes('overexert') && player.hp >= 3 && player.hand.length <= 2) {
    return { kind: 'activate', skill: 'overexert' }
  }

  // 4. 进攻
  const strike = bestStrike(state, p)
  if (strike) return strike

  return { kind: 'end-phase' }
}

/** 找出可用于【打击】的最佳方案，优先真牌，其次技能转化 */
function bestStrike(state: GameState, p: PlayerIndex): Action | null {
  const player = state.players[p]
  if (player.strikesUsedThisTurn >= strikeLimit(state, p)) return null
  if (!state.players[otherPlayer(p)].alive) return null

  const direct = player.hand.find((c) => c.kind === 'strike')
  if (direct) return { kind: 'use-card', card: direct, as: 'strike' }

  const defends = player.hand.filter((c) => c.kind === 'defend')
  const heals = player.hand.filter((c) => c.kind === 'heal')

  // 猛扑：红牌当【打击】——优先牺牲富余的【防御】，满血时才牺牲富余的【回复】
  if (hasSkill(player.species, 'pounce')) {
    if (defends.length >= 2) {
      const spare = defends[defends.length - 1]
      if (spare) return { kind: 'use-card', card: spare, as: 'strike', via: 'pounce' }
    }
    if (player.hp >= player.maxHp && heals.length >= 2) {
      const spare = heals[heals.length - 1]
      if (spare) return { kind: 'use-card', card: spare, as: 'strike', via: 'pounce' }
    }
  }

  // 疾影：【防御】当【打击】，同样只在有富余时
  if (hasSkill(player.species, 'flicker') && defends.length >= 2) {
    const spare = defends[defends.length - 1]
    if (spare) return { kind: 'use-card', card: spare, as: 'strike', via: 'flicker' }
  }

  return null
}

/** 响应【打击】：能抵消就抵消，优先真【防御】，其次疾影转化 */
function decideRespond(state: GameState, p: PlayerIndex): Action {
  const player = state.players[p]

  const direct = player.hand.find((c) => c.kind === 'defend')
  if (direct) return { kind: 'play-card', card: direct, as: 'defend' }

  if (hasSkill(player.species, 'flicker')) {
    const strike = player.hand.find((c) => c.kind === 'strike')
    if (strike) return { kind: 'play-card', card: strike, as: 'defend', via: 'flicker' }
  }

  return { kind: 'cancel' }
}

/** 濒死求【回复】：只救自己，绝不救对手 */
function decideDying(state: GameState, p: PlayerIndex, dying: PlayerIndex): Action {
  if (p !== dying) return { kind: 'cancel' }

  const player = state.players[p]
  if (player.hp > 0) return { kind: 'cancel' }

  const heal = player.hand.find((c) => c.kind === 'heal')
  if (heal) return { kind: 'use-card', card: heal, as: 'heal' }

  // 灵草：回合外可以用红牌当【回复】
  if (hasSkill(player.species, 'herb') && state.active !== p) {
    const red = player.hand.find((c) => isRedCard(c))
    if (red) return { kind: 'use-card', card: red, as: 'heal', via: 'herb' }
  }

  return { kind: 'cancel' }
}

/** 弃牌优先级：黑【打击】→ 红【打击】→【防御】→【回复】；同级弃点数最小者 */
function cardScore(card: Card): number {
  if (card.kind === 'strike') return isRedCard(card) ? 1 : 0
  if (card.kind === 'defend') return 2
  return 3
}

function worstCard(hand: Card[]): Card | undefined {
  return [...hand].sort(
    (a, b) => cardScore(a) - cardScore(b) || a.rank - b.rank || a.uid - b.uid,
  )[0]
}

function decideDiscard(state: GameState, p: PlayerIndex, count: number): Action {
  const sorted = [...state.players[p].hand].sort(
    (a, b) => cardScore(a) - cardScore(b) || a.rank - b.rank || a.uid - b.uid,
  )
  return { kind: 'discard-cards', cards: sorted.slice(0, count) }
}
