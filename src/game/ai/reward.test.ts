import { describe, expect, it } from 'vitest'
import { makeState } from '../testUtils'
import type { Card, GameState, Prompt } from '../types'
import { aiDecide, rewardCardScore } from './index'

/**
 * AI 的奖励决策与功能牌策略。
 *
 * 这些用例只使用文档结构（分数、可选性、效果类型）驱动断言，不出现任何牌种 id 之外的
 * 内容判断；「AI 代码里不得出现牌种 id」这条约定由 dsl/guards.test.ts 机械守卫。
 */

/** 构造一个"AI 正在做服务三选一"的状态（奖励帧在栈顶，pending 指向 AI） */
function serviceState(options: Record<string, unknown> = {}): GameState {
  const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', ...options })
  state.stack.push({
    kind: 'reward',
    ask: [1],
    reward: 'service',
    allowSkip: false,
    healAmount: 3,
    removeFloor: 5,
  })
  state.pending = { kind: 'reward', player: 1, reward: 'service', allowSkip: false }
  return state
}

/** 构造一个"AI 正在升级/移除选牌"的状态 */
function pickState(purpose: 'upgrade' | 'remove', candidates: Card[]): GameState {
  const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
  state.stack.push({
    kind: 'reward',
    ask: [1],
    reward: 'service',
    allowSkip: false,
    healAmount: 3,
    removeFloor: 5,
    pendingPick: { player: 1, purpose },
  })
  state.pending = { kind: 'pick-card', player: 1, purpose, candidates }
  return state
}

describe('AI 卡牌三选一', () => {
  it('按文档结构评分取最高分', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    // 重锤（5 威胁 / 3 费）明显强于连击（2 威胁 / 1 费）
    state.pending = {
      kind: 'reward',
      player: 1,
      reward: 'card',
      cards: ['combo', 'bludgeon', 'tactics'],
      allowSkip: true,
    }
    expect(aiDecide(state)).toEqual({ kind: 'pick-reward', card: 'bludgeon' })
  })

  it('最高分低于阈值且允许跳过时选择跳过', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    // 重压是 2 费、威胁写的是非 const 表达式，评分最低，低于接受阈值
    state.pending = {
      kind: 'reward',
      player: 1,
      reward: 'card',
      cards: ['heavy-press'],
      allowSkip: true,
    }
    expect(aiDecide(state)).toEqual({ kind: 'skip-reward' })
  })

  it('不允许跳过时仍然选一张（绝不提交非法动作）', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    state.pending = {
      kind: 'reward',
      player: 1,
      reward: 'card',
      cards: ['heavy-press'],
      allowSkip: false,
    }
    expect(aiDecide(state)).toEqual({ kind: 'pick-reward', card: 'heavy-press' })
  })

  it('评分由文档结构派生：威胁越高分越高、费用越高分越低', () => {
    expect(rewardCardScore('bludgeon')).toBeGreaterThan(rewardCardScore('combo'))
    expect(rewardCardScore('combo')).toBeGreaterThan(rewardCardScore('plunder'))
    for (const kind of ['combo', 'bash', 'bludgeon', 'tactics', 'plunder']) {
      expect(Number.isFinite(rewardCardScore(kind))).toBe(true)
    }
  })
})

describe('AI 服务三选一', () => {
  it('体力低于一半时选择回复', () => {
    const state = serviceState({ aiHp: 3 })
    expect(aiDecide(state)).toEqual({ kind: 'pick-reward', service: 'heal' })
  })

  it('攻击牌占比过低时选择移除', () => {
    const state = serviceState({ aiHp: 10 })
    // 把 AI 的手牌与牌区换成清一色防御牌：攻击牌占比为 0
    state.players[1].deck = []
    state.players[1].discard = []
    state.players[1].hand = Array.from({ length: 6 }, (_, i) => ({
      uid: 200 + i,
      kind: 'defend',
    }))
    expect(aiDecide(state)).toEqual({ kind: 'pick-reward', service: 'remove' })
  })

  it('否则选择升级', () => {
    const state = serviceState({ aiHp: 10 })
    expect(aiDecide(state)).toEqual({ kind: 'pick-reward', service: 'upgrade' })
  })
})

describe('AI 升级 / 移除选牌', () => {
  it('升级优先挑攻击牌', () => {
    const state = pickState('upgrade', [
      { uid: 1, kind: 'defend' },
      { uid: 2, kind: 'strike' },
    ])
    expect(aiDecide(state)).toEqual({ kind: 'pick-own-card', card: { uid: 2, kind: 'strike' } })
  })

  it('移除挑最不值得留的一张（沿用弃牌优先级）', () => {
    const state = pickState('remove', [
      { uid: 1, kind: 'defend' },
      { uid: 2, kind: 'strike' },
    ])
    expect(aiDecide(state)).toEqual({ kind: 'pick-own-card', card: { uid: 2, kind: 'strike' } })
  })
})

describe('AI 功能牌策略', () => {
  /** 直接给某方发一手指定的牌（新卡不在任何牌组里，不能走 makeState 的取牌路径） */
  function setHand(state: GameState, p: 0 | 1, kinds: string[]): Card[] {
    const cards = kinds.map((kind) => ({ uid: state.nextUid++, kind }))
    state.players[p].hand = cards
    return cards
  }

  function playWith(hand: string[], extra: Record<string, unknown> = {}) {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      ...extra,
    })
    setHand(state, 0, hand)
    return aiDecide(state)
  }

  it('手牌少时使用抽牌类牌面', () => {
    expect(playWith(['tactics'])).toMatchObject({ kind: 'use-card', as: 'tactics' })
  })

  it('对手手牌多时使用弃牌类牌面', () => {
    const action = playWith(['plunder'], {
      aiHand: [{ kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }],
    })
    expect(action).toMatchObject({ kind: 'use-card', as: 'plunder' })
  })

  it('有额外阶段牌时使用它', () => {
    expect(playWith(['sprint'])).toMatchObject({ kind: 'use-card', as: 'sprint' })
  })

  it('不具备条件时不硬打功能牌：手牌多时不用抽牌牌面，对手没手牌时不用弃牌牌面', () => {
    // 手牌 4 > 3：不走抽牌分支；进攻分支接手
    const action = playWith(['tactics', 'strike', 'strike', 'strike'])
    expect(action.kind === 'use-card' ? action.as : undefined).not.toBe('tactics')

    // 对手没有手牌，掠夺不合法（requires 不满足），AI 不会提交它
    const plunderAction = playWith(['plunder'])
    expect(plunderAction.kind === 'use-card' ? plunderAction.as : undefined).not.toBe('plunder')
  })
})

describe('AI 覆盖全部待输入项', () => {
  it('reward / pick-card 两类新待输入项都能给出动作', () => {
    const reward = serviceState({ aiHp: 3 })
    const pick = pickState('upgrade', [{ uid: 1, kind: 'strike' }])
    for (const state of [reward, pick]) {
      const action = aiDecide(state)
      expect(action).toBeDefined()
    }
  })
})

/** 让 Prompt 类型参与编译期检查：新增变体时这里会提醒补用例 */
export type _PromptCovered = Prompt['kind']
