import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { syntheticHealingRegistry } from '../dsl/fixtures'
import { withRegistry } from '../dsl/registry'
import { injectHand, makeState } from '../testUtils'
import { assertConservation } from './cardZones'
import { dealDamage } from './damage'

/**
 * 濒死结算。
 *
 * 内置内容**已删除全部回血牌**，因此没有任何牌声明 `dying` 语境：濒死询问走完
 * 「濒死者 → 对手」后必然阵亡。引擎仍然支持「濒死自救 / 救援」这条链路，为了不丢
 * 覆盖，下面的机制用 `fixtures.ts` 注入的**合成自救牌**（`test-mend`）验证——
 * 它只存在于测试注册表里，不会回到内置内容中。
 */

/** 在「注入合成自救牌」的注册表下执行 */
function withDyingCard<T>(fn: () => T): T {
  return withRegistry(syntheticHealingRegistry(), fn)
}

describe('濒死结算（内置内容：无自救牌，濒死即阵亡）', () => {
  it('内置内容没有任何自救牌：双方放弃后阵亡', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      aiHp: 1,
    })

    dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
    advance(state)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })

    submit(state, { kind: 'cancel' })
    // 轮到对手（玩家）决定是否救援：同样没有牌可救
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 1 })

    submit(state, { kind: 'cancel' })
    expect(state.players[1].alive).toBe(false)
    expect(state.result).toEqual({ winner: 0 })
    assertConservation(state)
  })

  it('濒死结算中不能使用【打击】：当前没有自救牌，报错只提自救牌', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }],
      aiHp: 1,
    })

    dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
    advance(state)
    submit(state, { kind: 'cancel' })
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 1 })

    expect(() => submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })).toThrow(
      '濒死结算中只能使用自救牌',
    )
    assertConservation(state)
  })
})

describe('濒死结算（合成自救牌：救援链路仍然有效）', () => {
  it('濒死时使用合成自救牌自救成功', () => {
    withDyingCard(() => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        aiHp: 1,
      })
      const [mend] = injectHand(state, 1, 'test-mend')

      dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
      advance(state)
      expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })

      submit(state, { kind: 'use-card', card: mend! })

      expect(state.players[1].hp).toBe(1)
      expect(state.players[1].alive).toBe(true)
      expect(state.result).toBeNull()
      expect(state.pending).toEqual({ kind: 'play', player: 0 })
      assertConservation(state)
    })
  })

  it('体力为负时需要连续使用两张自救牌才能脱离濒死', () => {
    withDyingCard(() => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        aiHp: 2,
      })
      const mends = injectHand(state, 1, 'test-mend', 2)

      dealDamage(state, { source: 0, target: 1, amount: 3, card: null })
      advance(state)

      expect(state.players[1].hp).toBe(-1)
      expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })

      submit(state, { kind: 'use-card', card: mends[0]! })
      expect(state.players[1].hp).toBe(0)
      // 仍未脱离濒死，同一角色继续被询问
      expect(state.pending).toMatchObject({ kind: 'dying', player: 1 })

      submit(state, { kind: 'use-card', card: mends[1]! })
      expect(state.players[1].hp).toBe(1)
      expect(state.pending).toEqual({ kind: 'play', player: 0 })
      expect(state.players[1].alive).toBe(true)
      assertConservation(state)
    })
  })

  it('救援不受「仅自己 / 已受伤 / 出牌阶段」限制，可以救对手', () => {
    withDyingCard(() => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        aiHp: 1,
      })
      const [mend] = injectHand(state, 0, 'test-mend')

      dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
      advance(state)
      submit(state, { kind: 'cancel' })
      expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 1 })

      submit(state, { kind: 'use-card', card: mend! })

      expect(state.players[1].hp).toBe(1)
      expect(state.players[1].alive).toBe(true)
      expect(state.pending).toEqual({ kind: 'play', player: 0 })
      assertConservation(state)
    })
  })

  it('能量不足时无法自救，只能放弃并阵亡', () => {
    withDyingCard(() => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        active: 1,
        playerHp: 1,
        // 差 1 点就付不起合成自救牌的 2 点能量
        playerEnergy: 1,
      })
      const [mend] = injectHand(state, 0, 'test-mend')

      dealDamage(state, { source: 1, target: 0, amount: 1, card: null })
      advance(state)
      expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 0 })

      expect(() => submit(state, { kind: 'use-card', card: mend! })).toThrow('能量不足')

      submit(state, { kind: 'cancel' }) // 自己放弃
      submit(state, { kind: 'cancel' }) // 对手也不救
      expect(state.players[0].alive).toBe(false)
      expect(state.result).toEqual({ winner: 1 })
      assertConservation(state)
    })
  })

  it('能量不足时无法救援对手', () => {
    withDyingCard(() => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        playerEnergy: 0,
        aiHp: 1,
      })
      const [mend] = injectHand(state, 0, 'test-mend')

      dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
      advance(state)
      expect(state.pending).toMatchObject({ kind: 'dying', player: 1, dying: 1 })

      submit(state, { kind: 'cancel' })
      expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 1 })

      expect(() => submit(state, { kind: 'use-card', card: mend! })).toThrow('能量不足')

      submit(state, { kind: 'cancel' })
      expect(state.players[1].alive).toBe(false)
      expect(state.result).toEqual({ winner: 0 })
      assertConservation(state)
    })
  })
})
