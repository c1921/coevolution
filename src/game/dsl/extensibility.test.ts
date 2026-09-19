import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { CARD_DEFS } from '../data/cardDefs'
import { SPECIES, speciesDef } from '../data/species'
import { assertConservation } from '../rules/cardZones'
import { makeState } from '../testUtils'
import { withRegistry } from './registry'
import { contentWith } from './fixtures'

/**
 * 扩展性验收：只改 JSON（这里用内存文档模拟）就能新增内容，
 * 引擎、legality、AI、界面一行都不用动。
 */

describe('扩展性：新增内容不需要改代码', () => {
  it('新增一个主动技（含费用、目标、限一次）即可端到端生效', () => {
    const synthetic = contentWith([
      {
          path: 'skills/bloom.json',
          value: {
            dslVersion: 1,
            kind: 'skill',
            id: 'bloom',
            name: '绽放',
            text: '出牌阶段限一次：弃一张手牌，令一名已受伤的角色回复 2 点体力。',
            activate: {
              timing: 'play',
              oncePerTurn: true,
              costCards: { count: { kind: 'const', value: 1 } },
              target: {
                scope: 'any',
                required: false,
                default: 'self',
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
                {
                  kind: 'move-cards',
                  from: { zone: 'hand', of: 'self' },
                  to: { zone: 'discard', of: 'self' },
                  pick: { mode: 'cost' },
                },
                { kind: 'record-skill-use', skill: 'bloom' },
                { kind: 'heal', target: 'target', amount: { kind: 'const', value: 2 } },
                { kind: 'log', template: '{self} 发动【绽放】，回复 2 点体力' },
              ],
            },
          },
        },
      // 鹿改用新技能
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
            skills: ['bloom'],
            deck: 'basic',
          },
        },
    ])

    // 牌组与技能都取自当前注册表，因此状态也要在同一份注册表下构造
    withRegistry(synthetic, () => {
      const state = makeState({
        playerSpecies: 'deer',
        aiSpecies: 'bear',
        playerHp: 1,
        playerHand: [{ kind: 'strike' }, { kind: 'defend' }],
      })
      const fodder = state.players[0].hand[0]!
      submit(state, { kind: 'activate', skill: 'bloom', cards: [fodder] })
      expect(state.players[0].hp).toBe(3)
      expect(state.players[0].hand).toHaveLength(1)
      expect(state.players[0].discard.map((card) => card.uid)).toContain(fodder.uid)
      expect(state.players[0].usedSkillsThisTurn).toContain('bloom')
      assertConservation(state)
    })
  })

  it('新增一张攻击牌（自带 2 点伤害）即可端到端生效', () => {
    const synthetic = contentWith([
      {
        path: 'cards/smite.json',
          value: {
            dslVersion: 1,
            kind: 'card',
            id: 'smite',
            name: '重击',
            short: '造成 2 点伤害',
            text: '消耗 1 点能量：对对方造成 2 点伤害。',
            cost: { kind: 'const', value: 1 },
            use: [
              {
                context: 'play',
                target: { scope: 'opponent', required: false, alive: true, range: true },
                effects: [
                  {
                    kind: 'move-cards',
                    from: { zone: 'hand', of: 'self' },
                    to: { zone: 'processing', of: 'self' },
                    pick: { mode: 'played' },
                  },
                  { kind: 'record-card-use', of: 'self', cardKind: 'smite' },
                  { kind: 'log', template: '{self} 对 {target} 使用{usedAs}' },
                  {
                    kind: 'contest',
                    responder: 'target',
                    expectedCard: 'defend',
                    need: { kind: 'const', value: 1 },
                    onUnmet: [
                      { kind: 'damage', target: 'target', amount: { kind: 'const', value: 2 } },
                    ],
                  },
                ],
              },
            ],
          },
        },
        // 牌组里加入新牌（守恒校验会自动按新构成计算）
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
              { kind: 'smite', count: 1 },
            ],
          },
        },
    ])

    withRegistry(synthetic, () => {
      expect(CARD_DEFS.smite?.name).toBe('重击')
      expect(CARD_DEFS.smite?.cost).toBe(1)
      // 牌组按新构成构建（虎用 aggressive），守恒校验也按新构成计算
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        playerHand: [{ kind: 'smite' }],
      })
      const smite = state.players[0].hand[0]!
      submit(state, { kind: 'use-card', card: smite })
      expect(state.pending).toMatchObject({ kind: 'respond', player: 1, expected: 'defend' })
      submit(state, { kind: 'cancel' })
      expect(state.players[1].hp).toBe(2)
      assertConservation(state)
    })
  })

  it('新增一张「使用时选目标」的牌：目标选择全链路只靠文档接通', () => {
    const synthetic = contentWith([
      {
        path: 'cards/provoke.json',
        value: {
          dslVersion: 1,
          kind: 'card',
          id: 'provoke',
          name: '挑衅',
          short: '令一名角色随机弃一张手牌',
          text: '消耗 1 点能量：令一名角色（可以是自己）随机弃置一张手牌。',
          cost: { kind: 'const', value: 1 },
          use: [
            {
              context: 'play',
              // required: true → 必须显式指定目标，界面会进入选择态
              target: { scope: 'any', required: true, alive: true },
              effects: [
                {
                  kind: 'move-cards',
                  from: { zone: 'hand', of: 'self' },
                  to: { zone: 'discard', of: 'self' },
                  pick: { mode: 'played' },
                },
                {
                  kind: 'move-cards',
                  from: { zone: 'hand', of: 'target' },
                  to: { zone: 'discard', of: 'target' },
                  pick: { mode: 'random', count: 1 },
                },
                { kind: 'log', template: '{self} 使用{usedAs}，令 {target} 随机弃一张手牌' },
              ],
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
            { kind: 'provoke', count: 1 },
          ],
        },
      },
    ])

    withRegistry(synthetic, () => {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        playerHand: [{ kind: 'provoke' }],
        aiHand: [{ kind: 'strike' }],
      })
      const card = state.players[0].hand[0]!

      // 声明了 required 就必须给目标：不给会被拒绝，状态不变
      const before = structuredClone(state)
      expect(() => submit(state, { kind: 'use-card', card })).toThrow('必须指定一个目标')
      expect(state).toEqual(before)

      submit(state, { kind: 'use-card', card, targets: [1] })
      expect(state.players[1].hand).toHaveLength(0)
      expect(state.players[1].discard).toHaveLength(1)
      assertConservation(state)
    })
  })

  it('新增一张多目标牌：count + for-each-target 只靠文档接通', () => {
    const synthetic = contentWith([
      {
        path: 'cards/quake.json',
        value: {
          dslVersion: 1,
          kind: 'card',
          id: 'quake',
          name: '震地',
          short: '对每名角色造成 1 点伤害',
          text: '消耗 1 点能量：对每名角色造成 1 点伤害。',
          cost: { kind: 'const', value: 1 },
          use: [
            {
              context: 'play',
              target: { scope: 'any', alive: true, count: { mode: 'all' } },
              effects: [
                {
                  kind: 'move-cards',
                  from: { zone: 'hand', of: 'self' },
                  to: { zone: 'discard', of: 'self' },
                  pick: { mode: 'played' },
                },
                { kind: 'log', template: '{self} 使用{usedAs}' },
                {
                  kind: 'for-each-target',
                  effects: [
                    { kind: 'damage', target: 'target', amount: { kind: 'const', value: 1 } },
                  ],
                },
              ],
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
            { kind: 'quake', count: 1 },
          ],
        },
      },
    ])

    withRegistry(synthetic, () => {
      const state = makeState({
        playerSpecies: 'tiger',
        aiSpecies: 'bear',
        playerHand: [{ kind: 'quake' }],
      })
      const card = state.players[0].hand[0]!

      // all 模式不需要指定目标：引擎作用于全部合法候选（双方各 1 点伤害）
      submit(state, { kind: 'use-card', card })
      expect(state.players[0].hp).toBe(3)
      expect(state.players[1].hp).toBe(3)
      assertConservation(state)
    })
  })

  it('改一份物种文档就能改体力上限（视图是实时的）', () => {
    const synthetic = contentWith([
      {
        path: 'species/tiger.json',
          value: {
            dslVersion: 1,
            kind: 'species',
            id: 'tiger',
            priority: 10,
            name: '虎',
            emoji: '🐯',
            maxHp: 6,
            skills: [],
            deck: 'basic',
          },
        },
    ])

    expect(speciesDef('tiger').maxHp).toBe(4)
    withRegistry(synthetic, () => {
      expect(SPECIES.tiger.maxHp).toBe(6)
      expect(makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' }).players[0].maxHp).toBe(6)
    })
    expect(speciesDef('tiger').maxHp).toBe(4)
  })
})
