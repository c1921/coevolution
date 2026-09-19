import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { makeState } from '../testUtils'
import { assertConservation } from './cardZones'
import { dealDamage, loseHp } from './damage'

/**
 * 伤害帧原语：内容层已经不再直接造成伤害（唯一途径是威胁结算，见 threat.test.ts），
 * 但「扣减体力 → 受到伤害后技能 → 濒死检查」这条结算链仍由 dealDamage 提供。
 */
describe('伤害结算', () => {
  it('造成伤害会扣减体力并写入战报', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
    advance(state)

    expect(state.players[1].hp).toBe(9)
    expect(state.lastDamage).toMatchObject({ source: 0, target: 1, amount: 1 })
    expect(state.log.map((e) => e.text).join()).toContain('受到 1 点伤害')
    assertConservation(state)
  })

  it('时机顺序：扣减体力 → 受到伤害后技能 → 濒死检查', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'counter',
      aiHp: 1,
    })

    dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
    advance(state)

    // 先询问反击型的【反击】，此时体力已经扣到 0
    expect(state.players[1].hp).toBe(0)
    expect(state.pending).toMatchObject({ kind: 'trigger', player: 1, skill: 'riposte' })

    submit(state, { kind: 'trigger-choice', accept: true })

    // 触发结算完才进入濒死
    expect(state.players[1].threat).toBe(0)
    expect(state.players[0].threat).toBe(1)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })
    assertConservation(state)
  })

  it('「失去体力」不触发受到伤害后技能，也不压入伤害帧', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'counter' })

    loseHp(state, 1, 1)

    expect(state.players[1].hp).toBe(9)
    expect(state.stack).toHaveLength(0)
    expect(state.log.map((e) => e.text).join()).toContain('失去 1 点体力')
  })

  it('「失去体力」降到 0 及以下同样进入濒死', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'counter', aiHp: 1 })

    loseHp(state, 1, 2)
    advance(state)

    expect(state.players[1].hp).toBe(-1)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })
    assertConservation(state)
  })
})
