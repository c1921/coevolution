import { log } from '../log'
import { loseHp } from '../rules/damage'
import { recordCardUse, recordSkillUse } from '../rules/usage'
import type { GameState } from '../types'
import { RuleError } from '../util'
import { evalCondition } from './condition'
import {
  addExtraPhaseFor,
  contributeToContest,
  drawFor,
  gainEnergy,
  healHp,
  moveCards,
  offsetThreatFor,
  pushContestFrame,
  pushEffectsFrame,
  resolveDying,
  skipPhaseFor,
  spendEnergy,
  threatFor,
} from './internal'
import { assertNever, requireRole } from './runtime'
import type { EffectContext, EvalEnv } from './runtime'
import { renderLog } from './template'
import { evalValue } from './value'
import type { Effect } from './types'

/**
 * 效果解释器：DSL 文档里每条指令的唯一执行入口。
 *
 * 语义约定（见 docs/dsl.md 第 7 节）：
 *  - **effects 立即按声明顺序执行**；需要"等当前结算链走完再执行"的指令写在 `after` 里，
 *    由 runEffectGroup 压成 Frame.effects（LIFO），例如「先失去体力濒死、存活后才摸牌」。
 *  - 解释器不判断内容，只按文档派发；具体机制全部落在 internal.ts 的原语上。
 *  - switch 以 assertNever 收尾：新增指令种类时漏实现会直接编译报错。
 */

/** 执行一组效果（立即，按声明顺序） */
export function runEffects(
  state: GameState,
  effects: readonly Effect[],
  ctx: EffectContext,
): void {
  const env: EvalEnv = { state, ctx }
  for (const effect of effects) runEffect(env, effect)
}

/**
 * 执行「effects + after」：先压入 after 的延迟帧，再立即执行 effects。
 * 顺序很关键——延迟帧必须先压栈，才能在当前效果（含濒死）之后结算。
 */
export function runEffectGroup(
  state: GameState,
  group: { effects: readonly Effect[]; after?: readonly Effect[] },
  ctx: EffectContext,
): void {
  if (group.after && group.after.length > 0) pushEffectsFrame(state, group.after, ctx)
  runEffects(state, group.effects, ctx)
}

export function runEffect(env: EvalEnv, effect: Effect): void {
  const { state, ctx } = env
  switch (effect.kind) {
    case 'log':
      log(state, renderLog(env, effect))
      return

    case 'threat': {
      const amount = evalValue(env, effect.amount)
      ctx.lastAmount = amount
      threatFor(state, env, effect.target, amount)
      return
    }

    case 'offset-threat': {
      const amount = evalValue(env, effect.amount)
      ctx.lastAmount = amount
      offsetThreatFor(state, env, effect.target, amount)
      return
    }

    case 'lose-hp': {
      const amount = evalValue(env, effect.amount)
      ctx.lastAmount = amount
      loseHp(state, requireRole(env, effect.target), amount)
      return
    }

    case 'heal': {
      const amount = evalValue(env, effect.amount)
      ctx.lastAmount = amount
      healHp(state, requireRole(env, effect.target), amount)
      return
    }

    case 'draw': {
      const count = evalValue(env, effect.count)
      ctx.lastAmount = count
      drawFor(state, requireRole(env, effect.target), count)
      return
    }

    case 'move-cards':
      moveCards(state, env, effect)
      return

    case 'pay-energy':
      spendEnergy(state, requireRole(env, effect.target), evalValue(env, effect.amount))
      return

    case 'gain-energy':
      gainEnergy(state, requireRole(env, effect.target), evalValue(env, effect.amount))
      return

    case 'record-card-use':
      recordCardUse(state, requireRole(env, effect.of), effect.cardKind)
      return

    case 'record-skill-use':
      recordSkillUse(state, ctx.self, effect.skill)
      return

    case 'contest':
      pushContestFrame(state, env, effect)
      return

    case 'contest-contribute':
      contributeToContest(state, env, evalValue(env, effect.amount))
      return

    case 'resolve-dying':
      resolveDying(state, env, effect.of)
      return

    case 'skip-phase':
      skipPhaseFor(state, effect.phase)
      return

    case 'extra-phase':
      addExtraPhaseFor(state, effect.phase, effect.position)
      return

    case 'for-each-target': {
      // 多目标结算：逐个把 target 绑定到目标上再执行子效果。
      // 每次迭代用**子上下文**，因此迭代内的 lastAmount / picked 不会冒泡到外层。
      const targets =
        ctx.targets && ctx.targets.length > 0
          ? ctx.targets
          : ctx.target === undefined
            ? []
            : [ctx.target]
      if (targets.length === 0) {
        throw new RuleError('for-each-target 需要目标，但当前结算语境没有绑定 target')
      }
      for (const target of targets) {
        runEffects(state, effect.effects, { ...ctx, target })
      }
      return
    }

    case 'if': {
      const branch = evalCondition(env, effect.condition) ? effect.then : effect.else
      if (branch) runEffects(state, branch, ctx)
      return
    }

    default:
      return assertNever(effect, '效果指令')
  }
}
