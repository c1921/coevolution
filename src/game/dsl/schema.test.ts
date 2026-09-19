import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSchema, schemaJson, unreachableDefs } from './schema'
import type { JsonSchema } from './schema'

/**
 * schema.json 是"生成物"：本测试把它与代码生成的版本逐字节比对。
 * 如果这里失败，说明字段表/词表变了但提交的 schema 没更新——
 * 用 `UPDATE_DSL_SCHEMA=1 npx vitest run src/game/dsl/schema.test.ts` 重新生成。
 *
 * 另外用一个极小的 JSON Schema 子集校验器，让每份内容文档真的过一遍提交的 schema，
 * 证明这份 schema 不是摆设（能拒绝多余键、认得出判别式与嵌套结构）。
 */

const DSL_DIR = 'src/game/data/dsl'
const SCHEMA_PATH = join(DSL_DIR, 'schema.json')

function contentDocPaths(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(DSL_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(DSL_DIR, entry.name)
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.json')) out.push(join(dir, file))
    }
  }
  return out.sort()
}

type Schema = Record<string, unknown>

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 迷你 JSON Schema 校验器：支持 $ref / oneOf / type / const / enum / required / items / additionalProperties / propertyNames */
function check(
  schema: Schema,
  defs: Record<string, Schema>,
  value: unknown,
  path: string,
  errors: string[],
): boolean {
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace('#/$defs/', '')
    const target = defs[name]
    if (!target) {
      errors.push(`${path}: schema 引用了不存在的 $defs/${name}`)
      return false
    }
    return check(target, defs, value, path, errors)
  }

  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf as Schema[]
    const passed = branches.filter((branch) => {
      const local: string[] = []
      return check(branch, defs, value, path, local)
    })
    if (passed.length !== 1) {
      errors.push(`${path}: 应恰好匹配 oneOf 的一个分支，实际匹配 ${passed.length} 个`)
      return false
    }
    return true
  }

  if ('const' in schema && value !== schema.const) {
    errors.push(`${path}: 期望常量 ${JSON.stringify(schema.const)}，实际 ${JSON.stringify(value)}`)
    return false
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: 期望 ${JSON.stringify(schema.enum)} 之一，实际 ${JSON.stringify(value)}`)
    return false
  }

  const type = schema.type
  if (type === 'object') {
    if (!isObj(value)) {
      errors.push(`${path}: 期望对象，实际 ${typeof value}`)
      return false
    }
    const properties = (schema.properties ?? {}) as Record<string, Schema>
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in value)) errors.push(`${path}: 缺少必填字段 ${key}`)
    }
    for (const [key, item] of Object.entries(value)) {
      const propSchema = properties[key]
      if (propSchema) {
        check(propSchema, defs, item, `${path}.${key}`, errors)
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: 出现未定义字段 ${key}`)
      }
    }
    return errors.length === 0
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: 期望数组，实际 ${typeof value}`)
      return false
    }
    const items = schema.items as Schema | undefined
    if (items) value.forEach((item, i) => check(items, defs, item, `${path}[${i}]`, errors))
    return errors.length === 0
  }
  if (type === 'string' && typeof value !== 'string') {
    errors.push(`${path}: 期望字符串，实际 ${typeof value}`)
    return false
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path}: 期望布尔值，实际 ${typeof value}`)
    return false
  }
  if (type === 'integer' && !Number.isInteger(value)) {
    errors.push(`${path}: 期望整数，实际 ${JSON.stringify(value)}`)
    return false
  }
  if (type === 'number' && typeof value !== 'number') {
    errors.push(`${path}: 期望数字，实际 ${typeof value}`)
    return false
  }
  return errors.length === 0
}

function validateAgainst(schema: JsonSchema, value: unknown): string[] {
  const errors: string[] = []
  check(schema as Schema, (schema.$defs ?? {}) as Record<string, Schema>, value, '$', errors)
  return errors
}

/** 直接针对某个 $defs 节点校验，便于断言具体错误信息（绕过顶层 oneOf 的汇总） */
function validateDef(schema: JsonSchema, name: string, value: unknown): string[] {
  const defs = (schema.$defs ?? {}) as Record<string, Schema>
  const target = defs[name]
  if (!target) throw new Error(`没有 $defs/${name}`)
  const errors: string[] = []
  check(target, defs, value, '$', errors)
  return errors
}

describe('DSL schema.json', () => {
  it('每个 $defs 节点都能从顶层文档种类到达（没有孤儿节点）', () => {
    expect(unreachableDefs()).toEqual([])
  })

  it('提交的 schema.json 与代码生成的一致', () => {
    const generated = schemaJson()
    if (process.env.UPDATE_DSL_SCHEMA === '1') {
      writeFileSync(SCHEMA_PATH, generated, 'utf8')
      return
    }
    const committed = readFileSync(SCHEMA_PATH, 'utf8')
    expect(committed).toBe(generated)
  })

  it('每份内容文档都能通过 schema 校验', () => {
    const schema = buildSchema()
    for (const path of contentDocPaths()) {
      const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
      const errors = validateAgainst(schema, value)
      expect(errors, `${path} 不符合 schema：${errors.join('; ')}`).toEqual([])
    }
  })

  it('schema 会拒绝多余字段与错误的判别式（证明校验不是空转）', () => {
    const schema = buildSchema()
    const bad = {
      dslVersion: 1,
      kind: 'skill',
      id: 'x',
      name: 'x',
      text: 'x',
      nonsense: true,
      modifiers: [{ channel: 'mana', op: 'add', value: { kind: 'const', value: 1 } }],
    }
    const errors = validateDef(schema, 'skill', bad).join('\n')
    expect(errors).toMatch(/nonsense/)
    expect(errors).toMatch(/mana/)

    // 顶层 oneOf 拒绝未知文档种类
    expect(validateAgainst(schema, { dslVersion: 1, kind: 'monster', id: 'x' })).not.toEqual([])
  })

  it('每份文档的 $schema 都指向 data/dsl/schema.json', () => {
    for (const path of contentDocPaths()) {
      const value = JSON.parse(readFileSync(path, 'utf8')) as { $schema?: string }
      expect(value.$schema, `${path} 缺少 $schema`).toBe('../schema.json')
    }
  })
})
