import { describe, expect, it } from 'vitest'
import { baseDocs, mutateDoc } from './fixtures'
import type { RawFixtureDoc } from './fixtures'
import { validateDocs } from './validate'
import type { Issue, IssueCode } from './validate'

/** 只跑校验，返回问题列表 */
function issuesOf(docs: RawFixtureDoc[]): Issue[] {
  return validateDocs(docs).issues
}

/**
 * 断言恰好出现一次某个错误码，并返回该问题。
 * 注意：校验器会一次报出全部问题，一个错误常常连带产生衍生问题（例如悬空引用
 * 会让被引用的技能变成 dead-doc），所以这里只锁目标错误码。
 */
function expectSingle(docs: RawFixtureDoc[], code: IssueCode): Issue {
  const hits = issuesOf(docs).filter((issue) => issue.code === code)
  expect(hits).toHaveLength(1)
  return hits[0] as Issue
}

describe('DSL 校验器 · 信封', () => {
  it('合法文档集没有问题', () => {
    expect(issuesOf(baseDocs())).toEqual([])
  })

  it('dslVersion 必须匹配', () => {
    const issue = expectSingle(
      mutateDoc('species/tiger.json', (doc) => {
        doc.dslVersion = 99
      }),
      'version',
    )
    expect(issue.path).toBe('species/tiger.json#/dslVersion')
  })

  it('未知文档种类直接拒绝', () => {
    expectSingle(
      mutateDoc('species/tiger.json', (doc) => {
        doc.kind = 'monster'
      }),
      'unknown-kind',
    )
  })

  it('严格字段：多余键（拼写错误）会报错', () => {
    const issue = expectSingle(
      mutateDoc('species/tiger.json', (doc) => {
        doc.Kind = 'species'
      }),
      'unknown-key',
    )
    expect(issue.path).toBe('species/tiger.json#/Kind')
  })

  it('缺少必填字段会报错', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        delete doc.cost
      }),
      'missing-field',
    )
  })

  it('id 全局唯一', () => {
    const docs = baseDocs()
    docs.push({
      path: 'species/fox.json',
      value: {
        dslVersion: 1,
        kind: 'species',
        id: 'tiger',
        name: '狐',
        emoji: '🦊',
        maxHp: 3,
        skills: ['roar'],
        deck: 'basic',
      },
    })
    expect(issuesOf(docs).map((issue) => issue.code)).toContain('duplicate-id')
  })
})

describe('DSL 校验器 · 数值与条件', () => {
  it('未知数值节点种类', () => {
    expectSingle(
      mutateDoc('skills/roar.json', (doc) => {
        doc.modifiers = [{ channel: 'energy-max', op: 'add', value: { kind: 'power', value: 2 } }]
      }),
      'unknown-instruction',
    )
  })

  it('未知通道', () => {
    expectSingle(
      mutateDoc('skills/roar.json', (doc) => {
        doc.modifiers = [{ channel: 'mana-max', op: 'add', value: { kind: 'const', value: 2 } }]
      }),
      'unknown-channel',
    )
  })

  it('ruleset 必须为每个通道给出基准值', () => {
    const issues = issuesOf(
      mutateDoc('rules/base.json', (doc) => {
        delete (doc.channels as Record<string, unknown>)['attack-range']
      }),
    )
    expect(issues.map((issue) => issue.code)).toEqual(['missing-field'])
    expect(issues[0]?.path).toBe('rules/base.json#/channels#/attack-range')
  })

  it('未知条件种类', () => {
    expectSingle(
      mutateDoc('rules/base.json', (doc) => {
        doc.kind = 'rule'
        delete doc.channels
        doc.on = { at: 'turn-start' }
        doc.effects = [
          { kind: 'if', condition: { kind: 'moon-phase' }, then: [{ kind: 'log', template: 'x' }] },
        ]
      }),
      'unknown-condition',
    )
  })

  it('条件列表不能为空', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.requires = []
      }),
      'bad-combination',
    )
  })
})

describe('DSL 校验器 · 效果', () => {
  it('未知指令种类', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [{ kind: 'execute', code: 'x' }]
      }),
      'unknown-instruction',
    )
  })

  it('费用必须 ≥ 1（防止 0 费 + 无限打击）', () => {
    const issue = expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        doc.cost = { kind: 'const', value: 0 }
      }),
      'cost-below-minimum',
    )
    expect(issue.path).toBe('cards/strike.json#/cost#/value')
  })

  it('取牌方式与牌区必须匹配', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          {
            kind: 'move-cards',
            from: { zone: 'processing', of: 'self' },
            to: { zone: 'hand', of: 'self' },
            pick: { mode: 'random', count: 1 },
          },
        ]
      }),
      'bad-combination',
    )
  })

  it('specific 只能从处理区取牌', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          {
            kind: 'move-cards',
            from: { zone: 'hand', of: 'self' },
            to: { zone: 'hand', of: 'self' },
            pick: { mode: 'specific', card: 'event-card' },
          },
        ]
      }),
      'bad-combination',
    )
  })

  it('deck 只能由 draw 访问，move-cards 不接受 deck', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          {
            kind: 'move-cards',
            from: { zone: 'deck', of: 'self' },
            to: { zone: 'hand', of: 'self' },
            pick: { mode: 'all' },
          },
        ]
      }),
      'bad-combination',
    )
  })

  it('contest-contribute 只能出现在卡牌的 play 变体里', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          { kind: 'contest-contribute', amount: { kind: 'const', value: 1 } },
        ]
      }),
      'bad-combination',
    )
  })
})

describe('DSL 校验器 · 日志模板', () => {
  it('未知占位符', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          { kind: 'log', template: '{who} 出手' },
        ]
      }),
      'bad-placeholder',
    )
  })

  it('玩家占位符的字段必须在白名单内', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          { kind: 'log', template: '{self.mana}' },
        ]
      }),
      'bad-placeholder',
    )
  })

  it('当前语境不允许的角色会报错', () => {
    // use-play 语境没有 source 角色
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          { kind: 'log', template: '{source} 出手' },
        ]
      }),
      'unknown-role',
    )
  })

  it('花括号不配对', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          { kind: 'log', template: '{self} 出手{' },
        ]
      }),
      'bad-placeholder',
    )
  })

  it('vars 只能绑定数值类占位符', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        ;(doc.use as Record<string, unknown>[])[0]!.effects = [
          { kind: 'log', template: '{self} 出手', vars: { usedAs: { kind: 'const', value: 1 } } },
        ]
      }),
      'bad-placeholder',
    )
  })
})

describe('DSL 校验器 · 引用与死文档', () => {
  it('技能引用必须可解析', () => {
    const issue = expectSingle(
      mutateDoc('species/tiger.json', (doc) => {
        doc.skills = ['nope']
      }),
      'unknown-ref',
    )
    // 悬空引用同时使 roar 变成死文档，因此这里只断言引用问题本身
    expect(issue.path).toBe('species/tiger.json#/skills/0')
  })

  it('牌组引用的牌种必须存在', () => {
    expectSingle(
      mutateDoc('decks/basic.json', (doc) => {
        doc.cards = [{ kind: 'hex', count: 1 }]
      }),
      'unknown-ref',
    )
  })

  it('未被任何物种引用的技能是死文档', () => {
    const docs = baseDocs()
    docs.push({
      path: 'skills/ghost.json',
      value: {
        dslVersion: 1,
        kind: 'skill',
        id: 'ghost',
        name: '幽灵',
        text: '没有被引用。',
        modifiers: [{ channel: 'energy-max', op: 'add', value: { kind: 'const', value: 1 } }],
      },
    })
    const issue = expectSingle(docs, 'dead-doc')
    expect(issue.path).toBe('/ghost')
  })

  it('ruleset 必须恰好一份', () => {
    const docs = baseDocs()
    docs.push({
      path: 'rules/extra.json',
      value: {
        dslVersion: 1,
        kind: 'ruleset',
        id: 'extra',
        channels: {
          'energy-max': 3,
          'defend-need-against': 1,
          'draw-count': 2,
          'hand-limit': 0,
          'card-cost': 0,
          'attack-range': 1,
        },
      },
    })
    const codes = issuesOf(docs).map((issue) => issue.code)
    expect(codes).toContain('duplicate-id')
  })
})

describe('DSL 校验器 · 技能与卡牌结构', () => {
  it('技能必须至少声明一种效果', () => {
    expectSingle(
      mutateDoc('skills/roar.json', (doc) => {
        delete doc.modifiers
      }),
      'bad-combination',
    )
  })

  it('卡牌必须有 use 或 play', () => {
    expectSingle(
      mutateDoc('cards/strike.json', (doc) => {
        delete doc.use
      }),
      'bad-combination',
    )
  })

  it('可选发动的触发技能目前只支持 after-damage', () => {
    expectSingle(
      mutateDoc('skills/roar.json', (doc) => {
        delete doc.modifiers
        doc.trigger = {
          on: { at: 'turn-start' },
          optional: true,
          effects: [{ kind: 'log', template: '{self} 触发' }],
        }
      }),
      'bad-combination',
    )
  })

  it('转化的语境必须是 use / play', () => {
    expectSingle(
      mutateDoc('skills/roar.json', (doc) => {
        delete doc.modifiers
        doc.transforms = [{ from: 'strike', to: 'strike', contexts: ['discard'] }]
      }),
      'bad-type',
    )
  })

  it('转化的 to 端必须在该语境真的有用法', () => {
    // strike 没有 play 变体（只能被使用，不能被"打出"），把它当作打出目标毫无意义
    expectSingle(
      mutateDoc('skills/roar.json', (doc) => {
        delete doc.modifiers
        doc.transforms = [{ from: 'strike', to: 'strike', contexts: ['play'] }]
      }),
      'bad-combination',
    )
  })

  it('主动技的 timing 目前只支持 play', () => {
    expectSingle(
      mutateDoc('skills/roar.json', (doc) => {
        delete doc.modifiers
        doc.activate = {
          timing: 'draw',
          effects: [{ kind: 'log', template: '{self} 发动' }],
        }
      }),
      'bad-type',
    )
  })
})
