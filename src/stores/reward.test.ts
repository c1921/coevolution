import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiDecide } from '../game/ai'
import { advance } from '../game/engine'
import { makeState } from '../game/testUtils'
import * as store from './game'

/**
 * 人类侧的奖励流程：三选一的候选/可用性由 selectors 派生，提交走 actions 的 `act()`，
 * 非法选择必须把文档 reason 显示到 `errorMessage`，且引擎状态不变。
 */

/** 装载一个「回合开始时」的局面并推进到奖励询问点 */
function loadTurnStart(turn: number, options: Record<string, unknown> = {}) {
  store.backToStart()
  const state = makeState({
    playerSpecies: 'offensive',
    aiSpecies: 'defensive',
    phase: 'turn-start',
    ...options,
  })
  state.turn = turn
  state.active = 0
  advance(state)
  store.gameState.value = state
  store.screen.value = 'battle'
  return state
}

/** 让 AI 把它那一侧的奖励也选掉，推进到下一段流程 */
function resolveAi(): void {
  const state = store.gameState.value
  if (!state?.pending) return
  store.act(aiDecide(state))
}

describe('界面的奖励三选一', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    store.backToStart()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('卡牌三选一：候选与提示来自 selectors，提交后进入对手的选择', () => {
    const state = loadTurnStart(3)
    expect(store.humanPending.value).toMatchObject({ kind: 'reward', reward: 'card' })
    expect(store.rewardCardOptions.value).toHaveLength(3)
    expect(store.rewardAllowSkip.value).toBe(true)
    expect(store.pendingHint.value).toContain('奖励三选一')

    const chosen = store.rewardCardOptions.value[0]!
    const before = state.players[0].hand.length
    store.submitRewardCard(chosen.kind)

    expect(store.errorMessage.value).toBeNull()
    expect(state.players[0].hand).toHaveLength(before + 1)
    expect(state.players[0].hand.some((card) => card.kind === chosen.kind)).toBe(true)
    // 轮到对手（AI）选择
    expect(state.pending).toMatchObject({ kind: 'reward', player: 1 })
  })

  it('非法卡牌选择报文档 reason，且状态不变', () => {
    const state = loadTurnStart(3)
    const hand = state.players[0].hand.length
    // 【打击】没有 rarity，不在奖励池里
    store.submitRewardCard('strike')

    expect(store.errorMessage.value).toBe('这张牌不在本次奖励候选中')
    expect(state.players[0].hand).toHaveLength(hand)
    expect(state.pending).toMatchObject({ kind: 'reward', player: 0 })
  })

  it('跳过卡牌奖励后轮到对手', () => {
    const state = loadTurnStart(3)
    store.submitSkipReward()
    expect(store.errorMessage.value).toBeNull()
    expect(state.pending).toMatchObject({ kind: 'reward', player: 1, reward: 'card' })
  })

  it('服务三选一：满血时回复被禁用并给出原因，升级/移除可选', () => {
    loadTurnStart(4)
    expect(store.humanPending.value).toMatchObject({ kind: 'reward', reward: 'service' })
    const options = store.rewardServiceOptions.value
    expect(options).toHaveLength(3)
    const heal = options.find((option) => option.service === 'heal')!
    expect(heal.enabled).toBe(false)
    expect(heal.reason).toContain('体力已满')
    expect(options.find((o) => o.service === 'upgrade')?.enabled).toBe(true)
    expect(options.find((o) => o.service === 'remove')?.enabled).toBe(true)
  })

  it('升级：先提交服务选择，再在自己的牌里选一张', () => {
    const state = loadTurnStart(4)
    store.submitRewardService('upgrade')
    expect(state.pending).toMatchObject({ kind: 'pick-card', player: 0, purpose: 'upgrade' })
    expect(store.pickCardOptions.value.length).toBeGreaterThan(0)
    expect(store.pickCardTitle.value).toContain('升级')

    const option = store.pickCardOptions.value[0]!
    const uid = option.card.uid
    store.submitPickOwnCard(option.card)

    expect(store.errorMessage.value).toBeNull()
    const after = [...state.players[0].hand, ...state.players[0].deck, ...state.players[0].discard]
    expect(after.find((card) => card.uid === uid)?.kind).not.toBe(option.card.kind)
    // 升级完轮到对手做服务选择
    expect(state.pending).toMatchObject({ kind: 'reward', player: 1, reward: 'service' })
  })

  it('移除：选定的牌进入移除区', () => {
    const state = loadTurnStart(4)
    store.submitRewardService('remove')
    expect(store.pickCardTitle.value).toContain('移除')
    const option = store.pickCardOptions.value[0]!
    store.submitPickOwnCard(option.card)
    expect(state.players[0].removed.map((card) => card.uid)).toContain(option.card.uid)
  })

  it('第 12 回合：人类与 AI 依次选完卡牌奖励后才轮到服务奖励', () => {
    const state = loadTurnStart(12)
    expect(state.pending).toMatchObject({ kind: 'reward', player: 0, reward: 'card' })
    const kind = store.rewardCardOptions.value[0]!.kind
    store.submitRewardCard(kind)
    expect(state.pending).toMatchObject({ player: 1, reward: 'card' })
    resolveAi()
    expect(state.pending).toMatchObject({ kind: 'reward', player: 0, reward: 'service' })
  })
})
