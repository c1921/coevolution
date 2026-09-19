import { NODE_SPECS, requiredFieldsOf, schemaFields, unreachableDefs } from './fieldSpecs'
import type { DefName, JsonSchema, Spec } from './fieldSpecs'
import { DOC_KINDS } from './kinds'

/**
 * 由代码生成 JSON Schema（draft 2020-12）。
 *
 * 为什么是"生成"而不是手写：手写的 schema 会与校验器漂移，而 schema 是编辑器补全与
 * 内容作者的规范文本。字段、类型、必填与判别式枚举**全部**来自 `fieldSpecs.ts`
 * —— 校验器读的是同一份表，所以两者不可能漂移。生成结果由 schema.test.ts 与提交的
 * `data/dsl/schema.json` 逐字节比对，因此也不可能悄悄过期。
 *
 * 覆盖范围：文档结构、允许/必填字段、判别式枚举、嵌套节点引用与取值类型。
 * 语义约束（引用完整性、费用 ≥ 1、牌区组合、占位符与角色可用性）无法用 JSON Schema
 * 表达，由加载期校验器强制 —— 这是刻意的分工。
 */

export type { JsonSchema }

function toJson(spec: Spec, defs: Record<string, JsonSchema>): JsonSchema {
  switch (spec.t) {
    case 'any':
      return {}
    case 'string':
      return { type: 'string' }
    case 'boolean':
      return { type: 'boolean' }
    case 'integer':
      return { type: 'integer' }
    case 'number':
      return { type: 'number' }
    case 'const':
      return { const: spec.value }
    case 'enum':
      return { enum: [...spec.values] }
    case 'ref':
      return { $ref: `#/$defs/${spec.name}` }
    case 'array':
      return { type: 'array', items: toJson(spec.of, defs) }
    case 'map': {
      const out: JsonSchema = {
        type: 'object',
        additionalProperties: toJson(spec.of, defs),
      }
      if (spec.keys) out.propertyNames = { enum: [...spec.keys] }
      return out
    }
    case 'oneOf':
      return { oneOf: spec.of.map((item) => toJson(item, defs)) }
  }
}

function buildDef(name: DefName, defs: Record<string, JsonSchema>): JsonSchema {
  const kinds = NODE_SPECS[name].kinds
  const properties: Record<string, JsonSchema> = {}
  for (const [field, fieldSpec] of Object.entries(schemaFields(name))) {
    properties[field] = toJson(fieldSpec, defs)
  }
  // 判别式字段排在最后：`kind` 由词表覆盖，不参与字段类型表
  if (kinds) properties.kind = { enum: [...kinds] }
  const required = [...requiredFieldsOf(name)]
  // 顶层文档的 id / dslVersion 由 checkDoc 统一报错，这里补进 schema 的必填
  if ((DOC_KINDS as readonly string[]).includes(name)) required.unshift('dslVersion', 'id')
  if (kinds) required.push('kind')
  const schema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties,
  }
  if (required.length > 0) schema.required = required
  return schema
}

export function buildSchema(): JsonSchema {
  const defs: Record<string, JsonSchema> = {}
  for (const name of Object.keys(NODE_SPECS) as DefName[]) {
    defs[name] = buildDef(name, defs)
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://coevolution.local/dsl/schema.json',
    title: '协同进化 · 内容 DSL',
    description:
      '由 src/game/dsl/schema.ts 从 kinds.ts 词表与 validate.ts 字段表生成，请勿手改；' +
      '语义约束（引用完整性、费用下限、牌区组合、占位符角色）由加载期校验器强制。',
    $defs: defs,
    oneOf: DOC_KINDS.map((kind) => ({ $ref: `#/$defs/${kind}` })),
  }
}

/** 生成提交用的 schema 文本（稳定性：键序固定 + 末尾换行） */
export function schemaJson(): string {
  return `${JSON.stringify(buildSchema(), null, 2)}\n`
}

/**
 * `$defs` 的可达性检查：从顶层文档种类出发，找出没人引用的节点。
 *
 * 与"字段表覆盖"不同，这里已经没有"字段名与类型对不上"的可能了 ——
 * 两者同源，都在 `fieldSpecs.ts`。剩下唯一会腐烂的是**孤儿节点**：
 * 新增一个 `$defs` 节点却忘了在别处引用它（schema.test.ts 断言本函数返回空）。
 */
export { unreachableDefs }
