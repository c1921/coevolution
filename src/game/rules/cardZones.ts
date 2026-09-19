import { log, playerLabel } from '../log'
import { shuffle } from '../rng'
import type { Card, GameState, PlayerIndex, ProcessingCard } from '../types'
import { RuleError } from '../util'

/** 某人的手牌 */
export function handOf(state: GameState, p: PlayerIndex): Card[] {
  return state.players[p].hand
}

export function findInHand(state: GameState, p: PlayerIndex, uid: number): Card | undefined {
  return state.players[p].hand.find((c) => c.uid === uid)
}

export function removeFromHand(state: GameState, p: PlayerIndex, card: Card): void {
  const hand = state.players[p].hand
  const i = hand.findIndex((c) => c.uid === card.uid)
  if (i < 0) throw new RuleError(`手牌中不存在 uid=${card.uid} 的牌`)
  hand.splice(i, 1)
}

/** 手牌 → 处理区（结算中的牌）；条目记住归属，收尾时才知道该进谁的弃牌堆 */
export function moveHandToProcessing(state: GameState, p: PlayerIndex, card: Card): void {
  removeFromHand(state, p, card)
  state.processing.push({ card, owner: p })
}

/** 手牌 → 自己的弃牌堆 */
export function moveHandToDiscard(state: GameState, p: PlayerIndex, card: Card): void {
  removeFromHand(state, p, card)
  state.players[p].discard.push(card)
}

/** 从处理区取走一张牌；不在处理区则返回 undefined（可能已被取走） */
export function takeFromProcessing(state: GameState, uid: number): ProcessingCard | undefined {
  const i = state.processing.findIndex((e) => e.card.uid === uid)
  if (i < 0) return undefined
  return state.processing.splice(i, 1)[0]
}

/** 某张牌是否还在处理区 */
export function isInProcessing(state: GameState, uid: number): boolean {
  return state.processing.some((e) => e.card.uid === uid)
}

/** 处理区 → 各自的弃牌堆（按条目归属分流）；已不在处理区的牌自动跳过 */
export function flushProcessing(state: GameState, entries: ProcessingCard[]): void {
  for (const entry of entries) {
    const taken = takeFromProcessing(state, entry.card.uid)
    if (taken) state.players[taken.owner].discard.push(taken.card)
  }
}

/**
 * 摸牌：只从该玩家自己的私有牌组摸。
 * 自己的牌组耗尽时，把**自己的**弃牌堆洗回自己的牌组；两者都空则跳过并记录日志。
 * 返回实际摸到的牌。
 */
export function drawCards(state: GameState, p: PlayerIndex, count: number): Card[] {
  const player = state.players[p]
  const drawn: Card[] = []
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) {
        log(
          state,
          `${playerLabel(state, p)} 的牌组与弃牌堆均已耗尽，${count - i} 张牌无法摸取，跳过`,
        )
        break
      }
      const result = shuffle(player.discard, state.rngState)
      player.deck = result.items
      state.rngState = result.state
      player.discard = []
      log(state, `${playerLabel(state, p)} 的牌组耗尽，弃牌堆的 ${player.deck.length} 张牌洗回牌堆`)
    }
    const card = player.deck.pop()
    if (!card) break
    player.hand.push(card)
    drawn.push(card)
  }
  return drawn
}

/** 汇总所有牌区，用于「牌数守恒」校验（含移除区：被移除的牌仍属于对局，只是不再参与摸牌） */
export function allCards(state: GameState): Card[] {
  return [
    ...state.players[0].deck,
    ...state.players[0].discard,
    ...state.players[0].hand,
    ...state.players[0].removed,
    ...state.players[1].deck,
    ...state.players[1].discard,
    ...state.players[1].hand,
    ...state.players[1].removed,
    ...state.processing.map((e) => e.card),
  ]
}

/**
 * 牌数守恒：全部牌区的合计张数必须等于 `state.cardTotal`，每张牌恰好属于一个牌区，
 * 且 uid 全局唯一（处理区由双方共享）。任何结算漏牌 / 重复放牌都会在这里被立刻发现。
 *
 * 基准值是 `state.cardTotal` 而不是初始牌组张数：奖励会**加牌**（三选一进手牌时 +1）、
 * 移除会把牌挪进移除区（总数不变），因此"初始 20 + 20 = 40"只在开局成立。
 * 加牌时 `applyPickReward` 同步 +1，移除只是换区，两者都不放宽这条断言。
 *
 * 注意：不要求「每方恒为 20 张」——技能可以把对手的牌拿进自己手里，
 * 之后再弃置就归获得者的弃牌堆，因此双方池子的张数可能此消彼长，但全局总数不变。
 */
export function assertConservation(state: GameState): void {
  const expected = state.cardTotal
  const all = allCards(state)
  if (all.length !== expected) {
    throw new Error(`牌数守恒被破坏：共 ${all.length} 张，应为 ${expected} 张`)
  }
  const uids = new Set(all.map((c) => c.uid))
  if (uids.size !== all.length) {
    throw new Error('牌数守恒被破坏：同一张牌同时存在于多个牌区')
  }
}
