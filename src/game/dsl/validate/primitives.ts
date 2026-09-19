import { ROLES } from '../kinds'
import type { RoleRef } from '../kinds'
import type { Issue, IssueCode, Obj } from './fieldTables'

/**
 * 单字段校验原语：所有节点校验器（值 / 条件 / 效果 / 目标 / 各文档）都从这几个
 * 函数拼出来。它们只做"取字段 + 报一条问题"，不含任何跨字段语义，
 * 因此改动面最小、也最适合单独成模块。
 *
 * 约定：`check*` 系列把问题 push 进调用方传进来的 `issues`，返回值只在
 * "后续校验需要用到这个值"时才给出（例如 checkEnum 返回收敛后的联合类型）。
 */

export function push(issues: Issue[], path: string, code: IssueCode, message: string): void {
  issues.push({ path, code, message })
}

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 检查字段集合：必填缺失与多余键都会报错 */
export function checkKeys(
  node: Obj,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  issues: Issue[],
): void {
  for (const key of required) {
    if (!(key in node)) {
      push(issues, `${path}#/${key}`, 'missing-field', `缺少必填字段 ${key}`)
    }
  }
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) {
      push(issues, `${path}#/${key}`, 'unknown-key', `未知字段 ${key}`)
    }
  }
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined
}

export function asObj(v: unknown): Obj | undefined {
  return isObj(v) ? v : undefined
}

/** 非空字符串字段 */
export function checkText(
  node: Obj,
  key: string,
  path: string,
  issues: Issue[],
  required = true,
): void {
  const value = node[key]
  if (value === undefined && !required) return
  if (typeof value !== 'string' || value.length === 0) {
    push(issues, `${path}#/${key}`, 'bad-type', `${key} 必须是非空字符串`)
  }
}

/** 非负整数字段 */
export function checkCount(node: Obj, key: string, path: string, issues: Issue[], min = 0): void {
  const value = node[key]
  if (value === undefined) return
  const num = asNumber(value)
  if (num === undefined || !Number.isInteger(num) || num < min) {
    push(issues, `${path}#/${key}`, 'bad-number', `${key} 必须是不小于 ${min} 的整数`)
  }
}

export function checkEnum<T extends string>(
  node: Obj,
  key: string,
  allowed: readonly T[],
  path: string,
  issues: Issue[],
  code: IssueCode = 'bad-type',
): T | undefined {
  const value = node[key]
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    push(
      issues,
      `${path}#/${key}`,
      code,
      `${key} 必须是 ${allowed.join(' / ')} 之一，实际为 ${JSON.stringify(value)}`,
    )
    return undefined
  }
  return value as T
}

export function checkRole(
  node: Obj,
  key: string,
  roles: readonly RoleRef[],
  path: string,
  issues: Issue[],
): RoleRef | undefined {
  const value = node[key]
  if (typeof value !== 'string' || !ROLES.includes(value as RoleRef)) {
    push(issues, `${path}#/${key}`, 'bad-type', `${key} 必须是角色名`)
    return undefined
  }
  if (!roles.includes(value as RoleRef)) {
    push(
      issues,
      `${path}#/${key}`,
      'unknown-role',
      `当前语境不允许角色 ${value}（可用：${roles.join(' / ')}）`,
    )
    return undefined
  }
  return value as RoleRef
}

/** 角色字段可省略，缺省为 self */
export function optionalRole(
  node: Obj,
  key: string,
  roles: readonly RoleRef[],
  path: string,
  issues: Issue[],
): void {
  if (node[key] === undefined) return
  checkRole(node, key, roles, path, issues)
}
