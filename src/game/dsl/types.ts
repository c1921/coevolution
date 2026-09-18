import type { TurnPhase } from '../types'
import type {
  CardRef,
  Channel,
  CompareOp,
  DocKind,
  ModifierOp,
  PickMode,
  RoleRef,
  TargetDefault,
  TargetScope,
  TransformContext,
  UseContext,
  ValueKind,
  ValueRefName,
  ZoneName,
} from './kinds'

/**
 * DSL 的 IR 类型：与 data/dsl/*.json 的结构一一对应。
 *
 * 这些类型只在"校验通过之后"成立——JSON 先经 validate.ts 校验，再被断言为这些类型。
 * 因此这里的字段都是必填的最终形态，可选字段只有 JSON 中真正可省略的那些。
 */

/** 时机：回合/阶段边界，或引擎会 emit 的事件 */
export type Timing =
  | { at: 'turn-start' }
  | { at: 'turn-end' }
  | { at: 'phase-start'; phase: TurnPhase }
  | { at: 'phase-end'; phase: TurnPhase }
  | { at: 'after-damage' }

/** 数值表达式 */
export type Value =
  | { kind: 'const'; value: number }
  | { kind: 'ref'; ref: ValueRefName; of?: RoleRef }
  | { kind: Extract<ValueKind, 'add' | 'sub' | 'mul' | 'min' | 'max'>; of: Value[] }
  | { kind: 'floor-div'; of: Value; by: Value }
  | { kind: 'clamp'; of: Value; min: number; max: number }
  | { kind: 'channel'; channel: Channel; of: RoleRef }

/**
 * 条件。
 * `reason` 是可选的失败说明：条件不成立时，合法性判定会把这句话回给玩家，
 * 因此"为什么不能这么做"也是内容，写在文档里而不是散落在引擎分支中。
 */
export type Condition = { reason?: string } & (
  | { kind: 'always' }
  | { kind: 'not'; of: Condition }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  | { kind: 'compare'; op: CompareOp; left: Value; right: Value }
  | { kind: 'alive'; of: RoleRef }
  | { kind: 'has-cards'; of: RoleRef; zone: ZoneName; atLeast: Value }
  | {
      kind: 'card-kind-count'
      of: RoleRef
      zone: ZoneName
      cardKind: string
      atLeast: Value
    }
  | { kind: 'in-processing'; card: CardRef }
  | { kind: 'card-transformed' }
  | { kind: 'picked-count'; atLeast: Value }
  | { kind: 'skill-unused'; skill: string }
  | { kind: 'is-active' }
  | { kind: 'phase-is'; phase: TurnPhase }
)

/** 取牌描述 */
export interface CardPick {
  mode: PickMode
  count?: number
  /** 限定牌种（缺省为任意牌种） */
  cardKind?: string
  /** mode='specific' 时指向具体牌 */
  card?: CardRef
}

/** 牌区引用 */
export interface ZoneRef {
  zone: ZoneName
  of?: RoleRef
}

/** 效果指令 */
export type Effect =
  | { kind: 'log'; template: string; vars?: Record<string, Value> }
  | { kind: 'damage'; target: RoleRef; amount: Value }
  | { kind: 'lose-hp'; target: RoleRef; amount: Value }
  | { kind: 'heal'; target: RoleRef; amount: Value }
  | { kind: 'draw'; target: RoleRef; count: Value }
  | {
      kind: 'move-cards'
      from: ZoneRef
      to: ZoneRef
      pick: CardPick
    }
  | { kind: 'pay-energy'; target: RoleRef; amount: Value }
  | { kind: 'gain-energy'; target: RoleRef; amount: Value }
  | { kind: 'record-card-use'; of: RoleRef; cardKind: string }
  | { kind: 'record-skill-use'; skill: string }
  | {
      kind: 'contest'
      /** 被询问响应的人 */
      responder: RoleRef
      /** 需要打出的牌种 */
      expectedCard: string
      /** 需要几张才能抵消（威压由 defend-need-against 通道给出） */
      need: Value
      /** 抵消成功的后续效果（收尾由引擎负责） */
      onMet?: Effect[]
      /** 未抵消的后续效果（通常是造成伤害） */
      onUnmet?: Effect[]
    }
  | { kind: 'contest-contribute'; amount: Value }
  | { kind: 'resolve-dying'; of: RoleRef }
  | { kind: 'skip-phase'; phase: TurnPhase }
  | { kind: 'extra-phase'; phase: TurnPhase; position: 'next' | 'last' }
  | { kind: 'if'; condition: Condition; then: Effect[]; else?: Effect[] }

/** 数值修正 */
export interface Modifier {
  channel: Channel
  op: ModifierOp
  value: Value
}

/** 牌面转化：把 from 牌种的牌当作 to 牌种使用/打出 */
export interface Transform {
  from: string
  to: string
  contexts: TransformContext[]
}

/** 目标选取规格 */
export interface TargetSpec {
  scope: TargetScope
  /** true 表示必须显式指定目标（界面需要目标选择器）；缺省 false，可省略 */
  required?: boolean
  /** 可省略目标时的缺省对象；缺省字段缺失时按"唯一候选 → 自己"回退 */
  default?: TargetDefault
  alive: boolean
  /** true 时要求距离在攻击范围内（打击） */
  range?: boolean
  conditions?: Condition[]
}

/** 触发型技能 */
export interface TriggerSpec {
  on: Timing
  /** true 表示可选发动（引擎询问玩家）；当前仅 after-damage 支持 */
  optional?: boolean
  when?: Condition[]
  effects: Effect[]
  /** 延迟到当前结算链结束后的效果（栈语义，见 docs/dsl.md） */
  after?: Effect[]
}

/** 主动技的发动规格 */
export interface ActivateSpec {
  timing: 'play'
  oncePerTurn?: boolean
  /** 需要先选定并弃置的手牌（疗愈） */
  costCards?: { count: Value; cardKind?: string }
  requires?: Condition[]
  target?: TargetSpec
  effects: Effect[]
  after?: Effect[]
  ui?: { buttonLabel?: string }
}

/** 卡牌在某语境下的用法变体 */
export interface UseVariant {
  context: UseContext
  target?: TargetSpec
  requires?: Condition[]
  effects: Effect[]
  after?: Effect[]
}

/** 卡牌在响应语境下的用法 */
export interface PlayVariant {
  /** 响应哪种牌开启的对抗（打击） */
  respondsTo: string
  requires?: Condition[]
  effects: Effect[]
}

/** 文档信封 */
export interface DocBase {
  dslVersion: number
  kind: DocKind
  id: string
  priority?: number
}

export interface SpeciesDoc extends DocBase {
  kind: 'species'
  name: string
  emoji: string
  maxHp: number
  skills: string[]
  deck: string
}

export interface SkillDoc extends DocBase {
  kind: 'skill'
  name: string
  text: string
  modifiers?: Modifier[]
  transforms?: Transform[]
  trigger?: TriggerSpec
  activate?: ActivateSpec
}

export interface CardDoc extends DocBase {
  kind: 'card'
  name: string
  short: string
  text: string
  cost: Value
  use?: UseVariant[]
  play?: PlayVariant
}

export interface RulesetDoc extends DocBase {
  kind: 'ruleset'
  channels: Partial<Record<Channel, number>>
}

export interface DeckDoc extends DocBase {
  kind: 'deck'
  cards: { kind: string; count: number }[]
}

/** 独立规则效果：挂在时机上的非技能效果（如消耗战） */
export interface RuleDoc extends DocBase {
  kind: 'rule'
  on: Timing
  when?: Condition[]
  effects: Effect[]
}

export type Doc = SpeciesDoc | SkillDoc | CardDoc | RulesetDoc | DeckDoc | RuleDoc

/** 校验后的注册表内容 */
export interface Registry {
  dslVersion: number
  /** 按 priority、id 排序后的全部文档 */
  species: SpeciesDoc[]
  skills: SkillDoc[]
  cards: CardDoc[]
  decks: DeckDoc[]
  rules: RuleDoc[]
  ruleset: RulesetDoc
  /** 常用查询表 */
  speciesById: Record<string, SpeciesDoc>
  skillById: Record<string, SkillDoc>
  cardById: Record<string, CardDoc>
  deckById: Record<string, DeckDoc>
}
