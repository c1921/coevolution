import { isOver, submit } from '../game/engine'
import { AI_DELAY_MS, aiDecide } from '../game/ai'
import { AI_PLAYER, errorMessage, gameState } from './state'

/**
 * AI 驱动循环：只要待输入项属于 AI 就延迟后自动决策，直到轮到玩家或终局。
 *
 * 单独成模块的原因：它是本层唯一的**异步副作用**（setTimeout），
 * 且带着一个竞态守卫 `pumpToken`——"再来一局"之后，上一局排队中的回调必须
 * 失效（`stores/game.test.ts` 有专门的回归用例）。把它隔离出来，
 * 别处就不会不小心绕过守卫直接驱动 AI。
 */

/** 每次开始新对局/回首页都 +1，使排队中的旧回调失效 */
let pumpToken = 0

/** 让所有排队中的 AI 回调失效（抽将、开局、回首页时调用） */
export function cancelAiPump(): void {
  pumpToken += 1
}

export function pump(): void {
  const state = gameState.value
  if (!state || isOver(state)) return
  const pending = state.pending
  if (!pending || pending.player !== AI_PLAYER) return

  const token = pumpToken
  // 用全局 setTimeout（浏览器与 Node 测试环境都可用）
  setTimeout(() => {
    if (token !== pumpToken) return
    const current = gameState.value
    if (!current || isOver(current)) return
    const currentPending = current.pending
    if (!currentPending || currentPending.player !== AI_PLAYER) return

    try {
      submit(current, aiDecide(current))
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
      return
    }
    pump()
  }, AI_DELAY_MS)
}
