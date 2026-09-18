import { describe, expect, it } from 'vitest'
import {
  DslLoadError,
  cardIds,
  createRegistry,
  registry,
  skillDoc,
  skillsOf,
  speciesDoc,
  speciesIds,
  withRegistry,
} from './registry'

/** 一份最小但自洽的文档集（覆盖每种引用关系），供校验与注册表测试复用 */
export function baseDocs(): { path: string; value: unknown }[] {
  return [
    {
      path: 'rules/base.json',
      value: {
        dslVersion: 1,
        kind: 'ruleset',
        id: 'base',
        channels: {
          'energy-max': 3,
          'defend-need-against': 1,
          'draw-count': 2,
          'hand-limit': 0,
          'card-cost': 0,
          'attack-range': 1,
        },
      },
    },
    {
      path: 'cards/strike.json',
      value: {
        dslVersion: 1,
        kind: 'card',
        id: 'strike',
        name: '打击',
        short: '造成 1 点伤害',
        text: '测试用牌',
        cost: { kind: 'const', value: 1 },
        use: [
          {
            context: 'play',
            effects: [{ kind: 'log', template: '{self} 出手' }],
          },
        ],
      },
    },
    {
      path: 'decks/basic.json',
      value: {
        dslVersion: 1,
        kind: 'deck',
        id: 'basic',
        cards: [{ kind: 'strike', count: 1 }],
      },
    },
    {
      path: 'skills/roar.json',
      value: {
        dslVersion: 1,
        kind: 'skill',
        id: 'roar',
        name: '怒吼',
        text: '能量上限 +2。',
        modifiers: [
          { channel: 'energy-max', op: 'add', value: { kind: 'const', value: 2 } },
        ],
      },
    },
    {
      path: 'species/tiger.json',
      value: {
        dslVersion: 1,
        kind: 'species',
        id: 'tiger',
        name: '虎',
        emoji: '🐯',
        maxHp: 4,
        skills: ['roar'],
        deck: 'basic',
      },
    },
  ]
}

/** 深拷贝后按 path 取出某份文档，便于逐项制造错误 */
function mutate(
  path: string,
  change: (doc: Record<string, unknown>) => void,
): { path: string; value: unknown }[] {
  const docs = baseDocs()
  const target = docs.find((doc) => doc.path === path)
  if (!target) throw new Error(`没有 ${path}`)
  change(target.value as Record<string, unknown>)
  return docs
}

describe('内置内容文档', () => {
  it('全部通过校验（导入注册表即校验）', () => {
    expect(registry.species).toHaveLength(8)
    expect(registry.skills).toHaveLength(7)
    expect(registry.cards).toHaveLength(3)
    expect(registry.decks).toHaveLength(1)
    expect(registry.rules).toHaveLength(1)
    expect(registry.ruleset.id).toBe('base')
  })

  it('物种顺序与原 SPECIES_IDS 完全一致（保证固定种子抽将结果不变）', () => {
    expect(speciesIds()).toEqual([
      'tiger',
      'bear',
      'leopard',
      'wolf',
      'deer',
      'lion',
      'ox',
      'fox',
    ])
  })

  it('牌种顺序与牌组构成保持 打击 11 / 防御 6 / 回复 3', () => {
    expect(cardIds()).toEqual(['strike', 'defend', 'heal'])
    expect(registry.decks[0]?.cards).toEqual([
      { kind: 'strike', count: 11 },
      { kind: 'defend', count: 6 },
      { kind: 'heal', count: 3 },
    ])
  })

  it('技能查询按 priority 排序，且只返回该物种的技能', () => {
    expect(skillsOf('tiger')).toHaveLength(0)
    expect(skillsOf('deer').map((skill) => skill.id)).toEqual(['mend'])
    expect(skillDoc('menace').modifiers?.[0]).toMatchObject({
      channel: 'defend-need-against',
      op: 'set',
    })
    expect(speciesDoc('wolf').skills).toEqual(['snatch'])
  })
})

describe('校验器', () => {
  it('非法文档会抛出 DslLoadError 并携带全部问题', () => {
    const docs = mutate('species/tiger.json', (doc) => {
      doc.skills = ['not-a-skill']
    })
    let caught: unknown
    try {
      createRegistry(docs)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DslLoadError)
    const issues = (caught as DslLoadError).issues
    // 悬空引用 + 因此不再被引用的技能（dead-doc）会同时报出
    expect(issues).toHaveLength(2)
    expect(issues.map((issue) => issue.code).sort()).toEqual(['dead-doc', 'unknown-ref'])
    expect(issues.find((issue) => issue.code === 'unknown-ref')).toMatchObject({
      path: 'species/tiger.json#/skills/0',
    })
  })

  it('问题按路径排序，便于快照与定位', () => {
    const docs = [
      ...mutate('species/tiger.json', (doc) => {
        doc.deck = 'missing'
      }),
      ...mutate('skills/roar.json', (doc) => {
        doc.name = ''
      }).filter((doc) => doc.path === 'skills/roar.json'),
    ]
    const issues = (() => {
      try {
        createRegistry(docs)
      } catch (error) {
        return (error as DslLoadError).issues
      }
      return []
    })()
    const paths = issues.map((issue) => issue.path)
    expect(paths).toEqual([...paths].sort())
    expect(paths).toContain('skills/roar.json#/name')
    expect(paths).toContain('species/tiger.json#/deck')
  })
})

describe('withRegistry', () => {
  it('可以注入合成物种并在结束后还原', () => {
    const synthetic = createRegistry([
      ...baseDocs().filter((doc) => !doc.path.startsWith('species/')),
      {
        path: 'species/fox.json',
        value: {
          dslVersion: 1,
          kind: 'species',
          id: 'fox',
          name: '狐',
          emoji: '🦊',
          maxHp: 3,
          skills: ['roar'],
          deck: 'basic',
        },
      },
    ])

    const before = registry
    const inside = withRegistry(synthetic, () => speciesIds())
    expect(inside).toEqual(['fox'])
    expect(registry).toBe(before)
  })

  it('注入的注册表抛出异常时也会还原', () => {
    const synthetic = createRegistry(baseDocs())
    const before = registry
    expect(() =>
      withRegistry(synthetic, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(registry).toBe(before)
  })
})
