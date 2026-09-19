import { describe, expect, it } from 'vitest'
import { applyTimingRules } from '../dsl/event'
import { assertConservation } from './cardZones'
import { energyMax } from './energy'
import { advance, submit } from '../engine'
import { makeState, logTexts } from '../testUtils'
import {
  advanceTurn,
  DRAW_PER_TURN,
  FIRST_TURN_DRAW,
  attritionLoss,
  ATTRITION_TURN,
  ATTRITION_STEP,
  discardCount,
  drawCount,
  handLimit,
} from './turn'
import { cardUseCount, recordCardUse, recordSkillUse, skillUsed } from './usage'

describe('回合流程', () => {
  it('摸牌阶段摸 2 张', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
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
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive', phase: 'draw' })
    state.turn = 1
    state.active = 0
    state.firstPlayer = 0

    advanceTurn(state)
    expect(state.players[0].hand).toHaveLength(FIRST_TURN_DRAW)
  })

  it('后手玩家在自己第一回合正常摸 2 张', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'draw',
      active: 1,
    })
    state.turn = 2
    state.active = 1
    state.firstPlayer = 0

    advanceTurn(state)
    expect(state.players[1].hand).toHaveLength(DRAW_PER_TURN)
  })

  it('回合开始时清零使用记录并把能量回满', () => {
    const state = makeState({
      playerSpecies: 'defensive',
      aiSpecies: 'offensive',
      phase: 'turn-start',
      playerEnergy: 1,
    })
    recordCardUse(state, 0, 'strike')
    recordCardUse(state, 0, 'strike')
    recordSkillUse(state, 0, 'assault')
    expect(cardUseCount(state, 0, 'strike')).toBe(2)
    expect(skillUsed(state, 0, 'assault')).toBe(true)

    advanceTurn(state)

    expect(cardUseCount(state, 0, 'strike')).toBe(0)
    expect(cardUseCount(state, 0, 'defend')).toBe(0)
    expect(skillUsed(state, 0, 'assault')).toBe(false)
    // 防御型的能量上限是 3 + 2
    expect(state.players[0].energy).toBe(energyMax(state, 0))
  })

  it('弃牌阶段：手牌上限等于当前体力值', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
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
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'discard',
      playerHp: 3,
      playerHand: [{ kind: 'strike' }],
    })

    advanceTurn(state)
    expect(state.pending).toEqual({ kind: 'play', player: 1 })
    expect(state.active).toBe(1)
    expect(state.turn).toBe(2)
  })

  it('牌组耗尽时把自己的弃牌堆洗回自己的牌组', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'draw',
      playerHand: [{ kind: 'heal' }],
    })
    state.turn = 2
    const player = state.players[0]
    const aiDeckBefore = state.players[1].deck.length
    const deckSize = player.deck.length
    player.discard = player.deck
    player.deck = []

    advanceTurn(state)

    expect(player.hand).toHaveLength(3)
    expect(player.discard).toHaveLength(0)
    expect(player.deck).toHaveLength(deckSize - DRAW_PER_TURN)
    // 私有牌组互不干扰：对手的牌组一张没动
    expect(state.players[1].deck).toHaveLength(aiDeckBefore)
    expect(logTexts(state)).toContain('洗回牌堆')
    assertConservation(state)
  })

  it('牌组与弃牌堆同时耗尽时跳过摸牌并记录日志', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'draw',
      playerHand: [{ kind: 'heal' }],
    })
    state.turn = 2
    const player = state.players[0]
    // 把玩家自己的牌组全部挪到对手手里，制造"牌组与弃牌堆同时为空"的极端情况（全局牌数依旧守恒）
    state.players[1].hand.push(...player.deck)
    player.discard = []
    player.deck = []

    advanceTurn(state)

    expect(player.hand).toHaveLength(1)
    expect(logTexts(state)).toContain('均已耗尽')
    expect(state.phase).toBe('play')
    assertConservation(state)
  })

  it('回合切换会交换行动方并递增回合数', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'turn-end',
    })
    advanceTurn(state)
    expect(state.active).toBe(1)
    expect(state.turn).toBe(2)
    assertConservation(state)
  })

  it('advance 在终局后不再推进', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    state.result = { winner: 0 }
    advance(state)
    expect(state.pending).toBeNull()
    expect(state.result).toEqual({ winner: 0 })
  })

  it('回合开始时若回合角色已阵亡，则兜底判定对手获胜', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'turn-start',
    })
    state.players[0].alive = false

    expect(advanceTurn(state)).toBe('over')
    expect(state.result).toEqual({ winner: 1 })
    expect(state.phase).toBe('game-over')
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
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'turn-start',
    })
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
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
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

describe('规范额度', () => {
  it('摸牌数：默认 2 张，先手角色的第一回合为 1 张', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    state.firstPlayer = 0
    state.active = 0
    state.turn = 1
    expect(drawCount(state, 0)).toBe(FIRST_TURN_DRAW)
    expect(drawCount(state, 1)).toBe(DRAW_PER_TURN)

    state.turn = 2
    expect(drawCount(state, 0)).toBe(DRAW_PER_TURN)

    state.active = 1
    expect(drawCount(state, 1)).toBe(DRAW_PER_TURN)
  })

  it('手牌上限等于当前体力值，弃牌数是超出的部分', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHp: 3,
      playerHand: [
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
      ],
    })

    expect(handLimit(state, 0)).toBe(3)
    expect(discardCount(state, 0)).toBe(2)

    state.players[0].hp = -1
    expect(handLimit(state, 0)).toBe(0)
  })

  it('消耗战挂在「回合开始时」时机：先失去体力，再进行摸牌阶段', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'turn-start',
    })
    state.turn = ATTRITION_TURN

    advance(state)

    const texts = state.log.map((e) => e.text)
    const attritionAt = texts.findIndex((t) => t.startsWith('消耗战：'))
    const drawAt = texts.findIndex((t) => t.includes('摸了'))
    expect(attritionAt).toBeGreaterThanOrEqual(0)
    expect(drawAt).toBeGreaterThan(attritionAt)
    expect(state.players[0].hp).toBe(3)
    assertConservation(state)
  })

  it('消耗战的行为数值与 rules/attrition.json 一致', () => {
    // 常量只用于界面提示与断言，真正的行为在 DSL 规则文档里；这里把两者钉在一起
    for (const turn of [ATTRITION_TURN, ATTRITION_TURN + ATTRITION_STEP, ATTRITION_TURN + 11]) {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        phase: 'turn-start',
      })
      state.turn = turn
      state.active = 0
      applyTimingRules(state, { at: 'turn-start' })
      expect(state.players[0].maxHp - state.players[0].hp).toBe(attritionLoss(turn))
    }

    // 消耗战之前不扣体力
    const early = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'turn-start',
    })
    early.turn = ATTRITION_TURN - 1
    applyTimingRules(early, { at: 'turn-start' })
    expect(early.players[early.active].hp).toBe(early.players[early.active].maxHp)
  })
})
