import { computed } from 'vue'
import { CARD_DEFS, CARD_NAME } from '../game/data/cardDefs'
import { skillDef } from '../game/data/species'
import { cardDoc, skillDoc } from '../game/dsl/registry'
import { assertNever, baseContext } from '../game/dsl/runtime'
import type { UseContext } from '../game/dsl/kinds'
import { targetCandidates, targetFailureReason, targetScopeMembers } from '../game/dsl/target'
import type { TargetSpec } from '../game/dsl/types'
import { isOver } from '../game/engine'
import { playerLabel } from '../game/log'
import { checkPlayCardAsDefend, checkUseCard } from '../game/rules/legality'
import { energyCost, energyMax } from '../game/rules/energy'
import { serviceOptions } from '../game/rules/reward'
import { PHASE_NAME } from '../game/rules/phase'
import { ATTRITION_TURN } from '../game/rules/turn'
import {
  activationCostCards,
  activationTargetChoice,
  activeOptions,
  cardTargetChoice,
  defaultTargets,
  dyingRescueOptions,
  dyingUsableLabel,
  optionLabel,
  playOptions,
  targetsSatisfied,
  useOptions,
  useVariantOf,
  type CardOption,
  type TargetChoice,
} from '../game/skills'
import type { Card, CardKind, GameState, PlayerIndex, Prompt, SkillId } from '../game/types'
import { AI_PLAYER, HUMAN, chosenTargets, gameState, pendingTarget, selected } from './state'

/**
 * 派生视图：把引擎状态与 DSL 文档翻译成界面/测试直接可用的值。
 *
 * 这一层**只读**：不写任何 ref、不提交动作、不注册副作用，因此可以被
 * `stores/game.test.ts` 直接断言，不必挂载组件。所有"组件里该显示什么"
 * 的判断都集中在这里（按钮列表、按钮文案、阶段说明、目标选择器的候选与标题），
 * 组件只剩下 v-for / v-if。
 */

export const human = computed(() => gameState.value?.players[HUMAN] ?? null)
export const opponent = computed(() => gameState.value?.players[AI_PLAYER] ?? null)
export const over = computed(() => (gameState.value ? isOver(gameState.value) : false))
export const isHumanTurn = computed(() => gameState.value?.active === HUMAN)

/** 人类的能量与上限（上限可能被技能修正，如防御型的【蓄能】） */
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
export const humanDeckCount = computed(() => gameState.value?.players[HUMAN].deck.length ?? 0)
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
  // 奖励期间手牌不可选：奖励的候选由 RewardOverlay 单独渲染
  if (pending.kind === 'reward' || pending.kind === 'pick-card') return []
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
    // 保证「按钮可用 ⟺ 进入选择态后必能提交成功」。缺省目标集的推导在 skills 里只有一份。
    const choice = cardTargetChoice(state, HUMAN, o.as, context, dying)
    if (!targetsSatisfied(choice)) return false
    const bound = defaultTargets(choice as TargetChoice)
    return checkUseCard(state, HUMAN, card, o.as, o.via, bound.length > 0 ? bound : undefined).ok
  })
}

export function optionText(option: CardOption): string {
  const verb = humanPending.value?.kind === 'respond' ? '打出' : '使用'
  const state = gameState.value
  const cost = state ? energyCost(state, HUMAN, option.as) : 0
  return `${optionLabel(option, verb)}（${cost} 能量）`
}

/** 一个操作按钮：把手牌与它的一种合法用法绑在一起，模板里无需再做空值判断 */
export interface ActionButton {
  card: Card
  option: CardOption
  label: string
}

/** 已选中那张手牌在当前时机的全部合法操作（没选牌时为空） */
export const actionButtons = computed<ActionButton[]>(() => {
  const card = selectedCards.value[0]
  if (!card) return []
  return legalOptions(card).map((option) => ({ card, option, label: optionText(option) }))
})

/** 弃牌阶段的「确认弃置」是否可点：已选张数正好等于应弃张数 */
export const canConfirmDiscard = computed(() => selectedCards.value.length === discardCount.value)

/**
 * 放弃按钮的文案。濒死阶段的「放弃」有两个意思，靠"濒死的是不是自己"区分；
 * 其余时机统一是放弃响应。
 */
export const cancelLabel = computed(() => {
  const pending = humanPending.value
  if (pending?.kind === 'dying') return pending.dying === HUMAN ? '放弃自救' : '放弃救援'
  return '放弃响应（承受伤害）'
})

/** 某牌种在当前对局里要付的能量（card-cost 通道可修正）；无对局时退回文档基准费用 */
export function cardCost(kind: CardKind): number {
  const state = gameState.value
  return state ? energyCost(state, HUMAN, kind) : CARD_DEFS[kind].cost
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
      // 当前内容没有任何「濒死可用」的牌，濒死即阵亡：给出直白说明，不要伪造一个救不回来的按钮
      if (!rescue) {
        return pending.dying === HUMAN
          ? '你已濒死：当前没有可用的自救牌，放弃即阵亡'
          : `${playerLabel(state, pending.dying)} 濒死：当前没有可用的救援牌，放弃则其阵亡`
      }
      const label = dyingUsableLabel()
      const cost = energyCost(state, HUMAN, rescue.kind)
      const energy = `需 ${cost} 点能量（当前 ${state.players[HUMAN].energy}）`
      return pending.dying === HUMAN
        ? `你已濒死，使用${label}自救（${energy}）；放弃则阵亡`
        : `${playerLabel(state, pending.dying)} 濒死，你可以用${label}救援（${energy}；对手救你通常是亏的）`
    }
    case 'discard':
      // 上限为 0 时引擎已自动弃光，不会出现在这里；能走到这里说明上限 > 0，需要玩家挑牌
      return `弃牌阶段：请选择 ${pending.count} 张手牌弃置`
    case 'trigger':
      return `是否发动【${skillDef(pending.skill).name}】？`
    case 'reward': {
      if (pending.reward === 'service') {
        return '奖励三选一：升级一张牌 / 移除一张牌 / 回复体力'
      }
      const names = (pending.cards ?? []).map((kind) => CARD_NAME[kind]).join(' / ')
      return `奖励三选一：选择一张加入手牌（${names}）${pending.allowSkip ? '，或跳过' : ''}`
    }
    case 'pick-card':
      return pending.purpose === 'upgrade'
        ? '选择一张要升级的牌'
        : '选择一张要移除的牌（移除后不再参与对局）'
    default:
      // Prompt 的变体已穷尽；assertNever 让新增变体在编译期报错，
      // 同时满足 vue/return-in-computed-property 的"所有路径都返回值"
      return assertNever(pending)
  }
})

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

/** 目标选择器的标题：主动技显示技能名，卡牌显示牌名 */
export const targetPickerTitle = computed(() => {
  const pending = pendingTarget.value
  if (!pending) return ''
  return pending.kind === 'skill'
    ? `发动【${skillDef(pending.skill).name}】`
    : `使用【${CARD_NAME[pending.as]}】`
})

/** 目标选择器的说明行：多选时告知要选几个，其余就是「选择目标」 */
export const targetPickerHint = computed(() => {
  const choice = pendingTargetChoice.value
  return choice?.multi ? `选择 ${choice.size} 个目标` : '选择目标'
})

/** 多选时已勾选的目标是否达到要求（单选恒为 true，点击即提交） */
export const targetsReady = computed(() => {
  const choice = pendingTargetChoice.value
  if (!pendingTarget.value || !choice) return false
  return !choice.multi || chosenTargets.value.length === choice.size
})

/* ------------------------------------------------------------------ 奖励覆盖层 */

/** 卡牌奖励的一个候选（牌名 / 费用 / 稀有度 / 效果文案） */
export interface RewardCardOption {
  kind: CardKind
  name: string
  cost: number
  rarity: string
  short: string
  text: string
}

/** 卡牌奖励的候选列表（评级与顺序沿用引擎给的那一组，界面不重排） */
export const rewardCardOptions = computed<RewardCardOption[]>(() => {
  const pending = humanPending.value
  if (!pending || pending.kind !== 'reward' || pending.reward !== 'card') return []
  return (pending.cards ?? []).map((kind) => {
    const def = CARD_DEFS[kind]
    const doc = cardDoc(kind)
    return {
      kind,
      name: def.name,
      cost: cardCost(kind),
      rarity: doc.rarity ?? 'common',
      short: def.short,
      text: def.text,
    }
  })
})

/** 是否允许跳过本次卡牌奖励 */
export const rewardAllowSkip = computed(
  () => humanPending.value?.kind === 'reward' && humanPending.value.allowSkip,
)

export type ServiceChoice = 'upgrade' | 'remove' | 'heal'

/** 服务奖励的一个选项：不可用时附上文档口径的原因 */
export interface RewardServiceOption {
  service: ServiceChoice
  label: string
  enabled: boolean
  reason?: string
}

/** 服务奖励的可选项与可用性（满血不能回复、无牌可升、移除后不足下限） */
export const rewardServiceOptions = computed<RewardServiceOption[]>(() => {
  const state = gameState.value
  const pending = humanPending.value
  if (!state || !pending || pending.kind !== 'reward' || pending.reward !== 'service') return []
  const top = state.stack[state.stack.length - 1]
  if (!top || top.kind !== 'reward') return []
  const available = serviceOptions(state, HUMAN, top)
  return [
    {
      service: 'upgrade',
      label: '升级一张牌',
      enabled: available.upgrade,
      reason: available.upgrade ? undefined : '你没有可以升级的牌',
    },
    {
      service: 'remove',
      label: '移除一张牌',
      enabled: available.remove,
      reason: available.remove
        ? undefined
        : `移除后牌组、手牌与弃牌堆不得少于 ${top.removeFloor} 张`,
    },
    {
      service: 'heal',
      label: `回复 ${top.healAmount} 点体力`,
      enabled: available.heal,
      reason: available.heal ? undefined : '你的体力已满，无法回复',
    },
  ]
})

/** 升级 / 移除选牌的一张候选：所在牌区 + 升级预览 */
export interface PickCardOption {
  card: Card
  name: string
  zone: string
  /** 升级后的牌名（移除时为空） */
  upgradedName?: string
}

const ZONE_LABEL = { deck: '牌组', hand: '手牌', discard: '弃牌堆' } as const

/** 某张牌目前在哪个牌区（升级/移除候选来自牌组、手牌、弃牌堆） */
function zoneLabelOf(state: GameState, p: PlayerIndex, card: Card): string {
  const player = state.players[p]
  for (const zone of ['deck', 'hand', 'discard'] as const) {
    if (player[zone].some((item) => item.uid === card.uid)) return ZONE_LABEL[zone]
  }
  return '牌组'
}

/** 升级 / 移除的候选列表（按引擎给定的 uid 升序） */
export const pickCardOptions = computed<PickCardOption[]>(() => {
  const state = gameState.value
  const pending = humanPending.value
  if (!state || !pending || pending.kind !== 'pick-card') return []
  return pending.candidates.map((card) => {
    const doc = cardDoc(card.kind)
    const upgradedName = doc.upgradeTo ? cardDoc(doc.upgradeTo).name : undefined
    return {
      card,
      name: doc.name,
      zone: zoneLabelOf(state, HUMAN, card),
      upgradedName,
    }
  })
})

/** 选牌覆盖层的标题：升级还是移除 */
export const pickCardTitle = computed(() =>
  humanPending.value?.kind === 'pick-card' && humanPending.value.purpose === 'remove'
    ? '选择要移除的牌'
    : '选择要升级的牌',
)
