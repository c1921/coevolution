import { describe, expect, it } from 'vitest'
import { advance } from '../engine'
import { makeState } from '../testUtils'
import type { MakeStateOptions } from '../testUtils'
import { nextInt } from '../rng'
import type { GameState, SpeciesId } from '../types'
import { runEffect, runEffectGroup, runEffects } from './effect'
import { baseContext } from './runtime'
import type { EffectContext, EvalEnv } from './runtime'
import { findCardByUid } from './runtime'
import type { Effect } from './types'

type ScenarioOptions = Omit<MakeStateOptions, 'playerSpecies' | 'aiSpecies'>

function scenario(
  playerSpecies: SpeciesId,
  aiSpecies: SpeciesId,
  opts: ScenarioOptions = {},
): { state: GameState; ctx: EffectContext; env: EvalEnv } {
  const state = makeState({ playerSpecies, aiSpecies, ...opts })
  const ctx = baseContext(state, 0)
  return { state, ctx, env: { state, ctx } }
}

const CONST = (value: number): { kind: 'const'; value: number } => ({ kind: 'const', value })

function lastLog(state: GameState): string {
  return state.log[state.log.length - 1]?.text ?? ''
}

describe('效果解释器 · 基础指令', () => {
  it('log：按模板渲染战报', () => {
    const { state, ctx } = scenario('tiger', 'bear')
    runEffects(state, [{ kind: 'log', template: '{self} 做了一个测试' }], ctx)
    expect(lastLog(state)).toBe('🐯 虎 做了一个测试')
  })

  it('lose-hp：失去体力且不触发受到伤害后技能', () => {
    const { state, ctx } = scenario('tiger', 'bear', { playerHp: 3 })
    runEffects(state, [{ kind: 'lose-hp', target: 'self', amount: CONST(1) }], ctx)
    expect(state.players[0].hp).toBe(2)
    expect(state.lastDamage).toBeNull()
    // 失去体力到 0 及以下会进入濒死
    runEffects(state, [{ kind: 'lose-hp', target: 'self', amount: CONST(5) }], ctx)
    expect(state.stack[state.stack.length - 1]).toMatchObject({ kind: 'dying', dying: 0 })
  })

  it('heal：回复体力且不超过上限', () => {
    const { state, ctx } = scenario('deer', 'bear', { playerHp: 1 })
    runEffects(state, [{ kind: 'heal', target: 'self', amount: CONST(1) }], ctx)
    expect(state.players[0].hp).toBe(2)
    // 满血时回复不会溢出上限
    ctx.target = 1
    runEffects(state, [{ kind: 'heal', target: 'target', amount: CONST(9) }], ctx)
    expect(state.players[1].hp).toBe(state.players[1].maxHp)
  })

  it('damage：造成伤害并压入伤害帧（触发受到伤害后技能）', () => {
    const { state, ctx } = scenario('tiger', 'wolf')
    ctx.target = 1
    ctx.source = 0
    runEffects(state, [{ kind: 'damage', target: 'target', amount: CONST(1) }], ctx)
    expect(state.players[1].hp).toBe(3)
    expect(state.lastDamage).toMatchObject({ source: 0, target: 1, amount: 1 })
    expect(state.stack[state.stack.length - 1]).toMatchObject({ kind: 'damage' })
  })

  it('draw：摸牌并记战报，count 为延迟表达式也支持', () => {
    const { state, ctx } = scenario('tiger', 'bear', { playerHand: [] })
    runEffects(state, [{ kind: 'draw', target: 'self', count: CONST(2) }], ctx)
    expect(state.players[0].hand).toHaveLength(2)
    expect(lastLog(state)).toContain('摸了 2 张牌')
  })

  it('pay-energy / gain-energy：能量增减，不足时抛错', () => {
    const { state, ctx } = scenario('tiger', 'bear')
    runEffects(state, [{ kind: 'pay-energy', target: 'self', amount: CONST(2) }], ctx)
    expect(state.players[0].energy).toBe(1)
    runEffects(state, [{ kind: 'gain-energy', target: 'self', amount: CONST(1) }], ctx)
    expect(state.players[0].energy).toBe(2)
    expect(() =>
      runEffects(state, [{ kind: 'pay-energy', target: 'self', amount: CONST(99) }], ctx),
    ).toThrow('能量不足')
  })

  it('record-card-use / record-skill-use：写入使用记录', () => {
    const { state, ctx } = scenario('tiger', 'bear')
    runEffects(
      state,
      [
        { kind: 'record-card-use', of: 'self', cardKind: 'strike' },
        { kind: 'record-skill-use', skill: 'mend' },
      ],
      ctx,
    )
    expect(state.players[0].usedCardsThisTurn.strike).toBe(1)
    expect(state.players[0].usedSkillsThisTurn).toContain('mend')
  })

  it('skip-phase / extra-phase：操纵本回合阶段计划', () => {
    const { state, ctx } = scenario('tiger', 'bear', { phase: 'prepare' })
    runEffects(state, [{ kind: 'skip-phase', phase: 'play' }], ctx)
    expect(state.phaseQueue).not.toContain('play')
    runEffects(state, [{ kind: 'extra-phase', phase: 'draw', position: 'next' }], ctx)
    expect(state.phaseQueue[0]).toBe('draw')
  })

  it('if：按条件选择分支', () => {
    const { state, ctx } = scenario('leopard', 'bear', { playerHand: [{ kind: 'defend' }] })
    const card = state.players[0].hand[0]!
    const effect: Effect = {
      kind: 'if',
      condition: { kind: 'card-transformed' },
      then: [{ kind: 'log', template: '转化了' }],
      else: [{ kind: 'log', template: '没转化' }],
    }
    runEffects(state, [effect], ctx)
    expect(lastLog(state)).toBe('没转化')
    ctx.usedCard = { as: 'strike', source: card, via: 'flicker' }
    runEffects(state, [effect], ctx)
    expect(lastLog(state)).toBe('转化了')
  })
})

describe('效果解释器 · move-cards', () => {
  it('played：把已使用的牌从手牌移入处理区', () => {
    const { state, ctx } = scenario('tiger', 'bear', { playerHand: [{ kind: 'strike' }] })
    const card = state.players[0].hand[0]!
    ctx.usedUid = card.uid
    runEffects(
      state,
      [
        {
          kind: 'move-cards',
          from: { zone: 'hand', of: 'self' },
          to: { zone: 'processing', of: 'self' },
          pick: { mode: 'played' },
        },
      ],
      ctx,
    )
    expect(state.players[0].hand).toHaveLength(0)
    expect(state.processing).toEqual([{ card, owner: 0 }])
    expect(ctx.picked).toEqual([card.uid])
  })

  it('played：没有使用上下文时报错', () => {
    const { state, ctx } = scenario('tiger', 'bear', { playerHand: [{ kind: 'strike' }] })
    expect(() =>
      runEffects(
        state,
        [
          {
            kind: 'move-cards',
            from: { zone: 'hand', of: 'self' },
            to: { zone: 'processing', of: 'self' },
            pick: { mode: 'played' },
          },
        ],
        ctx,
      ),
    ).toThrow('played 取牌需要')
  })

  it('cost：按 ctx.costCards 弃置费用牌', () => {
    const { state, ctx } = scenario('tiger', 'bear', { playerHand: [{ kind: 'strike' }] })
    const card = state.players[0].hand[0]!
    ctx.costCards = [card.uid]
    runEffects(
      state,
      [
        {
          kind: 'move-cards',
          from: { zone: 'hand', of: 'self' },
          to: { zone: 'discard', of: 'self' },
          pick: { mode: 'cost' },
        },
      ],
      ctx,
    )
    expect(state.players[0].hand).toHaveLength(0)
    expect(state.players[0].discard.map((c) => c.uid)).toEqual([card.uid])
  })

  it('random：只消耗一次 nextInt，并在双方手牌之间转移', () => {
    const { state, ctx } = scenario('fox', 'bear', {
      aiHand: [{ kind: 'strike' }, { kind: 'defend' }, { kind: 'heal' }],
    })
    const before = state.rngState
    const expected = nextInt(before, 3)
    runEffects(
      state,
      [
        {
          kind: 'move-cards',
          from: { zone: 'hand', of: 'opponent' },
          to: { zone: 'hand', of: 'self' },
          pick: { mode: 'random', count: 1 },
        },
      ],
      ctx,
    )
    expect(state.rngState).toBe(expected.state)
    expect(state.players[0].hand).toHaveLength(1)
    expect(state.players[1].hand).toHaveLength(2)
    const moved = state.players[0].hand[0]!
    expect(findCardByUid(state, moved.uid)).toEqual(moved)
    expect(ctx.picked).toEqual([moved.uid])
  })

  it('specific：从处理区取回造成伤害的牌；牌不在处理区时静默跳过', () => {
    const { state, ctx } = scenario('wolf', 'bear', { playerHand: [{ kind: 'strike' }] })
    const card = state.players[0].hand[0]!
    const effect: Effect = {
      kind: 'move-cards',
      from: { zone: 'processing', of: 'self' },
      to: { zone: 'hand', of: 'self' },
      pick: { mode: 'specific', card: 'event-card' },
    }
    ctx.damage = { source: 1, target: 0, amount: 1, card: { as: 'strike', source: card } }
    // 还没进处理区
    runEffects(state, [effect], ctx)
    expect(ctx.picked).toEqual([])

    state.processing.push({ card, owner: 1 })
    runEffects(state, [effect], ctx)
    expect(state.processing).toHaveLength(0)
    expect(ctx.picked).toEqual([card.uid])
    expect(state.players[0].hand.map((c) => c.uid)).toContain(card.uid)
  })

  it('all：整片牌区迁移（可用于"弃置全部手牌"类效果）', () => {
    const { state, ctx } = scenario('tiger', 'bear', {
      playerHand: [{ kind: 'strike' }, { kind: 'defend' }],
    })
    runEffects(
      state,
      [
        {
          kind: 'move-cards',
          from: { zone: 'hand', of: 'self' },
          to: { zone: 'discard', of: 'self' },
          pick: { mode: 'all' },
        },
      ],
      ctx,
    )
    expect(state.players[0].hand).toHaveLength(0)
    expect(state.players[0].discard).toHaveLength(2)
  })
})

describe('效果解释器 · 帧与延迟', () => {
  it('contest：按通道读取 need 并等待响应', () => {
    const { state, ctx } = scenario('lion', 'bear', { playerHand: [{ kind: 'strike' }] })
    const card = state.players[0].hand[0]!
    ctx.usedUid = card.uid
    ctx.usedCard = { as: 'strike', source: card }
    ctx.target = 1
    state.processing.push({ card, owner: 0 })
    runEffects(
      state,
      [
        {
          kind: 'contest',
          responder: 'target',
          expectedCard: 'defend',
          need: { kind: 'channel', channel: 'defend-need-against', of: 'self' },
          onUnmet: [{ kind: 'damage', target: 'target', amount: CONST(1) }],
        },
      ],
      ctx,
    )
    expect(state.stack[0]).toMatchObject({
      kind: 'contest',
      need: 2,
      expected: 'defend',
      openedBy: 'strike',
    })

    advance(state)
    expect(state.pending).toMatchObject({ kind: 'respond', player: 1, expected: 'defend', need: 2 })
  })

  it('contest-contribute：必须有对抗帧，之后累加抵消进度', () => {
    const { state, ctx } = scenario('tiger', 'bear', { playerHand: [{ kind: 'strike' }] })
    const card = state.players[0].hand[0]!
    state.processing.push({ card, owner: 0 })
    ctx.usedCard = { as: 'strike', source: card }
    ctx.target = 1
    // 没有对抗帧时必须报错，而不是静默累加
    expect(() =>
      runEffects(state, [{ kind: 'contest-contribute', amount: CONST(1) }], ctx),
    ).toThrow('contest-contribute')

    runEffects(
      state,
      [
        {
          kind: 'contest',
          responder: 'target',
          expectedCard: 'defend',
          need: CONST(2),
        },
      ],
      ctx,
    )
    runEffects(state, [{ kind: 'contest-contribute', amount: CONST(1) }], ctx)
    expect(state.stack[state.stack.length - 1]).toMatchObject({ kind: 'contest', got: 1, need: 2 })
  })

  it('resolve-dying：体力回到 0 以上时弹出濒死帧', () => {
    const { state, ctx } = scenario('deer', 'bear', { playerHp: 0 })
    state.stack.push({ kind: 'dying', dying: 0, ask: [0, 1] })
    runEffects(state, [{ kind: 'heal', target: 'self', amount: CONST(1) }], ctx)
    runEffects(state, [{ kind: 'resolve-dying', of: 'self' }], ctx)
    expect(state.stack).toHaveLength(0)
    expect(lastLog(state)).toContain('脱离濒死状态')
  })

  it('runEffectGroup：after 先压栈，等当前结算链走完才执行（透支的语义）', () => {
    const { state, ctx } = scenario('ox', 'bear', { playerHp: 1 })
    runEffectGroup(
      state,
      {
        effects: [{ kind: 'lose-hp', target: 'self', amount: CONST(1) }],
        after: [{ kind: 'draw', target: 'self', count: CONST(2) }],
      },
      ctx,
    )
    // 失去体力导致濒死：延迟帧在栈底，摸牌尚未发生
    expect(state.players[0].hp).toBe(0)
    expect(state.stack.map((frame) => frame.kind)).toEqual(['effects', 'dying'])
    expect(state.players[0].hand).toHaveLength(0)

    // 自救后延迟帧才执行
    const heal: Effect = { kind: 'heal', target: 'self', amount: CONST(1) }
    runEffects(state, [heal], ctx)
    runEffects(state, [{ kind: 'resolve-dying', of: 'self' }], ctx)
    advance(state)
    expect(state.players[0].hand).toHaveLength(2)
  })

  it('runEffect：单条指令入口可用', () => {
    const { state, env } = scenario('tiger', 'bear')
    runEffect(env, { kind: 'log', template: '{turn}' })
    expect(lastLog(state)).toBe('1')
  })
})

describe('效果解释器 · for-each-target', () => {
  it('对每个选定目标各执行一次，并逐目标绑定 target', () => {
    const { state, ctx } = scenario('tiger', 'bear')
    ctx.targets = [0, 1]
    runEffects(
      state,
      [
        {
          kind: 'for-each-target',
          effects: [
            { kind: 'log', template: '{target} 受到测试效果' },
            { kind: 'lose-hp', target: 'target', amount: CONST(1) },
          ],
        },
      ],
      ctx,
    )
    expect(state.players[0].hp).toBe(3)
    expect(state.players[1].hp).toBe(3)
    // 多目标下外层不绑定 target，效果必须写在 for-each-target 内
    expect(ctx.target).toBeUndefined()
    expect(state.log.filter((entry) => entry.text.includes('受到测试效果'))).toHaveLength(2)
  })

  it('单目标语境退化为执行一次', () => {
    const { state, ctx } = scenario('tiger', 'bear')
    ctx.target = 1
    runEffects(
      state,
      [
        {
          kind: 'for-each-target',
          effects: [{ kind: 'lose-hp', target: 'target', amount: CONST(1) }],
        },
      ],
      ctx,
    )
    expect(state.players[0].hp).toBe(4)
    expect(state.players[1].hp).toBe(3)
  })

  it('迭代内的上下文写入不会冒泡到外层', () => {
    const { state, ctx } = scenario('tiger', 'bear')
    ctx.targets = [0, 1]
    runEffects(
      state,
      [
        {
          kind: 'for-each-target',
          effects: [{ kind: 'draw', target: 'target', count: CONST(1) }],
        },
      ],
      ctx,
    )
    expect(ctx.lastAmount).toBeUndefined()
    expect(state.players[0].hand).toHaveLength(1)
    expect(state.players[1].hand).toHaveLength(1)
  })

  it('没有绑定任何目标时抛错（文档与调用点不匹配）', () => {
    const { state, ctx } = scenario('tiger', 'bear')
    expect(() =>
      runEffects(
        state,
        [
          {
            kind: 'for-each-target',
            effects: [{ kind: 'lose-hp', target: 'target', amount: CONST(1) }],
          },
        ],
        ctx,
      ),
    ).toThrow(/for-each-target/)
  })
})
