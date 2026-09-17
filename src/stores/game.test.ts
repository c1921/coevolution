import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiDecide } from '../game/ai'
import { isOver } from '../game/engine'
import * as store from './game'

/** 用 AI 代替玩家点击，走一遍界面层的提交路径 */
function actLikeHuman(): void {
  const state = store.gameState.value
  if (!state || isOver(state)) return
  store.act(aiDecide(state))
}

describe('界面状态与驱动循环', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    store.backToStart()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('从首页到终局：抽将 → 选将 → 自动推进 → 对局结束', () => {
    store.beginDraft()
    expect(store.screen.value).toBe('draft')
    expect(store.draftOptions.value).toHaveLength(3)

    const species = store.draftOptions.value[0]!
    store.chooseSpecies(species)

    expect(store.screen.value).toBe('battle')
    expect(store.human.value?.species).toBe(species)
    expect(store.humanPending.value?.kind).toBe('play')

    let guard = 0
    while (!store.over.value) {
      if (++guard > 5000) throw new Error('界面驱动循环未能在合理步数内终局')
      // 让 AI 的延迟回调全部执行完
      vi.runAllTimers()
      if (store.over.value) break
      const pending = store.humanPending.value
      if (!pending) throw new Error('驱动循环停滞：既没有玩家待操作项也没有终局')
      actLikeHuman()
    }

    expect(store.over.value).toBe(true)
    expect(store.resultText.value).toMatch(/获胜/)
    expect(store.errorMessage.value).toBeNull()
  })

  it('只向玩家提供合法操作，且提交后引擎接受', () => {
    store.beginDraft()
    store.chooseSpecies(store.draftOptions.value[0]!)
    const state = store.gameState.value!

    const usable = state.players[0].hand.filter((c) => store.legalOptions(c).length > 0)
    expect(usable.length).toBeGreaterThan(0)

    // 非法用法不会出现：防御牌在出牌阶段没有任何选项
    const defend = state.players[0].hand.find((c) => c.kind === 'defend')
    if (defend) {
      const onlyStrikeConversion = store
        .legalOptions(defend)
        .every((o) => o.as === 'strike')
      expect(onlyStrikeConversion).toBe(true)
    }

    const card = usable[0]!
    store.pickCard(card.uid)
    expect(store.isSelected(card.uid)).toBe(true)
    expect(store.selectedCards.value).toHaveLength(1)

    const option = store.legalOptions(card)[0]!
    store.submitOption(card, option)
    expect(store.errorMessage.value).toBeNull()
  })

  it('点选同一张牌可以取消选择', () => {
    store.beginDraft()
    store.chooseSpecies(store.draftOptions.value[0]!)
    const card = store.gameState.value!.players[0].hand[0]!

    store.pickCard(card.uid)
    expect(store.selectedCards.value).toHaveLength(1)
    store.pickCard(card.uid)
    expect(store.selectedCards.value).toHaveLength(0)
  })

  it('非法操作给出中文提示且状态不变', () => {
    store.beginDraft()
    store.chooseSpecies(store.draftOptions.value[0]!)
    const state = store.gameState.value!
    const before = JSON.stringify(state.players.map((p) => p.hp))

    store.act({ kind: 'play-card', card: state.players[0].hand[0]!, as: 'defend' })

    expect(store.errorMessage.value).toBeTruthy()
    expect(JSON.stringify(state.players.map((p) => p.hp))).toBe(before)
  })

  it('弃牌阶段：选够张数才能确认', () => {
    store.beginDraft()
    store.chooseSpecies(store.draftOptions.value[0]!)

    // 一直推进到玩家的弃牌阶段
    let guard = 0
    let count = 0
    while (!store.over.value) {
      if (++guard > 500) throw new Error('没有进入弃牌阶段')
      vi.runAllTimers()
      const pending = store.humanPending.value
      if (!pending) throw new Error('驱动循环停滞')
      if (pending.kind === 'discard') {
        count = pending.count
        break
      }
      actLikeHuman()
    }

    expect(count).toBeGreaterThan(0)

    // 选不满时拒绝提交
    store.submitDiscard()
    expect(store.errorMessage.value).toContain('需要弃置')

    const hand = store.gameState.value!.players[0].hand
    for (const card of hand.slice(0, count)) store.pickCard(card.uid)
    expect(store.selectedCards.value).toHaveLength(count)

    store.submitDiscard()
    expect(store.errorMessage.value).toBeNull()
  })

  it('再来一局会重置对局，旧的 AI 回调不会污染新对局', () => {
    store.beginDraft()
    store.chooseSpecies(store.draftOptions.value[0]!)
    expect(store.screen.value).toBe('battle')

    // AI 的延迟回调此刻还在队列里
    store.beginDraft()
    expect(store.screen.value).toBe('draft')
    expect(store.gameState.value).toBeNull()

    vi.runAllTimers()
    // 旧回调被 pumpToken 拦下：界面仍停在选将页，没有偷偷开出新对局
    expect(store.screen.value).toBe('draft')
    expect(store.gameState.value).toBeNull()
  })

  it('返回首页会清空对局', () => {
    store.beginDraft()
    store.chooseSpecies(store.draftOptions.value[0]!)
    store.backToStart()
    expect(store.screen.value).toBe('start')
    expect(store.gameState.value).toBeNull()
    expect(store.human.value).toBeNull()
  })
})
