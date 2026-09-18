import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { CARD_DEFS } from '../data/cardDefs'
import { SPECIES, speciesDef } from '../data/species'
import { assertConservation } from '../rules/cardZones'
import { makeState } from '../testUtils'
import { createRegistry, registryToDocs, withRegistry } from './registry'
import type { RawFixtureDoc } from './fixtures'

/**
 * 扩展性验收：只改 JSON（这里用内存文档模拟）就能新增内容，
 * 引擎、legality、AI、界面一行都不用动。
 */

/**
 * 用完整内容集为底，按 id 替换/新增文档（与"改一份 JSON"等价）。
 * 同 id 的旧文档会被剔除，避免重复 id；新 id 则是纯新增。
 */
function contentWith(docs: RawFixtureDoc[]): ReturnType<typeof createRegistry> {
  const patchIds = new Set(docs.map((doc) => (doc.value as { id: string }).id))
  const base = registryToDocs().filter((doc) => !patchIds.has((doc.value as { id: string }).id))
  return createRegistry([...base, ...docs])
}

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
          path: 'decks/basic.json',
          value: {
            dslVersion: 1,
            kind: 'deck',
            id: 'basic',
            priority: 10,
            cards: [
              { kind: 'strike', count: 10 },
              { kind: 'defend', count: 6 },
              { kind: 'heal', count: 3 },
              { kind: 'smite', count: 1 },
            ],
          },
        },
    ])

    withRegistry(synthetic, () => {
      expect(CARD_DEFS.smite?.name).toBe('重击')
      expect(CARD_DEFS.smite?.cost).toBe(1)
      // 牌组按新构成构建（21 张），守恒校验也按新构成计算
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
