import { registry } from '../dsl/registry'
import type { CardDoc, Value } from '../dsl/types'
import type { CardKind } from '../types'

/**
 * 牌面元数据（由 DSL 文档派生）。
 *
 * 这里是"展示与费用"的视图：费用、牌名、卡面文案。
 * 结算所需的完整文档（use / play 变体）请直接读 `dsl/registry` 的 `cardDoc(id)`。
 */

export interface CardDef {
  kind: CardKind
  name: string
  /**
   * 使用 / 打出这张牌需要支付的能量：**按牌种的固定费用**。
   * 卡牌没有点数与花色，费用只由牌种决定。结算见 rules/energy.ts。
   */
  cost: number
  /** 卡面上的一行效果文案 */
  short: string
  /** 完整效果说明（悬停提示与图鉴） */
  text: string
}

/** 费用是常量表达式（当前三张牌都是常量；动态费用由状态化求值负责） */
function constCost(doc: CardDoc): number {
  if (doc.cost.kind !== 'const') {
    throw new Error(`牌种 ${doc.id} 的费用不是常量表达式，需要用状态化的费用求值`)
  }
  return doc.cost.value
}

function toCardDef(doc: CardDoc): CardDef {
  return {
    kind: doc.id,
    name: doc.name,
    cost: constCost(doc),
    short: doc.short,
    text: doc.text,
  }
}

export const CARD_DEFS: Record<CardKind, CardDef> = Object.fromEntries(
  registry.cards.map((doc) => [doc.id, toCardDef(doc)]),
)

export const CARD_NAME: Record<CardKind, string> = Object.fromEntries(
  registry.cards.map((doc) => [doc.id, doc.name]),
)

/** 牌面的费用表达式（保留原始 IR，供将来接入 card-cost 修正通道） */
export function cardCostValue(kind: CardKind): Value {
  const doc = registry.cardById[kind]
  if (!doc) throw new Error(`未知牌种 id：${kind}`)
  return doc.cost
}
