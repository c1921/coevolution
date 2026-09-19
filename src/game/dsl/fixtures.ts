/**
 * 测试夹具：一份最小但自洽的 DSL 文档集。
 *
 * 放在独立模块（而非某个 .test.ts）里，供多个测试文件复用；
 * 不命名为 *.test.ts，避免被 vitest 当作测试文件收集。
 */

import { createRegistry, registryToDocs } from './registry'
import type { Registry } from './types'

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

/**
 * 以**当前完整内容集**为底，按 id 替换/新增文档（与"改一份 JSON"等价）。
 *
 * 用完整内容集而不是最小夹具，是因为牌数守恒、引用完整性与 schema 校验
 * 都要求一份自洽的内容；同 id 的旧文档会被剔除，新 id 则是纯新增。
 */
export function contentWith(docs: RawFixtureDoc[]): Registry {
  const patchIds = new Set(docs.map((doc) => (doc.value as { id: string }).id))
  const base = registryToDocs().filter((doc) => !patchIds.has((doc.value as { id: string }).id))
  return createRegistry([...base, ...docs])
}
