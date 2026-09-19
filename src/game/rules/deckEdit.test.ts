import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { cardDoc } from '../dsl/registry'
import { makeState, snapshot } from '../testUtils'
import type { Card, GameState } from '../types'
import { allCards, assertConservation, drawCards } from './cardZones'
import { canRemove } from './reward'

/**
 * 升级 / 移除对牌区的改动：
 *  - 升级**就地改 kind**，uid 不变（摸牌、洗回、守恒都不受影响）；
 *  - 移除把牌移进 `removed` 区，既不参与摸牌、也不随弃牌堆洗回；
 *  - 两者都计入牌数守恒，且移除有下限。
 */

/** 走到一次服务奖励的选牌点上（第 4 回合，只有服务三选一） */
function servicePick(purpose: 'upgrade' | 'remove', options: Record<string, unknown> = {}) {
  const state = makeState({
    playerSpecies: 'offensive',
    aiSpecies: 'defensive',
    phase: 'turn-start',
    ...options,
  })
  state.turn = 4
  state.active = 0
  advance(state)
  submit(state, { kind: 'pick-reward', service: purpose })
  const pick = state.pending
  if (pick?.kind !== 'pick-card') throw new Error('没有进入选牌待输入项')
  return { state, pick }
}

describe('升级', () => {
  it('升级保 uid、kind 换成 upgradeTo，守恒成立', () => {
    const { state, pick } = servicePick('upgrade')
    const target = pick.candidates[0]!
    const uid = target.uid
    const upgraded = cardDoc(target.kind).upgradeTo!

    submit(state, { kind: 'pick-own-card', card: target })

    const after = allCards(state).find((card) => card.uid === uid)!
    expect(after.kind).toBe(upgraded)
    // 升级不改变总张数
    expect(allCards(state)).toHaveLength(state.cardTotal)
    assertConservation(state)
  })

  it('升级后的牌仍能被正常摸到 / 打出（uid 未变，牌区未动）', () => {
    const { state, pick } = servicePick('upgrade')
    const target = pick.candidates[0]!
    const uid = target.uid
    const zone = state.players[0].deck.some((c) => c.uid === uid) ? 'deck' : 'hand'
    submit(state, { kind: 'pick-own-card', card: target })
    const zoneCards = zone === 'deck' ? state.players[0].deck : state.players[0].hand
    expect(zoneCards.map((c) => c.uid)).toContain(uid)
    assertConservation(state)
  })
})

describe('移除', () => {
  it('移除的牌进入 removed 区并从原牌区消失', () => {
    const { state, pick } = servicePick('remove')
    const target = pick.candidates[0]!
    const uid = target.uid

    submit(state, { kind: 'pick-own-card', card: target })

    const player = state.players[0]
    expect(player.removed.map((c) => c.uid)).toContain(uid)
    for (const zone of [player.deck, player.hand, player.discard]) {
      expect(zone.map((c) => c.uid)).not.toContain(uid)
    }
    assertConservation(state)
  })

  it('移除的牌不会再被摸到，洗回牌组时也不会复活', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    const player = state.players[0]
    const removed = player.deck.splice(0, 3)
    player.removed.push(...removed)
    const removedUids = new Set(player.removed.map((card) => card.uid))

    const drawn: Card[] = []
    // 反复抽干：牌组耗尽时弃牌堆会洗回牌组，但移除区不参与
    for (let i = 0; i < 40; i++) drawn.push(...drawCards(state, 0, 5))

    expect(drawn.some((card) => removedUids.has(card.uid))).toBe(false)
    expect(drawn.length).toBeGreaterThan(0)
    assertConservation(state)
  })

  it('移除后总数不足下限时被拒绝，状态不变', () => {
    const state: GameState = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    state.players[0].deck = []
    state.players[0].discard = []
    state.players[0].hand = Array.from(
      { length: 5 },
      (_, i) => ({ uid: 100 + i, kind: 'strike' }) as Card,
    )
    expect(canRemove(state, 0, 5)).toBe(false)

    state.stack.push({
      kind: 'reward',
      ask: [0],
      reward: 'service',
      allowSkip: false,
      healAmount: 3,
      removeFloor: 5,
    })
    state.pending = { kind: 'reward', player: 0, reward: 'service', allowSkip: false }
    const before = snapshot(state)

    expect(() => submit(state, { kind: 'pick-reward', service: 'remove' })).toThrow(
      '移除后牌组、手牌与弃牌堆不得少于 5 张',
    )
    expect(state).toEqual(before)
  })
})
