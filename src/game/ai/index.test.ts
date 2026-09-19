import { describe, expect, it } from 'vitest'
import { contentWith, syntheticHealingRegistry } from '../dsl/fixtures'
import { withRegistry } from '../dsl/registry'
import type { Registry } from '../dsl/types'
import { injectHand, makeState } from '../testUtils'
import type { Action } from '../types'
import { aiDecide, chooseActivationTarget, chooseCardTargets } from './index'

/**
 * AI 选目标：完全由文档结构派生。
 *
 * AI 里不允许出现技能 id，因此"治疗效果选自己 / 伤害效果选对手 / required 必须带目标"
 * 都要能从技能文档推出来；测试用合成技能（withRegistry）验证这条约定。
 */

/** 用一份合成技能替换试验型的技能表（技能与物种文档必须同时替换，否则是死文档） */
function probeWith(skill: Record<string, unknown> & { id: string }): Registry {
  return contentWith([
    { path: `skills/${skill.id}.json`, value: skill },
    {
      path: 'species/probe.json',
      value: {
        dslVersion: 1,
        kind: 'species',
        id: 'probe',
        priority: 50,
        name: '试验型',
        maxHp: 4,
        skills: [skill.id],
        deck: 'basic',
      },
    },
  ])
}

/** 出牌阶段动作里带的费用牌与目标 */
function activationOf(action: Action): Extract<Action, { kind: 'activate' }> {
  if (action.kind !== 'activate') throw new Error(`期待主动技动作，实际是 ${action.kind}`)
  return action
}

/** 令一名任意角色（可用 required 强制显式选择）回复体力的合成技 */
function healSkill(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> & {
  id: string
} {
  return {
    dslVersion: 1,
    kind: 'skill',
    id,
    name: '合成治疗',
    text: '出牌阶段：令一名已受伤的角色回复 1 点体力。',
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
      effects: [{ kind: 'heal', target: 'target', amount: { kind: 'const', value: 1 } }],
      ...extra,
    },
  }
}

describe('AI 选目标', () => {
  it('自我治疗类主动技：受伤时选自己，并把 target 交给引擎', () => {
    withRegistry(
      probeWith(healSkill('restore', { costCards: { count: { kind: 'const', value: 1 } } })),
      () => {
        const state = makeState({
          playerSpecies: 'probe',
          aiSpecies: 'defensive',
          playerHp: 2,
          playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
        })

        const action = activationOf(aiDecide(state))
        expect(action).toMatchObject({ skill: 'restore', target: 0 })
        expect(action.cards).toHaveLength(1)
      },
    )
  })

  it('required:true 的技能：AI 会带上显式目标', () => {
    withRegistry(probeWith(healSkill('setbone')), () => {
      const state = makeState({
        playerSpecies: 'probe',
        aiSpecies: 'defensive',
        playerHp: 2,
        aiHp: 2,
        playerHand: [{ kind: 'strike' }],
      })

      const action = activationOf(aiDecide(state))
      expect(action).toMatchObject({ skill: 'setbone', target: 0 })
    })
  })

  it('对敌效果：目标倾向对手（由效果指令与角色引用派生）', () => {
    const venom: Record<string, unknown> & { id: string } = {
      dslVersion: 1,
      kind: 'skill',
      id: 'venom',
      name: '毒牙',
      text: '出牌阶段：令任意一名角色获得 1 点威胁。',
      activate: {
        timing: 'play',
        target: { scope: 'any', required: true, alive: true },
        effects: [{ kind: 'threat', target: 'target', amount: { kind: 'const', value: 1 } }],
      },
    }

    withRegistry(probeWith(venom), () => {
      const state = makeState({
        playerSpecies: 'probe',
        aiSpecies: 'defensive',
        playerHp: 2,
        aiHp: 2,
      })
      // 自己也是候选，但"伤害 target"的效果倾向让 AI 选对手
      expect(chooseActivationTarget(state, 0, 'venom')).toBe(1)
    })
  })

  it('费用张数由文档决定：costCards 为 2 时传两张', () => {
    const rites = healSkill('rites', {
      costCards: { count: { kind: 'const', value: 2 } },
    })

    withRegistry(probeWith(rites), () => {
      const state = makeState({
        playerSpecies: 'probe',
        aiSpecies: 'defensive',
        playerHp: 2,
        playerHand: [{ kind: 'strike' }, { kind: 'strike' }, { kind: 'strike' }],
      })

      const action = activationOf(aiDecide(state))
      expect(action).toMatchObject({ skill: 'rites', target: 0 })
      expect(action.cards).toHaveLength(2)
    })
  })
})

describe('AI 使用卡牌时的目标', () => {
  it('急救：优先治疗自己；只有对手受伤时治疗对手', () => {
    // 内置回血牌已删除：用合成急救牌（test-aid）验证「按效果方向选目标」
    withRegistry(syntheticHealingRegistry(), () => {
      const bothWounded = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        playerHp: 2,
        aiHp: 2,
      })
      expect(chooseCardTargets(bothWounded, 0, 'test-aid', 'play')).toEqual([0])

      const onlyOpponent = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        aiHp: 2,
      })
      expect(chooseCardTargets(onlyOpponent, 0, 'test-aid', 'play')).toEqual([1])
    })
  })

  it('风暴：all 模式不传目标（由引擎作用于全部合法候选）', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'storm' }],
    })
    expect(chooseCardTargets(state, 0, 'storm', 'play')).toEqual([])
  })

  it('进攻型主动技【强袭】：手牌有余量时发动，并带上目标与费用牌', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }, { kind: 'defend' }, { kind: 'defend' }],
    })
    const action = activationOf(aiDecide(state))
    expect(action).toMatchObject({ skill: 'assault', target: 1 })
    expect(action.cards).toHaveLength(1)
  })

  it('身上有威胁时先打出【防御】抵消（威胁会在回合结束时变成伤害）', () => {
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerThreat: 2,
      playerHand: [{ kind: 'strike' }, { kind: 'defend' }, { kind: 'defend' }],
    })
    expect(aiDecide(state)).toMatchObject({ kind: 'use-card', as: 'defend' })
  })

  it('会伤到自己的牌只在能直接终结对手时使用', () => {
    // 对手满血：风暴会连自己一起打，AI 选择结束阶段
    const healthy = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      aiHp: 4,
      playerHand: [{ kind: 'storm' }],
    })
    expect(aiDecide(healthy)).toEqual({ kind: 'end-phase' })

    // 对手只剩 1 点体力、自己扛得住：风暴成为终结技
    const finish = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHp: 3,
      aiHp: 1,
      playerHand: [{ kind: 'storm' }],
    })
    expect(aiDecide(finish)).toMatchObject({ kind: 'use-card', as: 'storm' })
  })

  it('AI 打出的牌都带齐目标或明确不带（不会提交必失败的牌）', () => {
    withRegistry(syntheticHealingRegistry(), () => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'defensive',
        playerHp: 2,
        aiHp: 2,
      })
      injectHand(state, 0, 'test-aid')
      injectHand(state, 0, 'strike')
      // 先治疗自己（带目标 0），而不是无目标地提交
      expect(aiDecide(state)).toMatchObject({ kind: 'use-card', as: 'test-aid', targets: [0] })
    })
  })
})

/**
 * 奖励新卡必须对 AI 不是死牌：功能牌要有专门策略，自伤攻击牌要用净收益判断。
 * 用反击型（没有主动技）排除主动技分支的干扰，只考察卡牌本身。
 */
describe('AI 使用奖励新卡', () => {
  /** 直接发牌：奖励新卡不在任何牌组里，makeState 取不到 */
  function handState(kinds: string[], extra: Record<string, unknown> = {}) {
    const state = makeState({ playerSpecies: 'counter', aiSpecies: 'defensive', ...extra })
    state.players[0].hand = kinds.map((kind) => ({ uid: state.nextUid++, kind }))
    return state
  }

  it('至少两类新卡会被 AI 实际打出', () => {
    // 功能牌：手牌少时用【战术演习】抽牌
    expect(aiDecide(handState(['tactics']))).toMatchObject({ kind: 'use-card', as: 'tactics' })
    // 自伤攻击牌：【血怒】收益（3 威胁）大于自伤（1 体力），不再被一律弃用
    expect(aiDecide(handState(['bloodrage', 'strike', 'strike']))).toMatchObject({
      kind: 'use-card',
      as: 'bloodrage',
    })
  })

  it('新攻击牌走同一条威胁机制（连击 / 痛击 / 重锤都只是牌面数据）', () => {
    expect(aiDecide(handState(['combo', 'strike', 'strike', 'strike']))).toMatchObject({
      kind: 'use-card',
      as: 'combo',
    })
    expect(aiDecide(handState(['bludgeon', 'strike', 'strike', 'strike']))).toMatchObject({
      kind: 'use-card',
      as: 'bludgeon',
    })
  })

  it('自伤牌在会把自己打穿时被跳过（已有威胁 + 自伤 ≥ 体力）', () => {
    // 体力 6、身上已有 5 点威胁：再打【血怒】会变成 6 点，回合结束时阵亡
    const state = handState(['bloodrage'], { playerHp: 6, playerThreat: 5 })
    expect(aiDecide(state)).toEqual({ kind: 'end-phase' })
  })
})
