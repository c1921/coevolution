import {
  BASE_KEYS,
  CONDITION_SPECS,
  EFFECT_REQUIRED,
  EFFECT_SPECS,
  NODE_SPECS,
  PICK_KEYS,
  TARGET_KEYS,
  TARGET_COUNT_KEYS,
  VALUE_SPECS,
  allowedFields,
  kindAllowedFields,
  requiredFieldsOf,
} from '../fieldSpecs'
import type { Spec } from '../fieldSpecs'
import type { RoleRef } from '../kinds'
import type { Doc } from '../types'

/**
 * 校验契约与**结构字段表**。
 *
 * 这是校验器（`validate/*`）与 JSON Schema 生成器（`schema.ts`）共用的唯一来源：
 * 新增字段必须同时改这里，否则校验器会报 unknown-key、schema 会漏字段。
 * 单独成文件的目的就是让 `schema.ts` 不必依赖整个校验器（原先它从
 * `validate.ts` 借 `DOC_SCHEMA_KEYS`，导致生成器与校验器耦合）。
 *
 * 本文件只有类型与常量表，没有任何逻辑，是 `validate/` 目录的叶子。
 */

/** 校验问题的错误码（`docs/dsl.md` 第 12 节逐条解释） */
export type IssueCode =
  | 'version'
  | 'unknown-kind'
  | 'unknown-key'
  | 'missing-field'
  | 'bad-type'
  | 'bad-number'
  | 'bad-combination'
  | 'unknown-ref'
  | 'duplicate-id'
  | 'unknown-role'
  | 'unknown-channel'
  | 'unknown-instruction'
  | 'unknown-condition'
  | 'unknown-pick-mode'
  | 'bad-placeholder'
  | 'cost-below-minimum'
  | 'dead-doc'

export interface Issue {
  path: string
  code: IssueCode
  message: string
}

export interface RawDoc {
  path: string
  value: unknown
}

export interface ValidatedDocs {
  docs: Doc[]
  issues: Issue[]
}

/** 文档对象（`unknown` 收敛前的形态） */
export type Obj = Record<string, unknown>

/**
 * 内容所处的**文档语境**，决定可用角色与允许的指令。
 *
 * 名字刻意区别于运行时的 `EffectContext`（`dsl/runtime.ts`）：那个是结算用的数据
 * 上下文（self / target / damage…），这个是**校验期**从文档位置推出的语境标签。
 * 两者过去同名，读代码时要靠 import 来源区分。
 */
export type DocContext =
  'activate' | 'use-play' | 'use-dying' | 'play' | 'trigger' | 'contest' | 'rule' | 'modifier'

export const CONTEXT_ROLES: Record<DocContext, readonly RoleRef[]> = {
  activate: ['self', 'target', 'active', 'opponent'],
  'use-play': ['self', 'target', 'active', 'opponent'],
  'use-dying': ['self', 'target', 'dying', 'active', 'opponent'],
  play: ['self', 'source', 'active', 'opponent'],
  trigger: ['self', 'target', 'source', 'active', 'opponent'],
  contest: ['self', 'target', 'active', 'opponent'],
  rule: ['self', 'active'],
  modifier: ['self'],
}

/** 一条待解析的引用（第二遍 resolveRefs 消费） */
export interface Ref {
  path: string
  type: 'skill' | 'card' | 'deck'
  id: string
  /** 额外要求：牌种必须在该语境有用法（转化指令的 to 端） */
  expect?: 'use' | 'play'
  /** 引用的来源语义：`upgradeTo` 需要额外检查"目标不得再声明 upgradeTo"（禁链式升级） */
  role?: 'upgradeTo'
}

// 字段表的**实现**在 ../fieldSpecs（校验器与 schema 生成器共用的唯一来源）。
// 这里只按校验器的调用习惯把同一份数据转成 allowed/required 两张表，
// 并原样转出字段名常量，因此 validate/ 下的各节点校验器不需要知道字段表的来源。
export { BASE_KEYS, PICK_KEYS, TARGET_KEYS, TARGET_COUNT_KEYS }

/** 字段集合：allowed = 允许出现的键（多余键即报错），required = 必填键 */
export interface FieldSet {
  allowed: readonly string[]
  required: readonly string[]
}

/** 各数值节点允许的字段（键 = `Value['kind']`，含判别式字段 `kind`） */
export const VALUE_KEYS: Record<string, readonly string[]> = mapKinds(VALUE_SPECS)

/** 各条件节点允许的字段（键 = `Condition['kind']`）；`reason` 单独在 checkCondition 里补 */
export const CONDITION_KEYS: Record<string, readonly string[]> = mapKinds(CONDITION_SPECS)

/** 各效果节点允许的字段（键 = `Effect['kind']`） */
export const EFFECT_KEYS: Record<string, readonly string[]> = mapKinds(EFFECT_SPECS)

/** 各效果节点的**条件必填**字段（并表无法表达，由 checkEffect 读取） */
export { EFFECT_REQUIRED }

/** 各节点的 allowed / required（键与 `DefName` 一致） */
export const DOC_FIELDS: Record<string, FieldSet> = Object.fromEntries(
  Object.entries(NODE_SPECS).map(([name]) => [
    name,
    {
      allowed: allowedFields(name as keyof typeof NODE_SPECS),
      required: requiredFieldsOf(name as keyof typeof NODE_SPECS),
    },
  ]),
)

/** 供 schema.test.ts 与 kinds.test.ts 使用：各节点的字段表一览 */
export const DOC_SCHEMA_KEYS = {
  base: BASE_KEYS,
  fields: DOC_FIELDS,
  value: VALUE_KEYS,
  condition: CONDITION_KEYS,
  effect: EFFECT_KEYS,
  pick: PICK_KEYS,
  target: TARGET_KEYS,
  targetCount: TARGET_COUNT_KEYS,
  timing: Object.keys(NODE_SPECS.timing.fields),
} as const

function mapKinds(table: Record<string, Record<string, Spec>>): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.keys(table).map((kind) => [kind, kindAllowedFields(table, kind)]),
  )
}
