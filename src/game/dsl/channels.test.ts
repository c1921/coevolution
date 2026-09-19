import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { BASE_ENERGY_MAX, canPayEnergy, energyCost, energyMax } from '../rules/energy'
import { checkUseCard } from '../rules/legality'
import { BASE_ATTACK_RANGE } from '../rules/distance'
import {
  advanceTurn,
  discardCount,
  drawCount,
  handLimit,
  DRAW_PER_TURN,
  FIRST_TURN_DRAW,
} from '../rules/turn'
import { defendNeedAgainst } from '../skills'
import { makeState } from '../testUtils'
import { contentWith } from './fixtures'
import { CHANNELS } from './kinds'
import type { Channel, ModifierOp } from './kinds'
import { baseChannel, withRegistry } from './registry'
import { baseContext } from './runtime'
import { targetCandidates } from './target'

/**
 * 通道接线验收：`CHANNELS` 里声明的每条修正通道都必须被引擎**真正消费**。
 *
 * 只声明不消费的通道是最坏的一种缺口：内容作者写下一份带该通道修正的技能，
 * 校验通过、打包通过、加载通过，行为却毫无变化——"改 JSON 即生效"在这里是假的。
 * 因此这里对每条通道注入一个修正，断言**可观察到的行为**随之改变；
 * 末尾的守卫要求 `CHANNELS` 与探针表一一对应，新增通道忘了接线会直接失败。
 */

const PROBE_SKILL = 'probe'

/** 以完整内容集为底，把虎的技能换成一条只带指定通道修正的探针技能 */
function registryWith(channel: Channel, op: ModifierOp, value: number) {
  return contentWith([
    {
      path: 'skills/probe.json',
      value: {
        dslVersion: 1,
        kind: 'skill',
        id: PROBE_SKILL,
        name: '探针',
        text: '测试用：只带一条通道修正，不产生其他效果。',
        modifiers: [{ channel, op, value: { kind: 'const', value } }],
      },
    },
    {
      path: 'species/tiger.json',
      value: {
        dslVersion: 1,
        kind: 'species',
        id: 'tiger',
        priority: 10,
        name: '虎',
        emoji: '🐯',
        maxHp: 4,
        skills: [PROBE_SKILL],
        deck: 'basic',
      },
    },
  ])
}

/** 每条通道一个探针：注入修正 → 断言引擎行为真的变了 */
const PROBES: Record<Channel, () => void> = {
  'energy-max': () => {
    withRegistry(registryWith('energy-max', 'add', 1), () => {
      const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
      expect(energyMax(state, 0)).toBe(BASE_ENERGY_MAX + 1)
    })
  },

  'defend-need-against': () => {
    withRegistry(registryWith('defend-need-against', 'set', 3), () => {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        playerHand: [{ kind: 'strike' }],
        aiHand: [{ kind: 'defend' }, { kind: 'defend' }, { kind: 'defend' }],
      })
      expect(defendNeedAgainst(state, 0)).toBe(3)

      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'strike' })
      expect(state.pending).toMatchObject({ kind: 'respond', player: 1, need: 3 })
    })
  },

  'draw-count': () => {
    withRegistry(registryWith('draw-count', 'add', 1), () => {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        phase: 'draw',
        playerHand: [{ kind: 'heal' }],
      })
      // 第 2 回合避开先手首回合补偿，观察纯通道修正
      state.turn = 2

      expect(drawCount(state, 0)).toBe(DRAW_PER_TURN + 1)
      expect(advanceTurn(state)).toBe('pending')
      expect(state.players[0].hand).toHaveLength(1 + DRAW_PER_TURN + 1)
    })
  },

  'hand-limit': () => {
    // 体力 3、手牌 4：默认上限 3 需要弃 1 张
    const options = {
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHp: 3,
      phase: 'discard',
      playerHand: [
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
        { kind: 'strike' },
      ],
    } as const

    const base = makeState({ ...options, playerHand: [...options.playerHand] })
    expect(advanceTurn(base)).toBe('pending')
    expect(base.pending).toEqual({ kind: 'discard', player: 0, count: 1 })

    withRegistry(registryWith('hand-limit', 'add', 1), () => {
      const state = makeState({ ...options, playerHand: [...options.playerHand] })
      expect(handLimit(state, 0)).toBe(4)
      expect(discardCount(state, 0)).toBe(0)

      // 上限 +1 后不再需要弃牌：推进时不会停在弃牌询问上
      advanceTurn(state)
      expect(state.pending?.kind).not.toBe('discard')
    })
  },

  'card-cost': () => {
    withRegistry(registryWith('card-cost', 'add', 1), () => {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        playerHand: [{ kind: 'strike' }],
        playerEnergy: 1,
      })

      expect(energyCost(state, 0, 'strike')).toBe(2)
      expect(canPayEnergy(state, 0, 'strike')).toBe(false)
      // 观察行为：费用涨到 2 后，只有 1 点能量的角色用不出【打击】
      expect(checkUseCard(state, 0, state.players[0].hand[0]!, 'strike').ok).toBe(false)
    })

    // 反向：修正把费用压到 0 甚至负数，也必须夹在 1（0 费 + 无次数限制 = 无限连击）
    withRegistry(registryWith('card-cost', 'add', -99), () => {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        playerHand: [{ kind: 'strike' }],
        playerEnergy: 1,
      })

      expect(energyCost(state, 0, 'strike')).toBe(1)
      expect(energyCost(state, 0, 'heal')).toBe(1)
      expect(canPayEnergy(state, 0, 'strike')).toBe(true)
    })
  },

  'attack-range': () => {
    const spec = { scope: 'opponent', required: false, alive: true, range: true } as const

    withRegistry(registryWith('attack-range', 'set', 0), () => {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        playerHand: [{ kind: 'strike' }],
      })
      const env = { state, ctx: baseContext(state, 0) }

      expect(targetCandidates(env, spec)).toEqual([])
      // 观察行为：攻击范围 0 时【打击】选不到对手，因此不能用
      expect(checkUseCard(state, 0, state.players[0].hand[0]!, 'strike').ok).toBe(false)
    })

    // 基准范围 1：1v1 的对手在范围内
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
    })
    const env = { state, ctx: baseContext(state, 0) }
    expect(targetCandidates(env, spec)).toEqual([1])
    expect(checkUseCard(state, 0, state.players[0].hand[0]!, 'strike').ok).toBe(true)
  },
}

describe('通道接线：每条声明的修正通道都被引擎消费', () => {
  for (const channel of CHANNELS) {
    it(`通道 ${channel} 的修正能改变引擎行为`, () => {
      PROBES[channel]()
    })
  }

  it('探针表覆盖 CHANNELS 的全部条目（新增通道必须接线）', () => {
    expect(Object.keys(PROBES).sort()).toEqual([...CHANNELS].sort())
  })

  it('测试用物种替换后注册表仍然自洽（守卫的前提成立）', () => {
    withRegistry(registryWith('energy-max', 'add', 1), () => {
      const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
      expect(state.players[0].species).toBe('tiger')
    })
  })

  it('注释里引用的默认值常量与 ruleset 文档一致', () => {
    expect(baseChannel('draw-count')).toBe(DRAW_PER_TURN)
    expect(baseChannel('draw-count') - (DRAW_PER_TURN - FIRST_TURN_DRAW)).toBe(FIRST_TURN_DRAW)
    expect(baseChannel('energy-max')).toBe(BASE_ENERGY_MAX)
    expect(baseChannel('attack-range')).toBe(BASE_ATTACK_RANGE)
  })
})
