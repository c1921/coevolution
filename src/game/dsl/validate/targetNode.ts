import {
  CHANNELS,
  MODIFIER_OPS,
  PHASES,
  TARGET_COUNT_MODES,
  TARGET_DEFAULTS,
  TARGET_SCOPES,
  TIMING_KINDS,
  TRANSFORM_CONTEXTS,
} from '../kinds'
import type { Issue, Ref } from './fieldTables'
import { CONTEXT_ROLES, DOC_FIELDS } from './fieldTables'
import { asArray, asNumber, asObj, asString, checkEnum, checkKeys, isObj, push } from './primitives'
import { checkCondition } from './conditionNode'
import { checkValue } from './valueNode'

/**
 * 目标规格、修正、转化与时机的校验。
 *
 * 本文件的后半段（targetDeclaresCount → guardMultiTargetEffects）是一组
 * **多目标静态分析**：判断"这份效果有没有直接引用 `target`"。
 * 它们彼此递归调用，是一个整体（`guardMultiTargetEffects` 的 `inside` 标志
 * 决定了"已经在 for-each-target 里"这个状态），因此同文件迁移、不拆散。
 */

export function checkTarget(
  node: unknown,
  path: string,
  issues: Issue[],
  refs: Ref[],
  allowCount = true,
): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', 'target 必须是对象')
    return
  }
  checkKeys(obj, path, DOC_FIELDS.target.allowed, DOC_FIELDS.target.required, issues)
  checkEnum(obj, 'scope', TARGET_SCOPES, path, issues)
  if (obj.required !== undefined && typeof obj.required !== 'boolean') {
    push(issues, `${path}#/required`, 'bad-type', 'required 必须是布尔值')
  }
  if (obj.default !== undefined) {
    checkEnum(obj, 'default', TARGET_DEFAULTS, path, issues)
  }
  if (typeof obj.alive !== 'boolean') {
    push(issues, `${path}#/alive`, 'bad-type', 'alive 必须是布尔值')
  }
  if (obj.range !== undefined && typeof obj.range !== 'boolean') {
    push(issues, `${path}#/range`, 'bad-type', 'range 必须是布尔值')
  }
  if (obj.count !== undefined) {
    if (!allowCount) {
      push(
        issues,
        `${path}#/count`,
        'bad-combination',
        '多目标（count）目前只支持卡牌的使用变体，主动技仍是单选',
      )
    } else {
      checkTargetCount(obj.count, `${path}#/count`, issues)
    }
    if (obj.default !== undefined) {
      push(
        issues,
        path,
        'bad-combination',
        '多目标没有「缺省单目标」的概念：count 与 default 不能同时出现',
      )
    }
  }
  if (obj.conditions !== undefined) {
    const list = asArray(obj.conditions)
    if (!list) {
      push(issues, `${path}#/conditions`, 'bad-type', 'conditions 必须是数组')
    } else {
      list.forEach((item, i) =>
        checkCondition(item, `${path}#/conditions/${i}`, ['self', 'target'], issues, refs),
      )
    }
  }
}

/** 目标个数规格：all 不需要个数；exactly 必须给出 ≥ 1 的个数表达式 */
export function checkTargetCount(node: unknown, path: string, issues: Issue[]): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', 'count 必须是对象')
    return
  }
  checkKeys(obj, path, DOC_FIELDS.targetCount.allowed, DOC_FIELDS.targetCount.required, issues)
  const mode = checkEnum(obj, 'mode', TARGET_COUNT_MODES, path, issues)

  if (mode === 'all') {
    if (obj.count !== undefined) {
      push(issues, `${path}#/count`, 'bad-combination', 'all 模式不需要 count')
    }
    return
  }
  if (mode !== 'exactly') return
  if (obj.count === undefined) {
    push(issues, `${path}#/count`, 'missing-field', 'exactly 模式必须给出 count')
    return
  }
  // 个数在「还没选出目标」的环境求值，因此只允许 self / active 角色
  checkValue(obj.count, `${path}#/count`, ['self', 'active'], issues)
  const value = asObj(obj.count)
  if (value?.kind === 'const') {
    const n = asNumber(value.value)
    if (n !== undefined && n < 1) {
      push(issues, `${path}#/count#/value`, 'bad-number', '目标个数必须 ≥ 1')
    }
  }
}

/** 目标规格是否声明了多目标 */
export function targetDeclaresCount(node: unknown): boolean {
  const obj = asObj(node)
  return obj !== undefined && obj.count !== undefined
}

/** 值表达式是否引用角色 target */
function valueRefsTarget(value: unknown): boolean {
  const obj = asObj(value)
  if (!obj) return false
  if (obj.kind === 'ref' || obj.kind === 'channel') return obj.of === 'target'
  if (Array.isArray(obj.of)) return obj.of.some(valueRefsTarget)
  if (isObj(obj.of)) return valueRefsTarget(obj.of)
  if (obj.by !== undefined) return valueRefsTarget(obj.by)
  return false
}

/** 条件是否引用角色 target */
function conditionRefsTarget(node: unknown): boolean {
  const obj = asObj(node)
  if (!obj) return false
  if (obj.of === 'target') return true
  if (isObj(obj.of)) return conditionRefsTarget(obj.of)
  if (Array.isArray(obj.of)) return obj.of.some(conditionRefsTarget)
  for (const key of ['left', 'right', 'atLeast'] as const) {
    if (obj[key] !== undefined && valueRefsTarget(obj[key])) return true
  }
  return false
}

/** 日志模板是否引用角色 target */
function logRefsTarget(template: unknown): boolean {
  if (typeof template !== 'string') return false
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    if ((match[1] ?? '').split('.')[0] === 'target') return true
  }
  return false
}

/** 单条效果是否直接引用角色 target */
function effectRefsTarget(effect: unknown): boolean {
  const obj = asObj(effect)
  if (!obj) return false
  switch (obj.kind) {
    case 'threat':
    case 'offset-threat':
    case 'lose-hp':
    case 'heal':
    case 'draw':
    case 'pay-energy':
    case 'gain-energy':
      return obj.target === 'target'
    case 'record-card-use':
    case 'resolve-dying':
      return obj.of === 'target'
    case 'contest':
      return obj.responder === 'target'
    case 'move-cards': {
      const from = asObj(obj.from)
      const to = asObj(obj.to)
      return from?.of === 'target' || to?.of === 'target'
    }
    case 'log':
      return logRefsTarget(obj.template)
    case 'if':
      return conditionRefsTarget(obj.condition)
    default:
      return false
  }
}

/**
 * 多目标变体的效果必须在 for-each-target 内引用 target。
 * 否则 ctx.target 不会被绑定（多目标下不绑定），结算会在更深处抛错，
 * 或者内容作者以为"对每个目标"却只作用于其中一个。
 */
export function guardMultiTargetEffects(
  node: unknown,
  path: string,
  issues: Issue[],
  inside = false,
): void {
  const list = asArray(node)
  if (!list) return
  list.forEach((item, i) => {
    const obj = asObj(item)
    if (!obj) return
    const childPath = `${path}/${i}`
    if (obj.kind === 'for-each-target') {
      guardMultiTargetEffects(obj.effects, `${childPath}#/effects`, issues, true)
      return
    }
    if (!inside && effectRefsTarget(obj)) {
      push(
        issues,
        childPath,
        'bad-combination',
        '多目标效果对 target 的引用必须写在 for-each-target 内',
      )
    }
    if (obj.kind === 'if') {
      guardMultiTargetEffects(obj.then, `${childPath}#/then`, issues, inside)
      guardMultiTargetEffects(obj.else, `${childPath}#/else`, issues, inside)
    }
    if (obj.kind === 'contest') {
      guardMultiTargetEffects(obj.onMet, `${childPath}#/onMet`, issues, inside)
      guardMultiTargetEffects(obj.onUnmet, `${childPath}#/onUnmet`, issues, inside)
    }
  })
}

export function checkModifier(node: unknown, path: string, issues: Issue[], refs: Ref[]): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', 'modifier 必须是对象')
    return
  }
  checkKeys(obj, path, DOC_FIELDS.modifier.allowed, DOC_FIELDS.modifier.required, issues)
  checkEnum(obj, 'channel', CHANNELS, path, issues, 'unknown-channel')
  checkEnum(obj, 'op', MODIFIER_OPS, path, issues)
  checkValue(obj.value, `${path}#/value`, CONTEXT_ROLES.modifier, issues)
  void refs
}

export function checkTransform(node: unknown, path: string, issues: Issue[], refs: Ref[]): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', 'transform 必须是对象')
    return
  }
  checkKeys(obj, path, DOC_FIELDS.transform.allowed, DOC_FIELDS.transform.required, issues)
  for (const key of ['from', 'to'] as const) {
    const id = asString(obj[key])
    if (id) refs.push({ path: `${path}#/${key}`, type: 'card', id })
    else push(issues, `${path}#/${key}`, 'bad-type', `${key} 必须是牌种 id`)
  }
  const contexts = asArray(obj.contexts)
  if (!contexts || contexts.length === 0) {
    push(issues, `${path}#/contexts`, 'bad-combination', 'contexts 至少要有一个语境')
    return
  }
  const to = asString(obj.to)
  contexts.forEach((item, i) => {
    if (
      typeof item !== 'string' ||
      !TRANSFORM_CONTEXTS.includes(item as (typeof TRANSFORM_CONTEXTS)[number])
    ) {
      push(
        issues,
        `${path}#/contexts/${i}`,
        'bad-type',
        `转化语境必须是 ${TRANSFORM_CONTEXTS.join(' / ')}`,
      )
      return
    }
    // 转化后的牌面必须在该语境真的有用法，否则这条转化永远不会生效
    if (to) {
      refs.push({
        path: `${path}#/to`,
        type: 'card',
        id: to,
        expect: item as 'use' | 'play',
      })
    }
  })
}

export function checkTiming(node: unknown, path: string, issues: Issue[]): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', '时机必须是对象')
    return
  }
  checkKeys(obj, path, DOC_FIELDS.timing.allowed, DOC_FIELDS.timing.required, issues)
  const at = checkEnum(obj, 'at', TIMING_KINDS, path, issues)
  const needsPhase = at === 'phase-start' || at === 'phase-end'
  if (needsPhase) {
    checkEnum(obj, 'phase', PHASES, path, issues)
  } else if (at !== undefined && obj.phase !== undefined) {
    push(issues, `${path}#/phase`, 'bad-combination', `${at} 时机不需要 phase`)
  }
}
