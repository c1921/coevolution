import type { Effect } from './types'

/**
 * 效果树的**结构查询**：只回答"文档里有没有做某件事"这类问题，
 * 不执行任何效果，也不依赖注册表或解释器（本模块是纯叶子）。
 *
 * 为什么单独一个模块：这些查询同时服务互不相干的调用方——
 * AI 判断牌面/主动技的用途、注册表派生卡牌角色（`cardRole`）、以及测试。
 * 塞进解释器或注册表都会让别的调用方绕远路，也会让这两者互相牵连。
 *
 * 递归形状只有一份（`findEffect`）。注意在 `for-each-target` 内部也照样命中：
 * 那里 `target` 指"本次迭代的目标"，而调用方问的是"这份效果会不会打到
 * 被选中的那个目标"，语义上仍然是"会"。
 */

/**
 * 深度优先找第一个满足 `match` 的效果节点，含 if 的 then/else、
 * contest 的 onMet/onUnmet、for-each-target 的子效果。
 *
 * 只服务"有没有"这类布尔查询。需要**数值归约**的查询（例如
 * `registry.ts` 的 `selfThreatOf`：分支要取 max 或求和）不适用，请自行递归。
 */
export function findEffect(
  effects: readonly Effect[] | undefined,
  match: (effect: Effect) => boolean,
): Effect | undefined {
  for (const effect of effects ?? []) {
    if (match(effect)) return effect
    if (effect.kind === 'if') {
      const hit = findEffect(effect.then, match) ?? findEffect(effect.else, match)
      if (hit) return hit
    } else if (effect.kind === 'contest') {
      const hit = findEffect(effect.onMet, match) ?? findEffect(effect.onUnmet, match)
      if (hit) return hit
    } else if (effect.kind === 'for-each-target') {
      const hit = findEffect(effect.effects, match)
      if (hit) return hit
    }
  }
  return undefined
}

/** 效果列表（含嵌套分支）里是否出现某条指令 */
export function effectsInclude(effects: readonly Effect[] | undefined, kind: string): boolean {
  return findEffect(effects, (effect) => effect.kind === kind) !== undefined
}

/**
 * 这条效果是不是"打向被选定目标"的伤害类指令。
 *
 * 注意 **不能**用 `effect.kind === 'threat'` 代替：只打自己的自伤效果
 * （`target: 'self'`，如【风暴】对自己那一路）不算"打向选定目标"。
 */
function harmsChosenTarget(effect: Effect): boolean {
  if (effect.kind === 'threat' || effect.kind === 'lose-hp' || effect.kind === 'pay-energy') {
    return effect.target === 'target'
  }
  return false
}

/**
 * 效果列表里是否含有指向**选定目标**的伤害类效果（含嵌套分支）。
 *
 * AI 用它决定目标偏好（有害效果优先选对手）与判断主动技是不是进攻型。
 * 与"能不能伤到自己"（`registry.cardSelfThreat`）是两个不同的问题，别混用。
 */
export function effectsHarmChosenTarget(effects: readonly Effect[] | undefined): boolean {
  return findEffect(effects, harmsChosenTarget) !== undefined
}
