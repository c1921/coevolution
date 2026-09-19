import { describe, expect, it } from 'vitest'
import { contentWith } from '../dsl/fixtures'
import { withRegistry } from '../dsl/registry'
import { submit } from '../engine'
import { assertConservation } from '../rules/cardZones'
import { skillUsed } from '../rules/usage'
import { activationTargetChoice, activeOptions } from '../skills'
import { makeState, snapshot } from '../testUtils'

describe('主动技', () => {
  it('透支：失去 1 点体力并摸两张牌，且不算「受到伤害」', () => {
    const state = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      playerHp: 4,
      playerHand: [{ kind: 'strike' }],
    })

    submit(state, { kind: 'activate', skill: 'overexert' })

    expect(state.players[0].hp).toBe(3)
    expect(state.players[0].hand).toHaveLength(3)
    expect(state.lastDamage).toBeNull()
    expect(state.stack).toHaveLength(0)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('透支：体力降到 0 时先结算濒死，存活后才摸两张牌', () => {
    const state = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      playerHp: 1,
      playerHand: [{ kind: 'heal' }],
    })

    submit(state, { kind: 'activate', skill: 'overexert' })

    expect(state.players[0].hp).toBe(0)
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0, dying: 0 })
    // 濒死尚未结算，摸牌还没有发生
    expect(state.players[0].hand).toHaveLength(1)

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'heal' })

    expect(state.players[0].hp).toBe(1)
    expect(state.players[0].alive).toBe(true)
    // 回复牌已用掉，随后摸两张
    expect(state.players[0].hand).toHaveLength(2)
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    assertConservation(state)
  })

  it('透支：濒死时无人救援则阵亡', () => {
    const state = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      playerHp: 1,
      playerHand: [{ kind: 'strike' }],
    })

    submit(state, { kind: 'activate', skill: 'overexert' })
    expect(state.pending).toMatchObject({ kind: 'dying', player: 0 })

    submit(state, { kind: 'cancel' })
    submit(state, { kind: 'cancel' })

    expect(state.players[0].alive).toBe(false)
    expect(state.result).toEqual({ winner: 1 })
    assertConservation(state)
  })

  it('透支：出牌阶段可以反复发动', () => {
    const state = makeState({ playerSpecies: 'ox', aiSpecies: 'bear', playerHp: 4 })

    submit(state, { kind: 'activate', skill: 'overexert' })
    submit(state, { kind: 'activate', skill: 'overexert' })

    expect(state.players[0].hp).toBe(2)
    expect(state.players[0].hand).toHaveLength(4)
    assertConservation(state)
  })

  it('疗愈：弃一张手牌回复 1 点体力', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 2,
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
    })
    const discard = state.players[0].hand[0]!

    submit(state, { kind: 'activate', skill: 'mend', cards: [discard] })

    expect(state.players[0].hp).toBe(3)
    expect(state.players[0].discard.map((c) => c.uid)).toContain(discard.uid)
    expect(state.players[0].hand).toHaveLength(1)
    assertConservation(state)
  })

  it('疗愈：每回合限一次', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 1,
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
    })

    submit(state, { kind: 'activate', skill: 'mend', cards: [state.players[0].hand[0]!] })
    expect(state.players[0].hp).toBe(2)
    expect(skillUsed(state, 0, 'mend')).toBe(true)

    const before = snapshot(state)
    expect(() =>
      submit(state, {
        kind: 'activate',
        skill: 'mend',
        cards: [state.players[0].hand[0]!],
      }),
    ).toThrow('当前无法发动【疗愈】')
    expect(state).toEqual(before)
  })

  it('疗愈：没有任何已受伤角色时不可发动', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
    })

    expect(activeOptions(state, 0)).not.toContain('mend')
    // 候选为空：技能直接不可用，界面不会出现「点了必失败」的按钮
    expect(activationTargetChoice(state, 0, 'mend')).toBeNull()

    const before = snapshot(state)
    expect(() =>
      submit(state, {
        kind: 'activate',
        skill: 'mend',
        cards: [state.players[0].hand[0]!],
      }),
    ).toThrow()
    expect(state).toEqual(before)
  })

  it('疗愈：也可以指定已受伤的对手为目标', () => {
    const state = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      aiHp: 2,
      playerHand: [{ kind: 'strike' }],
    })

    submit(state, {
      kind: 'activate',
      skill: 'mend',
      cards: [state.players[0].hand[0]!],
      target: 1,
    })

    expect(state.players[1].hp).toBe(3)
    expect(state.players[0].hp).toBe(3)
    assertConservation(state)
  })

  it('不是自己的回合时无法发动主动技', () => {
    const state = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      active: 1,
      playerHp: 4,
    })

    const before = snapshot(state)
    expect(() => submit(state, { kind: 'activate', skill: 'overexert' })).toThrow()
    expect(state).toEqual(before)
  })
})

/**
 * 目标选择是「可用性判定（activeOptions 决定按钮）」与「结算解析（checkActivate）」
 * 的共同入口：按钮出现的每个技能，都必须存在一个能提交成功的目标。
 */
describe('主动技的目标选择', () => {
  /** 一份只有对手受伤的疗愈场面（就是"点了必失败"的那个坏路径） */
  function onlyOpponentWounded() {
    return makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      aiHp: 2,
      playerHand: [{ kind: 'strike' }],
    })
  }

  it('疗愈：要选谁由文档决定（required / 多候选 / 缺省不合格）', () => {
    const onlyOpponent = activationTargetChoice(onlyOpponentWounded(), 0, 'mend')!
    expect(onlyOpponent.spec?.scope).toBe('any')
    expect(onlyOpponent.candidates).toEqual([1])
    // default: self 不合格 → 没有可用缺省，必须显式选
    expect(onlyOpponent.fallback).toBeUndefined()
    expect(onlyOpponent.mustChoose).toBe(true)

    const bothWounded = activationTargetChoice(
      makeState({ playerSpecies: 'deer', aiSpecies: 'bear', playerHp: 2, aiHp: 2 }),
      0,
      'mend',
    )!
    expect(bothWounded.candidates).toEqual([0, 1])
    expect(bothWounded.fallback).toBe(0)
    // 候选不唯一：界面让玩家选（可以主动治疗对手）
    expect(bothWounded.mustChoose).toBe(true)

    const onlySelf = activationTargetChoice(
      makeState({ playerSpecies: 'deer', aiSpecies: 'bear', playerHp: 2 }),
      0,
      'mend',
    )!
    expect(onlySelf.candidates).toEqual([0])
    expect(onlySelf.fallback).toBe(0)
    expect(onlySelf.mustChoose).toBe(false)
  })

  it('没有 target 规格的技能：不需要目标，也不需要选择', () => {
    const state = makeState({ playerSpecies: 'ox', aiSpecies: 'bear', playerHp: 4 })
    const choice = activationTargetChoice(state, 0, 'overexert')!
    expect(choice.spec).toBeUndefined()
    expect(choice.candidates).toEqual([])
    expect(choice.mustChoose).toBe(false)
  })

  it('可用 ⟺ 提交必成功：候选逐个提交都被引擎接受', () => {
    // 双方都受伤时两个候选都成立，各自在独立状态上验证（疗愈每回合限一次）
    const probe = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 2,
      aiHp: 2,
      playerHand: [{ kind: 'strike' }],
    })
    const choice = activationTargetChoice(probe, 0, 'mend')!
    expect(activeOptions(probe, 0)).toContain('mend')

    for (const target of choice.candidates) {
      const state = makeState({
        playerSpecies: 'deer',
        aiSpecies: 'bear',
        playerHp: 2,
        aiHp: 2,
        playerHand: [{ kind: 'strike' }],
      })
      const before = state.players[target].hp
      submit(state, {
        kind: 'activate',
        skill: 'mend',
        cards: [state.players[0].hand[0]!],
        target,
      })
      expect(state.players[target].hp).toBe(before + 1)
      assertConservation(state)
    }
  })

  it('只有对手受伤：按钮可用，显式指向对手即可成功（不再点了必失败）', () => {
    const state = onlyOpponentWounded()
    expect(activeOptions(state, 0)).toContain('mend')

    submit(state, {
      kind: 'activate',
      skill: 'mend',
      cards: [state.players[0].hand[0]!],
      target: 1,
    })

    expect(state.players[1].hp).toBe(3)
    expect(state.players[0].hp).toBe(3)
    assertConservation(state)
  })

  it('必须选目标却不给：拒绝并保持状态不变', () => {
    const state = onlyOpponentWounded()
    const before = snapshot(state)

    expect(() =>
      submit(state, {
        kind: 'activate',
        skill: 'mend',
        cards: [state.players[0].hand[0]!],
      }),
    ).toThrow('【疗愈】需要指定一个目标')
    expect(state).toEqual(before)
  })

  it('required:true 的技能：不指定目标不可发动，指定后正常结算', () => {
    const synthetic = contentWith([
      {
        path: 'skills/setbone.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'setbone',
          name: '正骨',
          text: '出牌阶段：令一名已受伤的角色回复 1 点体力（必须指定目标）。',
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
        path: 'species/deer.json',
        value: {
          dslVersion: 1,
          kind: 'species',
          id: 'deer',
          priority: 50,
          name: '鹿',
          emoji: '🦌',
          maxHp: 3,
          skills: ['setbone'],
          deck: 'basic',
        },
      },
    ])

    withRegistry(synthetic, () => {
      const state = makeState({
        playerSpecies: 'deer',
        aiSpecies: 'bear',
        playerHp: 2,
        aiHp: 2,
      })
      const choice = activationTargetChoice(state, 0, 'setbone')!
      expect(choice.candidates).toEqual([0, 1])
      expect(choice.fallback).toBeUndefined()
      expect(choice.mustChoose).toBe(true)
      expect(activeOptions(state, 0)).toContain('setbone')

      const before = snapshot(state)
      expect(() => submit(state, { kind: 'activate', skill: 'setbone' })).toThrow(
        '【正骨】需要指定一个目标',
      )
      expect(state).toEqual(before)

      submit(state, { kind: 'activate', skill: 'setbone', target: 1 })
      expect(state.players[1].hp).toBe(3)
      expect(state.players[0].hp).toBe(2)
      assertConservation(state)
    })
  })
})

describe('虎的【猛扑】', () => {
  it('弃一张手牌，令对手获得 2 点威胁，且每回合限一次', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }, { kind: 'defend' }],
    })
    expect(activeOptions(state, 0)).toContain('pounce')
    const fodder = state.players[0].hand[0]!

    submit(state, { kind: 'activate', skill: 'pounce', cards: [fodder] })

    // 走同一条威胁机制：不直接扣血，只叠 2 点威胁
    expect(state.players[1].threat).toBe(2)
    expect(state.players[1].hp).toBe(4)
    expect(state.players[0].discard.map((card) => card.uid)).toContain(fodder.uid)
    expect(state.players[0].usedSkillsThisTurn).toContain('pounce')
    expect(state.pending).toMatchObject({ kind: 'play', player: 0 })
    // 限一次：本回合不再出现在可用主动技里
    expect(activeOptions(state, 0)).not.toContain('pounce')
    assertConservation(state)
  })

  it('必须弃一张手牌才能发动', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
    })
    const before = snapshot(state)
    expect(() => submit(state, { kind: 'activate', skill: 'pounce' })).toThrow(
      '【猛扑】需要弃置 1 张手牌',
    )
    expect(state).toEqual(before)

    // 手牌不足时按钮根本不出现
    const empty = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    expect(activeOptions(empty, 0)).not.toContain('pounce')
  })

  it('不消耗能量（技能不属于「使用或打出卡牌」）', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
    })
    const before = state.players[0].energy
    submit(state, { kind: 'activate', skill: 'pounce', cards: [state.players[0].hand[0]!] })
    expect(state.players[0].energy).toBe(before)
  })
})
