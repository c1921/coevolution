import { cardDoc, cardIds, getRegistry } from '../dsl/registry'
import type { CardKind } from '../types'

/**
 * 牌面元数据（由 DSL 文档实时派生）。
 *
 * 这里是"展示与费用"的视图：费用、牌名、卡面文案。
 * 结算所需的完整文档（use / play 变体）请直接读 `dsl/registry` 的 `cardDoc(id)`。
 *
 * 与物种视图一样是实时 Proxy：新增牌种只需要加一份 JSON，引擎与界面立刻可见。
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

export function cardDef(kind: CardKind): CardDef {
  const doc = cardDoc(kind)
  if (doc.cost.kind !== 'const') {
    throw new Error(`牌种 ${doc.id} 的费用不是常量表达式，需要用状态化的费用求值`)
  }
  return {
    kind: doc.id,
    name: doc.name,
    cost: doc.cost.value,
    short: doc.short,
    text: doc.text,
  }
}

/** 以注册表为准的实时映射：未知键返回 undefined，与普通对象一致 */
function liveMap<T>(derive: (key: string) => T): Record<string, T> {
  return new Proxy({} as Record<string, T>, {
    get: (_target, key) =>
      typeof key === 'string' && key in getRegistry().cardById ? derive(key) : undefined,
    has: (_target, key) => typeof key === 'string' && key in getRegistry().cardById,
    ownKeys: () => cardIds(),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })
}

export const CARD_DEFS: Record<CardKind, CardDef> = liveMap(cardDef)

export const CARD_NAME: Record<CardKind, string> = liveMap((kind) => cardDoc(kind).name)
