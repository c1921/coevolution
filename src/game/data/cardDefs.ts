import type { CardKind } from '../types'

export interface CardDef {
  kind: CardKind
  name: string
  /**
   * 使用 / 打出这张牌需要支付的能量：**按牌种的固定费用**，
   * 与点数无关（点数仍然只用于展示）。结算见 rules/energy.ts。
   */
  cost: number
  text: string
}

export const CARD_DEFS: Record<CardKind, CardDef> = {
  strike: {
    kind: 'strike',
    name: '打击',
    cost: 1,
    text: '消耗 1 点能量：对对方造成 1 点伤害；其可打出【防御】抵消。',
  },
  defend: {
    kind: 'defend',
    name: '防御',
    cost: 1,
    text: '消耗 1 点能量：抵消一次【打击】。只能在响应时打出。',
  },
  heal: {
    kind: 'heal',
    name: '回复',
    cost: 2,
    text: '消耗 2 点能量：回复 1 点体力。出牌阶段只能对自己使用且需已受伤；濒死时可用来自救。',
  },
}

export const CARD_NAME: Record<CardKind, string> = {
  strike: '打击',
  defend: '防御',
  heal: '回复',
}
