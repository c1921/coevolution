import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { makeState, snapshot } from '../testUtils'
import { cardTargetChoice } from '../skills'
import { contentWith } from '../dsl/fixtures'
import { withRegistry } from '../dsl/registry'
import { checkUseCard } from './legality'

/**
 * 「使用卡牌时的目标」端到端：合法性校验、结算目标绑定与濒死语境的限制。
 * 目标选择**始终**来自卡牌文档的 TargetSpec，引擎不判断牌种。
 */

describe('使用卡牌时的目标', () => {
  it('急救：双方都受伤时需要选择，显式目标只治疗选定的人', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHp: 2,
      aiHp: 2,
      playerHand: [{ kind: 'first-aid' }],
    })
    const card = state.players[0].hand[0]!

    expect(cardTargetChoice(state, 0, 'first-aid', 'play')).toMatchObject({
      mustChoose: true,
      multi: false,
      size: 1,
      candidates: [0, 1],
      fallback: 0,
    })

    submit(state, { kind: 'use-card', card, targets: [1] })
    expect(state.players[1].hp).toBe(3)
    expect(state.players[0].hp).toBe(2)
    expect(state.players[0].energy).toBe(1)
  })

  it('急救：不给目标时使用文档缺省目标（自己）', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHp: 2,
      aiHp: 2,
      playerHand: [{ kind: 'first-aid' }],
    })
    submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
    expect(state.players[0].hp).toBe(3)
    expect(state.players[1].hp).toBe(2)
  })

  it('急救：目标必须已受伤，文档 reason 直接作为报错且状态不变', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHp: 2,
      playerHand: [{ kind: 'first-aid' }],
    })
    const before = snapshot(state)
    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, targets: [1] }),
    ).toThrow('目标角色体力已满，无法回复')
    expect(state).toEqual(before)
  })

  it('风暴：count=all 不需要指定目标，双方各受 1 点伤害', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
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
    expect(state.players[0].hp).toBe(3)
    expect(state.players[1].hp).toBe(3)
    expect(state.players[0].energy).toBe(1)
  })

  it('风暴：只指定一部分目标会被拒绝（作用于全部合法目标）', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
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
          use: [
            {
              context: 'play',
              effects: [{ kind: 'log', template: '{self} 打出一记刺拳' }],
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
            { kind: 'jab', count: 1 },
          ],
        },
      },
    ])

    withRegistry(synthetic, () => {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        playerHand: [{ kind: 'jab' }],
      })
      const before = snapshot(state)
      expect(() =>
        submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, targets: [1] }),
      ).toThrow('不需要指定目标')
      expect(state).toEqual(before)
    })
  })

  it('濒死语境的目标由结算决定：显式给出别的目标会被拒绝', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHp: 0,
      playerHand: [{ kind: 'heal' }, { kind: 'first-aid' }],
    })
    state.pending = { kind: 'dying', player: 0, dying: 0 }
    const heal = state.players[0].hand.find((card) => card.kind === 'heal')!

    expect(checkUseCard(state, 0, heal, 'heal', undefined, [1])).toMatchObject({
      ok: false,
      reason: '濒死结算的目标必须是濒死者',
    })
    expect(checkUseCard(state, 0, heal, 'heal', undefined, [0])).toEqual({ ok: true })
    expect(checkUseCard(state, 0, heal, 'heal')).toEqual({ ok: true })

    // 【急救】没有 dying 语境，濒死时不能用来自救（回归：AI 曾因此提交非法动作）
    const firstAid = state.players[0].hand.find((card) => card.kind === 'first-aid')!
    expect(checkUseCard(state, 0, firstAid, 'first-aid')).toMatchObject({ ok: false })
  })

  it('对称伤害同时归零：按座次推入、按后进先出结算，座位靠后者先阵亡', () => {
    for (const active of [0, 1] as const) {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'lion',
        playerHp: 1,
        aiHp: 1,
        active,
        playerHand: [{ kind: 'storm' }],
        aiHand: [{ kind: 'storm' }],
      })
      submit(state, { kind: 'use-card', card: state.players[active].hand[0]! })

      // 双方都没人使用【回复】自救：先完成死亡结算的一方判负
      let guard = 0
      while (state.pending && guard++ < 10) submit(state, { kind: 'cancel' })

      expect(state.result, `active=${active}`).toEqual({ winner: 0 })
      expect(state.players[1].alive, `active=${active}`).toBe(false)
      expect(state.phase).toBe('game-over')
    }
  })
})
