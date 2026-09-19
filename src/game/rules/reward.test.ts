import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { cardDoc, cardIds } from '../dsl/registry'
import { makeState, snapshot } from '../testUtils'
import type { GameState } from '../types'
import { assertConservation } from './cardZones'
import {
  REWARD_CANDIDATES,
  canRemove,
  ownCardCount,
  rewardPool,
  rollRewardCards,
  serviceOptions,
  upgradeCandidates,
} from './reward'

/**
 * 奖励机制的节奏与流程：
 *  - 卡牌三选一在 `turn % 3 === 0` 触发，服务三选一在 `turn % 4 === 0` 触发；
 *  - 同一时机上两份规则都命中时，**卡牌先弹、服务后弹**
 *    （规则按 priority 升序执行、帧后压先弹，见 rules/reward-card.json 的说明）；
 *  - 双方各选一次，从回合角色起按座次。
 */

/** 把一个「回合开始时」的局面交到奖励询问点上 */
function startTurn(turn: number, extra: Partial<Parameters<typeof makeState>[0]> = {}): GameState {
  const state = makeState({
    playerSpecies: 'offensive',
    aiSpecies: 'defensive',
    phase: 'turn-start',
    ...extra,
  })
  state.turn = turn
  state.active = 0
  advance(state)
  return state
}

describe('奖励节奏', () => {
  it('第 3 回合弹卡牌三选一：3 张互不重复的候选', () => {
    const state = startTurn(3)
    const pending = state.pending
    expect(pending).toMatchObject({ kind: 'reward', player: 0, reward: 'card', allowSkip: true })
    if (pending?.kind !== 'reward') throw new Error('没有卡牌奖励')
    expect(pending.cards).toHaveLength(REWARD_CANDIDATES)
    expect(new Set(pending.cards).size).toBe(REWARD_CANDIDATES)
  })

  it('第 4 回合弹服务三选一（卡牌规则不触发）', () => {
    const state = startTurn(4)
    expect(state.pending).toMatchObject({ kind: 'reward', player: 0, reward: 'service' })
  })

  it('第 6 回合仍然只弹卡牌三选一（6 是 3 的倍数、不是 4 的倍数）', () => {
    const state = startTurn(6)
    expect(state.pending).toMatchObject({ kind: 'reward', player: 0, reward: 'card' })
  })

  it('第 12 回合先弹卡牌三选一、再弹服务三选一', () => {
    const state = startTurn(12)
    expect(state.pending).toMatchObject({ kind: 'reward', player: 0, reward: 'card' })
    const first = state.pending
    if (first?.kind !== 'reward') throw new Error('没有卡牌奖励')
    const kind = first.cards![0]!

    // 双方各选一次：先回合角色（0），再对手（1）
    submit(state, { kind: 'pick-reward', card: kind })
    expect(state.pending).toMatchObject({ kind: 'reward', player: 1, reward: 'card' })
    submit(state, { kind: 'pick-reward', card: kind })

    // 卡牌帧弹出后才处理服务帧
    expect(state.pending).toMatchObject({ kind: 'reward', player: 0, reward: 'service' })
  })

  it('非 3/4 倍数的回合不发奖励', () => {
    const state = startTurn(2)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
  })

  it('消耗战优先级更低：第 21 回合先扣体力，再发卡牌奖励', () => {
    const state = startTurn(21)
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('消耗战')
    // 21 是 3 的倍数：消耗战扣完体力后奖励帧才压栈，因此奖励在栈顶先弹
    expect(state.pending).toMatchObject({ kind: 'reward', player: 0, reward: 'card' })
  })
})

describe('奖励池与抽取', () => {
  it('奖励池只收声明了 rarity 的牌种，基础牌与升级版都不入池', () => {
    const pool = rewardPool()
    expect(pool.length).toBeGreaterThan(0)
    for (const kind of pool) expect(cardDoc(kind).rarity).toBeDefined()
    for (const id of cardIds()) {
      if (cardDoc(id).rarity === undefined) expect(pool).not.toContain(id)
    }
  })

  it('同种子抽到同一组候选（确定性），且互不重复', () => {
    const a = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', seed: 42 })
    const b = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', seed: 42 })
    const first = rollRewardCards(a)
    const second = rollRewardCards(b)
    expect(second).toEqual(first)
    expect(new Set(first).size).toBe(first.length)
  })

  it('候选张数由调用方决定，池子不够时不重复地全部返回', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    const all = rollRewardCards(state, 999)
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBeLessThanOrEqual(rewardPool().length)
  })
})

describe('跳过', () => {
  it('卡牌奖励可以跳过，随后轮到对手', () => {
    const state = startTurn(3)
    submit(state, { kind: 'skip-reward' })
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('放弃了卡牌奖励')
    expect(state.pending).toMatchObject({ kind: 'reward', player: 1, reward: 'card' })
  })

  it('服务奖励不能跳过，且状态不变', () => {
    const state = startTurn(4)
    const before = snapshot(state)
    expect(() => submit(state, { kind: 'skip-reward' })).toThrow('服务奖励不能跳过')
    expect(state).toEqual(before)
  })
})

describe('服务三选一', () => {
  it('回复：回复规则给出的数值，不超过体力上限', () => {
    const state = startTurn(4, { playerHp: 2 })
    submit(state, { kind: 'pick-reward', service: 'heal' })
    expect(state.players[0].hp).toBe(5)
    expect(state.pending).toMatchObject({ kind: 'reward', player: 1, reward: 'service' })
  })

  it('升级：选一张牌后就地改 kind，uid 不变', () => {
    const state = startTurn(4)
    submit(state, { kind: 'pick-reward', service: 'upgrade' })

    const pick = state.pending
    expect(pick).toMatchObject({ kind: 'pick-card', player: 0, purpose: 'upgrade' })
    if (pick?.kind !== 'pick-card') throw new Error('没有选牌待输入项')
    const target = pick.candidates[0]!
    const uid = target.uid
    const upgraded = cardDoc(target.kind).upgradeTo!

    submit(state, { kind: 'pick-own-card', card: target })
    const after = state.players[0].hand
      .concat(state.players[0].deck, state.players[0].discard)
      .find((card) => card.uid === uid)!
    expect(after.kind).toBe(upgraded)
    assertConservation(state)
  })

  it('移除：牌进入移除区，全局仍守恒', () => {
    const state = startTurn(4)
    submit(state, { kind: 'pick-reward', service: 'remove' })
    const pick = state.pending
    if (pick?.kind !== 'pick-card') throw new Error('没有选牌待输入项')
    const target = pick.candidates[0]!

    submit(state, { kind: 'pick-own-card', card: target })
    expect(state.players[0].removed.map((card) => card.uid)).toContain(target.uid)
    expect(state.players[0].hand.map((c) => c.uid)).not.toContain(target.uid)
    expect(state.players[0].deck.map((c) => c.uid)).not.toContain(target.uid)
    assertConservation(state)
  })

  it('满血时回复不可用，无牌可升级时升级不可用', () => {
    const full = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(serviceOptions(full, 0, { healAmount: 3, removeFloor: 5 }).heal).toBe(false)

    // 把 0 号玩家的牌区换成一个没有 upgradeTo 的牌种
    const noUpgrade = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    noUpgrade.players[0].deck = []
    noUpgrade.players[0].discard = []
    noUpgrade.players[0].hand = [{ uid: 9001, kind: 'strike-plus' }]
    expect(upgradeCandidates(noUpgrade, 0)).toHaveLength(0)
    expect(serviceOptions(noUpgrade, 0, { healAmount: 3, removeFloor: 5 }).upgrade).toBe(false)
  })

  it('移除下限：牌太少时不能移除', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    state.players[0].deck = []
    state.players[0].discard = []
    state.players[0].hand = Array.from({ length: 5 }, (_, i) => ({ uid: 100 + i, kind: 'strike' }))
    expect(ownCardCount(state, 0)).toBe(5)
    expect(canRemove(state, 0, 5)).toBe(false)
    expect(canRemove(state, 0, 4)).toBe(true)
    expect(serviceOptions(state, 0, { healAmount: 3, removeFloor: 5 }).remove).toBe(false)
  })
})
