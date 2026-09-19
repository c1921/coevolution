import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiDecide } from '../game/ai'
import { isOver } from '../game/engine'
import { assertEnergyBounds, energyCost } from '../game/rules/energy'
import { makeState } from '../game/testUtils'
import type { MakeStateOptions } from '../game/testUtils'
import type { GameState } from '../game/types'
import * as store from './game'

/** 固定种子：对局随机只影响"抽到什么物种/什么牌"，测试用固定种子避免偶发失败 */
const FIXED_SEED = 2

/** 用 AI 代替玩家点击，走一遍界面层的提交路径 */
function actLikeHuman(): void {
  const state = store.gameState.value
  if (!state || isOver(state)) return
  store.act(aiDecide(state))
}

/**
 * 装载一个手牌与体力都可精确指定的对局状态（主动技的目标选择需要确定的场面，
 * 靠固定种子抽将撞不出"自己满血、对手受伤"这种组合）。
 */
function loadState(options: MakeStateOptions): GameState {
  store.backToStart()
  const state = makeState(options)
  store.gameState.value = state
  return state
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
    store.beginDraft(FIXED_SEED)
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
    // 全程能量都落在 0..上限 之内（AI 也没有因付不起能量而卡住）
    assertEnergyBounds(store.gameState.value!)
  })

  it('界面提交的出牌会按牌面扣除能量', () => {
    store.beginDraft(FIXED_SEED)
    store.chooseSpecies(store.draftOptions.value[0]!)
    const state = store.gameState.value!

    const card = state.players[0].hand.find((c) => store.legalOptions(c).length > 0)!
    const option = store.legalOptions(card)[0]!
    const before = state.players[0].energy

    store.pickCard(card.uid)
    store.submitOption(card, option)

    expect(store.errorMessage.value).toBeNull()
    expect(state.players[0].energy).toBe(before - energyCost(state, 0, option.as))
    expect(store.optionText(option)).toContain(`${energyCost(state, 0, option.as)} 能量`)
  })

  it('能量见底后没有可选的牌，只能结束出牌阶段', () => {
    store.beginDraft(FIXED_SEED)
    store.chooseSpecies(store.draftOptions.value[0]!)
    const state = store.gameState.value!

    // 直接把能量清零，模拟「打光了」的局面
    state.players[0].energy = 0

    expect(store.humanEnergy.value).toBe(0)
    expect(store.hasPlayableCard.value).toBe(false)
    for (const card of state.players[0].hand) {
      expect(store.isSelectable(card)).toBe(false)
    }
    expect(store.pendingHint.value).toContain('能量')

    store.submitEndPhase()
    expect(store.errorMessage.value).toBeNull()
  })

  it('只向玩家提供合法操作，且提交后引擎接受', () => {
    store.beginDraft(FIXED_SEED)
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
    store.beginDraft(FIXED_SEED)
    store.chooseSpecies(store.draftOptions.value[0]!)
    const card = store.gameState.value!.players[0].hand[0]!

    store.pickCard(card.uid)
    expect(store.selectedCards.value).toHaveLength(1)
    store.pickCard(card.uid)
    expect(store.selectedCards.value).toHaveLength(0)
  })

  it('非法操作给出中文提示且状态不变', () => {
    store.beginDraft(FIXED_SEED)
    store.chooseSpecies(store.draftOptions.value[0]!)
    const state = store.gameState.value!
    const before = JSON.stringify(state.players.map((p) => p.hp))

    store.act({ kind: 'play-card', card: state.players[0].hand[0]!, as: 'defend' })

    expect(store.errorMessage.value).toBeTruthy()
    expect(JSON.stringify(state.players.map((p) => p.hp))).toBe(before)
  })

  it('弃牌阶段：选够张数才能确认', () => {
    store.beginDraft(FIXED_SEED)
    store.chooseSpecies(store.draftOptions.value[0]!)

    // 一直推进到玩家的弃牌阶段
    let guard = 0
    let count = 0
    while (!store.over.value) {
      if (++guard > 500) throw new Error('没有进入弃牌阶段')
      vi.runAllTimers()
      if (store.over.value) break
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
    store.beginDraft(FIXED_SEED)
    store.chooseSpecies(store.draftOptions.value[0]!)
    expect(store.screen.value).toBe('battle')

    // AI 的延迟回调此刻还在队列里
    store.beginDraft(FIXED_SEED)
    expect(store.screen.value).toBe('draft')
    expect(store.gameState.value).toBeNull()

    vi.runAllTimers()
    // 旧回调被 pumpToken 拦下：界面仍停在选将页，没有偷偷开出新对局
    expect(store.screen.value).toBe('draft')
    expect(store.gameState.value).toBeNull()
  })

  it('返回首页会清空对局', () => {
    store.beginDraft(FIXED_SEED)
    store.chooseSpecies(store.draftOptions.value[0]!)
    store.backToStart()
    expect(store.screen.value).toBe('start')
    expect(store.gameState.value).toBeNull()
    expect(store.human.value).toBeNull()
  })

  it('只有对手受伤时，界面提供「治疗对手」并提交成功', () => {
    const state = loadState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 3,
      aiHp: 2,
      playerHand: [{ kind: 'strike' }],
    })

    // 按钮出现（技能可用），点击后进入目标选择态而不是直接报错
    expect(store.humanSkills.value).toContain('mend')
    store.pickCard(state.players[0].hand[0]!.uid)
    store.submitActivate('mend')

    expect(store.errorMessage.value).toBeNull()
    expect(store.pendingSkillTarget.value).toBe('mend')
    expect(state.players[1].hp).toBe(2) // 还没结算

    const options = store.pendingSkillTargetOptions.value
    expect(options.map((option) => option.index)).toEqual([0, 1])
    expect(options.find((option) => option.index === 1)).toMatchObject({ selectable: true })
    // 不可选的候选带上文档里的 reason
    expect(options.find((option) => option.index === 0)).toMatchObject({
      selectable: false,
      reason: '目标角色体力已满，无法回复',
    })

    store.chooseSkillTarget(1)

    expect(store.errorMessage.value).toBeNull()
    expect(store.pendingSkillTarget.value).toBeNull()
    expect(state.players[1].hp).toBe(3)
    expect(state.players[0].hp).toBe(3)
  })

  it('双方都受伤时，界面让玩家选，可以主动治疗对手', () => {
    const state = loadState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 2,
      aiHp: 2,
      playerHand: [{ kind: 'strike' }],
    })

    store.pickCard(state.players[0].hand[0]!.uid)
    store.submitActivate('mend')
    expect(store.pendingSkillTarget.value).toBe('mend')
    expect(
      store.pendingSkillTargetOptions.value.map((option) => [option.index, option.selectable]),
    ).toEqual([
      [0, true],
      [1, true],
    ])

    store.chooseSkillTarget(1)

    expect(state.players[1].hp).toBe(3)
    expect(state.players[0].hp).toBe(2) // 没有治疗自己
  })

  it('候选为空时主动技按钮不出现，也不会进入目标选择态', () => {
    const state = loadState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
    })

    expect(store.humanSkills.value).not.toContain('mend')

    store.pickCard(state.players[0].hand[0]!.uid)
    store.submitActivate('mend')

    expect(store.pendingSkillTarget.value).toBeNull()
    expect(store.errorMessage.value).toContain('当前无法发动')
  })

  it('取消目标选择不提交，已选手牌保留', () => {
    const state = loadState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 3,
      aiHp: 2,
      playerHand: [{ kind: 'strike' }],
    })

    store.pickCard(state.players[0].hand[0]!.uid)
    store.submitActivate('mend')
    expect(store.pendingSkillTarget.value).toBe('mend')

    store.cancelSkillTarget()

    expect(store.pendingSkillTarget.value).toBeNull()
    expect(state.players[1].hp).toBe(2)
    expect(state.players[0].hand).toHaveLength(1)
    expect(store.selectedCards.value).toHaveLength(1)
  })
})
