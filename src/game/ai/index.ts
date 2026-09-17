import { hasSkill } from '../data/species'
import { canPayEnergy, energyCost } from '../rules/energy'
import { activeOptions, playOptions } from '../skills'
import type { Action, Card, GameState, PlayerIndex } from '../types'
import { otherPlayer, RuleError } from '../util'

/** AI 思考延迟（毫秒）：只影响界面节奏，引擎与单测不受影响 */
export const AI_DELAY_MS = 600

/**
 * 预留给防御的能量：手上还有能打出的【防御】（含疾影转化）时，
 * 进攻到只剩这么多能量就收手，留着拦对手下回合的【打击】。
 */
export const DEFENSE_RESERVE = 1

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

/**
 * 出牌阶段决策：疗愈 → 回血 → 透支 → 打击（受能量约束）→ 结束阶段。
 *
 * 每次 submit 只走一步，引擎再把待输入项交回这里，所以「能打几张【打击】」
 * 由循环自然形成：付得起就打，付不起或要留防御余量就结束出牌阶段。
 */
function decidePlay(state: GameState, p: PlayerIndex): Action {
  const player = state.players[p]
  const skills = activeOptions(state, p)

  // 1. 疗愈：自己已受伤，且弃得起（留至少一张手牌）。技能不消耗能量
  if (skills.includes('mend') && player.hp < player.maxHp && player.hand.length >= 2) {
    const fodder = worstCard(player.hand)
    if (fodder) {
      return { kind: 'activate', skill: 'mend', cards: [fodder], target: p }
    }
  }

  // 2. 体力告急就用【回复】（要付得起 2 点能量）
  if (player.hp <= 2 && player.hp < player.maxHp && canPayEnergy(state, p, 'heal')) {
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

/** 手上是否还有能打出【防御】的牌（真【防御】或疾影把【打击】当【防御】） */
function holdsDefense(state: GameState, p: PlayerIndex): boolean {
  return state.players[p].hand.some((card) =>
    playOptions(state, p, card).some((o) => o.as === 'defend'),
  )
}

/**
 * 找出可用于【打击】的最佳方案，优先真牌，其次技能转化。
 * 【打击】没有次数限制，唯一的门槛是能量：除了这一张的费用，还要留出防御余量。
 */
function bestStrike(state: GameState, p: PlayerIndex): Action | null {
  const player = state.players[p]
  if (!canPayEnergy(state, p, 'strike')) return null
  if (!state.players[otherPlayer(p)].alive) return null

  const reserve = holdsDefense(state, p) ? DEFENSE_RESERVE : 0
  if (player.energy - energyCost('strike') < reserve) return null

  const direct = player.hand.find((c) => c.kind === 'strike')
  if (direct) return { kind: 'use-card', card: direct, as: 'strike' }

  const defends = player.hand.filter((c) => c.kind === 'defend')

  // 疾影：【防御】当【打击】，只在有富余时
  if (hasSkill(player.species, 'flicker') && defends.length >= 2) {
    const spare = defends[defends.length - 1]
    if (spare) return { kind: 'use-card', card: spare, as: 'strike', via: 'flicker' }
  }

  return null
}

/** 响应【打击】：付得起就抵消（优先真【防御】，其次疾影转化），否则承受伤害 */
function decideRespond(state: GameState, p: PlayerIndex): Action {
  const player = state.players[p]
  if (!canPayEnergy(state, p, 'defend')) return { kind: 'cancel' }

  const direct = player.hand.find((c) => c.kind === 'defend')
  if (direct) return { kind: 'play-card', card: direct, as: 'defend' }

  if (hasSkill(player.species, 'flicker')) {
    const strike = player.hand.find((c) => c.kind === 'strike')
    if (strike) return { kind: 'play-card', card: strike, as: 'defend', via: 'flicker' }
  }

  return { kind: 'cancel' }
}

/** 濒死求【回复】：只救自己，绝不救对手；付不起 2 点能量就只能放弃 */
function decideDying(state: GameState, p: PlayerIndex, dying: PlayerIndex): Action {
  if (p !== dying) return { kind: 'cancel' }

  const player = state.players[p]
  if (player.hp > 0) return { kind: 'cancel' }
  if (!canPayEnergy(state, p, 'heal')) return { kind: 'cancel' }

  const heal = player.hand.find((c) => c.kind === 'heal')
  if (heal) return { kind: 'use-card', card: heal, as: 'heal' }

  return { kind: 'cancel' }
}

/**
 * 弃牌优先级：【打击】→【防御】→【回复】；同级弃 uid 最小者。
 * 【打击】每个牌组有 11 张且只要 1 点能量，多出来的打击最不值得留。
 */
function cardScore(card: Card): number {
  if (card.kind === 'strike') return 0
  if (card.kind === 'defend') return 1
  return 2
}

function worstCard(hand: Card[]): Card | undefined {
  return [...hand].sort((a, b) => cardScore(a) - cardScore(b) || a.uid - b.uid)[0]
}

function decideDiscard(state: GameState, p: PlayerIndex, count: number): Action {
  const sorted = [...state.players[p].hand].sort(
    (a, b) => cardScore(a) - cardScore(b) || a.uid - b.uid,
  )
  return { kind: 'discard-cards', cards: sorted.slice(0, count) }
}
