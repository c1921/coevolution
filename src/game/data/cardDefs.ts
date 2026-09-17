import type { CardKind } from '../types'

export interface CardDef {
  kind: CardKind
  name: string
  text: string
}

export const CARD_DEFS: Record<CardKind, CardDef> = {
  strike: {
    kind: 'strike',
    name: '打击',
    text: '对对方造成 1 点伤害；其可打出【防御】抵消。每回合限用一次。',
  },
  defend: {
    kind: 'defend',
    name: '防御',
    text: '抵消一次【打击】。只能在响应时打出。',
  },
  heal: {
    kind: 'heal',
    name: '回复',
    text: '回复 1 点体力。出牌阶段只能对自己使用且需已受伤；濒死时可用来自救。',
  },
}

export const CARD_NAME: Record<CardKind, string> = {
  strike: '打击',
  defend: '防御',
  heal: '回复',
}
