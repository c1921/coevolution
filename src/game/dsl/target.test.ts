import { describe, expect, it } from 'vitest'
import { makeState } from '../testUtils'
import type { MakeStateOptions } from '../testUtils'
import { baseContext } from './runtime'
import type { EvalEnv } from './runtime'
import type { SpeciesId } from '../types'
import { cardDoc } from './registry'
import {
  defaultTarget,
  hasTargetCandidate,
  resolveTargetChoice,
  resolveTargetChoices,
  targetCandidates,
  targetScopeMembers,
} from './target'
import type { TargetSpec } from './types'

/** 取内置文档里的目标规格，保证测试与内容文档同步。
 *  主动技只剩【强袭】，带「已受伤」条件的目标规格改由【急救】牌提供（两者的规格一致）。 */
function firstAidTarget(): TargetSpec {
  const variant = cardDoc('first-aid').use?.find((item) => item.context === 'play')
  if (!variant?.target) throw new Error('急救缺少 target')
  return variant.target
}

function strikeTarget(): TargetSpec {
  const variant = cardDoc('strike').use?.find((item) => item.context === 'play')
  if (!variant?.target) throw new Error('打击缺少 target')
  return variant.target
}

function healTarget(context: 'play' | 'dying'): TargetSpec {
  const variant = cardDoc('heal').use?.find((item) => item.context === context)
  if (!variant?.target) throw new Error(`回复缺少 ${context} 的 target`)
  return variant.target
}

type ScenarioOptions = Omit<MakeStateOptions, 'playerSpecies' | 'aiSpecies'>

function envOf(
  playerSpecies: SpeciesId,
  aiSpecies: SpeciesId,
  opts: ScenarioOptions = {},
): EvalEnv {
  const state = makeState({ playerSpecies, aiSpecies, ...opts })
  return { state, ctx: baseContext(state, 0) }
}

describe('目标选取', () => {
  it('急救：候选是所有已受伤的角色', () => {
    const bothWounded = envOf('counter', 'defensive', { playerHp: 2, aiHp: 2 })
    expect(targetCandidates(bothWounded, firstAidTarget())).toEqual([0, 1])
    expect(hasTargetCandidate(bothWounded, firstAidTarget())).toBe(true)

    const onlyOpponent = envOf('counter', 'defensive', { aiHp: 2 })
    expect(targetCandidates(onlyOpponent, firstAidTarget())).toEqual([1])

    const nobodyWounded = envOf('counter', 'defensive')
    expect(targetCandidates(nobodyWounded, firstAidTarget())).toEqual([])
    expect(hasTargetCandidate(nobodyWounded, firstAidTarget())).toBe(false)
  })

  it('急救：缺省目标是自己（与界面"不选目标就治自己"一致）', () => {
    const bothWounded = envOf('counter', 'defensive', { playerHp: 2, aiHp: 2 })
    expect(defaultTarget(bothWounded, firstAidTarget())).toBe(0)
    expect(resolveTargetChoice(bothWounded, firstAidTarget())).toEqual({ ok: true, target: 0 })

    // 自己满血、只有对手受伤时，缺省目标不合法——必须显式指定
    const onlyOpponent = envOf('counter', 'defensive', { aiHp: 2 })
    expect(defaultTarget(onlyOpponent, firstAidTarget())).toBe(0)
    // 说明文案来自文档里条件的 reason
    expect(resolveTargetChoice(onlyOpponent, firstAidTarget())).toEqual({
      ok: false,
      reason: '目标角色体力已满，无法回复',
    })
    expect(resolveTargetChoice(onlyOpponent, firstAidTarget(), 1)).toEqual({ ok: true, target: 1 })
  })

  it('急救：目标必须已受伤', () => {
    const env = envOf('counter', 'defensive', { playerHp: 2 })
    // 对手满血，不能作为目标
    expect(resolveTargetChoice(env, firstAidTarget(), 1)).toEqual({
      ok: false,
      reason: '目标角色体力已满，无法回复',
    })
  })

  it('打击：目标是唯一候选的对手，且可用 range 约束', () => {
    const env = envOf('offensive', 'defensive')
    expect(targetCandidates(env, strikeTarget())).toEqual([1])
    expect(defaultTarget(env, strikeTarget())).toBe(1)
    expect(resolveTargetChoice(env, strikeTarget())).toEqual({ ok: true, target: 1 })
  })

  it('回复：出牌阶段目标是自己，濒死时目标是濒死者', () => {
    const env = envOf('counter', 'defensive')
    expect(targetCandidates(env, healTarget('play'))).toEqual([0])
    expect(resolveTargetChoice(env, healTarget('play'))).toEqual({ ok: true, target: 0 })

    const dying: EvalEnv = { state: env.state, ctx: { ...env.ctx, dying: 1 } }
    expect(targetCandidates(dying, healTarget('dying'))).toEqual([1])
    // 濒死语境必须显式给出濒死者
    expect(resolveTargetChoice(dying, healTarget('dying'))).toEqual({
      ok: false,
      reason: '必须指定一个目标',
    })
    expect(resolveTargetChoice(dying, healTarget('dying'), 1)).toEqual({ ok: true, target: 1 })
    // 没有濒死者时没有候选
    expect(targetCandidates(env, healTarget('dying'))).toEqual([])
  })

  it('阵亡角色不会成为候选', () => {
    const env = envOf('offensive', 'defensive')
    env.state.players[1].alive = false
    expect(targetCandidates(env, strikeTarget())).toEqual([])
    expect(hasTargetCandidate(env, strikeTarget())).toBe(false)
    // 候选为空即「没有符合条件的目标」：不能无目标地继续结算
    // （攻击范围、存活条件这类修正都能让候选变空）
    expect(resolveTargetChoice(env, strikeTarget())).toEqual({
      ok: false,
      reason: '没有符合条件的目标',
    })
  })

  it('scope 成员集是过滤前的集合（目标选择器据此列出"为什么不能选"）', () => {
    // 自己满血、对手受伤：候选只剩对手，但成员集仍是双方
    const env = envOf('counter', 'defensive', { aiHp: 2 })
    expect(targetCandidates(env, firstAidTarget())).toEqual([1])
    expect(targetScopeMembers(env, firstAidTarget())).toEqual([0, 1])

    // 阵亡者仍是 scope 成员，但被 alive 过滤掉
    env.state.players[1].alive = false
    expect(targetScopeMembers(env, strikeTarget())).toEqual([1])
    expect(targetCandidates(env, strikeTarget())).toEqual([])

    // dying scope 没有濒死者时成员集为空
    expect(targetScopeMembers(env, healTarget('dying'))).toEqual([])
    const dying: EvalEnv = { state: env.state, ctx: { ...env.ctx, dying: 1 } }
    expect(targetScopeMembers(dying, healTarget('dying'))).toEqual([1])
  })
})

describe('多目标选取', () => {
  const allSpec: TargetSpec = { scope: 'any', alive: true, count: { mode: 'all' } }
  const exactly = (count: number): TargetSpec => ({
    scope: 'any',
    alive: true,
    count: { mode: 'exactly', count: { kind: 'const', value: count } },
  })

  it('all：不需要选择，作用于全部合法候选（按座次序）', () => {
    const env = envOf('offensive', 'defensive')
    expect(resolveTargetChoices(env, allSpec)).toEqual({ ok: true, targets: [0, 1] })
    // 显式给出同样的集合也接受
    expect(resolveTargetChoices(env, allSpec, [1, 0])).toEqual({ ok: true, targets: [0, 1] })
    expect(resolveTargetChoices(env, allSpec, [0])).toEqual({
      ok: false,
      reason: '该效果作用于全部合法目标，不能只指定其中一部分',
    })
  })

  it('all：候选为空时拒绝（阵亡者不算候选）', () => {
    const env = envOf('offensive', 'defensive')
    env.state.players[1].alive = false
    const opponentOnly: TargetSpec = { scope: 'opponent', alive: true, count: { mode: 'all' } }
    expect(resolveTargetChoices(env, opponentOnly)).toEqual({
      ok: false,
      reason: '没有符合条件的目标',
    })
  })

  it('exactly：必须显式指定恰好 N 个互不重复的目标', () => {
    const env = envOf('offensive', 'defensive')
    expect(resolveTargetChoices(env, exactly(2))).toEqual({ ok: false, reason: '必须指定 2 个目标' })
    expect(resolveTargetChoices(env, exactly(2), [0, 1])).toEqual({ ok: true, targets: [0, 1] })
    // 目标顺序按玩家指定的顺序保留（for-each-target 会照此结算）
    expect(resolveTargetChoices(env, exactly(2), [1, 0])).toEqual({ ok: true, targets: [1, 0] })
    expect(resolveTargetChoices(env, exactly(2), [0, 0])).toEqual({ ok: false, reason: '目标有重复' })
    expect(resolveTargetChoices(env, exactly(2), [0])).toEqual({ ok: false, reason: '必须指定 2 个目标' })
  })

  it('exactly：候选不足时明确报「不足」', () => {
    const env = envOf('offensive', 'defensive')
    env.state.players[1].alive = false
    expect(resolveTargetChoices(env, exactly(2))).toEqual({
      ok: false,
      reason: '符合条件的目标不足 2 个',
    })
  })

  it('exactly 1 等价于「必须指定一个目标」', () => {
    const env = envOf('offensive', 'defensive')
    expect(resolveTargetChoices(env, exactly(1))).toEqual({ ok: false, reason: '必须指定 1 个目标' })
    expect(resolveTargetChoices(env, exactly(1), [1])).toEqual({ ok: true, targets: [1] })
  })

  it('多目标同样按条件过滤，并沿用文档 reason', () => {
    const wounded: TargetSpec = {
      scope: 'any',
      alive: true,
      count: { mode: 'exactly', count: { kind: 'const', value: 2 } },
      conditions: [
        {
          kind: 'compare',
          op: 'lt',
          left: { kind: 'ref', ref: 'hp', of: 'target' },
          right: { kind: 'ref', ref: 'maxHp', of: 'target' },
          reason: '目标角色体力已满，无法回复',
        },
      ],
    }
    const bothWounded = envOf('counter', 'defensive', { playerHp: 2, aiHp: 2 })
    expect(resolveTargetChoices(bothWounded, wounded, [0, 1])).toEqual({ ok: true, targets: [0, 1] })
    expect(resolveTargetChoices(bothWounded, wounded, [0])).toEqual({
      ok: false,
      reason: '必须指定 2 个目标',
    })

    const onlyPlayerWounded = envOf('counter', 'defensive', { playerHp: 2 })
    expect(resolveTargetChoices(onlyPlayerWounded, wounded, [0, 1])).toEqual({
      ok: false,
      reason: '目标角色体力已满，无法回复',
    })
    expect(resolveTargetChoices(onlyPlayerWounded, wounded, [0])).toEqual({
      ok: false,
      reason: '符合条件的目标不足 2 个',
    })
  })

  it('单选规格仍拒绝多个目标（resolveTargetChoices 入口）', () => {
    const env = envOf('offensive', 'defensive')
    expect(resolveTargetChoices(env, strikeTarget(), [0, 1])).toEqual({
      ok: false,
      reason: '该效果只能指定一个目标',
    })
  })
})
