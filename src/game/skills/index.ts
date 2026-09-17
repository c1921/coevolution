import { CARD_NAME } from '../data/cardDefs'
import { hasSkill, speciesDef, skillDef } from '../data/species'
import { isInProcessing } from '../rules/cardZones'
import { skillUsed } from '../rules/usage'
import type {
  Card,
  CardKind,
  DamageCtx,
  GameState,
  PlayerIndex,
  SkillId,
  VirtualCard,
} from '../types'
import { otherPlayer } from '../util'

/** 一张手牌在某语境下的一个可选"牌面"：直接用，或经技能转化后用 */
export interface CardOption {
  as: CardKind
  via?: SkillId
}

/**
 * 已实现的全部技能。新增物种时先在这里登记，
 * passive.test.ts 会校验「8 个物种的技能集合」与它完全一致，防止漏实现。
 *
 * 注：【猛扑】（虎）与【灵草】（鹿）原本以「红色牌」为判定依据，
 * 卡牌移除花色后暂时整条移除；重新设计出不含花色的效果后再登记回这里。
 */
export const IMPLEMENTED_SKILLS: SkillId[] = [
  'roar',
  'flicker',
  'snatch',
  'mend',
  'menace',
  'overexert',
  'guile',
]

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

/**
 * 「使用」语境（出牌阶段主动使用 / 濒死求【回复】）下的全部牌面。
 * 注意：只列出机制上说得通的牌面，具体合法性（次数、体力是否已满）由 legality 判定。
 */
export function useOptions(
  state: GameState,
  p: PlayerIndex,
  card: Card,
): CardOption[] {
  const player = state.players[p]
  const options: CardOption[] = []

  // 直接使用：【防御】永远不会被主动使用
  if (card.kind === 'strike' || card.kind === 'heal') {
    options.push({ as: card.kind })
  }

  // 疾影：【防御】当【打击】
  if (card.kind === 'defend' && hasSkill(player.species, 'flicker')) {
    options.push({ as: 'strike', via: 'flicker' })
  }

  return options
}

/** 「打出」语境（响应【打击】）下的全部牌面：本作中只有【防御】有意义 */
export function playOptions(
  state: GameState,
  p: PlayerIndex,
  card: Card,
): CardOption[] {
  const player = state.players[p]
  const options: CardOption[] = []

  if (card.kind === 'defend') options.push({ as: 'defend' })

  // 疾影：【打击】当【防御】打出
  if (card.kind === 'strike' && hasSkill(player.species, 'flicker')) {
    options.push({ as: 'defend', via: 'flicker' })
  }

  return options
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

/** 受到伤害后可以发动的技能（按物种技能表顺序） */
export function triggerSkillsFor(state: GameState, ctx: DamageCtx): SkillId[] {
  const target = state.players[ctx.target]
  if (!target.alive) return []

  const out: SkillId[] = []
  for (const skill of speciesDef(target.species).skills) {
    if (skill.kind !== 'trigger') continue

    if (skill.id === 'snatch') {
      const card = ctx.card
      // 造成伤害的牌必须还在处理区才能被取回
      if (card && isInProcessing(state, card.source.uid)) {
        out.push('snatch')
      }
    }

    if (skill.id === 'guile') {
      const source = state.players[ctx.source]
      if (source.alive && source.hand.length > 0) out.push('guile')
    }
  }
  return out
}

/** 【打击】需要目标打出几张【防御】才能抵消 */
export function defendNeedAgainst(state: GameState, source: PlayerIndex): number {
  return hasSkill(state.players[source].species, 'menace') ? 2 : 1
}

/** 【怒吼】的能量上限加成 */
export const ROAR_ENERGY_BONUS = 2

/**
 * 能量上限的技能修正（基础值见 rules/energy.ts 的 BASE_ENERGY_MAX）。
 *
 * 【打击】的次数限制已从规则层面整体去除，所以原来的「无次数限制」不再是效果；
 * 【怒吼】改为「更多能量」，让熊依然打得更凶，同时避开另一条死路：
 * 任何把【打击】降成 0 费的效果都会与「无次数限制」组合成无限连击。
 */
export function energyMaxBonus(state: GameState, p: PlayerIndex): number {
  return hasSkill(state.players[p].species, 'roar') ? ROAR_ENERGY_BONUS : 0
}
