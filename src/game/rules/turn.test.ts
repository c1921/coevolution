import { describe, expect, it } from 'vitest'
import { assertConservation } from './cardZones'
import { advance, submit } from '../engine'
import { makeState, logTexts } from '../testUtils'
import {
  advanceTurn,
  DRAW_PER_TURN,
  FIRST_TURN_DRAW,
  attritionLoss,
  ATTRITION_TURN,
} from './turn'

describe('回合流程', () => {
  it('摸牌阶段摸 2 张', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      phase: 'draw',
      playerHand: [{ kind: 'heal' }],
    })
    state.turn = 2

    expect(advanceTurn(state)).toBe('pending')
    expect(state.players[0].hand).toHaveLength(1 + DRAW_PER_TURN)
    expect(state.phase).toBe('play')
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('先手玩家第一回合少摸一张', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', phase: 'draw' })
    state.turn = 1
    state.active = 0
    state.firstPlayer = 0

    advanceTurn(state)
    expect(state.players[0].hand).toHaveLength(FIRST_TURN_DRAW)
  })

  it('后手玩家在自己第一回合正常摸 2 张', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      phase: 'draw',
      active: 1,
    })
    state.turn = 2
    state.active = 1
    state.firstPlayer = 0

    advanceTurn(state)
    expect(state.players[1].hand).toHaveLength(DRAW_PER_TURN)
  })

  it('回合开始时清零回合内标记', () => {
    const state = makeState({ playerSpecies: 'bear', aiSpecies: 'tiger', phase: 'turn-start' })
    state.players[0].strikesUsedThisTurn = 3
    state.players[0].mendUsedThisTurn = true

    advanceTurn(state)
    expect(state.players[0].strikesUsedThisTurn).toBe(0)
    expect(state.players[0].mendUsedThisTurn).toBe(false)
  })

  it('弃牌阶段：手牌上限等于当前体力值', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      phase: 'discard',
      playerHp: 3,
      playerHand: [
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
      ],
    })

    expect(advanceTurn(state)).toBe('pending')
    expect(state.pending).toEqual({ kind: 'discard', player: 0, count: 2 })
  })

  it('手牌数不超过体力值时无需弃牌，直接进入下一回合', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      phase: 'discard',
      playerHp: 3,
      playerHand: [{ kind: 'strike' }],
    })

    advanceTurn(state)
    expect(state.pending).toEqual({ kind: 'play', player: 1 })
    expect(state.active).toBe(1)
    expect(state.turn).toBe(2)
  })

  it('牌堆耗尽时把弃牌堆洗回牌堆', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      phase: 'draw',
      playerHand: [{ kind: 'heal' }],
    })
    state.turn = 2
    const deckSize = state.deck.length
    state.discard = state.deck
    state.deck = []

    advanceTurn(state)

    expect(state.players[0].hand).toHaveLength(3)
    expect(state.discard).toHaveLength(0)
    expect(state.deck).toHaveLength(deckSize - DRAW_PER_TURN)
    expect(logTexts(state)).toContain('洗回牌堆')
    assertConservation(state)
  })

  it('牌堆与弃牌堆同时耗尽时跳过摸牌并记录日志', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      phase: 'draw',
      playerHand: [{ kind: 'heal' }],
    })
    state.turn = 2
    // 把牌堆的牌全部挪到 AI 手里，制造"牌堆与弃牌堆同时为空"的极端情况（牌数依旧守恒）
    state.players[1].hand.push(...state.deck)
    state.discard = []
    state.deck = []

    advanceTurn(state)

    expect(state.players[0].hand).toHaveLength(1)
    expect(logTexts(state)).toContain('均已耗尽')
    expect(state.phase).toBe('play')
    assertConservation(state)
  })

  it('回合切换会交换行动方并递增回合数', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', phase: 'turn-end' })
    advanceTurn(state)
    expect(state.active).toBe(1)
    expect(state.turn).toBe(2)
    assertConservation(state)
  })

  it('advance 在终局后不再推进', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    state.result = { winner: 0 }
    advance(state)
    expect(state.pending).toBeNull()
    expect(state.result).toEqual({ winner: 0 })
  })
})

describe('消耗战（终止规则）', () => {
  it('体力流失量随回合递增，消耗战前为 0', () => {
    expect(attritionLoss(1)).toBe(0)
    expect(attritionLoss(ATTRITION_TURN - 1)).toBe(0)
    expect(attritionLoss(ATTRITION_TURN)).toBe(1)
    expect(attritionLoss(ATTRITION_TURN + 4)).toBe(1)
    expect(attritionLoss(ATTRITION_TURN + 5)).toBe(2)
    expect(attritionLoss(ATTRITION_TURN + 10)).toBe(3)
  })

  it('消耗战回合开始时回合角色失去体力，并进入濒死结算', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', phase: 'turn-start' })
    state.turn = ATTRITION_TURN
    state.active = 0
    state.players[0].hp = 1

    expect(advanceTurn(state)).toBe('continue')
    expect(state.players[0].hp).toBe(0)
    expect(state.stack[0]).toMatchObject({ kind: 'dying', dying: 0 })
    expect(logTexts(state)).toContain('消耗战开始')

    // 无人救援 → 死亡 → 终局
    advance(state)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 0 })
  })

  it('消耗战濒死被救活后，同一回合不会重复扣体力', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      phase: 'turn-start',
      playerHp: 1,
      playerHand: [{ kind: 'heal' }],
    })
    state.turn = ATTRITION_TURN
    state.active = 0

    advance(state)
    expect(state.players[0].hp).toBe(0)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 0 })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'heal' })

    expect(state.players[0].hp).toBe(1)
    expect(state.phase).toBe('play')
    // 消耗战扣体力只发生了一次
    const losses = state.log.filter((e) => e.text.startsWith('消耗战：'))
    expect(losses).toHaveLength(1)
    assertConservation(state)
  })
})
