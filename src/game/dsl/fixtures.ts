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

/**
 * 测试注入用的**合成回血牌**。
 *
 * 内置内容已删除全部回血牌（回复 / 急救及其升级版），但引擎仍然支持
 * 「出牌阶段回复」「濒死自救 / 救援」「scope=any + 已受伤条件」这些机制。
 * 需要它们的测试用本夹具注入，而**不要**把回血牌加回内置内容：
 *  - `test-mend`：回复自己 1 点（2 费），并带 `dying` 语境；
 *  - `test-aid` ：令任意已受伤角色回复 1 点（2 费，`scope: any` + 条件）。
 * 两张都声明 `rarity`，因此不会被当成死文档（奖励池里出现对测试无影响）。
 */
export function syntheticHealingDocs(): RawFixtureDoc[] {
  const heal = (target: 'self' | 'target', value: number) => [
    { kind: 'heal', target, amount: { kind: 'const', value } },
  ]
  return [
    {
      path: 'cards/test-mend.json',
      value: {
        dslVersion: 1,
        kind: 'card',
        id: 'test-mend',
        name: '测试回复',
        short: '回复 1 点体力',
        text: '消耗 2 点能量：回复 1 点体力；濒死时可用来自救或救援。',
        cost: { kind: 'const', value: 2 },
        rarity: 'common',
        use: [
          {
            context: 'play',
            target: { scope: 'self', required: false, alive: true },
            requires: [
              {
                kind: 'compare',
                op: 'lt',
                left: { kind: 'ref', ref: 'hp', of: 'self' },
                right: { kind: 'ref', ref: 'maxHp', of: 'self' },
                reason: '你的体力已满，无法回复',
              },
            ],
            effects: [...heal('self', 1), { kind: 'log', template: '{self} 使用{usedAs}恢复体力' }],
          },
          {
            context: 'dying',
            target: { scope: 'dying', required: true, alive: true },
            effects: [
              ...heal('target', 1),
              { kind: 'log', template: '{self} 救援 {target}' },
              { kind: 'resolve-dying', of: 'target' },
            ],
          },
        ],
      },
    },
    {
      path: 'cards/test-aid.json',
      value: {
        dslVersion: 1,
        kind: 'card',
        id: 'test-aid',
        name: '测试急救',
        short: '令一名已受伤角色回复 1 点体力',
        text: '消耗 2 点能量：令一名已受伤的角色（可以是自己）回复 1 点体力。',
        cost: { kind: 'const', value: 2 },
        rarity: 'common',
        use: [
          {
            context: 'play',
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
                  reason: '目标角色体力已满，无法回复',
                },
              ],
            },
            effects: [
              ...heal('target', 1),
              { kind: 'log', template: '{self} 使用{usedAs}令 {target} 回复体力' },
            ],
          },
        ],
      },
    },
  ]
}

/** 以完整内置内容为底、注入合成回血牌的注册表 */
export function syntheticHealingRegistry(): Registry {
  return contentWith(syntheticHealingDocs())
}
