import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiDecide } from '../game/ai'
import { advance, isOver } from '../game/engine'
import { contentWith } from '../game/dsl/fixtures'
import { withRegistry } from '../game/dsl/registry'
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

    // 非法用法不会出现：威胁为 0 时【防御】没有任何合法用法
    const defend = state.players[0].hand.find((c) => c.kind === 'defend')
    if (defend) {
      expect(store.legalOptions(defend)).toHaveLength(0)
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
    const state = loadState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
    })
    const before = JSON.stringify(state.players.map((p) => p.hp))

    // 没有威胁时使用【防御】：文档给出的 reason 直接显示在界面上
    store.act({ kind: 'use-card', card: state.players[0].hand[0]! })

    expect(store.errorMessage.value).toContain('没有需要抵消的威胁')
    expect(JSON.stringify(state.players.map((p) => p.hp))).toBe(before)
  })

  it('弃牌阶段：选够张数才能确认', () => {
    const state = loadState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHp: 2,
      phase: 'discard',
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }],
    })
    // 手牌上限 = 当前体力 = 2 → 需要弃 2 张
    advance(state)
    expect(store.humanPending.value).toMatchObject({ kind: 'discard', count: 2 })

    // 选不满时拒绝提交
    store.submitDiscard()
    expect(store.errorMessage.value).toContain('需要弃置')

    const hand = state.players[0].hand
    for (const card of hand.slice(0, 2)) store.pickCard(card.uid)
    expect(store.selectedCards.value).toHaveLength(2)

    store.submitDiscard()
    expect(store.errorMessage.value).toBeNull()
    expect(state.players[0].hand).toHaveLength(2)
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

  /**
   * 内置主动技只剩【强袭】（目标固定是对手，不需要选择），
   * 因此用一份合成技能验证界面层的「主动技选目标」链路。
   */
  function registryWithHeal() {
    return contentWith([
      {
        path: 'skills/restore.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'restore',
          name: '复原',
          text: '出牌阶段：弃一张手牌，令一名已受伤的角色回复 1 点体力。',
          activate: {
            timing: 'play',
            costCards: { count: { kind: 'const', value: 1 } },
            target: {
              scope: 'any',
              required: false,
              default: 'self',
              alive: true,
              conditions: [
                {
                  kind: 'compare',
                  op: 'lt',
                  left: { kind: 'ref', ref: 'hp', of: 'target' },
                  right: { kind: 'ref', ref: 'maxHp', of: 'target' },
                  reason: '目标角色体力已满，无法回复',
                },
              ],
            },
            effects: [
              {
                kind: 'move-cards',
                from: { zone: 'hand', of: 'self' },
                to: { zone: 'discard', of: 'self' },
                pick: { mode: 'cost' },
              },
              { kind: 'heal', target: 'target', amount: { kind: 'const', value: 1 } },
            ],
          },
        },
      },
      {
        path: 'species/probe.json',
        value: {
          dslVersion: 1,
          kind: 'species',
          id: 'probe',
          priority: 50,
          name: '试验型',
          maxHp: 4,
          skills: ['restore'],
          deck: 'basic',
        },
      },
    ])
  }

  it('只有对手受伤时，界面提供「治疗对手」并提交成功', () => {
    withRegistry(registryWithHeal(), () => {
      const state = loadState({
        playerSpecies: 'probe',
        aiSpecies: 'defensive',
        playerHp: 4,
        aiHp: 2,
        playerHand: [{ kind: 'strike' }],
      })

      // 按钮出现（技能可用），点击后进入目标选择态而不是直接报错
      expect(store.humanSkills.value).toContain('restore')
      store.pickCard(state.players[0].hand[0]!.uid)
      store.submitActivate('restore')

      expect(store.errorMessage.value).toBeNull()
      expect(store.pendingTarget.value).toMatchObject({ kind: 'skill', skill: 'restore' })
      expect(state.players[1].hp).toBe(2) // 还没结算

      const options = store.pendingTargetOptions.value
      expect(options.map((option) => option.index)).toEqual([0, 1])
      expect(options.find((option) => option.index === 1)).toMatchObject({ selectable: true })
      // 不可选的候选带上文档里的 reason
      expect(options.find((option) => option.index === 0)).toMatchObject({
        selectable: false,
        reason: '目标角色体力已满，无法回复',
      })

      store.chooseTarget(1)

      expect(store.errorMessage.value).toBeNull()
      expect(store.pendingTarget.value).toBeNull()
      expect(state.players[1].hp).toBe(3)
      expect(state.players[0].hp).toBe(4)
    })
  })

  it('候选为空时主动技按钮不出现，也不会进入目标选择态', () => {
    withRegistry(registryWithHeal(), () => {
      const state = loadState({
        playerSpecies: 'probe',
        aiSpecies: 'defensive',
        playerHand: [{ kind: 'strike' }],
      })

      expect(store.humanSkills.value).not.toContain('restore')

      store.pickCard(state.players[0].hand[0]!.uid)
      store.submitActivate('restore')

      expect(store.pendingTarget.value).toBeNull()
      expect(store.errorMessage.value).toContain('当前无法发动')
    })
  })

  it('取消目标选择不提交，已选手牌保留', () => {
    withRegistry(registryWithHeal(), () => {
      const state = loadState({
        playerSpecies: 'probe',
        aiSpecies: 'defensive',
        playerHp: 4,
        aiHp: 2,
        playerHand: [{ kind: 'strike' }],
      })

      store.pickCard(state.players[0].hand[0]!.uid)
      store.submitActivate('restore')
      expect(store.pendingTarget.value).toMatchObject({ kind: 'skill', skill: 'restore' })

      store.cancelTarget()

      expect(store.pendingTarget.value).toBeNull()
      expect(state.players[1].hp).toBe(2)
      expect(state.players[0].hand).toHaveLength(1)
      expect(store.selectedCards.value).toHaveLength(1)
    })
  })

  it('使用卡牌需要选目标时先进入选择态，选中后才结算', () => {
    const state = loadState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHp: 2,
      aiHp: 2,
      playerHand: [{ kind: 'first-aid' }],
    })
    const card = state.players[0].hand[0]!
    const option = store.legalOptions(card).find((o) => o.as === 'first-aid')!

    store.pickCard(card.uid)
    store.submitOption(card, option)

    expect(store.errorMessage.value).toBeNull()
    expect(store.pendingTarget.value).toMatchObject({ kind: 'card', as: 'first-aid' })
    expect(state.players[1].hp).toBe(2) // 还没结算
    expect(store.pendingTargetOptions.value.map((o) => [o.index, o.selectable])).toEqual([
      [0, true],
      [1, true],
    ])

    // 取消不提交
    store.cancelTarget()
    expect(store.pendingTarget.value).toBeNull()
    expect(state.players[1].hp).toBe(2)

    // 重新进入并治疗对手
    store.submitOption(card, option)
    store.chooseTarget(1)
    expect(store.pendingTarget.value).toBeNull()
    expect(state.players[1].hp).toBe(3)
  })

  it('多目标牌必须选够个数才能确认（合成 exactly=2 的牌）', () => {
    const synthetic = contentWith([
      {
        path: 'cards/dual.json',
        value: {
          dslVersion: 1,
          kind: 'card',
          id: 'dual',
          name: '双震',
          short: '令两名角色各获得 1 点威胁',
          text: '消耗 1 点能量：选择两名角色，各获得 1 点威胁。',
          cost: { kind: 'const', value: 1 },
          use: [
            {
              context: 'play',
              target: {
                scope: 'any',
                alive: true,
                count: { mode: 'exactly', count: { kind: 'const', value: 2 } },
              },
              effects: [
                {
                  kind: 'move-cards',
                  from: { zone: 'hand', of: 'self' },
                  to: { zone: 'discard', of: 'self' },
                  pick: { mode: 'played' },
                },
                {
                  kind: 'for-each-target',
                  effects: [
                    { kind: 'threat', target: 'target', amount: { kind: 'const', value: 1 } },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        path: 'decks/aggressive.json',
        value: {
          dslVersion: 1,
          kind: 'deck',
          id: 'aggressive',
          priority: 20,
          cards: [
            { kind: 'strike', count: 10 },
            { kind: 'defend', count: 5 },
            { kind: 'heal', count: 2 },
            { kind: 'first-aid', count: 1 },
            { kind: 'storm', count: 1 },
            { kind: 'dual', count: 1 },
          ],
        },
      },
    ])

    withRegistry(synthetic, () => {
      const state = loadState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        playerHp: 4,
        aiHp: 4,
        playerHand: [{ kind: 'dual' }],
      })
      const card = state.players[0].hand[0]!
      const option = store.legalOptions(card).find((o) => o.as === 'dual')!
      expect(option, '多目标牌必须出现在可用牌面里').toBeDefined()

      store.pickCard(card.uid)
      store.submitOption(card, option)

      expect(store.pendingTargetChoice.value).toMatchObject({ multi: true, size: 2 })
      expect(store.targetsReady.value).toBe(false)
      expect(store.pendingTargetOptions.value.map((o) => o.index)).toEqual([0, 1])

      store.chooseTarget(0)
      expect(store.chosenTargets.value).toEqual([0])
      expect(store.targetsReady.value).toBe(false)

      // 数量不够时确认会被拦下
      store.confirmTargets()
      expect(store.errorMessage.value).toContain('需要选择 2 个目标')
      expect(state.players[0].threat).toBe(0)

      store.chooseTarget(1)
      expect(store.targetsReady.value).toBe(true)
      store.confirmTargets()

      expect(store.pendingTarget.value).toBeNull()
      expect(state.players[0].threat).toBe(1)
      expect(state.players[1].threat).toBe(1)
    })
  })
})
