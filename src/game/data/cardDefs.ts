import type { CardKind } from '../types'

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

export const CARD_DEFS: Record<CardKind, CardDef> = {
  strike: {
    kind: 'strike',
    name: '打击',
    cost: 1,
    short: '造成 1 点伤害',
    text: '消耗 1 点能量：对对方造成 1 点伤害；其可打出【防御】抵消。',
  },
  defend: {
    kind: 'defend',
    name: '防御',
    cost: 1,
    short: '抵消一次【打击】',
    text: '消耗 1 点能量：抵消一次【打击】。只能在响应时打出。',
  },
  heal: {
    kind: 'heal',
    name: '回复',
    cost: 2,
    short: '回复 1 点体力',
    text: '消耗 2 点能量：回复 1 点体力。出牌阶段只能对自己使用且需已受伤；濒死时可用来自救。',
  },
}

export const CARD_NAME: Record<CardKind, string> = {
  strike: '打击',
  defend: '防御',
  heal: '回复',
}
