import { describe, expect, it } from 'vitest'
import { aiDecide } from './ai'
import { buildDeck, DECK_SIZE } from './data/deck'
import { SPECIES_IDS } from './data/species'
import { createGame, isOver, rollDraft, submit, advance } from './engine'
import { contentWith } from './dsl/fixtures'
import { withRegistry } from './dsl/registry'
import { assertConservation, drawCards } from './rules/cardZones'
import { dealDamage } from './rules/damage'
import { assertEnergyBounds } from './rules/energy'
import { FIRST_TURN_DRAW, INITIAL_HAND } from './rules/turn'
import { makeState } from './testUtils'
import type { GameState, SpeciesId } from './types'

/** 死循环保护上限；正常对局远低于此 */
const MAX_STEPS = 20000
/** 正常对局的步数上限（用于发现"能终局但异常漫长"的问题） */
const SANE_STEPS = 5000

function runToEnd(state: GameState, label: string): { state: GameState; steps: number } {
  let steps = 0
  while (!isOver(state)) {
    if (++steps > MAX_STEPS) {
      throw new Error(`自对局未在 ${MAX_STEPS} 步内结束：${label}`)
    }
    if (!state.pending) {
      throw new Error(`自对局停滞：既没有待输入项也没有终局：${label}`)
    }
    // 双方都由 AI 驱动
    submit(state, aiDecide(state))
  }
  assertConservation(state)
  assertEnergyBounds(state)
  return { state, steps }
}

function playOut(o: { seed: number; playerSpecies: SpeciesId; aiSpecies?: SpeciesId }) {
  return runToEnd(createGame(o), `seed=${o.seed} ${o.playerSpecies}`)
}

/** 用任意物种组合开局（绕过随机候选，双方各 4 张起手，玩家先手） */
function playOutPair(a: SpeciesId, b: SpeciesId) {
  const state = makeState({ playerSpecies: a, aiSpecies: b })
  drawCards(state, 0, INITIAL_HAND)
  drawCards(state, 1, INITIAL_HAND)
  return runToEnd(state, `${a} vs ${b}`)
}

describe('引擎不变式（AI 自对局）', () => {
  it('200 局自对局全部正常终局，牌数守恒，恰好一方获胜', () => {
    let maxSteps = 0
    let totalSteps = 0

    for (let seed = 1; seed <= 200; seed++) {
      const options = rollDraft(seed).playerOptions
      const playerSpecies = options[seed % options.length] as SpeciesId
      const { state, steps } = playOut({ seed, playerSpecies })

      totalSteps += steps
      maxSteps = Math.max(maxSteps, steps)

      expect(state.result).not.toBeNull()
      const winner = state.result?.winner
      expect(winner === 0 || winner === 1).toBe(true)
      expect(state.players.filter((p) => p.alive)).toHaveLength(1)
      expect(state.players[winner as 0 | 1].alive).toBe(true)
      expect(state.pending).toBeNull()
      expect(state.stack).toHaveLength(0)
      expect(state.processing).toHaveLength(0)
      expect(state.phase).toBe('game-over')
      expect(state.log.length).toBeGreaterThan(5)
    }

    expect(totalSteps / 200).toBeLessThan(SANE_STEPS / 4)
    expect(maxSteps).toBeLessThan(SANE_STEPS)
  })

  it('4 × 4 全部代号组合都能打完', () => {
    for (const a of SPECIES_IDS) {
      for (const b of SPECIES_IDS) {
        const { state } = playOutPair(a, b)
        expect(state.result).not.toBeNull()
        expect(state.players.filter((p) => p.alive)).toHaveLength(1)
      }
    }
  })

  it('曾经的死循环组合必定终局（回归测试）', () => {
    // 这三组在引入消耗战之前会无限循环：双方互相抵消 / 无限自救，牌堆无限洗回
    const pairs: [SpeciesId, SpeciesId][] = [
      ['counter', 'counter'],
      ['morph', 'morph'],
      ['counter', 'defensive'],
    ]
    for (const [a, b] of pairs) {
      const { state } = playOutPair(a, b)
      expect(state.result).not.toBeNull()
      expect(state.players.filter((p) => p.alive)).toHaveLength(1)
    }
  })

  it('同种子同选将必定复现同一局（完全确定性）', () => {
    const seed = 20240607
    const playerSpecies = rollDraft(seed).playerOptions[0] as SpeciesId

    const first = playOut({ seed, playerSpecies })
    const second = playOut({ seed, playerSpecies })

    expect(second.steps).toBe(first.steps)
    expect(second.state.result).toEqual(first.state.result)
    expect(second.state.log.map((e) => e.text)).toEqual(
      first.state.log.map((e) => e.text),
    )
  })

  it('战报覆盖完整流程：回合开始、摸牌、出牌、阵亡、获胜', () => {
    const seed = 9
    const playerSpecies = rollDraft(seed).playerOptions[0] as SpeciesId
    const { state } = playOut({ seed, playerSpecies })
    const text = state.log.map((e) => e.text).join('\n')

    expect(text).toContain('第 1 回合')
    expect(text).toContain('摸了')
    expect(text).toContain('阵亡')
    expect(text).toContain('获胜')
  })
})

describe('开局与选将', () => {
  it('抽将给出 3 个互不重复的候选（4 个代号里留 1 个给 AI）', () => {
    for (let seed = 0; seed < 50; seed++) {
      const draft = rollDraft(seed)
      expect(draft.playerOptions).toHaveLength(3)
      expect(new Set(draft.playerOptions).size).toBe(3)
      for (const id of draft.playerOptions) expect(SPECIES_IDS).toContain(id)
    }
  })

  it('同种子的抽将结果一致', () => {
    expect(rollDraft(7).playerOptions).toEqual(rollDraft(7).playerOptions)
  })

  it('选定不在候选中的物种会被拒绝', () => {
    const seed = 3
    const draft = rollDraft(seed)
    const notOffered = SPECIES_IDS.find((id) => !draft.playerOptions.includes(id)) as SpeciesId
    expect(() => createGame({ seed, playerSpecies: notOffered })).toThrow('选将非法')
  })

  it('开局：双方各 4 张起手牌，先手玩家第一回合少摸一张', () => {
    const seed = 42
    const playerSpecies = rollDraft(seed).playerOptions[0] as SpeciesId
    const state = createGame({ seed, playerSpecies })

    expect(state.players[0].hand).toHaveLength(INITIAL_HAND + FIRST_TURN_DRAW)
    expect(state.players[1].hand).toHaveLength(INITIAL_HAND)
    expect(state.turn).toBe(1)
    expect(state.active).toBe(0)
    expect(state.phase).toBe('play')
    expect(state.pending).toEqual({ kind: 'play', player: 0 })
    expect(state.processing).toHaveLength(0)
    assertConservation(state)
  })

  it('可以显式指定 AI 的物种', () => {
    const seed = 5
    const playerSpecies = rollDraft(seed).playerOptions[0] as SpeciesId
    const aiSpecies = SPECIES_IDS.find((id) => id !== playerSpecies) as SpeciesId
    const state = createGame({ seed, playerSpecies, aiSpecies })
    expect(state.players[1].species).toBe(aiSpecies)
    expect(state.players[1].hp).toBe(state.players[1].maxHp)
  })

  it('未指定 AI 物种时，AI 从「除玩家所选之外」的代号里随机选 1 个', () => {
    for (let seed = 0; seed < 30; seed++) {
      const playerSpecies = rollDraft(seed).playerOptions[0] as SpeciesId
      const state = createGame({ seed, playerSpecies })
      expect(state.players[1].species).not.toBe(playerSpecies)
      expect(SPECIES_IDS).toContain(state.players[1].species)
    }
  })

  it('AI 与玩家同种会被拒绝', () => {
    const seed = 5
    const playerSpecies = rollDraft(seed).playerOptions[0] as SpeciesId
    expect(() => createGame({ seed, playerSpecies, aiSpecies: playerSpecies })).toThrow(
      'AI 选将非法',
    )
  })
})

describe('私有牌组', () => {
  it('开局双方各有一副 20 张私有牌组，uid 全局不重叠', () => {
    const seed = 11
    const playerSpecies = rollDraft(seed).playerOptions[0] as SpeciesId
    const state = createGame({ seed, playerSpecies })

    for (const p of [0, 1] as const) {
      const player = state.players[p]
      const all = [...player.deck, ...player.discard, ...player.hand]
      expect(all).toHaveLength(DECK_SIZE)
      // 牌组的牌种构成与物种牌组一致（暂时所有物种共用同一套）
      const kinds = all.map((c) => c.kind).sort()
      expect(kinds).toEqual(buildDeck(player.species).map((c) => c.kind).sort())
    }

    const uids = [
      ...state.players[0].deck,
      ...state.players[0].discard,
      ...state.players[0].hand,
      ...state.players[1].deck,
      ...state.players[1].discard,
      ...state.players[1].hand,
    ].map((c) => c.uid)
    expect(new Set(uids).size).toBe(DECK_SIZE * 2)
    assertConservation(state)
  })

  it('摸牌只动自己的牌组：对手的牌组与手牌不受影响', () => {
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    const before = {
      deck: state.players[1].deck.map((c) => c.uid),
      hand: state.players[1].hand.length,
      discard: state.players[1].discard.length,
    }

    drawCards(state, 0, 2)

    expect(state.players[1].deck.map((c) => c.uid)).toEqual(before.deck)
    expect(state.players[1].hand).toHaveLength(before.hand)
    expect(state.players[1].discard).toHaveLength(before.discard)
    assertConservation(state)
  })

  it('跨池取牌后归属获得者，双方池子此消彼长但全局仍守恒（合成技能）', () => {
    // 【夺食】已随机制改动退役；这里把反击型的技能换成一份等价的合成技能，
    // 守住「牌易主后仍全局守恒」这条口径（换文档即换行为，不需要改引擎）。
    const synthetic = contentWith([
      {
        path: 'skills/riposte.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'riposte',
          priority: 40,
          name: '掠夺',
          text: '当你受到伤害后，你可以获得伤害来源的一张手牌。',
          trigger: {
            on: { at: 'after-damage' },
            optional: true,
            when: [
              {
                kind: 'has-cards',
                of: 'source',
                zone: 'hand',
                atLeast: { kind: 'const', value: 1 },
              },
            ],
            effects: [
              {
                kind: 'move-cards',
                from: { zone: 'hand', of: 'source' },
                to: { zone: 'hand', of: 'self' },
                pick: { mode: 'random', count: 1 },
              },
              { kind: 'log', template: '{self} 发动【掠夺】' },
            ],
          },
        },
      },
    ])

    withRegistry(synthetic, () => {
      const state = makeState({
        playerSpecies: 'offensive',
        aiSpecies: 'counter',
        playerHand: [{ kind: 'strike' }],
      })

      dealDamage(state, { source: 0, target: 1, amount: 1, card: null })
      advance(state)
      submit(state, { kind: 'trigger-choice', accept: true })

      const poolOf = (p: 0 | 1) =>
        state.players[p].deck.length + state.players[p].discard.length + state.players[p].hand.length
      // 反击型拿走了进攻型的一张牌：自己 21 张，进攻型只剩下 19 张
      expect(poolOf(1)).toBe(DECK_SIZE + 1)
      expect(poolOf(0)).toBe(DECK_SIZE - 1)
      // 全局依旧一张不多不少
      assertConservation(state)
    })
  })
})
