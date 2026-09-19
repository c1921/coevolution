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
import type { Condition, Effect, Value } from './types'

/**
 * **结构字段表的唯一事实来源**：一个字段叫什么、是什么类型、哪些节点允许它。
 *
 * 为什么把字段表从校验器里搬出来：同一份信息过去散在三处 ——
 * `kinds.ts` 的词表、`validate.ts` 的 allowed 字段表（只有字段名）、
 * `schema.ts` 的「字段 → 类型」表。新增一条效果指令要同时改三处，
 * 漏一处只会得到"校验通过但 schema 里没这个字段"（或反过来）这种静默漂移。
 *
 * 现在的分工：
 *  - **词表**（有哪些 kind、角色、通道、阶段…）仍在 `kinds.ts`，那是内容作者的词汇表；
 *  - **字段名与类型**在下面按 kind / 节点声明，allowed 字段集合由
 *    `Object.keys(fields)` 派生 —— 名与型天然同源，不可能再对不上；
 *  - 校验器（`validate/`）与 JSON Schema 生成器（`schema.ts`）都只读本模块，
 *    因此两者**不可能再漂移**。
 *
 * 注意 `fields` 是"字段 → 类型"而不是"字段 → 类型名"：同一个字段名在不同节点里
 * 允许有不同类型（例如 `count` 在 `pick` 里是整数、在 `targetCount` 里是数值表达式；
 * `of` 在 `value` 里是角色或子表达式、在 `condition` 里是角色或子条件）。
 * 这是内容 DSL 的真实形态，不是重复：**每一处类型都只写一次**。
 *
 * 新增一条效果指令的改动点只剩两处，且第二处漏了会编译失败（见文件末尾的断言）：
 *  1. 本文件的 `EFFECT_SPECS` 加一条；
 *  2. `types.ts` 的 `Effect` 联合加一支。
 */

export type JsonSchema = Record<string, unknown>

/** 一个字段在 JSON Schema 里的类型描述（中立表示，生成器再翻译成 JSON Schema） */
export type Spec =
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

/** `$defs` 里的节点名 */
export type DefName =
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

/** 一个节点的完整结构规格 */
export interface NodeSpec {
  /**
   * 判别式 `kind` 的取值；有它则 schema 里 `kind` 是枚举、校验器按 kind 分支。
   * 没有它的节点（如 `deckEntry`）里 `kind` 只是一个普通字符串字段。
   */
  kinds?: readonly string[]
  /** 字段 → 类型（不含 `kind`） */
  fields: Record<string, Spec>
  /** 必填字段（不含信封的 dslVersion / id，它们由 checkDoc 统一处理） */
  required?: readonly string[]
}

const STRING: Spec = { t: 'string' }
const BOOLEAN: Spec = { t: 'boolean' }
const INTEGER: Spec = { t: 'integer' }
const VALUE: Spec = { t: 'ref', name: 'value' }
const CONDITION: Spec = { t: 'ref', name: 'condition' }
const EFFECT: Spec = { t: 'ref', name: 'effect' }
const EFFECTS: Spec = { t: 'array', of: EFFECT }
const CONDITIONS: Spec = { t: 'array', of: CONDITION }
const ROLES_SPEC: Spec = { t: 'enum', values: ROLES }

/** 所有文档共有的信封字段 */
export const BASE_KEYS = ['$schema', 'dslVersion', 'kind', 'id', 'priority']
/** 取牌对象的字段 */
export const PICK_KEYS = ['mode', 'count', 'cardKind', 'card']
/** 目标规格的字段 */
export const TARGET_KEYS = ['scope', 'required', 'default', 'alive', 'range', 'conditions', 'count']
/** 目标个数规格的字段 */
export const TARGET_COUNT_KEYS = ['mode', 'count']

/* ------------------------------------------------------------------ 三类判别式节点 */

/** 数值表达式各节点的字段（键即 `VALUE_KINDS`，缺一个都编译不过） */
export const VALUE_SPECS: Record<(typeof VALUE_KINDS)[number], Record<string, Spec>> = {
  const: { value: { t: 'number' } },
  ref: { ref: { t: 'enum', values: VALUE_REF_NAMES }, of: ROLES_SPEC },
  add: { of: { t: 'array', of: VALUE } },
  sub: { of: { t: 'array', of: VALUE } },
  mul: { of: { t: 'array', of: VALUE } },
  min: { of: { t: 'array', of: VALUE } },
  max: { of: { t: 'array', of: VALUE } },
  'floor-div': { of: VALUE, by: VALUE },
  clamp: { of: VALUE, min: { t: 'number' }, max: { t: 'number' } },
  channel: { channel: { t: 'enum', values: CHANNELS }, of: ROLES_SPEC },
}

/** 条件各节点的字段 */
export const CONDITION_SPECS: Record<(typeof CONDITION_KINDS)[number], Record<string, Spec>> = {
  always: {},
  not: { of: CONDITION },
  all: { of: { t: 'array', of: CONDITION } },
  any: { of: { t: 'array', of: CONDITION } },
  compare: {
    op: { t: 'enum', values: COMPARE_OPS },
    left: VALUE,
    right: VALUE,
  },
  alive: { of: ROLES_SPEC },
  'has-cards': { of: ROLES_SPEC, zone: { t: 'enum', values: ZONE_NAMES }, atLeast: VALUE },
  'card-kind-count': {
    of: ROLES_SPEC,
    zone: { t: 'enum', values: ZONE_NAMES },
    cardKind: STRING,
    atLeast: VALUE,
  },
  'in-processing': { card: { t: 'enum', values: CARD_REFS } },
  'card-transformed': {},
  'picked-count': { atLeast: VALUE },
  'skill-unused': { skill: STRING },
  'is-active': {},
  'phase-is': { phase: { t: 'enum', values: PHASES } },
}

/**
 * 任何条件都可以带失败说明（`reason`）。它不进 per-kind 表，而是由
 * `conditionFields()` 统一补在末尾，避免每个 kind 都抄一遍。
 */
export const CONDITION_COMMON_FIELDS: Record<string, Spec> = { reason: STRING }

/** 效果各节点的字段 */
export const EFFECT_SPECS: Record<(typeof EFFECT_KINDS)[number], Record<string, Spec>> = {
  log: { template: STRING, vars: { t: 'map', of: VALUE, keys: LOG_VAR_ROOTS } },
  threat: { target: ROLES_SPEC, amount: VALUE },
  'offset-threat': { target: ROLES_SPEC, amount: VALUE },
  'lose-hp': { target: ROLES_SPEC, amount: VALUE },
  heal: { target: ROLES_SPEC, amount: VALUE },
  draw: { target: ROLES_SPEC, count: VALUE },
  'move-cards': {
    from: { t: 'ref', name: 'zoneRef' },
    to: { t: 'ref', name: 'zoneRef' },
    pick: { t: 'ref', name: 'pick' },
  },
  'pay-energy': { target: ROLES_SPEC, amount: VALUE },
  'gain-energy': { target: ROLES_SPEC, amount: VALUE },
  'record-card-use': { of: ROLES_SPEC, cardKind: STRING },
  'record-skill-use': { skill: STRING },
  contest: {
    responder: ROLES_SPEC,
    expectedCard: STRING,
    need: VALUE,
    onMet: EFFECTS,
    onUnmet: EFFECTS,
  },
  'contest-contribute': { amount: VALUE },
  'resolve-dying': { of: ROLES_SPEC },
  'skip-phase': { phase: { t: 'enum', values: PHASES } },
  'extra-phase': {
    phase: { t: 'enum', values: PHASES },
    position: { t: 'enum', values: ['next', 'last'] },
  },
  'for-each-target': { effects: EFFECTS },
  if: { condition: CONDITION, then: EFFECTS, else: EFFECTS },
}

/* ------------------------------------------------------------------ 结构节点与文档节点 */

/**
 * 结构节点与顶层文档节点的字段与必填。
 * `pick` / `target` / `targetCount` 的字段名常量与上面的 `*_KEYS` 共用，
 * 避免"常量表写了一套、字段表又写一套"。
 */
const STRUCTURAL_AND_DOC_SPECS: Record<
  Exclude<DefName, 'value' | 'condition' | 'effect'>,
  NodeSpec
> = {
  pick: {
    fields: {
      mode: { t: 'enum', values: PICK_MODES },
      count: INTEGER,
      cardKind: STRING,
      card: { t: 'enum', values: CARD_REFS },
    },
    required: ['mode'],
  },
  zoneRef: {
    fields: { zone: { t: 'enum', values: MOVE_ZONES }, of: ROLES_SPEC },
    required: ['zone'],
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
    required: ['scope', 'alive'],
  },
  targetCount: {
    fields: { mode: { t: 'enum', values: TARGET_COUNT_MODES }, count: VALUE },
    required: ['mode'],
  },
  modifier: {
    fields: {
      channel: { t: 'enum', values: CHANNELS },
      op: { t: 'enum', values: MODIFIER_OPS },
      value: VALUE,
    },
    required: ['channel', 'op', 'value'],
  },
  transform: {
    fields: {
      from: STRING,
      to: STRING,
      contexts: { t: 'array', of: { t: 'enum', values: TRANSFORM_CONTEXTS } },
    },
    required: ['from', 'to', 'contexts'],
  },
  timing: {
    fields: { at: { t: 'enum', values: TIMING_KINDS }, phase: { t: 'enum', values: PHASES } },
    required: ['at'],
  },
  trigger: {
    fields: {
      on: { t: 'ref', name: 'timing' },
      optional: BOOLEAN,
      when: CONDITIONS,
      effects: EFFECTS,
      after: EFFECTS,
    },
    required: ['on', 'effects'],
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
    required: ['timing', 'effects'],
  },
  costCards: { fields: { count: VALUE, cardKind: STRING }, required: ['count'] },
  ui: { fields: { buttonLabel: STRING }, required: [] },
  species: {
    kinds: ['species'],
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
    required: ['name', 'maxHp', 'skills', 'deck'],
  },
  skill: {
    kinds: ['skill'],
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
    required: ['name', 'text'],
  },
  card: {
    kinds: ['card'],
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
    required: ['name', 'short', 'text', 'cost'],
  },
  useVariant: {
    fields: {
      context: { t: 'enum', values: USE_CONTEXTS },
      target: { t: 'ref', name: 'target' },
      requires: CONDITIONS,
      effects: EFFECTS,
      after: EFFECTS,
    },
    required: ['context', 'effects'],
  },
  playVariant: {
    fields: { respondsTo: STRING, requires: CONDITIONS, effects: EFFECTS },
    required: ['respondsTo', 'effects'],
  },
  ruleset: {
    kinds: ['ruleset'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      channels: { t: 'map', of: INTEGER, keys: CHANNELS },
    },
    required: ['channels'],
  },
  deck: {
    kinds: ['deck'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      cards: { t: 'array', of: { t: 'ref', name: 'deckEntry' } },
    },
    required: ['cards'],
  },
  // 注意：这里的 kind 是牌种 id，不是判别式，所以没有 kinds
  deckEntry: { fields: { kind: STRING, count: INTEGER }, required: ['kind', 'count'] },
  rule: {
    kinds: ['rule'],
    fields: {
      $schema: STRING,
      dslVersion: { t: 'const', value: DSL_VERSION },
      id: STRING,
      priority: INTEGER,
      on: { t: 'ref', name: 'timing' },
      when: CONDITIONS,
      effects: EFFECTS,
    },
    required: ['on', 'effects'],
  },
}

/* ------------------------------------------------------------------ 派生 */

/** 同一份 Spec 的相等判断（用于把同名不同型的字段合并成 oneOf） */
function sameSpec(a: Spec, b: Spec): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 把一个字段在多个 kind 下的类型并成一个或 oneOf */
function mergeSpec(existing: Spec, incoming: Spec): Spec {
  if (sameSpec(existing, incoming)) return existing
  const variants = existing.t === 'oneOf' ? [...existing.of] : [existing]
  if (!variants.some((variant) => sameSpec(variant, incoming))) variants.push(incoming)
  return { t: 'oneOf', of: variants }
}

/**
 * 把 per-kind 的字段表并成一个"判别式节点"的字段表（供 schema 生成器使用）。
 * 字段顺序 = 各 kind 依次出现时**首次出现**的顺序，因此表本身的书写顺序
 * 会决定生成的 schema 里属性的顺序（对 JSON Schema 语义没有影响）。
 */
function unionFields(
  kinds: readonly string[],
  table: Record<string, Record<string, Spec>>,
  common: Record<string, Spec> = {},
): Record<string, Spec> {
  const fields: Record<string, Spec> = {}
  for (const kind of kinds) {
    for (const [field, spec] of Object.entries(table[kind] ?? {})) {
      const existing = fields[field]
      fields[field] = existing === undefined ? spec : mergeSpec(existing, spec)
    }
  }
  for (const [field, spec] of Object.entries(common)) fields[field] = spec
  return fields
}

/** 全部 `$defs` 节点的规格：三类判别式节点由 per-kind 表并出来，其余直接声明 */
export const NODE_SPECS: Record<DefName, NodeSpec> = {
  value: { kinds: VALUE_KINDS, fields: unionFields(VALUE_KINDS, VALUE_SPECS) },
  condition: {
    kinds: CONDITION_KINDS,
    fields: unionFields(CONDITION_KINDS, CONDITION_SPECS, CONDITION_COMMON_FIELDS),
  },
  effect: { kinds: EFFECT_KINDS, fields: unionFields(EFFECT_KINDS, EFFECT_SPECS) },
  ...STRUCTURAL_AND_DOC_SPECS,
}

/**
 * 每个节点允许出现的字段（校验器的 allowed 列表）。
 * 判别式节点的 `kind` 由 `kinds` 补在**最前面**，顺序对校验器（集合判断）无所谓。
 */
export function allowedFields(name: DefName): readonly string[] {
  const spec = NODE_SPECS[name]
  const fields = Object.keys(spec.fields)
  return spec.kinds ? ['kind', ...fields] : fields
}

/** 每个节点的字段 → 类型（schema 生成器用；`kind` 由生成器按 `kinds` 单独补） */
export function schemaFields(name: DefName): Record<string, Spec> {
  return NODE_SPECS[name].fields
}

/** 每个节点的必填字段（不含信封的 dslVersion / id，也不含判别式 kind） */
export function requiredFieldsOf(name: DefName): readonly string[] {
  return NODE_SPECS[name].required ?? []
}

/** 某类判别式节点里，单个 kind 允许的字段（校验器用，含 kind） */
export function kindAllowedFields(
  table: Record<string, Record<string, Spec>>,
  kind: string,
  extra: readonly string[] = [],
): readonly string[] {
  return ['kind', ...Object.keys(table[kind] ?? {}), ...extra]
}

/**
 * 从顶层文档种类出发，找**不可达**的 `$defs` 节点。
 *
 * 用途与 DSL 的 `dead-doc` 校验同源：新增了一个节点却忘了在别处引用它，
 * 它就会悄悄留在 schema 里误导内容作者。返回空数组表示所有节点都可达。
 */
export function unreachableDefs(): string[] {
  const reachable = new Set<string>()
  const visit = (name: DefName): void => {
    if (reachable.has(name)) return
    reachable.add(name)
    for (const spec of Object.values(NODE_SPECS[name].fields)) collectRefs(spec, visit)
  }
  for (const kind of DOC_KINDS) visit(kind as DefName)
  return (Object.keys(NODE_SPECS) as DefName[]).filter((name) => !reachable.has(name)).sort()
}

function collectRefs(spec: Spec, visit: (name: DefName) => void): void {
  switch (spec.t) {
    case 'ref':
      visit(spec.name)
      return
    case 'array':
      collectRefs(spec.of, visit)
      return
    case 'map':
      collectRefs(spec.of, visit)
      return
    case 'oneOf':
      for (const item of spec.of) collectRefs(item, visit)
      return
    default:
      return
  }
}

/* ------------------------------------------------------------------ 编译期守卫
 * IR 联合类型（types.ts）与字段表必须一一对应：少一个 kind 会让内容在校验期才报错，
 * 多一个 kind 会让类型说有、词表里没有。下面几条断言把这件事提前到编译期。
 *
 * `AssertNever<T>` 只在 T 恰好是 never 时成立，因此任何一边多出 / 缺少 kind 都会
 * 在本文件直接编译失败。
 * -------------------------------------------------------------------------- */
type AssertNever<T extends never> = T

export type _ValueKindsMatchIr = AssertNever<Exclude<Value['kind'], keyof typeof VALUE_SPECS>>
export type _ValueSpecsMatchIr = AssertNever<Exclude<keyof typeof VALUE_SPECS, Value['kind']>>
export type _ConditionKindsMatchIr = AssertNever<
  Exclude<Condition['kind'], keyof typeof CONDITION_SPECS>
>
export type _ConditionSpecsMatchIr = AssertNever<
  Exclude<keyof typeof CONDITION_SPECS, Condition['kind']>
>
export type _EffectKindsMatchIr = AssertNever<Exclude<Effect['kind'], keyof typeof EFFECT_SPECS>>
export type _EffectSpecsMatchIr = AssertNever<Exclude<keyof typeof EFFECT_SPECS, Effect['kind']>>
