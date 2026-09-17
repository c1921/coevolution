import { log, playerLabel } from '../log'
import type { GameState, PlayerIndex } from '../types'
import { otherPlayer } from '../util'
import { drawCards } from './cardZones'
import { loseHp } from './damage'

/** 每回合摸牌数 */
export const DRAW_PER_TURN = 2
/** 先手玩家第一回合的摸牌数（先手补偿，比后手少摸一张） */
export const FIRST_TURN_DRAW = 1
/** 起手手牌数 */
export const INITIAL_HAND = 4

/**
 * 消耗战（加时规则）：从这一回合开始，每回合开始时回合角色失去体力。
 * 三张基本牌的 1v1 里双方可以互相抵消到天荒地老（例如鹿每回合回 1 点、
 * 疾影把每次【打击】都挡掉），牌堆又会无限洗回，因此必须有一条终止压力。
 * 体力流失每 ATTRITION_STEP 回合 +1，最终必定超过任何回复能力，保证对局必然结束。
 */
export const ATTRITION_TURN = 21
export const ATTRITION_STEP = 5

/** 第 turn 回合的消耗战体力流失量（0 表示尚未进入消耗战） */
export function attritionLoss(turn: number): number {
  if (turn < ATTRITION_TURN) return 0
  return 1 + Math.floor((turn - ATTRITION_TURN) / ATTRITION_STEP)
}

/** advanceTurn 的推进结果 */
export type TurnProgress =
  /** 已生成待输入项，等待人或 AI 决策 */
  | 'pending'
  /** 推进过程中压入了结算帧（例如消耗战导致濒死），调用方应继续处理结算栈 */
  | 'continue'
  /** 对局已结束 */
  | 'over'

/** 回合开始时清零回合内标记 */
export function resetTurnFlags(state: GameState, p: PlayerIndex): void {
  const player = state.players[p]
  player.strikesUsedThisTurn = 0
  player.mendUsedThisTurn = false
}

/**
 * 推进回合流程。
 * 遇到需要决策的点返回 'pending'；压入结算帧返回 'continue'；终局返回 'over'。
 */
export function advanceTurn(state: GameState): TurnProgress {
  let guard = 0
  while (true) {
    if (++guard > 64) throw new Error('回合推进步数超限，疑似死循环')
    if (state.result) return 'over'

    switch (state.phase) {
      case 'game-over':
        return 'over'

      case 'turn-start': {
        const active = state.players[state.active]
        if (!active.alive) {
          // 防御性分支：1v1 中阵亡会立即终局，正常不会走到这里
          const winner = otherPlayer(state.active)
          state.result = { winner }
          state.phase = 'game-over'
          log(state, `${playerLabel(state, winner)} 获胜！`)
          return 'over'
        }

        log(state, `—— 第 ${state.turn} 回合 · ${playerLabel(state, state.active)} ——`)
        resetTurnFlags(state, state.active)
        // 先把阶段推进掉，这样消耗战濒死结算完之后不会重复扣体力
        state.phase = 'draw'

        const loss = attritionLoss(state.turn)
        if (loss > 0) {
          if (state.turn === ATTRITION_TURN) {
            log(
              state,
              `消耗战开始：此后每回合开始时，回合角色失去体力（每 ${ATTRITION_STEP} 回合递增 1 点）`,
            )
          }
          log(state, `消耗战：${playerLabel(state, state.active)} 失去 ${loss} 点体力`)
          loseHp(state, state.active, loss)
          if (state.stack.length > 0) return 'continue'
        }
        break
      }

      case 'draw': {
        const isFirstTurnOfFirstPlayer =
          state.turn === 1 && state.active === state.firstPlayer
        const count = isFirstTurnOfFirstPlayer ? FIRST_TURN_DRAW : DRAW_PER_TURN
        const drawn = drawCards(state, state.active, count)
        log(state, `${playerLabel(state, state.active)} 摸了 ${drawn.length} 张牌`)
        state.phase = 'play'
        break
      }

      case 'play': {
        state.pending = { kind: 'play', player: state.active }
        return 'pending'
      }

      case 'discard': {
        const player = state.players[state.active]
        const count = player.hand.length - Math.max(0, player.hp)
        if (count > 0) {
          state.pending = { kind: 'discard', player: state.active, count }
          return 'pending'
        }
        state.phase = 'turn-end'
        break
      }

      case 'turn-end': {
        state.active = otherPlayer(state.active)
        state.turn += 1
        state.phase = 'turn-start'
        break
      }
    }
  }
}
