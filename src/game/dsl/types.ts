import type { TurnPhase } from '../types'
import type {
  CardRef,
  Channel,
  CompareOp,
  DocKind,
  ModifierOp,
  PickMode,
  Rarity,
  RewardKind,
  RoleRef,
  TargetCountMode,
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
  | { at: 'after-threat' }

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
  /** 给目标叠加威胁（唯一的攻击途径，见 rules/threat.ts） */
  | { kind: 'threat'; target: RoleRef; amount: Value }
  /** 抵消目标的威胁（【防御】） */
  | { kind: 'offset-threat'; target: RoleRef; amount: Value }
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
  /**
   * 对抗：开启响应窗口，让 responder 打出 expectedCard 抵消。
   *
   * 占位机制：当前的防御改为「自己回合抵消威胁」，因此内置内容没有任何卡牌声明
   * `play` 变体，这条指令与响应链暂时不可达，保留给后续的反制机制。
   */
  | {
      kind: 'contest'
      /** 被询问响应的人 */
      responder: RoleRef
      /** 需要打出的牌种 */
      expectedCard: string
      /** 需要几张才能抵消 */
      need: Value
      /** 抵消成功的后续效果（收尾由引擎负责） */
      onMet?: Effect[]
      /** 未抵消的后续效果 */
      onUnmet?: Effect[]
    }
  | { kind: 'contest-contribute'; amount: Value }
  | { kind: 'resolve-dying'; of: RoleRef }
  | { kind: 'skip-phase'; phase: TurnPhase }
  | { kind: 'extra-phase'; phase: TurnPhase; position: 'next' | 'last' }
  /** 对每个选定目标执行一次子效果（把 target 临时绑定为当前目标） */
  | { kind: 'for-each-target'; effects: Effect[] }
  | { kind: 'if'; condition: Condition; then: Effect[]; else?: Effect[] }
  /**
   * 奖励三选一：压入奖励结算帧，让双方各自做一次选择。
   *  - `card`：从奖励池按权重抽 `candidates` 张不重复的牌，`allowSkip` 决定能否跳过；
   *  - `service`：升级 / 移除 / 回复 三选一，`healAmount` 为回复量、`removeFloor` 为移除下限。
   * 该指令只压帧、不立即询问，因此同一时机上的多份规则会按压栈顺序依次弹出。
   */
  | {
      kind: 'offer-reward'
      reward: RewardKind
      candidates?: number
      allowSkip?: boolean
      weights?: { common: number; uncommon: number; rare: number }
      healAmount?: Value
      removeFloor?: number
    }

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

/** 目标个数规格（见 kinds.ts 的 TARGET_COUNT_MODES） */
export type TargetCount =
  | { mode: Extract<TargetCountMode, 'all'> }
  | { mode: Extract<TargetCountMode, 'exactly'>; count: Value }

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
  /**
   * 目标个数；缺省为单选 1 个。`all` 作用于全部候选（无需选择），
   * `exactly` 必须显式指定 N 个；出现 count 时忽略 required 且不允许 default。
   */
  count?: TargetCount
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
  /** 需要先选定并弃置的手牌（如强袭） */
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
  /**
   * 稀有度：只有声明了稀有度的牌种才进入奖励池（见 rules/reward.ts）。
   * 基础牌与升级版都不声明，因此不会出现在奖励候选里。
   */
  rarity?: Rarity
  /**
   * 升级后的牌种 id：升级奖励把目标牌的 kind 就地改成它（uid 不变）。
   * 只写在基础牌上；升级版本身不得再声明 upgradeTo（禁止链式升级）。
   */
  upgradeTo?: string
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
