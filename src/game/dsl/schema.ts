import {
  CARD_REFS,
  CHANNELS,
  COMPARE_OPS,
  CONDITION_KINDS,
  DOC_KINDS,
  DSL_VERSION,
  EFFECT_KINDS,
  LOG_VAR_ROOTS,
  MODIFIER_OPS,
  MOVE_ZONES,
  PHASES,
  PICK_MODES,
  ROLES,
  TARGET_COUNT_MODES,
  TARGET_DEFAULTS,
  TARGET_SCOPES,
  TIMING_KINDS,
  TRANSFORM_CONTEXTS,
  USE_CONTEXTS,
  VALUE_KINDS,
  VALUE_REF_NAMES,
  ZONE_NAMES,
} from './kinds'
// 字段表住在 validate/fieldTables（唯一来源）：生成器只依赖这张表，
// 不再依赖整个校验器，两个模块之间没有耦合。
import { DOC_SCHEMA_KEYS } from './validate/fieldTables'

/**
 * 由代码生成 JSON Schema（draft 2020-12）。
 *
 * 为什么是"生成"而不是手写：手写的 schema 会与校验器漂移，而 schema 是编辑器补全与
 * 内容作者的规范文本。这里把 kinds.ts 的词表与 validate/fieldTables.ts 的字段表当作
 * 唯一来源，生成结果由 schema.test.ts 与提交的 schema.json 逐字节比对，因此不可能
 * 悄悄过期。
 *
 * 覆盖范围：文档结构、允许/必填字段、判别式枚举、嵌套节点引用与取值类型。
 * 语义约束（引用完整性、费用 ≥ 1、牌区组合、占位符与角色可用性）由 validate.ts 在加载期强制，
 * 那部分无法用 JSON Schema 表达，是刻意的分工。
 */

export type JsonSchema = Record<string, unknown>

type Spec =
  | { t: 'any' }
  | { t: 'string' }
  | { t: 'boolean' }
  | { t: 'integer' }
  | { t: 'number' }
  | { t: 'const'; value: unknown }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'ref'; name: DefName }
  | { t: 'array'; of: Spec }
  | { t: 'map'; of: Spec; keys?: readonly string[] }
  | { t: 'oneOf'; of: Spec[] }

type DefName =
  | 'value'
  | 'condition'
  | 'effect'
  | 'pick'
  | 'zoneRef'
  | 'target'
  | 'targetCount'
  | 'modifier'
  | 'transform'
  | 'timing'
  | 'trigger'
  | 'activate'
  | 'costCards'
  | 'ui'
  | 'species'
  | 'skill'
  | 'card'
  | 'useVariant'
  | 'playVariant'
  | 'ruleset'
  | 'deck'
  | 'deckEntry'
  | 'rule'

const STRING: Spec = { t: 'string' }
const BOOLEAN: Spec = { t: 'boolean' }
const INTEGER: Spec = { t: 'integer' }
const VALUE: Spec = { t: 'ref', name: 'value' }
const CONDITION: Spec = { t: 'ref', name: 'condition' }
const EFFECT: Spec = { t: 'ref', name: 'effect' }
const EFFECTS: Spec = { t: 'array', of: EFFECT }
const CONDITIONS: Spec = { t: 'array', of: CONDITION }
const ROLES_SPEC: Spec = { t: 'enum', values: ROLES }

/** 各节点的字段类型表。新增字段必须在这里给出类型（schema.test.ts 会检查覆盖率）。 */
const NODE_SPECS: Record<DefName, { kind?: readonly string[]; fields: Record<string, Spec> }> = {
  value: {
    kind: VALUE_KINDS,
    fields: {
      value: { t: 'number' },
      ref: { t: 'enum', values: VALUE_REF_NAMES },
      // of 有三种形态：ref/channel 取角色，floor-div/clamp 取子表达式，add/sub/... 取子表达式数组
      of: { t: 'oneOf', of: [ROLES_SPEC, VALUE, { t: 'array', of: VALUE }] },
      by: VALUE,
      min: { t: 'number' },
      max: { t: 'number' },
      channel: { t: 'enum', values: CHANNELS },
    },
  },
  condition: {
    kind: CONDITION_KINDS,
    fields: {
      of: { t: 'oneOf', of: [ROLES_SPEC, CONDITION, { t: 'array', of: CONDITION }] },
      op: { t: 'enum', values: COMPARE_OPS },
      left: VALUE,
      right: VALUE,
      zone: { t: 'enum', values: ZONE_NAMES },
      atLeast: VALUE,
      cardKind: STRING,
      card: { t: 'enum', values: CARD_REFS },
      skill: STRING,
      phase: { t: 'enum', values: PHASES },
      reason: STRING,
    },
  },
  effect: {
    kind: EFFECT_KINDS,
    fields: {
      template: STRING,
      vars: { t: 'map', of: VALUE, keys: LOG_VAR_ROOTS },
      target: ROLES_SPEC,
      amount: VALUE,
      count: VALUE,
      from: { t: 'ref', name: 'zoneRef' },
      to: { t: 'ref', name: 'zoneRef' },
      pick: { t: 'ref', name: 'pick' },
      of: ROLES_SPEC,
      cardKind: STRING,
      skill: STRING,
      responder: ROLES_SPEC,
      expectedCard: STRING,
      need: VALUE,
      onMet: EFFECTS,
      onUnmet: EFFECTS,
      effects: EFFECTS,
      condition: CONDITION,
      then: EFFECTS,
      else: EFFECTS,
      phase: { t: 'enum', values: PHASES },
      position: { t: 'enum', values: ['next', 'last'] },
    },
  },
  pick: {
    fields: {
      mode: { t: 'enum', values: PICK_MODES },
      count: INTEGER,
      cardKind: STRING,
      card: { t: 'enum', values: CARD_REFS },
    },
  },
  zoneRef: {
    fields: {
      zone: { t: 'enum', values: MOVE_ZONES },
      of: ROLES_SPEC,
    },
  },
  target: {
    fields: {
      scope: { t: 'enum', values: TARGET_SCOPES },
      required: BOOLEAN,
      default: { t: 'enum', values: TARGET_DEFAULTS },
      alive: BOOLEAN,
      range: BOOLEAN,
      conditions: CONDITIONS,
      count: { t: 'ref', name: 'targetCount' },
    },
  },
  targetCount: {
    fields: {
      mode: { t: 'enum', values: TARGET_COUNT_MODES },
      count: VALUE,
    },
  },
  modifier: {
    fields: {
      channel: { t: 'enum', values: CHANNELS },
      op: { t: 'enum', values: MODIFIER_OPS },
      value: VALUE,
    },
  },
  transform: {
    fields: {
      from: STRING,
      to: STRING,
      contexts: { t: 'array', of: { t: 'enum', values: TRANSFORM_CONTEXTS } },
    },
  },
  timing: {
    fields: {
      at: { t: 'enum', values: TIMING_KINDS },
      phase: { t: 'enum', values: PHASES },
    },
  },
  trigger: {
    fields: {
      on: { t: 'ref', name: 'timing' },
      optional: BOOLEAN,
      when: CONDITIONS,
      effects: EFFECTS,
      after: EFFECTS,
    },
  },
  activate: {
    fields: {
      timing: { t: 'enum', values: ['play'] },
      oncePerTurn: BOOLEAN,
      costCards: { t: 'ref', name: 'costCards' },
      requires: CONDITIONS,
      target: { t: 'ref', name: 'target' },
      effects: EFFECTS,
      after: EFFECTS,
      ui: { t: 'ref', name: 'ui' },
    },
  },
  costCards: {
    fields: {
      count: VALUE,
      cardKind: STRING,
    },
  },
  ui: {
    fields: {
      buttonLabel: STRING,
    },
  },
  species: {
    kind: ['species'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      name: STRING,
      maxHp: INTEGER,
      skills: { t: 'array', of: STRING },
      deck: STRING,
    },
  },
  skill: {
    kind: ['skill'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      name: STRING,
      text: STRING,
      modifiers: { t: 'array', of: { t: 'ref', name: 'modifier' } },
      transforms: { t: 'array', of: { t: 'ref', name: 'transform' } },
      trigger: { t: 'ref', name: 'trigger' },
      activate: { t: 'ref', name: 'activate' },
    },
  },
  card: {
    kind: ['card'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      name: STRING,
      short: STRING,
      text: STRING,
      cost: VALUE,
      use: { t: 'array', of: { t: 'ref', name: 'useVariant' } },
      play: { t: 'ref', name: 'playVariant' },
    },
  },
  useVariant: {
    fields: {
      context: { t: 'enum', values: USE_CONTEXTS },
      target: { t: 'ref', name: 'target' },
      requires: CONDITIONS,
      effects: EFFECTS,
      after: EFFECTS,
    },
  },
  playVariant: {
    fields: {
      respondsTo: STRING,
      requires: CONDITIONS,
      effects: EFFECTS,
    },
  },
  ruleset: {
    kind: ['ruleset'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      channels: { t: 'map', of: INTEGER, keys: CHANNELS },
    },
  },
  deck: {
    kind: ['deck'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      cards: { t: 'array', of: { t: 'ref', name: 'deckEntry' } },
    },
  },
  deckEntry: {
    fields: {
      kind: STRING,
      count: INTEGER,
    },
  },
  rule: {
    kind: ['rule'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      on: { t: 'ref', name: 'timing' },
      when: CONDITIONS,
      effects: EFFECTS,
    },
  },
}

/** 各文档节点的必填字段（与 validate.ts 的 DOC_FIELDS 保持同一份） */
function requiredFields(name: DefName): string[] {
  const table = DOC_SCHEMA_KEYS.fields as unknown as Record<
    string,
    { required: readonly string[] } | undefined
  >
  const entry = table[name]
  if (!entry) return []
  // 文档类节点一律必填 dslVersion 与 id（校验器对它们有专门的报错信息）
  const isDoc = (DOC_KINDS as readonly string[]).includes(name)
  return isDoc ? ['dslVersion', 'id', ...entry.required] : [...entry.required]
}

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
  const spec = NODE_SPECS[name]
  const properties: Record<string, JsonSchema> = {}
  for (const [field, fieldSpec] of Object.entries(spec.fields)) {
    properties[field] = toJson(fieldSpec, defs)
  }
  if (spec.kind) properties.kind = { enum: [...spec.kind] }
  const required = [...requiredFields(name)]
  if (spec.kind) required.push('kind')
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
 * 覆盖率检查：字段表里出现过的每个字段都必须在 NODE_SPECS 里显式声明类型。
 * 返回未声明的 "节点.字段" 列表（schema.test.ts 断言它为空）。
 */
export function uncoveredFields(): string[] {
  const missing: string[] = []
  const tables = DOC_SCHEMA_KEYS as unknown as {
    value: Record<string, string[]>
    condition: Record<string, string[]>
    effect: Record<string, string[]>
    fields: Record<string, { allowed: readonly string[] } | undefined>
  }

  const declared = (name: DefName, field: string): boolean => {
    const spec = NODE_SPECS[name]
    return field in spec.fields || (spec.kind !== undefined && field === 'kind')
  }

  for (const name of ['value', 'condition', 'effect'] as const) {
    for (const [kind, fields] of Object.entries(tables[name])) {
      for (const field of fields) {
        if (!declared(name, field)) missing.push(`${name}[${kind}].${field}`)
      }
    }
  }
  for (const name of Object.keys(NODE_SPECS) as DefName[]) {
    const table = tables.fields[name]
    const allowed = table?.allowed ?? []
    for (const field of allowed) {
      if (!declared(name, field)) missing.push(`${name}.${field}`)
    }
  }
  return [...new Set(missing)].sort()
}
