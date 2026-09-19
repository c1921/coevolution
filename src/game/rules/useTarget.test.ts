import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { contentWith, syntheticHealingRegistry } from '../dsl/fixtures'
import { withRegistry } from '../dsl/registry'
import { injectHand, makeState, snapshot } from '../testUtils'
import { cardTargetChoice } from '../skills'
import { checkUseCard } from './legality'

/**
 * 「使用卡牌时的目标」端到端：合法性校验、结算目标绑定与濒死语境的限制。
 * 目标选择**始终**来自卡牌文档的 TargetSpec，引擎不判断牌种。
 *
 * 内置内容已删除全部回血牌，「自己回复 / 任意已受伤角色」两类规格由
 * `fixtures.ts` 的合成牌（`test-mend` / `test-aid`）提供。
 */

describe('使用卡牌时的目标', () => {
  it('急救：双方都受伤时需要选择，显式目标只治疗选定的人', () => {
    withRegistry(syntheticHealingRegistry(), () => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        playerHp: 2,
        aiHp: 2,
      })
      const [card] = injectHand(state, 0, 'test-aid')

      expect(cardTargetChoice(state, 0, 'test-aid', 'play')).toMatchObject({
        mustChoose: true,
        multi: false,
        size: 1,
        candidates: [0, 1],
        fallback: 0,
      })

      submit(state, { kind: 'use-card', card: card!, targets: [1] })
      expect(state.players[1].hp).toBe(3)
      expect(state.players[0].hp).toBe(2)
      expect(state.players[0].energy).toBe(1)
    })
  })

  it('急救：不给目标时使用文档缺省目标（自己）', () => {
    withRegistry(syntheticHealingRegistry(), () => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        playerHp: 2,
        aiHp: 2,
      })
      const [card] = injectHand(state, 0, 'test-aid')
      submit(state, { kind: 'use-card', card: card! })
      expect(state.players[0].hp).toBe(3)
      expect(state.players[1].hp).toBe(2)
    })
  })

  it('急救：目标必须已受伤，文档 reason 直接作为报错且状态不变', () => {
    withRegistry(syntheticHealingRegistry(), () => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        playerHp: 2,
      })
      const [card] = injectHand(state, 0, 'test-aid')
      const before = snapshot(state)
      expect(() => submit(state, { kind: 'use-card', card: card!, targets: [1] })).toThrow(
        '目标角色体力已满，无法回复',
      )
      expect(state).toEqual(before)
    })
  })

  it('风暴：count=all 不需要指定目标，双方各获得 2 点威胁', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'storm' }],
    })
    const card = state.players[0].hand[0]!

    expect(cardTargetChoice(state, 0, 'storm', 'play')).toMatchObject({
      mustChoose: false,
      multi: false,
      size: 2,
      candidates: [0, 1],
    })

    submit(state, { kind: 'use-card', card })
    expect(state.players[0].threat).toBe(2)
    expect(state.players[1].threat).toBe(2)
    expect(state.players[0].hp).toBe(10)
    expect(state.players[1].hp).toBe(10)
    expect(state.players[0].energy).toBe(1)
  })

  it('风暴：只指定一部分目标会被拒绝（作用于全部合法目标）', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'storm' }],
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, targets: [1] }),
    ).toThrow('作用于全部合法目标')
    expect(state).toEqual(before)
  })

  it('没有声明 target 的牌不允许携带目标', () => {
    const synthetic = contentWith([
      {
        path: 'cards/jab.json',
        value: {
          dslVersion: 1,
          kind: 'card',
          id: 'jab',
          name: '刺拳',
          short: '无目标效果',
          text: '消耗 1 点能量：写一条战报。',
          cost: { kind: 'const', value: 1 },
          rarity: 'common',
          use: [
            {
              context: 'play',
              effects: [{ kind: 'log', template: '{self} 打出一记刺拳' }],
            },
          ],
        },
      },
    ])

    withRegistry(synthetic, () => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
      })
      const [jab] = injectHand(state, 0, 'jab')
      const before = snapshot(state)
      expect(() => submit(state, { kind: 'use-card', card: jab!, targets: [1] })).toThrow(
        '不需要指定目标',
      )
      expect(state).toEqual(before)
    })
  })

  it('濒死语境的目标由结算决定：显式给出别的目标会被拒绝', () => {
    withRegistry(syntheticHealingRegistry(), () => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        playerHp: 0,
      })
      const [mend] = injectHand(state, 0, 'test-mend')
      const [aid] = injectHand(state, 0, 'test-aid')
      state.pending = { kind: 'dying', player: 0, dying: 0 }

      expect(checkUseCard(state, 0, mend!, 'test-mend', undefined, [1])).toMatchObject({
        ok: false,
        reason: '濒死结算的目标必须是濒死者',
      })
      expect(checkUseCard(state, 0, mend!, 'test-mend', undefined, [0])).toEqual({ ok: true })
      expect(checkUseCard(state, 0, mend!, 'test-mend')).toEqual({ ok: true })

      // 【急救】没有 dying 语境，濒死时不能用来自救（回归：AI 曾因此提交非法动作）
      expect(checkUseCard(state, 0, aid!, 'test-aid')).toMatchObject({ ok: false })
    })
  })

  it('对称威胁由各自在回合结束时结算：先结算的一方先阵亡', () => {
    for (const active of [0, 1] as const) {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'morph',
        playerHp: 1,
        aiHp: 1,
        active,
        playerHand: [{ kind: 'storm' }],
        aiHand: [{ kind: 'storm' }],
      })
      submit(state, { kind: 'use-card', card: state.players[active].hand[0]! })

      // 双方各拿 2 点威胁，但只有回合角色会在本回合结束时兑现
      expect(state.players[0].threat, `active=${active}`).toBe(2)
      expect(state.players[1].threat, `active=${active}`).toBe(2)

      submit(state, { kind: 'end-phase' })

      // 内置内容没有任何自救牌：回合角色先结算，1 点体力扛不住 2 点威胁
      let guard = 0
      while (state.pending && guard++ < 10) submit(state, { kind: 'cancel' })

      expect(state.result, `active=${active}`).toEqual({ winner: active === 0 ? 1 : 0 })
      expect(state.players[active].alive, `active=${active}`).toBe(false)
      expect(state.phase).toBe('game-over')
    }
  })
})
