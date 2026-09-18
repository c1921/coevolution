/**
 * 测试夹具：一份最小但自洽的 DSL 文档集。
 *
 * 放在独立模块（而非某个 .test.ts）里，供多个测试文件复用；
 * 不命名为 *.test.ts，避免被 vitest 当作测试文件收集。
 */

export interface RawFixtureDoc {
  path: string
  value: unknown
}

/** 覆盖每种引用关系的最小文档集：ruleset + 1 牌 + 1 牌组 + 1 技能 + 1 物种 */
export function baseDocs(): RawFixtureDoc[] {
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

/** 深拷贝后按 path 取出某份文档并就地修改，便于逐项制造错误 */
export function mutateDoc(
  path: string,
  change: (doc: Record<string, unknown>) => void,
): RawFixtureDoc[] {
  const docs = baseDocs()
  const target = docs.find((doc) => doc.path === path)
  if (!target) throw new Error(`夹具里没有 ${path}`)
  change(target.value as Record<string, unknown>)
  return docs
}
