import { watch } from 'vue'
import { skillDef } from '../game/data/species'
import { activationCostCards, activationTargetChoice } from '../game/skills'
import type { Action, PlayerIndex, SkillId } from '../game/types'
import { act } from './actions'
import { humanPending, pendingTargetChoice, selectedCards } from './selectors'
import { HUMAN, chosenTargets, errorMessage, gameState, pendingTarget, selected } from './state'

/**
 * 手牌选择与目标选择态。
 *
 * 「选择态」是纯界面概念（引擎只知道最终提交的目标），因此它整个住在这里：
 *  - 手牌选择：单选（出牌阶段）与多选（弃牌阶段）由 `pickCard` 按当前待输入项分流；
 *  - 目标选择：需要选目标的牌/技能**先进入选择态**，由 `chooseTarget` /
 *    `confirmTargets` 带着目标再提交——绝不让玩家点出一个必失败的按钮。
 *
 * 本模块会调用 `actions.ts` 的 `act()` 做最终提交；反过来 `act()` 只清空
 * `state.ts` 里的 ref，不反向依赖本模块，因此依赖图无环。
 */

export function isSelected(uid: number): boolean {
  return selected.value.includes(uid)
}

/** 弃牌阶段是多选，其余时机为单选 */
export function pickCard(uid: number): void {
  const pending = humanPending.value
  if (!pending) return

  if (pending.kind === 'discard') {
    const at = selected.value.indexOf(uid)
    if (at >= 0) selected.value.splice(at, 1)
    else if (selected.value.length < pending.count) selected.value.push(uid)
    return
  }

  selected.value = selected.value[0] === uid ? [] : [uid]
}

/**
 * 选定一个目标：单选点一下即提交；多选（count.mode = exactly）切换勾选，
 * 由界面上的「确定」调用 confirmTargets。
 */
export function chooseTarget(index: PlayerIndex): void {
  const choice = pendingTargetChoice.value
  if (!pendingTarget.value || !choice) return
  if (!choice.multi) {
    submitTargets([index])
    return
  }
  const at = chosenTargets.value.indexOf(index)
  if (at >= 0) chosenTargets.value.splice(at, 1)
  else if (chosenTargets.value.length < choice.size) chosenTargets.value.push(index)
}

/** 多选：确认已勾选的目标，数量不符时给出可照做的提示 */
export function confirmTargets(): void {
  const choice = pendingTargetChoice.value
  if (!pendingTarget.value || !choice) return
  if (chosenTargets.value.length !== choice.size) {
    errorMessage.value = `需要选择 ${choice.size} 个目标`
    return
  }
  submitTargets([...chosenTargets.value])
}

/** 带着目标提交：主动技走 activate，卡牌走 use-card */
function submitTargets(targets: PlayerIndex[]): void {
  const pending = pendingTarget.value
  if (!pending) return
  pendingTarget.value = null
  chosenTargets.value = []

  if (pending.kind === 'skill') {
    const action: Extract<Action, { kind: 'activate' }> = { kind: 'activate', skill: pending.skill }
    if (pending.cards && pending.cards.length > 0) action.cards = pending.cards
    if (targets.length > 0) action.target = targets[0]
    act(action)
    return
  }
  act({
    kind: 'use-card',
    card: pending.card,
    as: pending.as,
    ...(pending.via !== undefined ? { via: pending.via } : {}),
    ...(targets.length > 0 ? { targets } : {}),
  })
}

/**
 * 发动主动技：需要弃牌的技能把已选手牌作为费用传给引擎。
 *
 * 文档要求选目标（required / 多候选 / 缺省目标不合格）时先进入目标选择态，
 * 由 chooseTarget 带着目标再提交——绝不让玩家点出一个必失败的按钮。
 */
export function submitActivate(skill: SkillId): void {
  const state = gameState.value
  if (!state) return

  const action: Extract<Action, { kind: 'activate' }> = { kind: 'activate', skill }
  const need = activationCostCards(state, HUMAN, skill)
  const cards = need > 0 ? selectedCards.value.slice(0, need) : []
  if (cards.length < need) {
    errorMessage.value = `发动【${skillDef(skill).name}】需要先点选 ${need} 张手牌`
    return
  }
  if (need > 0) action.cards = cards

  if (activationTargetChoice(state, HUMAN, skill)?.mustChoose) {
    pendingTarget.value = need > 0 ? { kind: 'skill', skill, cards } : { kind: 'skill', skill }
    chosenTargets.value = []
    errorMessage.value = null
    return
  }
  act(action)
}

/** 放弃选择目标，回到出牌阶段（已选手牌保留） */
export function cancelTarget(): void {
  pendingTarget.value = null
  chosenTargets.value = []
}

/** 待输入项变化时清空选择，避免残留过期手牌与过期的目标选择态 */
watch(humanPending, () => {
  selected.value = []
  pendingTarget.value = null
  chosenTargets.value = []
})
