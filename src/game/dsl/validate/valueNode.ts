import { CHANNELS, VALUE_KINDS, VALUE_REF_NAMES } from '../kinds'
import type { RoleRef } from '../kinds'
import type { Issue } from './fieldTables'
import { VALUE_KEYS } from './fieldTables'
import { asArray, asNumber, asObj, checkEnum, checkKeys, optionalRole, push } from './primitives'

/** 数值表达式 `Value` 的校验（递归：算术节点的子表达式走同一条路径） */
export function checkValue(
  node: unknown,
  path: string,
  roles: readonly RoleRef[],
  issues: Issue[],
): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', '数值表达式必须是对象')
    return
  }
  const kind = checkEnum(obj, 'kind', VALUE_KINDS, path, issues, 'unknown-instruction')
  if (!kind) return
  checkKeys(obj, path, VALUE_KEYS[kind] ?? ['kind'], [], issues)

  if (kind === 'const') {
    const value = asNumber(obj.value)
    if (value === undefined) {
      push(issues, `${path}#/value`, 'bad-number', 'const 的 value 必须是有限数字')
    }
  }
  if (kind === 'ref') {
    checkEnum(obj, 'ref', VALUE_REF_NAMES, path, issues)
    optionalRole(obj, 'of', roles, path, issues)
  }
  if (kind === 'channel') {
    checkEnum(obj, 'channel', CHANNELS, path, issues, 'unknown-channel')
    optionalRole(obj, 'of', roles, path, issues)
  }
  if (['add', 'sub', 'mul', 'min', 'max'].includes(kind)) {
    const list = asArray(obj.of)
    if (!list || list.length === 0) {
      push(issues, `${path}#/of`, 'bad-combination', `${kind} 至少需要一个子表达式`)
    } else {
      list.forEach((item, i) => checkValue(item, `${path}#/of/${i}`, roles, issues))
    }
  }
  if (kind === 'floor-div') {
    checkValue(obj.of, `${path}#/of`, roles, issues)
    checkValue(obj.by, `${path}#/by`, roles, issues)
  }
  if (kind === 'clamp') {
    checkValue(obj.of, `${path}#/of`, roles, issues)
    if (asNumber(obj.min) === undefined) {
      push(issues, `${path}#/min`, 'bad-number', 'clamp 的 min 必须是数字')
    }
    if (asNumber(obj.max) === undefined) {
      push(issues, `${path}#/max`, 'bad-number', 'clamp 的 max 必须是数字')
    }
  }
}
