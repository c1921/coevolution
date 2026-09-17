import { computed, reactive, ref, watch } from 'vue'
import { AI_DELAY_MS, aiDecide } from '../game/ai'
import { skillDef } from '../game/data/species'
import { createGame, isOver, rollDraft, submit } from '../game/engine'
import { playerLabel } from '../game/log'
import { PHASE_NAME } from '../game/rules/phase'
import { checkPlayCardAsDefend, checkUseCard } from '../game/rules/legality'
import { ATTRITION_TURN } from '../game/rules/turn'
import { activeOptions, optionLabel, playOptions, useOptions, type CardOption } from '../game/skills'
import type {
  Action,
  Card,
  GameState,
  SpeciesId,
  PlayerIndex,
  Prompt,
  SkillId,
} from '../game/types'
import { RuleError } from '../game/util'

export type Screen = 'start' | 'draft' | 'battle'

/** 玩家固定为下标 0（先手），AI 为下标 1 */
export const HUMAN: PlayerIndex = 0
export const AI_PLAYER: PlayerIndex = 1

export const screen = ref<Screen>('start')
export const draftOptions = ref<SpeciesId[]>([])
/** 引擎状态用 reactive 包裹：引擎就地修改它，界面自动刷新 */
export const gameState = ref<GameState | null>(null)
export const selected = ref<number[]>([])
export const errorMessage = ref<string | null>(null)

let pumpToken = 0
let seed = 0

/**
 * 回到开始页，开始一次新的抽将。
 * 传入 seedOverride 可以复现同一局（界面不传，测试用固定种子避免随机导致的偶发失败）。
 */
export function beginDraft(seedOverride?: number): void {
  pumpToken += 1
  seed = seedOverride ?? Math.floor(Math.random() * 2 ** 31)
  draftOptions.value = rollDraft(seed).playerOptions
  gameState.value = null
  selected.value = []
  errorMessage.value = null
  screen.value = 'draft'
}

/** 选定物种并开局 */
export function chooseSpecies(species: SpeciesId): void {
  pumpToken += 1
  selected.value = []
  errorMessage.value = null
  gameState.value = reactive(createGame({ seed, playerSpecies: species })) as GameState
  screen.value = 'battle'
  pump()
}

export function backToStart(): void {
  pumpToken += 1
  gameState.value = null
  selected.value = []
  errorMessage.value = null
  screen.value = 'start'
}

/** 提交玩家动作 */
export function act(action: Action): void {
  const state = gameState.value
  if (!state) return
  try {
    submit(state, action)
    errorMessage.value = null
    selected.value = []
    pump()
  } catch (error) {
    errorMessage.value = error instanceof RuleError ? error.message : String(error)
  }
}

/**
 * AI 驱动循环：只要待输入项属于 AI 就延迟后自动决策，直到轮到玩家或终局。
 * pumpToken 守卫异步回调，避免"再来一局"之后旧回调污染新对局。
 */
function pump(): void {
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

export const human = computed(() => gameState.value?.players[HUMAN] ?? null)
export const opponent = computed(() => gameState.value?.players[AI_PLAYER] ?? null)
export const over = computed(() => (gameState.value ? isOver(gameState.value) : false))
export const isHumanTurn = computed(() => gameState.value?.active === HUMAN)

export const humanPending = computed<Prompt | null>(() => {
  const pending = gameState.value?.pending
  return pending && pending.player === HUMAN ? pending : null
})

export const discardCount = computed(() => {
  const pending = humanPending.value
  return pending?.kind === 'discard' ? pending.count : 0
})

export const selectedCards = computed<Card[]>(() => {
  const state = gameState.value
  if (!state) return []
  const hand = state.players[HUMAN].hand
  return selected.value
    .map((uid) => hand.find((c) => c.uid === uid))
    .filter((c): c is Card => c !== undefined)
})

export const humanSkills = computed<SkillId[]>(() => {
  const state = gameState.value
  if (!state || humanPending.value?.kind !== 'play') return []
  return activeOptions(state, HUMAN)
})

export const deckCount = computed(() => gameState.value?.deck.length ?? 0)

export const turnLabel = computed(() => {
  const state = gameState.value
  if (!state) return ''
  const side = state.active === HUMAN ? '你的回合' : '对手回合'
  // 终局后不再显示阶段名（此时回合游标停在终止态）
  const phase = state.result ? '' : ` · ${PHASE_NAME[state.phase]}`
  const attrition = state.turn >= ATTRITION_TURN ? ' · 消耗战' : ''
  return `第 ${state.turn} 回合 · ${side}${phase}${attrition}`
})

export const resultText = computed(() => {
  const state = gameState.value
  if (!state?.result) return ''
  const who = state.result.winner === HUMAN ? '你获胜' : '对手获胜'
  return `${who} · ${playerLabel(state, state.result.winner)}`
})

/** 该手牌当前可用的全部合法"牌面"（含技能转化），非法的一律不展示 */
export function legalOptions(card: Card): CardOption[] {
  const state = gameState.value
  const pending = humanPending.value
  if (!state || !pending) return []
  if (pending.kind === 'respond') {
    return playOptions(state, HUMAN, card).filter(
      (o) => checkPlayCardAsDefend(state, HUMAN, card, o.as, o.via).ok,
    )
  }
  return useOptions(state, HUMAN, card).filter(
    (o) => checkUseCard(state, HUMAN, card, o.as, o.via).ok,
  )
}

export function optionText(option: CardOption): string {
  return optionLabel(option, humanPending.value?.kind === 'respond' ? '打出' : '使用')
}

export function isSelectable(card: Card): boolean {
  const pending = humanPending.value
  if (!pending) return false
  if (pending.kind === 'discard') return true
  return legalOptions(card).length > 0
}

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

export const pendingHint = computed(() => {
  const state = gameState.value
  const pending = humanPending.value
  if (!state || !pending) return ''

  switch (pending.kind) {
    case 'play':
      return '你的出牌阶段：点选一张手牌再选择用法，或直接结束出牌阶段'
    case 'respond': {
      const need = pending.need - pending.got
      return `对手对你使用【打击】，还需打出 ${need} 张【防御】才能抵消（威压需两张）`
    }
    case 'dying':
      return pending.dying === HUMAN
        ? '你已濒死，使用【回复】自救；放弃则阵亡'
        : `${playerLabel(state, pending.dying)} 濒死，你可以用【回复】救援（对手救你通常是亏的）`
    case 'discard':
      return `弃牌阶段（手牌上限 = 当前体力）：请选择 ${pending.count} 张手牌弃置`
    case 'trigger':
      return `是否发动【${skillDef(pending.skill).name}】？`
  }
})

export function submitOption(card: Card, option: CardOption): void {
  const pending = humanPending.value
  if (!pending) return
  if (pending.kind === 'respond') {
    act({ kind: 'play-card', card, as: option.as, via: option.via })
    return
  }
  act({ kind: 'use-card', card, as: option.as, via: option.via })
}

export function submitActivate(skill: SkillId): void {
  if (skill === 'mend') {
    const card = selectedCards.value[0]
    if (!card) {
      errorMessage.value = '疗愈需要先点选一张手牌作为弃置'
      return
    }
    act({ kind: 'activate', skill: 'mend', cards: [card] })
    return
  }
  act({ kind: 'activate', skill })
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

/** 待输入项变化时清空选择，避免残留过期手牌 */
watch(humanPending, () => {
  selected.value = []
})
