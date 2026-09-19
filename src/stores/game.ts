import { computed, reactive, ref, watch } from 'vue'
import { AI_DELAY_MS, aiDecide } from '../game/ai'
import { skillDef } from '../game/data/species'
import { createGame, isOver, rollDraft, submit } from '../game/engine'
import { playerLabel } from '../game/log'
import { PHASE_NAME } from '../game/rules/phase'
import { checkPlayCardAsDefend, checkUseCard } from '../game/rules/legality'
import { energyCost, energyMax } from '../game/rules/energy'
import { ATTRITION_TURN } from '../game/rules/turn'
import { CARD_NAME } from '../game/data/cardDefs'
import { skillDoc } from '../game/dsl/registry'
import { baseContext } from '../game/dsl/runtime'
import type { UseContext } from '../game/dsl/kinds'
import type { TargetSpec } from '../game/dsl/types'
import {
  targetCandidates,
  targetFailureReason,
  targetScopeMembers,
} from '../game/dsl/target'
import {
  activationCostCards,
  activationTargetChoice,
  activeOptions,
  cardTargetChoice,
  dyingRescueOptions,
  dyingUsableLabel,
  optionLabel,
  playOptions,
  useOptions,
  useVariantOf,
  type CardOption,
  type TargetChoice,
} from '../game/skills'
import type {
  Action,
  Card,
  CardKind,
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
/** 正在为哪个主动技或哪张牌选择目标；null 表示不在目标选择态 */
export type PendingTarget =
  | { kind: 'skill'; skill: SkillId; cards?: Card[] }
  | { kind: 'card'; card: Card; as: CardKind; via?: SkillId }

export const pendingTarget = ref<PendingTarget | null>(null)
/** 多选时已勾选的目标（单选点一下即提交，不留状态） */
export const chosenTargets = ref<PlayerIndex[]>([])

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
  pendingTarget.value = null
  chosenTargets.value = []
  screen.value = 'draft'
}

/** 选定物种并开局 */
export function chooseSpecies(species: SpeciesId): void {
  pumpToken += 1
  selected.value = []
  errorMessage.value = null
  pendingTarget.value = null
  chosenTargets.value = []
  gameState.value = reactive(createGame({ seed, playerSpecies: species })) as GameState
  screen.value = 'battle'
  pump()
}

export function backToStart(): void {
  pumpToken += 1
  gameState.value = null
  selected.value = []
  errorMessage.value = null
  pendingTarget.value = null
  chosenTargets.value = []
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
    pendingTarget.value = null
  chosenTargets.value = []
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

/** 人类的能量与上限（上限可能被技能修正，如熊的怒吼） */
export const humanEnergy = computed(() => gameState.value?.players[HUMAN].energy ?? 0)
export const humanEnergyMax = computed(() =>
  gameState.value ? energyMax(gameState.value, HUMAN) : 0,
)
/** 人类当前身上的威胁点数（回合结束时结算为等量伤害） */
export const humanThreat = computed(() => gameState.value?.players[HUMAN].threat ?? 0)
export const opponentEnergyMax = computed(() =>
  gameState.value ? energyMax(gameState.value, AI_PLAYER) : 0,
)

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

/** 双方各自的私有牌组剩余张数（牌组私有化后不再有公共牌堆） */
export const humanDeckCount = computed(
  () => gameState.value?.players[HUMAN].deck.length ?? 0,
)
export const opponentDeckCount = computed(
  () => gameState.value?.players[AI_PLAYER].deck.length ?? 0,
)

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
  // 濒死语境的 scope=dying 需要传入濒死者；出牌阶段用 play 变体
  const dying = pending.kind === 'dying' ? pending.dying : undefined
  const context: UseContext = dying === undefined ? 'play' : 'dying'
  return useOptions(state, HUMAN, card).filter((o) => {
    // 需要选目标的牌面：用「存在合法目标」判定可用性，与主动技的 activeOptions 同一手法，
    // 保证「按钮可用 ⟺ 进入选择态后必能提交成功」。
    const choice = cardTargetChoice(state, HUMAN, o.as, context, dying)
    if (choice === null) return false
    const bound = choice.multi
      ? choice.candidates.slice(0, choice.size)
      : choice.mustChoose
        ? [choice.fallback ?? choice.candidates[0]].filter(
            (index): index is PlayerIndex => index !== undefined,
          )
        : []
    return checkUseCard(state, HUMAN, card, o.as, o.via, bound.length > 0 ? bound : undefined).ok
  })
}

export function optionText(option: CardOption): string {
  const verb = humanPending.value?.kind === 'respond' ? '打出' : '使用'
  const state = gameState.value
  const cost = state ? energyCost(state, HUMAN, option.as) : 0
  return `${optionLabel(option, verb)}（${cost} 能量）`
}

export function isSelectable(card: Card): boolean {
  const pending = humanPending.value
  if (!pending) return false
  if (pending.kind === 'discard') return true
  return legalOptions(card).length > 0
}

/** 出牌阶段是否还有任何打得出的牌（手牌为空或能量见底时为 false） */
export const hasPlayableCard = computed(() => {
  const state = gameState.value
  if (!state || humanPending.value?.kind !== 'play') return false
  return state.players[HUMAN].hand.some((card) => isSelectable(card))
})

/** 出牌阶段却一张牌都打不出（能量不够付任何牌面） */
export const cannotPlayAnything = computed(
  () => humanPending.value?.kind === 'play' && !hasPlayableCard.value,
)

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
    case 'play': {
      const threat =
        humanThreat.value > 0
          ? ` · 你身上有 ${humanThreat.value} 点威胁（回合结束时结算为伤害，可用【防御】抵消）`
          : ''
      return `你的出牌阶段（能量 ${humanEnergy.value}/${humanEnergyMax.value}）：点选一张手牌再选择用法，或直接结束出牌阶段${threat}`
    }
    case 'respond': {
      const need = pending.need - pending.got
      const opener = CARD_NAME[pending.card?.as ?? pending.expected]
      const expected = CARD_NAME[pending.expected]
      const cost = energyCost(state, HUMAN, pending.expected)
      return `对手对你使用【${opener}】，还需打出 ${need} 张【${expected}】才能抵消 · 每张 ${cost} 点能量（当前 ${state.players[HUMAN].energy}）`
    }
    case 'dying': {
      const rescue = dyingRescueOptions()[0]
      const label = dyingUsableLabel()
      const cost = rescue ? energyCost(state, HUMAN, rescue.kind) : 0
      const energy = `需 ${cost} 点能量（当前 ${state.players[HUMAN].energy}）`
      return pending.dying === HUMAN
        ? `你已濒死，使用${label}自救（${energy}）；放弃则阵亡`
        : `${playerLabel(state, pending.dying)} 濒死，你可以用${label}救援（${energy}；对手救你通常是亏的）`
    }
    case 'discard':
      return `弃牌阶段（手牌上限 = 当前体力）：请选择 ${pending.count} 张手牌弃置`
    case 'trigger':
      return `是否发动【${skillDef(pending.skill).name}】？`
  }
})

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

/**
 * 主动技按钮文案：需要先选牌的技能（由文档的 costCards 决定）在未选牌时给出提示，
 * 文档可用 ui.buttonLabel 覆盖默认文案。
 */
export function skillButtonLabel(skill: SkillId): string {
  const state = gameState.value
  const need = state ? activationCostCards(state, HUMAN, skill) : 0
  if (need > 0 && selectedCards.value.length < need) {
    return (
      skillDoc(skill).activate?.ui?.buttonLabel ??
      `发动【${skillDef(skill).name}】（先点选 ${need} 张手牌）`
    )
  }
  return `发动【${skillDef(skill).name}】`
}

/** 目标选择器里的一个候选；不可选的候选带上文档给出的原因 */
export interface TargetOption {
  index: PlayerIndex
  label: string
  selectable: boolean
  reason?: string
}

/** 目标选择态对应的目标规格（主动技或卡牌的文档） */
export function pendingTargetSpec(): TargetSpec | undefined {
  const pending = pendingTarget.value
  if (!pending) return undefined
  if (pending.kind === 'skill') return skillDoc(pending.skill).activate?.target
  return useVariantOf(pending.as, 'play')?.target
}

/** 目标选择态的解析结果：界面据此知道要不要多选、要选几个 */
export const pendingTargetChoice = computed<TargetChoice | null>(() => {
  const state = gameState.value
  const pending = pendingTarget.value
  if (!state || !pending) return null
  return pending.kind === 'skill'
    ? activationTargetChoice(state, HUMAN, pending.skill)
    : cardTargetChoice(state, HUMAN, pending.as, 'play')
})

/**
 * 目标选择器的候选列表：scope 的成员**全部**列出，
 * 不合法的附上目标规格里条件的 `reason`（界面不自己编理由）。
 */
export function targetOptionsFor(spec: TargetSpec): TargetOption[] {
  const state = gameState.value
  if (!state) return []
  const env = { state, ctx: baseContext(state, HUMAN) }
  const candidates = targetCandidates(env, spec)
  return targetScopeMembers(env, spec).map((index) => {
    const player = state.players[index]
    const side = index === HUMAN ? '你' : '对手'
    const selectable = candidates.includes(index)
    const option: TargetOption = {
      index,
      label: `${playerLabel(state, index)}（${side}） ${player.hp}/${player.maxHp}`,
      selectable,
    }
    if (!selectable) {
      option.reason = targetFailureReason(env, spec, index) ?? '该目标当前不可选'
    }
    return option
  })
}

/** 当前目标选择态下的候选列表（不在选择态时为空） */
export const pendingTargetOptions = computed<TargetOption[]>(() => {
  const spec = pendingTargetSpec()
  return spec ? targetOptionsFor(spec) : []
})

/** 多选时已勾选的目标是否达到要求（单选恒为 true，点击即提交） */
export const targetsReady = computed(() => {
  const choice = pendingTargetChoice.value
  if (!pendingTarget.value || !choice) return false
  return !choice.multi || chosenTargets.value.length === choice.size
})

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

/** 待输入项变化时清空选择，避免残留过期手牌与过期的目标选择态 */
watch(humanPending, () => {
  selected.value = []
  pendingTarget.value = null
  chosenTargets.value = []
})
