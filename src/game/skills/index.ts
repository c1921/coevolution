import { CARD_NAME } from '../data/cardDefs'
import { hasSkill, skillDef } from '../data/species'
import { channelValue } from '../dsl/modifier'
import { baseChannel, cardDoc, skillsOf } from '../dsl/registry'
import { skillUsed } from '../rules/usage'
import type { Card, CardKind, GameState, PlayerIndex, SkillId, VirtualCard } from '../types'
import { otherPlayer } from '../util'

/** 一张手牌在某语境下的一个可选"牌面"：直接用，或经技能转化后用 */
export interface CardOption {
  as: CardKind
  via?: SkillId
}

/** 生成虚拟牌 */
export function toVirtual(card: Card, option: CardOption): VirtualCard {
  if (option.via) return { as: option.as, source: card, via: option.via }
  return { as: option.as, source: card }
}

/** 按钮文案：「使用【打击】（猛扑）」 */
export function optionLabel(
  option: CardOption,
  verb: '使用' | '打出' | '当',
): string {
  if (option.via) {
    return `${verb}【${CARD_NAME[option.as]}】（${skillDef(option.via).name}）`
  }
  return `${verb}【${CARD_NAME[option.as]}】`
}

/** 卡牌自身在该语境是否有用法（defend 没有 use 变体，所以不能主动使用） */
function hasOwnVariant(kind: CardKind, context: 'use' | 'play'): boolean {
  const doc = cardDoc(kind)
  if (context === 'play') return doc.play !== undefined
  return (doc.use ?? []).some((variant) => variant.context === 'play' || variant.context === 'dying')
}

/**
 * 某语境下的全部牌面：卡牌自身的用法 + 该物种技能的转化。
 *
 * 转化完全由文档描述（skills/*.json 的 transforms），因此新增"把 A 当 B"的技能
 * 不需要改这里，也不需要碰 legality 或引擎。
 */
function optionsFor(
  state: GameState,
  p: PlayerIndex,
  card: Card,
  context: 'use' | 'play',
): CardOption[] {
  const options: CardOption[] = []
  if (hasOwnVariant(card.kind, context)) options.push({ as: card.kind })

  for (const skill of skillsOf(state.players[p].species)) {
    for (const transform of skill.transforms ?? []) {
      if (transform.from !== card.kind) continue
      if (!transform.contexts.includes(context)) continue
      options.push({ as: transform.to, via: skill.id })
    }
  }
  return options
}

/**
 * 「使用」语境（出牌阶段主动使用 / 濒死求【回复】）下的全部牌面。
 * 注意：只列出机制上说得通的牌面，具体合法性（次数、体力是否已满）由 legality 判定。
 */
export function useOptions(state: GameState, p: PlayerIndex, card: Card): CardOption[] {
  return optionsFor(state, p, card, 'use')
}

/** 「打出」语境（响应【打击】）下的全部牌面：本作中只有【防御】有意义 */
export function playOptions(state: GameState, p: PlayerIndex, card: Card): CardOption[] {
  return optionsFor(state, p, card, 'play')
}

/** 当前可发动的主动技 */
export function activeOptions(state: GameState, p: PlayerIndex): SkillId[] {
  const player = state.players[p]
  const out: SkillId[] = []
  if (state.phase !== 'play' || state.active !== p || !player.alive) return out

  if (hasSkill(player.species, 'overexert')) out.push('overexert')

  if (hasSkill(player.species, 'mend') && !skillUsed(state, p, 'mend') && player.hand.length >= 1) {
    // 疗愈必须指定一名"已受伤"的角色
    const opponent = state.players[otherPlayer(p)]
    const anyWounded =
      player.hp < player.maxHp || (opponent.alive && opponent.hp < opponent.maxHp)
    if (anyWounded) out.push('mend')
  }

  return out
}

/**
 * 【打击】需要目标打出几张【防御】才能抵消。
 * 数值来自 defend-need-against 通道：基准值在 rules/base.json，威压以 set 覆盖为 2。
 * 参考与 subject 都是"打击的使用者"。
 */
export function defendNeedAgainst(state: GameState, source: PlayerIndex): number {
  return channelValue(state, 'defend-need-against', source)
}

/**
 * 能量上限的技能修正（基础值见 rules/energy.ts 的 BASE_ENERGY_MAX）。
 * 数值来自 energy-max 通道：基准值 3，怒吼以 add +2 抬到 5。
 *
 * 【打击】的次数限制已从规则层面整体去除，所以原来的「无次数限制」不再是效果；
 * 【怒吼】改为「更多能量」，让熊依然打得更凶，同时避开另一条死路：
 * 任何把【打击】降成 0 费的效果都会与「无次数限制」组合成无限连击。
 */
export function energyMaxBonus(state: GameState, p: PlayerIndex): number {
  return channelValue(state, 'energy-max', p) - baseChannel('energy-max')
}
