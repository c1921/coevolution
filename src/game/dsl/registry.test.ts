import { describe, expect, it } from 'vitest'
import {
  DslLoadError,
  cardDoc,
  cardIds,
  cardRole,
  cardSelfThreat,
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
          'threat-per-attack': 1,
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
      path: 'skills/charge.json',
      value: {
        dslVersion: 1,
        kind: 'skill',
        id: 'charge',
        name: '蓄能',
        text: '能量上限 +2。',
        modifiers: [{ channel: 'energy-max', op: 'add', value: { kind: 'const', value: 2 } }],
      },
    },
    {
      path: 'species/offensive.json',
      value: {
        dslVersion: 1,
        kind: 'species',
        id: 'offensive',
        name: '进攻型',
        maxHp: 4,
        skills: ['charge'],
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
    expect(registry.species).toHaveLength(4)
    expect(registry.skills).toHaveLength(4)
    expect(registry.cards).toHaveLength(16)
    expect(registry.decks).toHaveLength(3)
    expect(registry.rules).toHaveLength(3)
    expect(registry.ruleset.id).toBe('base')
  })

  it('物种顺序与原 SPECIES_IDS 完全一致（保证固定种子抽将结果不变）', () => {
    expect(speciesIds()).toEqual(['offensive', 'counter', 'defensive', 'morph'])
  })

  it('牌种顺序按 priority，三套牌组各自自洽', () => {
    expect(cardIds()).toEqual([
      // 基础牌 10~50（回血牌已删除，只剩三张）
      'strike',
      'defend',
      'storm',
      // 奖励池新卡 100（同优先级按 id）
      'backflip',
      'bash',
      'bloodrage',
      'bludgeon',
      'combo',
      'heavy-press',
      'iron-wave',
      'plunder',
      'sprint',
      'tactics',
      // 升级版 110（同优先级按 id）
      'defend-plus',
      'storm-plus',
      'strike-plus',
    ])
    // 首个牌组（basic）是打击 8 / 防御 4
    expect(registry.decks[0]?.cards).toEqual([
      { kind: 'strike', count: 8 },
      { kind: 'defend', count: 4 },
    ])
    const byId = (id: string) => registry.decks.find((deck) => deck.id === id)?.cards
    expect(byId('aggressive')).toEqual([
      { kind: 'strike', count: 8 },
      { kind: 'defend', count: 3 },
      { kind: 'storm', count: 1 },
    ])
    expect(byId('guarded')).toEqual([
      { kind: 'strike', count: 7 },
      { kind: 'defend', count: 5 },
    ])
  })

  it('反击挂在「受到威胁后」上、每回合限一次，且内部内容没有任何 after-damage 触发', () => {
    expect(skillDoc('riposte').trigger?.on).toEqual({ at: 'after-threat' })
    expect(skillDoc('riposte').trigger?.optional).toBe(true)
    // 每回合限一次的写法：when 里查 skill-unused、effects 里先 record-skill-use
    expect(skillDoc('riposte').trigger?.when).toEqual([
      { kind: 'alive', of: 'source' },
      { kind: 'skill-unused', skill: 'riposte' },
    ])
    expect(skillDoc('riposte').trigger?.effects[0]).toEqual({
      kind: 'record-skill-use',
      skill: 'riposte',
    })
    expect(
      registry.skills.filter((doc) => doc.trigger?.on.at === 'after-damage'),
      '内置内容不应再有 after-damage 触发（伤害帧仍由测试的合成技能守护）',
    ).toEqual([])
  })

  it('技能查询按 priority 排序，且只返回该物种的技能', () => {
    expect(skillsOf('offensive').map((skill) => skill.id)).toEqual(['assault'])
    expect(skillsOf('counter').map((skill) => skill.id)).toEqual(['riposte'])
    expect(skillsOf('defensive').map((skill) => skill.id)).toEqual(['charge'])
    expect(skillsOf('morph').map((skill) => skill.id)).toEqual(['convert'])
    expect(skillDoc('charge').modifiers?.[0]).toMatchObject({
      channel: 'energy-max',
      op: 'add',
    })
    expect(speciesDoc('counter').skills).toEqual(['riposte'])
  })

  it('牌面用途与自伤威胁由文档结构派生（含 for-each-target 内的效果）', () => {
    expect(cardRole('strike')).toBe('attack')
    expect(cardRole('defend')).toBe('defense')
    // 威胁写在 for-each-target 里也要被识别为攻击牌
    expect(cardRole('storm')).toBe('attack')

    // 对称威胁在 1v1 里必然打到自己，因此自伤威胁为 2
    expect(cardSelfThreat('storm')).toBe(2)
    expect(cardSelfThreat('strike')).toBe(0)
    expect(cardSelfThreat('defend')).toBe(0)
  })

  it('稀有度与升级指向：奖励池只收声明 rarity 的牌，升级版不入池', () => {
    // 基础牌声明 upgradeTo，但不声明 rarity（不参与奖励池）
    expect(cardDoc('strike').upgradeTo).toBe('strike-plus')
    expect(cardDoc('strike').rarity).toBeUndefined()
    expect(cardDoc('defend').upgradeTo).toBe('defend-plus')
    expect(cardDoc('storm').upgradeTo).toBe('storm-plus')

    // 升级版不再声明 upgradeTo（禁止链式升级），也不声明 rarity
    expect(cardDoc('strike-plus').upgradeTo).toBeUndefined()
    expect(cardDoc('strike-plus').rarity).toBeUndefined()

    // 新卡声明了稀有度，因此进奖励池
    expect(cardDoc('combo').rarity).toBe('common')
    expect(cardDoc('bash').rarity).toBe('uncommon')
    expect(cardDoc('bludgeon').rarity).toBe('rare')
  })
})

describe('校验器', () => {
  it('非法文档会抛出 DslLoadError 并携带全部问题', () => {
    const docs = mutate('species/offensive.json', (doc) => {
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
      path: 'species/offensive.json#/skills/0',
    })
  })

  it('问题按路径排序，便于快照与定位', () => {
    const docs = [
      ...mutate('species/offensive.json', (doc) => {
        doc.deck = 'missing'
      }),
      ...mutate('skills/charge.json', (doc) => {
        doc.name = ''
      }).filter((doc) => doc.path === 'skills/charge.json'),
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
    expect(paths).toContain('skills/charge.json#/name')
    expect(paths).toContain('species/offensive.json#/deck')
  })
})

describe('withRegistry', () => {
  it('可以注入合成物种并在结束后还原', () => {
    const synthetic = createRegistry([
      ...baseDocs().filter((doc) => !doc.path.startsWith('species/')),
      {
        path: 'species/probe.json',
        value: {
          dslVersion: 1,
          kind: 'species',
          id: 'probe',
          name: '试验型',
          maxHp: 3,
          skills: ['charge'],
          deck: 'basic',
        },
      },
    ])

    const before = registry
    const inside = withRegistry(synthetic, () => speciesIds())
    expect(inside).toEqual(['probe'])
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
