import { CARD_REFS, COMPARE_OPS, CONDITION_KINDS, PHASES, ZONE_NAMES } from '../kinds'
import type { RoleRef } from '../kinds'
import type { Issue, Ref } from './fieldTables'
import { CONDITION_KEYS } from './fieldTables'
import {
  asArray,
  asObj,
  asString,
  checkEnum,
  checkKeys,
  checkRole,
  checkText,
  push,
} from './primitives'
import { checkValue } from './valueNode'

/**
 * 条件 `Condition` 的校验。
 *
 * 进入本函数时已有 `roles` 与 `refs`：前者限定"这个语境允许引用哪些角色"
 * （见 fieldTables 的 CONTEXT_ROLES），后者收集牌种/技能引用交给第二遍解析。
 */
export function checkCondition(
  node: unknown,
  path: string,
  roles: readonly RoleRef[],
  issues: Issue[],
  refs: Ref[],
): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', '条件必须是对象')
    return
  }
  const kind = checkEnum(obj, 'kind', CONDITION_KINDS, path, issues, 'unknown-condition')
  if (!kind) return
  const keys = CONDITION_KEYS[kind] ?? ['kind']
  // 任何条件都可以带失败说明
  checkKeys(obj, path, [...keys, 'reason'], [], issues)
  if (obj.reason !== undefined) checkText(obj, 'reason', path, issues)

  switch (kind) {
    case 'not':
      checkCondition(obj.of, `${path}#/of`, roles, issues, refs)
      break
    case 'all':
    case 'any': {
      const list = asArray(obj.of)
      if (!list || list.length === 0) {
        push(issues, `${path}#/of`, 'bad-combination', `${kind} 至少需要一个子条件`)
      } else {
        list.forEach((item, i) => checkCondition(item, `${path}#/of/${i}`, roles, issues, refs))
      }
      break
    }
    case 'compare':
      checkEnum(obj, 'op', COMPARE_OPS, path, issues)
      checkValue(obj.left, `${path}#/left`, roles, issues)
      checkValue(obj.right, `${path}#/right`, roles, issues)
      break
    case 'alive':
      checkRole(obj, 'of', roles, path, issues)
      break
    case 'has-cards':
      checkRole(obj, 'of', roles, path, issues)
      checkEnum(obj, 'zone', ZONE_NAMES, path, issues)
      checkValue(obj.atLeast, `${path}#/atLeast`, roles, issues)
      break
    case 'card-kind-count': {
      checkRole(obj, 'of', roles, path, issues)
      checkEnum(obj, 'zone', ZONE_NAMES, path, issues)
      const cardKind = asString(obj.cardKind)
      if (cardKind) refs.push({ path: `${path}#/cardKind`, type: 'card', id: cardKind })
      else push(issues, `${path}#/cardKind`, 'bad-type', 'cardKind 必须是牌种 id')
      checkValue(obj.atLeast, `${path}#/atLeast`, roles, issues)
      break
    }
    case 'in-processing':
      checkEnum(obj, 'card', CARD_REFS, path, issues)
      break
    case 'picked-count':
      checkValue(obj.atLeast, `${path}#/atLeast`, roles, issues)
      break
    case 'skill-unused': {
      const skill = asString(obj.skill)
      if (skill) refs.push({ path: `${path}#/skill`, type: 'skill', id: skill })
      else push(issues, `${path}#/skill`, 'bad-type', 'skill 必须是技能 id')
      break
    }
    case 'phase-is':
      checkEnum(obj, 'phase', PHASES, path, issues)
      break
    default:
      break
  }
}
