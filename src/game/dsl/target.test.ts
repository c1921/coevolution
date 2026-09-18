import { describe, expect, it } from 'vitest'
import { makeState } from '../testUtils'
import type { MakeStateOptions } from '../testUtils'
import { baseContext } from './runtime'
import type { EvalEnv } from './runtime'
import type { SpeciesId } from '../types'
import { cardDoc, skillDoc } from './registry'
import {
  defaultTarget,
  hasTargetCandidate,
  resolveTargetChoice,
  targetCandidates,
} from './target'
import type { TargetSpec } from './types'

/** 取内置文档里的目标规格，保证测试与内容文档同步 */
function mendTarget(): TargetSpec {
  const spec = skillDoc('mend').activate?.target
  if (!spec) throw new Error('疗愈缺少 target')
  return spec
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
  it('疗愈：候选是所有已受伤的角色', () => {
    const bothWounded = envOf('deer', 'bear', { playerHp: 2, aiHp: 2 })
    expect(targetCandidates(bothWounded, mendTarget())).toEqual([0, 1])
    expect(hasTargetCandidate(bothWounded, mendTarget())).toBe(true)

    const onlyOpponent = envOf('deer', 'bear', { aiHp: 2 })
    expect(targetCandidates(onlyOpponent, mendTarget())).toEqual([1])

    const nobodyWounded = envOf('deer', 'bear')
    expect(targetCandidates(nobodyWounded, mendTarget())).toEqual([])
    expect(hasTargetCandidate(nobodyWounded, mendTarget())).toBe(false)
  })

  it('疗愈：缺省目标是自己（与界面"不选目标就治自己"一致）', () => {
    const bothWounded = envOf('deer', 'bear', { playerHp: 2, aiHp: 2 })
    expect(defaultTarget(bothWounded, mendTarget())).toBe(0)
    expect(resolveTargetChoice(bothWounded, mendTarget())).toEqual({ ok: true, target: 0 })

    // 自己满血、只有对手受伤时，缺省目标不合法——必须显式指定
    const onlyOpponent = envOf('deer', 'bear', { aiHp: 2 })
    expect(defaultTarget(onlyOpponent, mendTarget())).toBe(0)
    // 说明文案来自文档里条件的 reason
    expect(resolveTargetChoice(onlyOpponent, mendTarget())).toEqual({
      ok: false,
      reason: '目标角色体力已满，无法回复',
    })
    expect(resolveTargetChoice(onlyOpponent, mendTarget(), 1)).toEqual({ ok: true, target: 1 })
  })

  it('疗愈：目标必须已受伤', () => {
    const env = envOf('deer', 'bear', { playerHp: 2 })
    // 对手满血，不能作为目标
    expect(resolveTargetChoice(env, mendTarget(), 1)).toEqual({
      ok: false,
      reason: '目标角色体力已满，无法回复',
    })
  })

  it('打击：目标是唯一候选的对手，且可用 range 约束', () => {
    const env = envOf('tiger', 'bear')
    expect(targetCandidates(env, strikeTarget())).toEqual([1])
    expect(defaultTarget(env, strikeTarget())).toBe(1)
    expect(resolveTargetChoice(env, strikeTarget())).toEqual({ ok: true, target: 1 })
  })

  it('回复：出牌阶段目标是自己，濒死时目标是濒死者', () => {
    const env = envOf('deer', 'bear')
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
    const env = envOf('tiger', 'bear')
    env.state.players[1].alive = false
    expect(targetCandidates(env, strikeTarget())).toEqual([])
    expect(hasTargetCandidate(env, strikeTarget())).toBe(false)
  })
})
