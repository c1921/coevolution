import { describe, expect, it } from 'vitest'
import { contentWith } from '../dsl/fixtures'
import { withRegistry } from '../dsl/registry'
import { submit } from '../engine'
import { assertConservation } from '../rules/cardZones'
import { activationTargetChoice, activeOptions } from '../skills'
import { makeState, snapshot } from '../testUtils'

/**
 * 主动技只剩进攻型的【强袭】一种内置内容，因此目标选择的通用机制
 * （required / 多候选 / 缺省不合格 / 无 target）用合成内容验证：
 * 内容全部由文档描述，引擎与界面不为某个具体技能加分支。
 */
describe('主动技的目标选择（合成内容）', () => {
  /** 一个带「已受伤」条件的治疗技 + 一个无 target 的摸牌技，挂在同一合成物种上 */
  function syntheticContent() {
    return contentWith([
      {
        path: 'skills/setbone.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'setbone',
          name: '正骨',
          text: '出牌阶段：弃一张手牌，令一名已受伤的角色回复 1 点体力（必须指定目标）。',
          activate: {
            timing: 'play',
            target: {
              scope: 'any',
              required: true,
              alive: true,
              conditions: [
                {
                  kind: 'compare',
                  op: 'lt',
                  left: { kind: 'ref', ref: 'hp', of: 'target' },
                  right: { kind: 'ref', ref: 'maxHp', of: 'target' },
                  reason: '目标体力已满',
                },
              ],
            },
            effects: [
              { kind: 'heal', target: 'target', amount: { kind: 'const', value: 1 } },
              { kind: 'log', template: '{self} 发动【正骨】，{target} 回复 1 点体力' },
            ],
          },
        },
      },
      {
        path: 'skills/overdraw.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'overdraw',
          name: '抽牌',
          text: '出牌阶段：摸两张牌（不需要目标）。',
          activate: {
            timing: 'play',
            effects: [{ kind: 'draw', target: 'self', count: { kind: 'const', value: 2 } }],
          },
        },
      },
      {
        path: 'species/medic.json',
        value: {
          dslVersion: 1,
          kind: 'species',
          id: 'medic',
          priority: 50,
          name: '试验型',
          maxHp: 3,
          skills: ['setbone', 'overdraw'],
          deck: 'basic',
        },
      },
    ])
  }

  it('required:true 的技能：候选来自文档，不指定目标不可发动', () => {
    withRegistry(syntheticContent(), () => {
      const state = makeState({
        playerSpecies: 'medic',
        aiSpecies: 'defensive',
        playerHp: 2,
        aiHp: 2,
        playerHand: [{ kind: 'strike' }],
      })
      const choice = activationTargetChoice(state, 0, 'setbone')!
      // required:true 且双方都已受伤 → 有可用候选，但缺省被禁用（没有 default）
      expect(choice.spec?.scope).toBe('any')
      expect(choice.candidates).toEqual([0, 1])
      expect(choice.fallback).toBeUndefined()
      expect(choice.mustChoose).toBe(true)
      expect(activeOptions(state, 0)).toContain('setbone')

      const before = snapshot(state)
      expect(() => submit(state, { kind: 'activate', skill: 'setbone' })).toThrow(
        '【正骨】需要指定一个目标',
      )
      expect(state).toEqual(before)

      submit(state, {
        kind: 'activate',
        skill: 'setbone',
        target: 1,
      })
      expect(state.players[1].hp).toBe(3)
      expect(state.players[0].hp).toBe(2)
      assertConservation(state)
    })
  })

  it('没有 target 规格的技能：不需要目标，也不需要选择', () => {
    withRegistry(syntheticContent(), () => {
      const state = makeState({ playerSpecies: 'medic', aiSpecies: 'defensive' })
      const choice = activationTargetChoice(state, 0, 'overdraw')!
      expect(choice.spec).toBeUndefined()
      expect(choice.candidates).toEqual([])
      expect(choice.mustChoose).toBe(false)
      expect(activeOptions(state, 0)).toContain('overdraw')
    })
  })
})

describe('进攻型的【强袭】', () => {
  it('弃一张手牌，令对手获得 2 点威胁，且每回合限一次', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }, { kind: 'defend' }],
    })
    expect(activeOptions(state, 0)).toContain('assault')
    const fodder = state.players[0].hand[0]!

    submit(state, { kind: 'activate', skill: 'assault', cards: [fodder] })

    // 走同一条威胁机制：不直接扣血，只叠 2 点威胁
    expect(state.players[1].threat).toBe(2)
    expect(state.players[1].hp).toBe(4)
    expect(state.players[0].discard.map((card) => card.uid)).toContain(fodder.uid)
    expect(state.players[0].usedSkillsThisTurn).toContain('assault')
    expect(state.pending).toMatchObject({ kind: 'play', player: 0 })
    // 限一次：本回合不再出现在可用主动技里
    expect(activeOptions(state, 0)).not.toContain('assault')
    assertConservation(state)
  })

  it('必须弃一张手牌才能发动', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }],
    })
    const before = snapshot(state)
    expect(() => submit(state, { kind: 'activate', skill: 'assault' })).toThrow(
      '【强袭】需要弃置 1 张手牌',
    )
    expect(state).toEqual(before)

    // 手牌不足时按钮根本不出现
    const empty = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(activeOptions(empty, 0)).not.toContain('assault')
  })

  it('不消耗能量（技能不属于「使用或打出卡牌」）', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }],
    })
    const before = state.players[0].energy
    submit(state, { kind: 'activate', skill: 'assault', cards: [state.players[0].hand[0]!] })
    expect(state.players[0].energy).toBe(before)
  })
})
