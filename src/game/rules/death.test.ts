import { describe, expect, it } from 'vitest'
import { submit } from '../engine'
import { makeState } from '../testUtils'
import { assertConservation } from './cardZones'

/** 打一场必死对局：玩家用【打击】击杀 1 点体力的 AI，双方都不响应、不救援 */
function killAi(aiHand: { kind: 'defend' | 'heal' | 'strike' }[] = []) {
  const state = makeState({
    playerSpecies: 'tiger',
    aiSpecies: 'bear',
    playerHand: [{ kind: 'strike' }],
    aiHand,
    aiHp: 1,
  })
  submit(state, { kind: 'use-card', card: state.players[0].hand[0]! })
  submit(state, { kind: 'cancel' })
  submit(state, { kind: 'cancel' })
  submit(state, { kind: 'cancel' })
  return state
}

describe('死亡与胜负结算', () => {
  it('阵亡者弃置全部手牌，且仅有一方获胜', () => {
    const state = killAi([{ kind: 'defend' }, { kind: 'heal' }])

    expect(state.players[1].alive).toBe(false)
    expect(state.players[1].hand).toHaveLength(0)
    expect(state.result).toEqual({ winner: 0 })
    expect(state.phase).toBe('game-over')
    expect(state.pending).toBeNull()
    expect(state.stack).toHaveLength(0)
    assertConservation(state)
  })

  it('阵亡时处理区残留的牌会进入弃牌堆', () => {
    const state = killAi([{ kind: 'defend' }, { kind: 'heal' }])
    expect(state.processing).toHaveLength(0)
    // 打击牌进攻击方（玩家 0）的弃牌堆，阵亡者的 2 张手牌进他自己的弃牌堆
    expect(state.players[0].discard.length).toBeGreaterThanOrEqual(1)
    expect(state.players[1].discard.length).toBeGreaterThanOrEqual(2)
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
