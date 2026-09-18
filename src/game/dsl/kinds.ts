/**
 * DSL 词表：所有判别式 kind 的唯一事实来源。
 *
 * 校验器（validate.ts）、解释器（effect.ts）与 data/dsl/schema.json 都从这里派生：
 *  - schema.test.ts 断言 schema.json 的枚举与这里完全一致，防止两套实现漂移；
 *  - 解释器对每种指令做 switch 并以 `never` 穷尽断言收尾，新增 kind 时漏实现即编译报错。
 *
 * 注意：tsconfig 开启 erasableSyntaxOnly，禁止 enum，因此一律用 `as const` 元组表达。
 */

/** DSL 版本：文档里的 dslVersion 必须与它一致，用于将来的破坏性升级 */
export const DSL_VERSION = 1

/** 文档种类 */
export const DOC_KINDS = ['species', 'skill', 'card', 'ruleset', 'deck', 'rule'] as const
export type DocKind = (typeof DOC_KINDS)[number]

/** 数值表达式的节点种类 */
export const VALUE_KINDS = [
  'const',
  'ref',
  'add',
  'sub',
  'mul',
  'min',
  'max',
  'floor-div',
  'clamp',
  'channel',
] as const
export type ValueKind = (typeof VALUE_KINDS)[number]

/** 可读取的运行时数值 */
export const VALUE_REF_NAMES = [
  'hp',
  'maxHp',
  'handCount',
  'deckCount',
  'discardCount',
  'energy',
  'energyMax',
  'turn',
  'damageAmount',
] as const
export type ValueRefName = (typeof VALUE_REF_NAMES)[number]

/** 条件节点种类 */
export const CONDITION_KINDS = [
  'always',
  'not',
  'all',
  'any',
  'compare',
  'alive',
  'has-cards',
  'card-kind-count',
  'in-processing',
  'card-transformed',
  'picked-count',
  'skill-unused',
  'is-active',
  'phase-is',
] as const
export type ConditionKind = (typeof CONDITION_KINDS)[number]

/** 比较运算符 */
export const COMPARE_OPS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const
export type CompareOp = (typeof COMPARE_OPS)[number]

/** 效果指令种类（即"标准指令集"，无 native 逃生舱） */
export const EFFECT_KINDS = [
  'log',
  'damage',
  'lose-hp',
  'heal',
  'draw',
  'move-cards',
  'pay-energy',
  'gain-energy',
  'record-card-use',
  'record-skill-use',
  'contest',
  'contest-contribute',
  'resolve-dying',
  'skip-phase',
  'extra-phase',
  'if',
] as const
export type EffectKind = (typeof EFFECT_KINDS)[number]

/** 取牌方式（chosen 需要交互式选牌机制，当前没有该 prompt，故不提供） */
export const PICK_MODES = ['played', 'cost', 'random', 'specific', 'all'] as const
export type PickMode = (typeof PICK_MODES)[number]

/** 牌区名 */
export const ZONE_NAMES = ['hand', 'discard', 'processing', 'deck'] as const
export type ZoneName = (typeof ZONE_NAMES)[number]

/** move-cards 允许的牌区（deck 只允许由 draw 指令访问，避免绕过洗回逻辑） */
export const MOVE_ZONES = ['hand', 'discard', 'processing'] as const

/** 事件/效果语境中的角色引用 */
export const ROLES = ['self', 'target', 'source', 'active', 'dying', 'opponent'] as const
export type RoleRef = (typeof ROLES)[number]

/** 牌引用：指向本次结算中被绑定的具体牌 */
export const CARD_REFS = ['event-card', 'used-card', 'cost-card'] as const
export type CardRef = (typeof CARD_REFS)[number]

/** 修正通道 */
export const CHANNELS = [
  'energy-max',
  'defend-need-against',
  'draw-count',
  'hand-limit',
  'card-cost',
  'attack-range',
] as const
export type Channel = (typeof CHANNELS)[number]

/** 修正运算：add 累加，set 覆盖，min/max 夹取（按 priority 顺序应用） */
export const MODIFIER_OPS = ['add', 'set', 'min', 'max'] as const
export type ModifierOp = (typeof MODIFIER_OPS)[number]

/** 目标选取范围 */
export const TARGET_SCOPES = ['self', 'any', 'opponent', 'others', 'dying'] as const
export type TargetScope = (typeof TARGET_SCOPES)[number]

/** 未显式指定目标时的缺省对象（缺省字段缺失时按"唯一候选"回退） */
export const TARGET_DEFAULTS = ['self', 'opponent'] as const
export type TargetDefault = (typeof TARGET_DEFAULTS)[number]

/**
 * 技能的分类，由文档结构派生（见 registry.ts 的 skillKinds）：
 *  - transform 转化型（transforms）
 *  - passive   常驻型（modifiers）
 *  - trigger   触发型（trigger）
 *  - active    主动型（activate）
 * 一个技能可以同时属于多类，展示用 kind 取派生顺序的第一个。
 */
export const SKILL_KINDS = ['transform', 'passive', 'trigger', 'active'] as const
export type SkillKind = (typeof SKILL_KINDS)[number]

/** 时机：回合/阶段边界 + 引擎实际会 emit 的事件 */
export const TIMING_KINDS = [
  'turn-start',
  'turn-end',
  'phase-start',
  'phase-end',
  'after-damage',
] as const
export type TimingKind = (typeof TIMING_KINDS)[number]

/**
 * 日志模板允许的根占位符。
 *  - self/target/source/active/dying：玩家标签（可用 .hp/.maxHp/... 取字段）
 *  - usedRaw/usedAs/via：本次使用/打出的牌与转化技能
 *  - cost/picked：费用牌 / 最近一次 move-cards 取到的牌
 *  - amount/turn：数值与回合数
 */
export const LOG_ROOTS = [
  'self',
  'target',
  'source',
  'active',
  'dying',
  'usedRaw',
  'usedAs',
  'via',
  'cost',
  'picked',
  'amount',
  'turn',
] as const

/** 日志模板中需要玩家上下文的根占位符 */
export const LOG_PLAYER_ROOTS = ['self', 'target', 'source', 'active', 'dying'] as const

/** 日志模板中可由 log.vars 显式绑定的根占位符（只允许数值类，避免把字符串占位符绑成数字） */
export const LOG_VAR_ROOTS = ['amount', 'turn'] as const

/** 日志模板中玩家占位符允许的字段（{self.hp} 等） */
export const LOG_PLAYER_FIELDS = [
  'hp',
  'maxHp',
  'energy',
  'energyMax',
  'handCount',
  'energyTag',
] as const

/** 卡牌 use 变体的语境（出牌阶段使用 / 濒死使用） */
export const USE_CONTEXTS = ['play', 'dying'] as const
export type UseContext = (typeof USE_CONTEXTS)[number]

/**
 * 牌面转化的适用语境：
 *  - use：使用（出牌阶段与濒死自救共用同一套牌面，故不区分）
 *  - play：打出（响应【打击】）
 */
export const TRANSFORM_CONTEXTS = ['use', 'play'] as const
export type TransformContext = (typeof TRANSFORM_CONTEXTS)[number]

/** 六个回合阶段（与 rules/phase.ts 的 TURN_PHASES 一致，kinds.test.ts 断言两者相同） */
export const PHASES = ['prepare', 'judge', 'draw', 'play', 'discard', 'end'] as const

/** 未知/缺失字段的容错：把对象当字典读取时的统一取值器 */
export function hasKind(value: unknown, allowed: readonly string[]): value is string {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return typeof kind === 'string' && allowed.includes(kind)
}
