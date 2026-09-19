import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { syntheticHealingRegistry } from '../dsl/fixtures'
import { withRegistry } from '../dsl/registry'
import { injectHand, makeState } from '../testUtils'
import { assertConservation } from './cardZones'
import { dealDamage, loseHp } from './damage'

/**
 * 濒死结算：救援机制**已禁用**（`rules/dying.ts` 的 `DYING_RESCUE_ENABLED = false`）。
 *
 * 体力归零进入濒死后不再询问任何角色，`engine/stack.ts` 直接把 `dying` 帧走成死亡结算。
 * 因此即便注册表里存在 `dying` 语境的自救牌（测试合成的 `test-mend`），也不会产生
 * 濒死待输入项、更不会被打出。救援链路（`dying` 语境 + `resolve-dying`）仍留在代码里，
 * 把开关改回 `true` 即可恢复。
 */
describe('濒死结算（救援已禁用：濒死即阵亡）', () => {
  it('进入濒死直接阵亡，不产生濒死待输入项', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      aiHp: 1,
    })

    dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
    advance(state)

    expect(state.pending).toBeNull()
    expect(state.players[1].alive).toBe(false)
    expect(state.result).toEqual({ winner: 0 })
    expect(state.phase).toBe('game-over')
    expect(state.log.map((e) => e.text).join()).toContain('进入濒死状态')
    assertConservation(state)
  })

  it('即使注册表里有合成自救牌，也不会询问或使用它', () => {
    withRegistry(syntheticHealingRegistry(), () => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        aiHp: 1,
      })
      const [mend] = injectHand(state, 1, 'test-mend')

      dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
      advance(state)

      expect(state.pending).toBeNull()
      expect(state.players[1].alive).toBe(false)
      expect(state.result).toEqual({ winner: 0 })
      // 自救牌没有被使用，随阵亡一并进弃牌堆
      expect(state.players[1].discard.map((c) => c.uid)).toContain(mend!.uid)
      assertConservation(state)
    })
  })

  it('「失去体力」降到 0 及以下同样直接阵亡', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      aiHp: 1,
    })

    loseHp(state, 1, 2)
    advance(state)

    expect(state.players[1].hp).toBe(-1)
    expect(state.players[1].alive).toBe(false)
    expect(state.result).toEqual({ winner: 0 })
    assertConservation(state)
  })

  it('终局后任何动作都被拒绝', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      aiHp: 1,
    })

    dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
    advance(state)

    expect(() => submit(state, { kind: 'cancel' })).toThrow('对局已经结束')
    assertConservation(state)
  })
})
