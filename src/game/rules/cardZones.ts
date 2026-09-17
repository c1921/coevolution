import { DECK_SIZE } from '../data/deck'
import { log } from '../log'
import { shuffle } from '../rng'
import type { Card, GameState, PlayerIndex } from '../types'
import { RuleError } from '../util'

/** 某人的手牌 */
export function handOf(state: GameState, p: PlayerIndex): Card[] {
  return state.players[p].hand
}

export function findInHand(
  state: GameState,
  p: PlayerIndex,
  uid: number,
): Card | undefined {
  return state.players[p].hand.find((c) => c.uid === uid)
}

export function removeFromHand(state: GameState, p: PlayerIndex, card: Card): void {
  const hand = state.players[p].hand
  const i = hand.findIndex((c) => c.uid === card.uid)
  if (i < 0) throw new RuleError(`手牌中不存在 uid=${card.uid} 的牌`)
  hand.splice(i, 1)
}

/** 手牌 → 处理区（结算中的牌） */
export function moveHandToProcessing(
  state: GameState,
  p: PlayerIndex,
  card: Card,
): void {
  removeFromHand(state, p, card)
  state.processing.push(card)
}

/** 手牌 → 弃牌堆 */
export function moveHandToDiscard(state: GameState, p: PlayerIndex, card: Card): void {
  removeFromHand(state, p, card)
  state.discard.push(card)
}

/** 从处理区取走一张牌；不在处理区则返回 false（夺食可能已经取走过） */
export function takeFromProcessing(state: GameState, card: Card): boolean {
  const i = state.processing.findIndex((c) => c.uid === card.uid)
  if (i < 0) return false
  state.processing.splice(i, 1)
  return true
}

/** 处理区 → 弃牌堆；已不在处理区的牌自动跳过 */
export function flushProcessing(state: GameState, cards: Card[]): void {
  for (const card of cards) {
    if (takeFromProcessing(state, card)) state.discard.push(card)
  }
}

/**
 * 摸牌。牌堆耗尽时把弃牌堆洗回牌堆；两者都空则跳过并记录日志。
 * 返回实际摸到的牌。
 */
export function drawCards(state: GameState, p: PlayerIndex, count: number): Card[] {
  const drawn: Card[] = []
  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) {
        log(state, `牌堆与弃牌堆均已耗尽，${count - i} 张牌无法摸取，跳过`)
        break
      }
      const result = shuffle(state.discard, state.rngState)
      state.deck = result.items
      state.rngState = result.state
      state.discard = []
      log(state, `牌堆耗尽，弃牌堆的 ${state.deck.length} 张牌洗回牌堆`)
    }
    const card = state.deck.pop()
    if (!card) break
    state.players[p].hand.push(card)
    drawn.push(card)
  }
  return drawn
}

/** 汇总所有牌区，用于「牌数守恒」校验 */
export function allCards(state: GameState): Card[] {
  return [
    ...state.deck,
    ...state.discard,
    ...state.processing,
    ...state.players[0].hand,
    ...state.players[1].hand,
  ]
}

/**
 * 牌数守恒：全 53 张牌必须各自恰好属于一个牌区。
 * 任何结算漏牌 / 重复放牌都会在这里被立刻发现。
 */
export function assertConservation(state: GameState): void {
  const all = allCards(state)
  if (all.length !== DECK_SIZE) {
    throw new Error(`牌数守恒被破坏：共 ${all.length} 张，应为 ${DECK_SIZE} 张`)
  }
  const uids = new Set(all.map((c) => c.uid))
  if (uids.size !== all.length) {
    throw new Error('牌数守恒被破坏：同一张牌同时存在于多个牌区')
  }
}
