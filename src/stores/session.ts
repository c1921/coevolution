import { reactive } from 'vue'
import { createGame, rollDraft } from '../game/engine'
import type { GameState, SpeciesId } from '../game/types'
import { cancelAiPump, pump } from './aiDriver'
import {
  chosenTargets,
  draftOptions,
  errorMessage,
  gameState,
  pendingTarget,
  screen,
  selected,
} from './state'

/**
 * 对局生命周期：抽将 → 选将开局 → 回首页。
 *
 * 三个入口都做同一件事：**先让排队中的 AI 回调失效**（`cancelAiPump`），
 * 再重置界面状态。漏掉任何一处都会出现"上一局的 AI 动作落到新一局"的竞态
 * （`stores/game.test.ts` 有回归用例）。
 *
 * `seed` 是会话级私有状态：界面不传种子（随机），测试传固定种子以复现同一局。
 */

let seed = 0

/**
 * 回到开始页，开始一次新的抽将。
 * 传入 seedOverride 可以复现同一局（界面不传，测试用固定种子避免随机导致的偶发失败）。
 */
export function beginDraft(seedOverride?: number): void {
  cancelAiPump()
  seed = seedOverride ?? Math.floor(Math.random() * 2 ** 31)
  draftOptions.value = rollDraft(seed).playerOptions
  gameState.value = null
  selected.value = []
  errorMessage.value = null
  pendingTarget.value = null
  chosenTargets.value = []
  screen.value = 'draft'
}

/** 选定物种并开局 */
export function chooseSpecies(species: SpeciesId): void {
  cancelAiPump()
  selected.value = []
  errorMessage.value = null
  pendingTarget.value = null
  chosenTargets.value = []
  gameState.value = reactive(createGame({ seed, playerSpecies: species })) as GameState
  screen.value = 'battle'
  pump()
}

export function backToStart(): void {
  cancelAiPump()
  gameState.value = null
  selected.value = []
  errorMessage.value = null
  pendingTarget.value = null
  chosenTargets.value = []
  screen.value = 'start'
}
