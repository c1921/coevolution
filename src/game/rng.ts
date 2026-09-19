// 确定性伪随机数：mulberry32 的纯函数式步进版本。
// 状态是一个 32 位整数，随 GameState.rngState 一起序列化，
// 因此同一种子必定复现同一局，单测可以稳定断言。

/** 推进一步，返回 [0,1) 区间的浮点数与新的内部状态 */
export function nextFloat(rngState: number): { value: number; state: number } {
  const state = (rngState + 0x6d2b79f5) | 0
  let r = state
  r = Math.imul(r ^ (r >>> 15), r | 1)
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296
  return { value, state }
}

/** 返回 [0, maxExclusive) 的整数；maxExclusive <= 0 时返回 0 */
export function nextInt(rngState: number, maxExclusive: number): { value: number; state: number } {
  if (maxExclusive <= 0) return { value: 0, state: rngState }
  const step = nextFloat(rngState)
  return { value: Math.floor(step.value * maxExclusive), state: step.state }
}

/** Fisher–Yates 洗牌，返回新数组，不修改入参 */
export function shuffle<T>(items: T[], rngState: number): { items: T[]; state: number } {
  const out = items.slice()
  let state = rngState
  for (let i = out.length - 1; i > 0; i--) {
    const step = nextInt(state, i + 1)
    state = step.state
    const j = step.value
    const a = out[i] as T
    const b = out[j] as T
    out[i] = b
    out[j] = a
  }
  return { items: out, state }
}

/** 从数组中随机取一个元素（数组不可为空） */
export function pickOne<T>(items: T[], rngState: number): { value: T; state: number } {
  const step = nextInt(rngState, items.length)
  return { value: items[step.value] as T, state: step.state }
}

/** 从数组中不重复地随机抽取 count 个元素（count 超过长度时返回整个数组的打乱副本） */
export function sample<T>(
  items: T[],
  count: number,
  rngState: number,
): { values: T[]; state: number } {
  const result = shuffle(items, rngState)
  return { values: result.items.slice(0, Math.max(0, count)), state: result.state }
}
