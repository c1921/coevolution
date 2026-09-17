import { describe, expect, it } from 'vitest'
import { CARD_DEFS } from '../data/cardDefs'
import { createGame, rollDraft, submit } from '../engine'
import { checkUseCard } from './legality'
import {
  assertEnergyBounds,
  BASE_ENERGY_MAX,
  canPayEnergy,
  energyCost,
  energyMax,
  payEnergy,
  refillEnergy,
} from './energy'
import { advanceTurn } from './turn'
import { useOptions } from '../skills'
import { makeState, snapshot } from '../testUtils'
import type { CardKind, SpeciesId } from '../types'

const ALL_KINDS: CardKind[] = ['strike', 'defend', 'heal']

describe('能量系统', () => {
  it('费用按牌种固定：打击 1 / 防御 1 / 回复 2，且与牌面说明一致', () => {
    expect(energyCost('strike')).toBe(1)
    expect(energyCost('defend')).toBe(1)
    expect(energyCost('heal')).toBe(2)

    for (const kind of ALL_KINDS) {
      expect(CARD_DEFS[kind].text).toContain(`消耗 ${CARD_DEFS[kind].cost} 点能量`)
    }
  })

  it('任何牌面的费用都至少 1 点（0 费 + 无次数限制 = 无限连击）', () => {
    for (const kind of ALL_KINDS) {
      expect(energyCost(kind)).toBeGreaterThanOrEqual(1)
    }
  })

  it('能量上限：基础 3 点，怒吼的熊为 5 点', () => {
    const tiger = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    const bear = makeState({ playerSpecies: 'bear', aiSpecies: 'tiger' })

    expect(energyMax(tiger, 0)).toBe(BASE_ENERGY_MAX)
    expect(energyMax(tiger, 1)).toBe(BASE_ENERGY_MAX + 2)
    expect(energyMax(bear, 1)).toBe(BASE_ENERGY_MAX)
  })

  it('开局双方能量回满', () => {
    const seed = 42
    const playerSpecies = rollDraft(seed).playerOptions[0] as SpeciesId
    const state = createGame({ seed, playerSpecies })

    expect(state.players[0].energy).toBe(energyMax(state, 0))
    expect(state.players[1].energy).toBe(energyMax(state, 1))
    assertEnergyBounds(state)
  })

  it('使用【打击】支付 1 点，响应打出【防御】也支付 1 点', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
      aiHand: [{ kind: 'defend' }],
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'strike' })
    expect(state.players[0].energy).toBe(BASE_ENERGY_MAX - 1)

    submit(state, { kind: 'play-card', card: state.players[1].hand[0]!, as: 'defend' })
    expect(state.players[1].energy).toBe(energyMax(state, 1) - 1)
    expect(state.players[1].hp).toBe(4)
  })

  it('【回复】支付 2 点', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'heal' }],
      playerHp: 2,
    })

    submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'heal' })
    expect(state.players[0].hp).toBe(3)
    expect(state.players[0].energy).toBe(BASE_ENERGY_MAX - 2)
  })

  it('转化牌按「当作的牌面」付费：疾影把【防御】当【打击】仍按【打击】收费', () => {
    const state = makeState({
      playerSpecies: 'leopard',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend' }],
    })

    submit(state, {
      kind: 'use-card',
      card: state.players[0].hand[0]!,
      as: 'strike',
      via: 'flicker',
    })

    expect(state.players[0].energy).toBe(BASE_ENERGY_MAX - energyCost('strike'))
    // 注：【打击】与【防御】目前同费（都是 1），所以「源牌与目标牌费用不同」的强断言
    // 要等出现一个源牌更便宜的转化技（如已移除的【灵草】红牌→2 费【回复】）才能复现。
  })

  it('能量不足时拒绝使用且状态完全不变', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'heal' }],
      playerHp: 2,
      playerEnergy: 1,
    })
    const before = snapshot(state)

    expect(() =>
      submit(state, { kind: 'use-card', card: state.players[0].hand[0]!, as: 'heal' }),
    ).toThrow('能量不足')
    expect(state).toEqual(before)
  })

  it('能量为 0 时没有任何可用的牌面', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      playerEnergy: 0,
      playerHp: 2,
      playerHand: [{ kind: 'strike' }, { kind: 'defend' }, { kind: 'heal' }],
    })

    expect(canPayEnergy(state, 0, 'strike')).toBe(false)
    for (const card of state.players[0].hand) {
      const legal = useOptions(state, 0, card).filter(
        (o) => checkUseCard(state, 0, card, o.as, o.via).ok,
      )
      expect(legal).toHaveLength(0)
    }
  })

  it('主动技不消耗能量：透支 / 疗愈', () => {
    const ox = makeState({
      playerSpecies: 'ox',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'strike' }],
    })
    submit(ox, { kind: 'activate', skill: 'overexert' })
    expect(ox.players[0].hp).toBe(3)
    expect(ox.players[0].energy).toBe(BASE_ENERGY_MAX)

    const deer = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 2,
      playerHand: [{ kind: 'strike' }, { kind: 'strike' }],
    })
    submit(deer, {
      kind: 'activate',
      skill: 'mend',
      cards: [deer.players[0].hand[0]!],
    })
    expect(deer.players[0].hp).toBe(3)
    expect(deer.players[0].energy).toBe(BASE_ENERGY_MAX)
  })

  it('回合开始时回满，且只有回合角色回满', () => {
    const start = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'tiger',
      phase: 'turn-start',
      playerEnergy: 0,
    })
    advanceTurn(start)
    expect(start.players[0].energy).toBe(BASE_ENERGY_MAX)

    // 结束出牌阶段后轮到对手：玩家不回满，对手回满
    const handover = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'tiger',
      playerEnergy: 0,
      aiEnergy: 0,
    })
    submit(handover, { kind: 'end-phase' })
    expect(handover.players[0].energy).toBe(0)
    expect(handover.players[1].energy).toBe(energyMax(handover, 1))
    expect(handover.pending).toMatchObject({ kind: 'play', player: 1 })
  })

  it('payEnergy 在能量不足时抛错且不扣减', () => {
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear', playerEnergy: 1 })
    expect(() => payEnergy(state, 0, 'heal')).toThrow('能量不足')
    expect(state.players[0].energy).toBe(1)

    refillEnergy(state, 0)
    expect(state.players[0].energy).toBe(BASE_ENERGY_MAX)
    assertEnergyBounds(state)
  })
})
