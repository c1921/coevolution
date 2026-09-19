import { runEffects } from '../dsl/effect'
import { runTrigger } from '../dsl/event'
import { log, playerLabel } from '../log'
import { flushProcessing } from '../rules/cardZones'
import { killPlayer } from '../rules/death'
import { pushDying } from '../rules/dying'
import { removeCandidates, serviceOptions, upgradeCandidates } from '../rules/reward'
import { advanceTurn } from '../rules/turn'
import type { Frame, GameState } from '../types'

/**
 * 结算推进：反复处理结算栈顶与回合流程，直到停在需要（人或 AI）输入的点上
 * 或对局结束。
 *
 * 这里是**结算帧栈**（continuation stack）的唯一消费者：`stepFrame` 每次处理
 * 栈顶一帧，返回 true 表示"已经生成待输入项，应立刻返回给调用方"。
 * 帧的**压入**分散在效果指令（dsl/primitives.ts）与规则（rules/*）里，
 * 但顺序保证只由这里的循环决定，因此顺序可测、可读。
 */

/** 结算推进步数上限，用于把死循环变成显式报错 */
const MAX_ADVANCE_STEPS = 10000

export function advance(state: GameState): void {
  let guard = 0
  while (true) {
    if (++guard > MAX_ADVANCE_STEPS) {
      throw new Error('结算推进步数超限，疑似死循环')
    }
    if (state.result) {
      state.pending = null
      return
    }

    const top = state.stack[state.stack.length - 1]
    if (top) {
      if (stepFrame(state, top)) return
      continue
    }

    // 结算栈已空，交给回合流程；回合流程可能又压入结算帧（例如消耗战导致濒死）
    state.pending = null
    if (advanceTurn(state) === 'continue') continue
    return
  }
}

/** 推进栈顶帧；返回 true 表示已经生成待输入项（应立即返回给调用方） */
function stepFrame(state: GameState, top: Frame): boolean {
  switch (top.kind) {
    case 'contest': {
      // need 为 0 或已凑够响应牌，都视为对抗结束：结算收尾后返回
      if (top.need <= 0 || top.got >= top.need) {
        state.stack.pop()
        state.stack.push({ kind: 'flush', cards: top.spent })
        return false
      }
      state.pending = {
        kind: 'respond',
        player: top.target,
        expected: top.expected,
        need: top.need,
        got: top.got,
        source: top.source,
        card: top.card,
      }
      return true
    }

    case 'damage': {
      const trigger = top.triggers[0]
      if (trigger) {
        if (!trigger.optional) {
          // 不可选的触发立即执行（仍在濒死检查之前）
          top.triggers.shift()
          runTrigger(state, trigger, { damage: top.ctx })
          return false
        }
        state.pending = { kind: 'trigger', player: trigger.owner, skill: trigger.skill }
        return true
      }
      state.stack.pop()
      const target = state.players[top.ctx.target]
      if (target.alive && target.hp <= 0) pushDying(state, top.ctx.target)
      return false
    }

    case 'dying': {
      const next = top.ask[0]
      if (next === undefined) {
        // 无人救援：死亡结算
        state.stack.pop()
        killPlayer(state, top.dying)
        return false
      }
      state.pending = { kind: 'dying', player: next, dying: top.dying }
      return true
    }

    case 'flush': {
      flushProcessing(state, top.cards)
      state.stack.pop()
      return false
    }

    case 'effects': {
      // 延迟效果帧：当前结算链走完后执行（after 列表）
      state.stack.pop()
      runEffects(state, top.effects, top.ctx)
      return false
    }

    case 'reward': {
      // 第一步：升级 / 移除已经选定，等玩家在自己的候选里挑一张
      const pick = top.pendingPick
      if (pick) {
        const candidates =
          pick.purpose === 'upgrade'
            ? upgradeCandidates(state, pick.player)
            : removeCandidates(state, pick.player)
        if (candidates.length === 0) {
          // 合法性已挡住"没有候选还选升级/移除"，这里只是兜底，避免出现无解的待输入项
          top.pendingPick = undefined
          top.ask.shift()
          return false
        }
        state.pending = {
          kind: 'pick-card',
          player: pick.player,
          purpose: pick.purpose,
          // 候选当场现算（按 uid 升序），保证界面看到的与提交时校验的是同一份
          candidates: candidates.map((card) => ({ ...card })),
        }
        return true
      }

      // 第二步：队列空了就弹栈
      const next = top.ask[0]
      if (next === undefined) {
        state.stack.pop()
        return false
      }

      // 服务奖励若三项都不可用（满血且无牌可升且不能移除），跳过该玩家，避免死锁
      if (top.reward === 'service') {
        const available = serviceOptions(state, next, top)
        if (!available.upgrade && !available.remove && !available.heal) {
          log(state, `${playerLabel(state, next)} 没有可用的奖励选项，跳过`)
          top.ask.shift()
          return false
        }
      }

      state.pending = {
        kind: 'reward',
        player: next,
        reward: top.reward,
        ...(top.cards !== undefined ? { cards: top.cards } : {}),
        allowSkip: top.allowSkip,
      }
      return true
    }
  }
}
