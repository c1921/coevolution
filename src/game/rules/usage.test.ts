import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { makeState } from '../testUtils'
import {
  cardUseCount,
  newCardUseRecord,
  recordCardUse,
  recordSkillUse,
  resetTurnUsage,
  skillUsed,
} from './usage'

describe('使用次数记录', () => {
  it('按角色、按牌名分别计数', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    expect(newCardUseRecord()).toEqual({ strike: 0, defend: 0, heal: 0 })

    recordCardUse(state, 0, 'strike')
    recordCardUse(state, 0, 'heal')

    expect(cardUseCount(state, 0, 'strike')).toBe(1)
    expect(cardUseCount(state, 0, 'heal')).toBe(1)
    expect(cardUseCount(state, 0, 'defend')).toBe(0)
    expect(cardUseCount(state, 1, 'strike')).toBe(0)
  })

  it('转化牌按「当作的牌名」计数', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend', suit: 'heart' }],
    })

    submit(state, {
      kind: 'use-card',
      card: state.players[0].hand[0]!,
      as: 'strike',
      via: 'pounce',
    })
    submit(state, { kind: 'cancel' })

    // 用掉的是【打击】本回合的那一次，而【防御】的次数不变
    expect(cardUseCount(state, 0, 'strike')).toBe(1)
    expect(cardUseCount(state, 0, 'defend')).toBe(0)
  })

  it('「每回合限一次」的技能有独立记录，重复记录不产生重复项', () => {
    const state = makeState({ playerSpecies: 'deer', aiSpecies: 'bear' })

    expect(skillUsed(state, 0, 'mend')).toBe(false)
    recordSkillUse(state, 0, 'mend')
    recordSkillUse(state, 0, 'mend')

    expect(skillUsed(state, 0, 'mend')).toBe(true)
    expect(state.players[0].usedSkillsThisTurn).toEqual(['mend'])
  })

  it('回合开始时清空使用记录', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    recordCardUse(state, 0, 'strike')
    recordSkillUse(state, 0, 'mend')

    resetTurnUsage(state, 0)

    expect(cardUseCount(state, 0, 'strike')).toBe(0)
    expect(skillUsed(state, 0, 'mend')).toBe(false)
  })
})
