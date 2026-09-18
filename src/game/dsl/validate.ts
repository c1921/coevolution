import {
  CARD_REFS,
  CHANNELS,
  COMPARE_OPS,
  CONDITION_KINDS,
  DOC_KINDS,
  DSL_VERSION,
  EFFECT_KINDS,
  LOG_PLAYER_FIELDS,
  LOG_PLAYER_ROOTS,
  LOG_ROOTS,
  LOG_VAR_ROOTS,
  MODIFIER_OPS,
  MOVE_ZONES,
  PHASES,
  PICK_MODES,
  ROLES,
  TARGET_DEFAULTS,
  TARGET_SCOPES,
  TIMING_KINDS,
  TRANSFORM_CONTEXTS,
  USE_CONTEXTS,
  VALUE_KINDS,
  VALUE_REF_NAMES,
  ZONE_NAMES,
} from './kinds'
import type { RoleRef, ZoneName } from './kinds'
import type { Doc } from './types'

/**
 * DSL 运行时校验器：把 data/dsl/*.json 从 unknown 收敛为 IR 类型。
 *
 * 设计要点：
 *  - **严格字段**：任何多余键都报 unknown-key——JSON 没有编译期检查，拼错 `Kind`
 *    这类问题必须在加载期暴露，而不是静默取默认值。
 *  - **一次报全部问题**：不做"遇错即停"，所有 issue 连同 JSON 路径一起返回并排序，
 *    便于快照测试与定位。
 *  - **引用完整性**：物种↔技能、牌组↔牌种、技能↔技能引用在第二遍统一解析。
 *  - **守住引擎不变量**：费用 ≥ 1（否则 0 费 + 无次数限制的【打击】= 无限连击）、
 *    计数 ≥ 1、牌区组合合法、日志占位符在白名单内。
 *
 * 契约：只要 issues 非空，调用方（registry）必须抛错，绝不能使用返回的 docs——
 * 结构校验不通过时这些对象不具备 IR 的字段保证。
 */

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

type Obj = Record<string, unknown>

/** 效果所处的语境，决定可用角色与允许的指令 */
type EffectContext =
  | 'activate'
  | 'use-play'
  | 'use-dying'
  | 'play'
  | 'trigger'
  | 'contest'
  | 'rule'
  | 'modifier'

const CONTEXT_ROLES: Record<EffectContext, readonly RoleRef[]> = {
  activate: ['self', 'target', 'active', 'opponent'],
  'use-play': ['self', 'target', 'active', 'opponent'],
  'use-dying': ['self', 'target', 'dying', 'active', 'opponent'],
  play: ['self', 'source', 'active', 'opponent'],
  trigger: ['self', 'target', 'source', 'active', 'opponent'],
  contest: ['self', 'target', 'active', 'opponent'],
  rule: ['self', 'active'],
  modifier: ['self'],
}

interface Ref {
  path: string
  type: 'skill' | 'card' | 'deck'
  id: string
}

const BASE_KEYS = ['$schema', 'dslVersion', 'kind', 'id', 'priority']

/** 字段集合：allowed = 允许出现的键（多余键即报错），required = 必填键 */
export interface FieldSet {
  allowed: readonly string[]
  required: readonly string[]
}

/**
 * 结构字段表是校验器与 schema 生成器（schema.ts）共用的唯一来源：
 * 新增字段必须同时改这里，否则校验器会报 unknown-key、schema 会漏字段。
 */
/** 取牌对象的字段 */
const PICK_KEYS = ['mode', 'count', 'cardKind', 'card']
/** 目标规格的字段 */
const TARGET_KEYS = ['scope', 'required', 'default', 'alive', 'range', 'conditions']

export const DOC_FIELDS = {
  zoneRef: { allowed: ['zone', 'of'], required: ['zone'] },
  pick: { allowed: PICK_KEYS, required: ['mode'] },
  target: { allowed: TARGET_KEYS, required: ['scope', 'alive'] },
  modifier: { allowed: ['channel', 'op', 'value'], required: ['channel', 'op', 'value'] },
  transform: { allowed: ['from', 'to', 'contexts'], required: ['from', 'to', 'contexts'] },
  timing: { allowed: ['at', 'phase'], required: ['at'] },
  species: {
    allowed: [...BASE_KEYS, 'name', 'emoji', 'maxHp', 'skills', 'deck'],
    required: ['name', 'emoji', 'maxHp', 'skills', 'deck'],
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

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function validateDocs(raws: RawDoc[]): ValidatedDocs {
  const issues: Issue[] = []
  const refs: Ref[] = []
  const docs: Doc[] = []
  const seenIds = new Set<string>()

  for (const raw of raws) {
    docs.push(checkDoc(raw, issues, refs, seenIds))
  }
  resolveRefs(docs, refs, issues)
  issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))
  return { docs, issues }
}

function push(issues: Issue[], path: string, code: IssueCode, message: string): void {
  issues.push({ path, code, message })
}

/** 检查字段集合：必填缺失与多余键都会报错 */
function checkKeys(
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

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined
}

function asObj(v: unknown): Obj | undefined {
  return isObj(v) ? v : undefined
}

/** 非空字符串字段 */
function checkText(
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
function checkCount(
  node: Obj,
  key: string,
  path: string,
  issues: Issue[],
  min = 0,
): void {
  const value = node[key]
  if (value === undefined) return
  const num = asNumber(value)
  if (num === undefined || !Number.isInteger(num) || num < min) {
    push(issues, `${path}#/${key}`, 'bad-number', `${key} 必须是不小于 ${min} 的整数`)
  }
}

function checkEnum<T extends string>(
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

function checkRole(
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
function optionalRole(
  node: Obj,
  key: string,
  roles: readonly RoleRef[],
  path: string,
  issues: Issue[],
): void {
  if (node[key] === undefined) return
  checkRole(node, key, roles, path, issues)
}

// ---------------------------------------------------------------- 数值表达式

const VALUE_KEYS: Record<string, string[]> = {
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

function checkValue(
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

// -------------------------------------------------------------------- 条件

const CONDITION_KEYS: Record<string, string[]> = {
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

function checkCondition(
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
  checkKeys(obj, path, CONDITION_KEYS[kind] ?? ['kind'], [], issues)

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

// -------------------------------------------------------------------- 效果

const EFFECT_KEYS: Record<string, string[]> = {
  log: ['kind', 'template', 'vars'],
  damage: ['kind', 'target', 'amount'],
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
  if: ['kind', 'condition', 'then', 'else'],
}

function checkLogTemplate(template: unknown, path: string, roles: readonly RoleRef[], issues: Issue[]): void {
  if (typeof template !== 'string' || template.length === 0) {
    push(issues, path, 'bad-type', 'template 必须是非空字符串')
    return
  }
  const stripped = template.replace(/\{[^{}]*\}/g, '')
  if (stripped.includes('{') || stripped.includes('}')) {
    push(issues, path, 'bad-placeholder', '日志模板存在不配对的占位符花括号')
  }
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const token = match[1] ?? ''
    const [root, field, extra] = token.split('.')
    if (!root || !LOG_ROOTS.includes(root as (typeof LOG_ROOTS)[number])) {
      push(issues, path, 'bad-placeholder', `未知占位符 {${token}}`)
      continue
    }
    const isPlayer = LOG_PLAYER_ROOTS.includes(root as (typeof LOG_PLAYER_ROOTS)[number])
    if (extra !== undefined) {
      push(issues, path, 'bad-placeholder', `占位符 {${token}} 层级过深`)
      continue
    }
    if (field !== undefined) {
      if (!isPlayer) {
        push(issues, path, 'bad-placeholder', `占位符 {${token}} 不能带字段`)
      } else if (!LOG_PLAYER_FIELDS.includes(field as (typeof LOG_PLAYER_FIELDS)[number])) {
        push(issues, path, 'bad-placeholder', `玩家占位符没有字段 ${field}`)
      }
    }
    if (isPlayer && !roles.includes(root as RoleRef)) {
      push(issues, path, 'unknown-role', `当前语境不允许占位符 {${root}}（可用：${roles.join(' / ')}）`)
    }
  }
}

function checkEffects(
  node: unknown,
  path: string,
  context: EffectContext,
  issues: Issue[],
  refs: Ref[],
): void {
  const list = asArray(node)
  if (!list) {
    push(issues, path, 'bad-type', '效果列表必须是数组')
    return
  }
  if (list.length === 0) {
    push(issues, path, 'bad-combination', '效果列表不能为空')
    return
  }
  list.forEach((item, i) => checkEffect(item, `${path}/${i}`, context, issues, refs))
}

function checkEffect(
  node: unknown,
  path: string,
  context: EffectContext,
  issues: Issue[],
  refs: Ref[],
): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', '效果必须是对象')
    return
  }
  const kind = checkEnum(obj, 'kind', EFFECT_KINDS, path, issues, 'unknown-instruction')
  if (!kind) return
  checkKeys(obj, path, EFFECT_KEYS[kind] ?? ['kind'], [], issues)
  const roles = CONTEXT_ROLES[context]

  switch (kind) {
    case 'log':
      checkLogTemplate(obj.template, `${path}#/template`, roles, issues)
      if (obj.vars !== undefined) {
        const vars = asObj(obj.vars)
        if (!vars) {
          push(issues, `${path}#/vars`, 'bad-type', 'vars 必须是对象')
        } else {
          for (const [name, value] of Object.entries(vars)) {
            if (!LOG_VAR_ROOTS.includes(name as (typeof LOG_VAR_ROOTS)[number])) {
              push(
                issues,
                `${path}#/vars#/${name}`,
                'bad-placeholder',
                `vars 只能绑定非玩家占位符（${LOG_VAR_ROOTS.join(' / ')}）`,
              )
              continue
            }
            checkValue(value, `${path}#/vars#/${name}`, roles, issues)
          }
        }
      }
      break
    case 'damage':
    case 'lose-hp':
    case 'heal':
      checkRole(obj, 'target', roles, path, issues)
      checkValue(obj.amount, `${path}#/amount`, roles, issues)
      break
    case 'draw':
      checkRole(obj, 'target', roles, path, issues)
      checkValue(obj.count, `${path}#/count`, roles, issues)
      break
    case 'pay-energy':
    case 'gain-energy':
      checkRole(obj, 'target', roles, path, issues)
      checkValue(obj.amount, `${path}#/amount`, roles, issues)
      break
    case 'move-cards':
      checkMoveCards(obj, path, context, roles, issues, refs)
      break
    case 'record-card-use': {
      checkRole(obj, 'of', roles, path, issues)
      const cardKind = asString(obj.cardKind)
      if (cardKind) refs.push({ path: `${path}#/cardKind`, type: 'card', id: cardKind })
      else push(issues, `${path}#/cardKind`, 'bad-type', 'cardKind 必须是牌种 id')
      break
    }
    case 'record-skill-use': {
      const skill = asString(obj.skill)
      if (skill) refs.push({ path: `${path}#/skill`, type: 'skill', id: skill })
      else push(issues, `${path}#/skill`, 'bad-type', 'skill 必须是技能 id')
      break
    }
    case 'contest': {
      checkRole(obj, 'responder', roles, path, issues)
      const expected = asString(obj.expectedCard)
      if (expected) refs.push({ path: `${path}#/expectedCard`, type: 'card', id: expected })
      else push(issues, `${path}#/expectedCard`, 'bad-type', 'expectedCard 必须是牌种 id')
      checkValue(obj.need, `${path}#/need`, roles, issues)
      for (const branch of ['onMet', 'onUnmet'] as const) {
        if (obj[branch] !== undefined) {
          checkEffects(obj[branch], `${path}#/${branch}`, 'contest', issues, refs)
        }
      }
      break
    }
    case 'contest-contribute':
      if (context !== 'play') {
        push(issues, path, 'bad-combination', 'contest-contribute 只能出现在卡牌的 play 变体中')
      }
      checkValue(obj.amount, `${path}#/amount`, roles, issues)
      break
    case 'resolve-dying':
      if (context !== 'use-dying') {
        push(issues, path, 'bad-combination', 'resolve-dying 只能出现在卡牌的 dying 语境中')
      }
      checkRole(obj, 'of', roles, path, issues)
      break
    case 'skip-phase':
      checkEnum(obj, 'phase', PHASES, path, issues)
      break
    case 'extra-phase':
      checkEnum(obj, 'phase', PHASES, path, issues)
      checkEnum(obj, 'position', ['next', 'last'], path, issues)
      break
    case 'if':
      checkCondition(obj.condition, `${path}#/condition`, roles, issues, refs)
      checkEffects(obj.then, `${path}#/then`, context, issues, refs)
      if (obj.else !== undefined) {
        checkEffects(obj.else, `${path}#/else`, context, issues, refs)
      }
      break
    default:
      break
  }
}


function checkMoveCards(
  obj: Obj,
  path: string,
  context: EffectContext,
  roles: readonly RoleRef[],
  issues: Issue[],
  refs: Ref[],
): void {
  for (const side of ['from', 'to'] as const) {
    const zone = asObj(obj[side])
    if (!zone) {
      push(issues, `${path}#/${side}`, 'bad-type', `${side} 必须是牌区对象`)
      continue
    }
    checkKeys(zone, `${path}#/${side}`, DOC_FIELDS.zoneRef.allowed, DOC_FIELDS.zoneRef.required, issues)
    const zoneName = checkEnum(zone, 'zone', MOVE_ZONES, `${path}#/${side}`, issues)
    optionalRole(zone, 'of', roles, `${path}#/${side}`, issues)
    void zoneName
  }

  const pick = asObj(obj.pick)
  if (!pick) {
    push(issues, `${path}#/pick`, 'bad-type', 'pick 必须是取牌对象')
    return
  }
  checkKeys(pick, `${path}#/pick`, DOC_FIELDS.pick.allowed, DOC_FIELDS.pick.required, issues)
  const mode = checkEnum(pick, 'mode', PICK_MODES, `${path}#/pick`, issues, 'unknown-pick-mode')
  if (!mode) return

  const fromZone = asObj(obj.from)?.zone as ZoneName | undefined
  const toZone = asObj(obj.to)?.zone as ZoneName | undefined

  if (mode === 'chosen' || mode === 'random') {
    checkCount(pick, 'count', `${path}#/pick`, issues, 1)
    if (fromZone !== 'hand') {
      push(issues, `${path}#/pick`, 'bad-combination', `${mode} 只能从手牌取牌`)
    }
  }
  if (mode === 'all') {
    if (fromZone === undefined || !['hand', 'discard'].includes(fromZone)) {
      push(issues, `${path}#/pick`, 'bad-combination', 'all 只能作用于手牌或弃牌堆')
    }
  }
  if (mode === 'specific') {
    const card = checkEnum(pick, 'card', CARD_REFS, `${path}#/pick`, issues)
    if (fromZone !== 'processing') {
      push(issues, `${path}#/pick`, 'bad-combination', 'specific 只能从处理区取牌')
    }
    void card
  }
  if (mode === 'played') {
    if (!['use-play', 'use-dying', 'play'].includes(context)) {
      push(issues, `${path}#/pick`, 'bad-combination', 'played 只能出现在卡牌的使用/打出效果中')
    }
    if (fromZone !== 'hand') {
      push(issues, `${path}#/pick`, 'bad-combination', 'played 只能从手牌取牌')
    }
  }
  if (mode === 'cost') {
    if (context !== 'activate') {
      push(issues, `${path}#/pick`, 'bad-combination', 'cost 只能出现在主动技的发动效果中')
    }
    if (fromZone !== 'hand') {
      push(issues, `${path}#/pick`, 'bad-combination', 'cost 只能从手牌取牌')
    }
  }
  if (toZone === 'processing' && fromZone !== 'hand' && mode !== 'specific') {
    push(issues, `${path}#/to`, 'bad-combination', '只有手牌可以进入处理区')
  }

  const cardKind = asString(pick.cardKind)
  if (cardKind) refs.push({ path: `${path}#/pick/cardKind`, type: 'card', id: cardKind })
}

// ------------------------------------------------------- 目标 / 修正 / 转化


function checkTarget(
  node: unknown,
  path: string,
  issues: Issue[],
  refs: Ref[],
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

function checkModifier(node: unknown, path: string, issues: Issue[], refs: Ref[]): void {
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

function checkTransform(node: unknown, path: string, issues: Issue[], refs: Ref[]): void {
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
    }
  })
}

function checkTiming(node: unknown, path: string, issues: Issue[]): void {
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

// --------------------------------------------------------------- 各类文档

function checkDoc(raw: RawDoc, issues: Issue[], refs: Ref[], seenIds: Set<string>): Doc {
  const path = raw.path
  if (!isObj(raw.value)) {
    push(issues, path, 'bad-type', '文档必须是 JSON 对象')
    return { dslVersion: DSL_VERSION, kind: 'rule', id: path, on: { at: 'turn-start' }, effects: [] }
  }
  const node = raw.value
  const kind = checkEnum(node, 'kind', DOC_KINDS, path, issues, 'unknown-kind')
  if (!kind) {
    return { dslVersion: DSL_VERSION, kind: 'rule', id: path, on: { at: 'turn-start' }, effects: [] }
  }

  if (node.dslVersion !== DSL_VERSION) {
    push(
      issues,
      `${path}#/dslVersion`,
      'version',
      `dslVersion 必须是 ${DSL_VERSION}，实际为 ${JSON.stringify(node.dslVersion)}`,
    )
  }
  const id = asString(node.id)
  if (!id || id.length === 0) {
    push(issues, `${path}#/id`, 'bad-type', 'id 必须是非空字符串')
  } else if (seenIds.has(id)) {
    push(issues, `${path}#/id`, 'duplicate-id', `id ${id} 重复`)
  } else {
    seenIds.add(id)
  }
  checkCount(node, 'priority', path, issues, 0)

  switch (kind) {
    case 'species':
      checkSpecies(node, path, issues, refs)
      break
    case 'skill':
      checkSkill(node, path, issues, refs)
      break
    case 'card':
      checkCard(node, path, issues, refs)
      break
    case 'ruleset':
      checkRuleset(node, path, issues)
      break
    case 'deck':
      checkDeck(node, path, issues, refs)
      break
    case 'rule':
      checkRule(node, path, issues, refs)
      break
  }

  return node as unknown as Doc
}

function checkSpecies(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.species.allowed, DOC_FIELDS.species.required, issues)
  for (const key of ['name', 'emoji'] as const) checkText(node, key, path, issues)
  checkCount(node, 'maxHp', path, issues, 1)
  const skills = asArray(node.skills)
  if (!skills) {
    push(issues, `${path}#/skills`, 'bad-type', 'skills 必须是数组')
  } else {
    skills.forEach((item, i) => {
      if (typeof item === 'string') refs.push({ path: `${path}#/skills/${i}`, type: 'skill', id: item })
      else push(issues, `${path}#/skills/${i}`, 'bad-type', '技能引用必须是字符串 id')
    })
  }
  const deck = asString(node.deck)
  if (deck) refs.push({ path: `${path}#/deck`, type: 'deck', id: deck })
  else push(issues, `${path}#/deck`, 'bad-type', 'deck 必须是牌组 id')
}

function checkSkill(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.skill.allowed, DOC_FIELDS.skill.required, issues)
  for (const key of ['name', 'text'] as const) checkText(node, key, path, issues)

  const hasParts =
    node.modifiers !== undefined ||
    node.transforms !== undefined ||
    node.trigger !== undefined ||
    node.activate !== undefined
  if (!hasParts) {
    push(issues, path, 'bad-combination', '技能必须至少声明 modifiers / transforms / trigger / activate 之一')
  }

  if (node.modifiers !== undefined) {
    const list = asArray(node.modifiers)
    if (!list || list.length === 0) {
      push(issues, `${path}#/modifiers`, 'bad-combination', 'modifiers 不能为空数组')
    } else {
      list.forEach((item, i) => checkModifier(item, `${path}#/modifiers/${i}`, issues, refs))
    }
  }

  if (node.transforms !== undefined) {
    const list = asArray(node.transforms)
    if (!list || list.length === 0) {
      push(issues, `${path}#/transforms`, 'bad-combination', 'transforms 不能为空数组')
    } else {
      list.forEach((item, i) => checkTransform(item, `${path}#/transforms/${i}`, issues, refs))
    }
  }

  if (node.trigger !== undefined) {
    const trigger = asObj(node.trigger)
    if (!trigger) {
      push(issues, `${path}#/trigger`, 'bad-type', 'trigger 必须是对象')
    } else {
      checkKeys(
        trigger,
        `${path}#/trigger`,
        DOC_FIELDS.trigger.allowed,
        DOC_FIELDS.trigger.required,
        issues,
      )
      checkTiming(trigger.on, `${path}#/trigger#/on`, issues)
      if (trigger.optional !== undefined && typeof trigger.optional !== 'boolean') {
        push(issues, `${path}#/trigger#/optional`, 'bad-type', 'optional 必须是布尔值')
      }
      const at = asObj(trigger.on)?.at
      if (trigger.optional === true && at !== 'after-damage') {
        push(
          issues,
          `${path}#/trigger#/optional`,
          'bad-combination',
          '当前只有 after-damage 时机的技能支持可选发动',
        )
      }
      if (trigger.when !== undefined) {
        checkConditionList(
          trigger.when,
          `${path}#/trigger#/when`,
          CONTEXT_ROLES.trigger,
          issues,
          refs,
        )
      }
      checkEffects(trigger.effects, `${path}#/trigger#/effects`, 'trigger', issues, refs)
      if (trigger.after !== undefined) {
        checkEffects(trigger.after, `${path}#/trigger#/after`, 'trigger', issues, refs)
      }
    }
  }

  if (node.activate !== undefined) {
    checkActivate(node.activate, `${path}#/activate`, issues, refs)
  }
}

function checkConditionList(
  node: unknown,
  path: string,
  roles: readonly RoleRef[],
  issues: Issue[],
  refs: Ref[],
): void {
  const list = asArray(node)
  if (!list || list.length === 0) {
    push(issues, path, 'bad-combination', '条件列表不能为空')
    return
  }
  list.forEach((item, i) => checkCondition(item, `${path}/${i}`, roles, issues, refs))
}

function checkActivate(node: unknown, path: string, issues: Issue[], refs: Ref[]): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', 'activate 必须是对象')
    return
  }
  checkKeys(obj, path, DOC_FIELDS.activate.allowed, DOC_FIELDS.activate.required, issues)
  const timing = checkEnum(obj, 'timing', ['play'], path, issues)
  void timing
  if (obj.oncePerTurn !== undefined && typeof obj.oncePerTurn !== 'boolean') {
    push(issues, `${path}#/oncePerTurn`, 'bad-type', 'oncePerTurn 必须是布尔值')
  }
  if (obj.costCards !== undefined) {
    const cost = asObj(obj.costCards)
    if (!cost) {
      push(issues, `${path}#/costCards`, 'bad-type', 'costCards 必须是对象')
    } else {
      checkKeys(cost, `${path}#/costCards`, DOC_FIELDS.costCards.allowed, DOC_FIELDS.costCards.required, issues)
      checkValue(cost.count, `${path}#/costCards#/count`, ['self'], issues)
      const cardKind = asString(cost.cardKind)
      if (cardKind) refs.push({ path: `${path}#/costCards#/cardKind`, type: 'card', id: cardKind })
    }
  }
  if (obj.requires !== undefined) {
    checkConditionList(obj.requires, `${path}#/requires`, CONTEXT_ROLES.activate, issues, refs)
  }
  if (obj.target !== undefined) {
    checkTarget(obj.target, `${path}#/target`, issues, refs)
  }
  checkEffects(obj.effects, `${path}#/effects`, 'activate', issues, refs)
  if (obj.after !== undefined) {
    checkEffects(obj.after, `${path}#/after`, 'activate', issues, refs)
  }
  if (obj.ui !== undefined) {
    const ui = asObj(obj.ui)
    if (!ui) {
      push(issues, `${path}#/ui`, 'bad-type', 'ui 必须是对象')
    } else {
      checkKeys(ui, `${path}#/ui`, DOC_FIELDS.ui.allowed, DOC_FIELDS.ui.required, issues)
      if (ui.buttonLabel !== undefined) checkText(ui, 'buttonLabel', `${path}#/ui`, issues)
    }
  }
}

function checkCard(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.card.allowed, DOC_FIELDS.card.required, issues)
  for (const key of ['name', 'short', 'text'] as const) checkText(node, key, path, issues)
  checkValue(node.cost, `${path}#/cost`, ['self'], issues)
  const cost = asObj(node.cost)
  if (cost && cost.kind === 'const') {
    const value = asNumber(cost.value)
    if (value !== undefined && value < 1) {
      push(
        issues,
        `${path}#/cost#/value`,
        'cost-below-minimum',
        '费用必须 ≥ 1：0 费与「无次数限制的打击」组合会形成无限连击',
      )
    }
  }

  const hasUse = node.use !== undefined
  const hasPlay = node.play !== undefined
  if (!hasUse && !hasPlay) {
    push(issues, path, 'bad-combination', '卡牌至少需要 use 或 play 之一')
  }

  if (hasUse) {
    const list = asArray(node.use)
    if (!list || list.length === 0) {
      push(issues, `${path}#/use`, 'bad-combination', 'use 不能为空数组')
    } else {
      const seen = new Set<string>()
      list.forEach((item, i) => {
        const variantPath = `${path}#/use/${i}`
        const variant = asObj(item)
        if (!variant) {
          push(issues, variantPath, 'bad-type', 'use 变体必须是对象')
          return
        }
        checkKeys(
          variant,
          variantPath,
          DOC_FIELDS.useVariant.allowed,
          DOC_FIELDS.useVariant.required,
          issues,
        )
        const context = checkEnum(variant, 'context', USE_CONTEXTS, variantPath, issues)
        if (context) {
          if (seen.has(context)) {
            push(issues, `${variantPath}#/context`, 'duplicate-id', `use 语境 ${context} 重复`)
          }
          seen.add(context)
        }
        if (variant.target !== undefined) {
          checkTarget(variant.target, `${variantPath}#/target`, issues, refs)
        }
        if (variant.requires !== undefined) {
          checkConditionList(
            variant.requires,
            `${variantPath}#/requires`,
            context === 'dying' ? CONTEXT_ROLES['use-dying'] : CONTEXT_ROLES['use-play'],
            issues,
            refs,
          )
        }
        checkEffects(
          variant.effects,
          `${variantPath}#/effects`,
          context === 'dying' ? 'use-dying' : 'use-play',
          issues,
          refs,
        )
        if (variant.after !== undefined) {
          checkEffects(
            variant.after,
            `${variantPath}#/after`,
            context === 'dying' ? 'use-dying' : 'use-play',
            issues,
            refs,
          )
        }
      })
    }
  }

  if (hasPlay) {
    const play = asObj(node.play)
    if (!play) {
      push(issues, `${path}#/play`, 'bad-type', 'play 必须是对象')
    } else {
      checkKeys(play, `${path}#/play`, DOC_FIELDS.playVariant.allowed, DOC_FIELDS.playVariant.required, issues)
      const respondsTo = asString(play.respondsTo)
      if (respondsTo) refs.push({ path: `${path}#/play#/respondsTo`, type: 'card', id: respondsTo })
      else push(issues, `${path}#/play#/respondsTo`, 'bad-type', 'respondsTo 必须是牌种 id')
      if (play.requires !== undefined) {
        checkConditionList(play.requires, `${path}#/play#/requires`, CONTEXT_ROLES.play, issues, refs)
      }
      checkEffects(play.effects, `${path}#/play#/effects`, 'play', issues, refs)
    }
  }
}

function checkRuleset(node: Obj, path: string, issues: Issue[]): void {
  checkKeys(node, path, DOC_FIELDS.ruleset.allowed, DOC_FIELDS.ruleset.required, issues)
  const channels = asObj(node.channels)
  if (!channels) {
    push(issues, `${path}#/channels`, 'bad-type', 'channels 必须是对象')
    return
  }
  for (const channel of CHANNELS) {
    if (!(channel in channels)) {
      push(issues, `${path}#/channels#/${channel}`, 'missing-field', `缺少通道 ${channel} 的基准值`)
    }
  }
  for (const [key, value] of Object.entries(channels)) {
    if (!CHANNELS.includes(key as (typeof CHANNELS)[number])) {
      push(issues, `${path}#/channels#/${key}`, 'unknown-channel', `未知修正通道 ${key}`)
      continue
    }
    const num = asNumber(value)
    if (num === undefined || !Number.isInteger(num) || num < 0) {
      push(issues, `${path}#/channels#/${key}`, 'bad-number', '通道基准值必须是非负整数')
    }
  }
}

function checkDeck(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.deck.allowed, DOC_FIELDS.deck.required, issues)
  const list = asArray(node.cards)
  if (!list || list.length === 0) {
    push(issues, `${path}#/cards`, 'bad-combination', 'cards 不能为空数组')
    return
  }
  list.forEach((item, i) => {
    const entryPath = `${path}#/cards/${i}`
    const entry = asObj(item)
    if (!entry) {
      push(issues, entryPath, 'bad-type', '牌组条目必须是对象')
      return
    }
    checkKeys(entry, entryPath, DOC_FIELDS.deckEntry.allowed, DOC_FIELDS.deckEntry.required, issues)
    const cardKind = asString(entry.kind)
    if (cardKind) refs.push({ path: `${entryPath}#/kind`, type: 'card', id: cardKind })
    else push(issues, `${entryPath}#/kind`, 'bad-type', 'kind 必须是牌种 id')
    checkCount(entry, 'count', entryPath, issues, 1)
  })
}

function checkRule(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.rule.allowed, DOC_FIELDS.rule.required, issues)
  checkTiming(node.on, `${path}#/on`, issues)
  if (node.when !== undefined) {
    checkConditionList(node.when, `${path}#/when`, CONTEXT_ROLES.rule, issues, refs)
  }
  checkEffects(node.effects, `${path}#/effects`, 'rule', issues, refs)
}

// ------------------------------------------------------------------ 交叉引用

function resolveRefs(docs: Doc[], refs: Ref[], issues: Issue[]): void {
  const ids: Record<Ref['type'], Set<string>> = {
    skill: new Set(),
    card: new Set(),
    deck: new Set(),
  }
  for (const doc of docs) {
    if (doc.kind === 'skill') ids.skill.add(doc.id)
    if (doc.kind === 'card') ids.card.add(doc.id)
    if (doc.kind === 'deck') ids.deck.add(doc.id)
  }
  for (const ref of refs) {
    if (!ids[ref.type].has(ref.id)) {
      push(issues, ref.path, 'unknown-ref', `引用了不存在的${refLabel(ref.type)} ${ref.id}`)
    }
  }

  // ruleset 必须恰好一份
  const rulesets = docs.filter((doc) => doc.kind === 'ruleset')
  if (rulesets.length === 0) {
    push(issues, '/', 'missing-field', '缺少 ruleset 文档（修正通道基准值）')
  } else if (rulesets.length > 1) {
    push(issues, '/', 'duplicate-id', `ruleset 只能有一份，实际 ${rulesets.length} 份`)
  }

  // 死文档：定义但没有任何内容引用，通常是拼写错误或残留
  const usedSkills = new Set(refs.filter((r) => r.type === 'skill').map((r) => r.id))
  const usedCards = new Set(refs.filter((r) => r.type === 'card').map((r) => r.id))
  const usedDecks = new Set(refs.filter((r) => r.type === 'deck').map((r) => r.id))
  for (const doc of docs) {
    if (doc.kind === 'skill' && !usedSkills.has(doc.id)) {
      push(issues, `/${doc.id}`, 'dead-doc', `技能 ${doc.id} 没有被任何物种引用`)
    }
    if (doc.kind === 'card' && !usedCards.has(doc.id)) {
      push(issues, `/${doc.id}`, 'dead-doc', `牌种 ${doc.id} 没有被任何牌组引用`)
    }
    if (doc.kind === 'deck' && !usedDecks.has(doc.id)) {
      push(issues, `/${doc.id}`, 'dead-doc', `牌组 ${doc.id} 没有被任何物种引用`)
    }
  }
}

function refLabel(type: Ref['type']): string {
  if (type === 'skill') return '技能'
  if (type === 'card') return '牌种'
  return '牌组'
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
  timing: ['at', 'phase'],
} as const

/** 供文档生成使用：语境与可用角色 */
export const DOC_CONTEXT_ROLES = CONTEXT_ROLES

/** 便于测试构造：把未知值当作某类节点的角色集合（避免重复字面量） */
export function rolesForContext(context: EffectContext): readonly RoleRef[] {
  return CONTEXT_ROLES[context]
}
