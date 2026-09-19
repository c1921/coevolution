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

/** 效果所处的语境，决定可用角色与允许的指令 */
export type EffectContext =
  'activate' | 'use-play' | 'use-dying' | 'play' | 'trigger' | 'contest' | 'rule' | 'modifier'

export const CONTEXT_ROLES: Record<EffectContext, readonly RoleRef[]> = {
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
}

export const BASE_KEYS = ['$schema', 'dslVersion', 'kind', 'id', 'priority']

/** 字段集合：allowed = 允许出现的键（多余键即报错），required = 必填键 */
export interface FieldSet {
  allowed: readonly string[]
  required: readonly string[]
}

/** 取牌对象的字段 */
export const PICK_KEYS = ['mode', 'count', 'cardKind', 'card']
/** 目标规格的字段 */
export const TARGET_KEYS = ['scope', 'required', 'default', 'alive', 'range', 'conditions', 'count']
/** 目标个数规格的字段 */
export const TARGET_COUNT_KEYS = ['mode', 'count']

export const DOC_FIELDS = {
  zoneRef: { allowed: ['zone', 'of'], required: ['zone'] },
  pick: { allowed: PICK_KEYS, required: ['mode'] },
  target: { allowed: TARGET_KEYS, required: ['scope', 'alive'] },
  targetCount: { allowed: TARGET_COUNT_KEYS, required: ['mode'] },
  modifier: { allowed: ['channel', 'op', 'value'], required: ['channel', 'op', 'value'] },
  transform: { allowed: ['from', 'to', 'contexts'], required: ['from', 'to', 'contexts'] },
  timing: { allowed: ['at', 'phase'], required: ['at'] },
  species: {
    allowed: [...BASE_KEYS, 'name', 'maxHp', 'skills', 'deck'],
    required: ['name', 'maxHp', 'skills', 'deck'],
  },
  skill: {
    allowed: [...BASE_KEYS, 'name', 'text', 'modifiers', 'transforms', 'trigger', 'activate'],
    required: ['name', 'text'],
  },
  trigger: {
    allowed: ['on', 'optional', 'when', 'effects', 'after'],
    required: ['on', 'effects'],
  },
  activate: {
    allowed: ['timing', 'oncePerTurn', 'costCards', 'requires', 'target', 'effects', 'after', 'ui'],
    required: ['timing', 'effects'],
  },
  costCards: { allowed: ['count', 'cardKind'], required: ['count'] },
  ui: { allowed: ['buttonLabel'], required: [] },
  card: {
    allowed: [...BASE_KEYS, 'name', 'short', 'text', 'cost', 'use', 'play'],
    required: ['name', 'short', 'text', 'cost'],
  },
  useVariant: {
    allowed: ['context', 'target', 'requires', 'effects', 'after'],
    required: ['context', 'effects'],
  },
  playVariant: {
    allowed: ['respondsTo', 'requires', 'effects'],
    required: ['respondsTo', 'effects'],
  },
  ruleset: { allowed: [...BASE_KEYS, 'channels'], required: ['channels'] },
  deck: { allowed: [...BASE_KEYS, 'cards'], required: ['cards'] },
  deckEntry: { allowed: ['kind', 'count'], required: ['kind', 'count'] },
  rule: { allowed: [...BASE_KEYS, 'on', 'when', 'effects'], required: ['on', 'effects'] },
} satisfies Record<string, FieldSet>

/** 各数值节点允许的字段（键 = `Value['kind']`） */
export const VALUE_KEYS: Record<string, string[]> = {
  const: ['kind', 'value'],
  ref: ['kind', 'ref', 'of'],
  add: ['kind', 'of'],
  sub: ['kind', 'of'],
  mul: ['kind', 'of'],
  min: ['kind', 'of'],
  max: ['kind', 'of'],
  'floor-div': ['kind', 'of', 'by'],
  clamp: ['kind', 'of', 'min', 'max'],
  channel: ['kind', 'channel', 'of'],
}

/** 各条件节点允许的字段（键 = `Condition['kind']`） */
export const CONDITION_KEYS: Record<string, string[]> = {
  always: ['kind'],
  not: ['kind', 'of'],
  all: ['kind', 'of'],
  any: ['kind', 'of'],
  compare: ['kind', 'op', 'left', 'right'],
  alive: ['kind', 'of'],
  'has-cards': ['kind', 'of', 'zone', 'atLeast'],
  'card-kind-count': ['kind', 'of', 'zone', 'cardKind', 'atLeast'],
  'in-processing': ['kind', 'card'],
  'card-transformed': ['kind'],
  'picked-count': ['kind', 'atLeast'],
  'skill-unused': ['kind', 'skill'],
  'is-active': ['kind'],
  'phase-is': ['kind', 'phase'],
}

/** 各效果节点允许的字段（键 = `Effect['kind']`） */
export const EFFECT_KEYS: Record<string, string[]> = {
  log: ['kind', 'template', 'vars'],
  threat: ['kind', 'target', 'amount'],
  'offset-threat': ['kind', 'target', 'amount'],
  'lose-hp': ['kind', 'target', 'amount'],
  heal: ['kind', 'target', 'amount'],
  draw: ['kind', 'target', 'count'],
  'move-cards': ['kind', 'from', 'to', 'pick'],
  'pay-energy': ['kind', 'target', 'amount'],
  'gain-energy': ['kind', 'target', 'amount'],
  'record-card-use': ['kind', 'of', 'cardKind'],
  'record-skill-use': ['kind', 'skill'],
  contest: ['kind', 'responder', 'expectedCard', 'need', 'onMet', 'onUnmet'],
  'contest-contribute': ['kind', 'amount'],
  'resolve-dying': ['kind', 'of'],
  'skip-phase': ['kind', 'phase'],
  'extra-phase': ['kind', 'phase', 'position'],
  'for-each-target': ['kind', 'effects'],
  if: ['kind', 'condition', 'then', 'else'],
}

/** 供 schema.test.ts 与文档生成使用：各节点的字段表 */
export const DOC_SCHEMA_KEYS = {
  base: BASE_KEYS,
  fields: DOC_FIELDS,
  value: VALUE_KEYS,
  condition: CONDITION_KEYS,
  effect: EFFECT_KEYS,
  pick: PICK_KEYS,
  target: TARGET_KEYS,
  targetCount: TARGET_COUNT_KEYS,
  timing: ['at', 'phase'],
} as const
