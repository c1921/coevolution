import { submit } from '../game/engine'
import { cardTargetChoice } from '../game/skills'
import type { CardOption } from '../game/skills'
import type { UseContext } from '../game/dsl/kinds'
import type { Action, Card, CardKind } from '../game/types'
import { RuleError } from '../game/util'
import { pump } from './aiDriver'
import { humanPending, selectedCards } from './selectors'
import {
  HUMAN,
  chosenTargets,
  errorMessage,
  gameState,
  pendingTarget,
  rewardSelection,
  selected,
} from './state'

/**
 * 提交入口：把界面上的点击变成引擎动作。
 *
 * 这里是**唯一**会清空选择态并驱动 AI 的地方，也是唯一捕获 `RuleError` 的地方：
 * 引擎拒绝动作时状态不变，错误文案落到 `errorMessage` 上给界面显示
 * （不再静默失败）。动作本身的应用与合法性判定都在 `game/` 里，
 * 本模块只负责"何时提交、提交后怎么收拾界面状态"。
 */

/** 提交玩家动作 */
export function act(action: Action): void {
  const state = gameState.value
  if (!state) return
  try {
    submit(state, action)
    errorMessage.value = null
    selected.value = []
    pendingTarget.value = null
    chosenTargets.value = []
    rewardSelection.value = null
    pump()
  } catch (error) {
    errorMessage.value = error instanceof RuleError ? error.message : String(error)
  }
}

export function submitOption(card: Card, option: CardOption): void {
  const state = gameState.value
  const pending = humanPending.value
  if (!state || !pending) return
  if (pending.kind === 'respond') {
    act({ kind: 'play-card', card, as: option.as, via: option.via })
    return
  }
  const context: UseContext = pending.kind === 'dying' ? 'dying' : 'play'
  // 濒死语境的目标由结算决定（濒死者），不需要也不能让玩家选
  if (pending.kind !== 'dying' && cardTargetChoice(state, HUMAN, option.as, context)?.mustChoose) {
    // 需要选目标：先进入选择态，绝不让玩家点出一个必失败的按钮
    pendingTarget.value = { kind: 'card', card, as: option.as, via: option.via }
    chosenTargets.value = []
    errorMessage.value = null
    return
  }
  act({ kind: 'use-card', card, as: option.as, via: option.via })
}

export function submitEndPhase(): void {
  act({ kind: 'end-phase' })
}

export function submitCancel(): void {
  act({ kind: 'cancel' })
}

export function submitTrigger(accept: boolean): void {
  act({ kind: 'trigger-choice', accept })
}

export function submitDiscard(): void {
  const pending = humanPending.value
  if (!pending || pending.kind !== 'discard') return
  const cards = selectedCards.value
  if (cards.length !== pending.count) {
    errorMessage.value = `需要弃置 ${pending.count} 张手牌`
    return
  }
  act({ kind: 'discard-cards', cards })
}

/* ------------------------------------------------------------------ 奖励 */

/** 卡牌奖励：选一张加入手牌 */
export function submitRewardCard(kind: CardKind): void {
  const pending = humanPending.value
  if (!pending || pending.kind !== 'reward' || pending.reward !== 'card') return
  act({ kind: 'pick-reward', card: kind })
}

/** 跳过卡牌奖励（服务奖励不可跳过，由引擎拒绝） */
export function submitSkipReward(): void {
  const pending = humanPending.value
  if (!pending || pending.kind !== 'reward') return
  act({ kind: 'skip-reward' })
}

/**
 * 服务奖励：升级 / 移除 / 回复。
 * 选「升级 / 移除」只是表达意图，引擎随后会出 `pick-card` 待输入项让玩家挑牌；
 * 这里把中间选择态记下来，供覆盖层显示"正在为升级选牌"。
 */
export function submitRewardService(service: 'upgrade' | 'remove' | 'heal'): void {
  const pending = humanPending.value
  if (!pending || pending.kind !== 'reward' || pending.reward !== 'service') return
  rewardSelection.value = service === 'heal' ? null : service
  act({ kind: 'pick-reward', service })
}

/** 升级 / 移除选定一张自己的牌 */
export function submitPickOwnCard(card: Card): void {
  const pending = humanPending.value
  if (!pending || pending.kind !== 'pick-card') return
  act({ kind: 'pick-own-card', card })
}
