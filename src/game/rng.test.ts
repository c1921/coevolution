import { describe, expect, it } from 'vitest'
import { nextFloat, nextInt, pickOne, sample, shuffle } from './rng'

describe('确定性随机数', () => {
  it('同种子产生同序列，异种子产生异序列', () => {
    const run = (seed: number) => {
      let state = seed
      const out: number[] = []
      for (let i = 0; i < 10; i++) {
        const step = nextFloat(state)
        out.push(step.value)
        state = step.state
      }
      return out
    }
    expect(run(42)).toEqual(run(42))
    expect(run(42)).not.toEqual(run(43))
  })

  it('输出落在 [0,1) 且不退化', () => {
    let state = 7
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      const step = nextFloat(state)
      expect(step.value).toBeGreaterThanOrEqual(0)
      expect(step.value).toBeLessThan(1)
      state = step.state
      seen.add(step.value)
    }
    expect(seen.size).toBeGreaterThan(900)
  })

  it('nextInt 分布均匀且落在 [0, max)', () => {
    let state = 2024
    const counts = new Array<number>(6).fill(0)
    const draws = 12000
    for (let i = 0; i < draws; i++) {
      const step = nextInt(state, 6)
      expect(step.value).toBeGreaterThanOrEqual(0)
      expect(step.value).toBeLessThan(6)
      counts[step.value] = (counts[step.value] ?? 0) + 1
      state = step.state
    }
    const expected = draws / 6
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected * 0.85)
      expect(count).toBeLessThan(expected * 1.15)
    }
  })

  it('nextInt 的 maxExclusive <= 0 时返回 0 且状态不变', () => {
    expect(nextInt(555, 0)).toEqual({ value: 0, state: 555 })
    expect(nextInt(555, -3)).toEqual({ value: 0, state: 555 })
  })

  it('sample 不重复抽取且不超过长度', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const step = sample(items, 3, 99)
    expect(step.values).toHaveLength(3)
    expect(new Set(step.values).size).toBe(3)
    for (const value of step.values) expect(items).toContain(value)

    expect(sample(items, 99, 99).values).toHaveLength(5)
  })

  it('pickOne 一定取到数组内元素', () => {
    const items = ['x', 'y', 'z']
    for (let seed = 0; seed < 20; seed++) {
      expect(items).toContain(pickOne(items, seed).value)
    }
  })

  it('shuffle 保持元素集合不变', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const step = shuffle(items, 31415)
    expect([...step.items].sort((a, b) => a - b)).toEqual(items)
  })
})
