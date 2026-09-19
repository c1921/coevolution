import { describe, expect, it } from 'vitest'
import { advance, submit } from '../engine'
import { makeState } from '../testUtils'
import { assertConservation, moveHandToProcessing } from './cardZones'
import { dealDamage } from './damage'

/** 打一场必死对局：对 1 点体力的 AI 造成 1 点伤害，双方都不救援 */
function killAi(aiHand: { kind: 'defend' | 'heal' | 'strike' }[] = []) {
  const state = makeState({
    playerSpecies: 'tiger',
    aiSpecies: 'bear',
    aiHand,
    aiHp: 1,
  })
  dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
  advance(state)
  submit(state, { kind: 'cancel' })
  submit(state, { kind: 'cancel' })
  return state
}

describe('死亡与胜负结算', () => {
  it('阵亡者弃置全部手牌，且仅有一方获胜', () => {
    const state = killAi([{ kind: 'defend' }, { kind: 'heal' }])

    expect(state.players[1].alive).toBe(false)
    expect(state.players[1].hand).toHaveLength(0)
    expect(state.players[1].threat).toBe(0)
    expect(state.result).toEqual({ winner: 0 })
    expect(state.phase).toBe('game-over')
    expect(state.pending).toBeNull()
    expect(state.stack).toHaveLength(0)
    assertConservation(state)
  })

  it('阵亡时处理区残留的牌会进入弃牌堆', () => {
    const state = makeState({
      playerSpecies: 'tiger',
      aiSpecies: 'bear',
      aiHand: [{ kind: 'defend' }],
      aiHp: 1,
    })
    const inFlight = state.players[1].hand[0]!
    moveHandToProcessing(state, 1, inFlight)

    dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
    advance(state)
    submit(state, { kind: 'cancel' })
    submit(state, { kind: 'cancel' })

    expect(state.processing).toHaveLength(0)
    expect(state.players[1].discard.map((c) => c.uid)).toContain(inFlight.uid)
    assertConservation(state)
  })

  it('终局后不再接受任何动作', () => {
    const state = killAi()
    expect(() => submit(state, { kind: 'end-phase' })).toThrow('对局已经结束')
    expect(() =>
      submit(state, { kind: 'trigger-choice', accept: true }),
    ).toThrow('对局已经结束')
  })

  it('终局后状态保持稳定', () => {
    const state = killAi()
    const result = state.result
    expect(state.result).toEqual(result)
    expect(state.players[1].hp).toBeLessThanOrEqual(0)
    expect(state.turn).toBe(1)
  })
})
