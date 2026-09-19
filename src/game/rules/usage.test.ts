import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { makeState } from '../testUtils'
import { cardIds } from '../dsl/registry'
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
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    // 记录表按当前牌种派生（新增牌种自动计入，不需要改这里）
    expect(newCardUseRecord()).toEqual(
      Object.fromEntries(cardIds().map((id) => [id, 0])),
    )

    recordCardUse(state, 0, 'strike')
    recordCardUse(state, 0, 'heal')

    expect(cardUseCount(state, 0, 'strike')).toBe(1)
    expect(cardUseCount(state, 0, 'heal')).toBe(1)
    expect(cardUseCount(state, 0, 'defend')).toBe(0)
    expect(cardUseCount(state, 1, 'strike')).toBe(0)
  })

  it('转化牌按「当作的牌名」计数', () => {
    const state = makeState({
      playerSpecies: 'morph',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
    })

    submit(state, {
      kind: 'use-card',
      card: state.players[0].hand[0]!,
      as: 'strike',
      via: 'convert',
    })

    // 记在【打击】名下，而【防御】的次数不变
    expect(cardUseCount(state, 0, 'strike')).toBe(1)
    expect(cardUseCount(state, 0, 'defend')).toBe(0)
    expect(state.players[1].threat).toBe(1)
  })

  it('「每回合限一次」的技能有独立记录，重复记录不产生重复项', () => {
    const state = makeState({ playerSpecies: 'counter', aiSpecies: 'defensive' })

    expect(skillUsed(state, 0, 'assault')).toBe(false)
    recordSkillUse(state, 0, 'assault')
    recordSkillUse(state, 0, 'assault')

    expect(skillUsed(state, 0, 'assault')).toBe(true)
    expect(state.players[0].usedSkillsThisTurn).toEqual(['assault'])
  })

  it('回合开始时清空使用记录', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    recordCardUse(state, 0, 'strike')
    recordSkillUse(state, 0, 'assault')

    resetTurnUsage(state, 0)

    expect(cardUseCount(state, 0, 'strike')).toBe(0)
    expect(skillUsed(state, 0, 'assault')).toBe(false)
  })
})
