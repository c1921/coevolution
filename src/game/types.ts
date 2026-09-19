// 协同进化 · 1v1 —— 领域类型定义
// 本文件与整个 src/game 目录都是纯 TypeScript，不依赖 Vue，以便被 vitest 直接单测。
// 注意：tsconfig 开启了 erasableSyntaxOnly，因此禁止使用 enum，
// 所有枚举语义一律用字符串字面量联合类型表达。

import type { Effect } from './dsl/types'
import type { EffectContext } from './dsl/runtime'

/**
 * 牌种 id（如 strike / defend / heal）。
 *
 * 内容已迁到 JSON（data/dsl/cards/*.json），因此这里不再用字面量联合类型锁死：
 * 新增牌种只需加 JSON，引用完整性由 DSL 加载期校验器保证。
 */
export type CardKind = string

export type PlayerIndex = 0 | 1

/**
 * 一张牌：只有「牌种」与「唯一编号」。
 * 牌种同时决定卡面效果与费用（见 data/cardDefs.ts），卡牌没有花色与点数。
 */
export interface Card {
  /** 全局唯一（跨双方牌组也不重复）；洗牌与牌区流转都不改变它，用于"牌数守恒"校验 */
  uid: number
  kind: CardKind
}

/**
 * 转化后的"虚拟牌"。疾影等转化型技能产生的牌统一用它表示，
 * 响应、伤害、日志、弃牌全部只认 VirtualCard，避免结算与展示分叉。
 */
export interface VirtualCard {
  /** 当作什么牌使用 / 打出 */
  as: CardKind
  /** 实际消耗的那张手牌 */
  source: Card
  /** 若经转化技能产生，记录技能 id */
  via?: SkillId
}

/** 物种 id（如 tiger / bear），内容见 data/dsl/species/*.json */
export type SpeciesId = string

/** 技能 id（如 roar / mend），内容见 data/dsl/skills/*.json */
export type SkillId = string

/**
 * 技能分类词汇：transform=转化型 / passive=常驻型 / trigger=触发型 / active=主动型。
 * 唯一的词表在 dsl/kinds.ts，这里复用以免两处漂移。
 */
import type { SkillKind } from './dsl/kinds'

export type { SkillKind }

export interface SkillDef {
  id: SkillId
  name: string
  kind: SkillKind
  text: string
}

export interface SpeciesDef {
  id: SpeciesId
  /** 物种名，如「虎」 */
  name: string
  emoji: string
  maxHp: number
  skills: SkillDef[]
}

export interface PlayerState {
  index: PlayerIndex
  species: SpeciesId
  hp: number
  maxHp: number
  alive: boolean
  hand: Card[]
  /**
   * 私有牌组：只属于这个物种（玩家）的 20 张牌，摸牌只从自己的牌组摸。
   * 每个物种暂时共用同一套牌（见 data/dsl/decks/basic.json 与物种文档的 `deck` 字段）。
   */
  deck: Card[]
  /** 私有弃牌堆：自己使用 / 弃置的牌；自己的牌组耗尽时洗回自己的牌组 */
  discard: Card[]
  /**
   * 当前能量。上限由 rules/energy.ts 的 energyMax() 计算（基础值 + 技能修正），
   * 在**回合开始时**回复至上限；使用 / 打出卡牌都要按「当作的牌面」支付能量。
   */
  energy: number
  /**
   * 本回合各牌名的「使用次数」（使用回合开始时重置，键为牌种 id）。
   * 转化牌按其当作的牌名计数。出牌的实际约束是**能量**（rules/energy.ts），
   * 这份记录只作统计与战报用，不再构成任何上限。
   */
  usedCardsThisTurn: Record<string, number>
  /** 本回合已发动过的「出牌阶段限一次」技能（如疗愈） */
  usedSkillsThisTurn: SkillId[]
}

/** 回合内的六个阶段，顺序固定：准备 → 判定 → 摸牌 → 出牌 → 弃牌 → 结束 */
export type TurnPhase = 'prepare' | 'judge' | 'draw' | 'play' | 'discard' | 'end'

/**
 * 阶段的子步骤。每个阶段都有「阶段开始时」「阶段结束时」两个时机，
 * 中间是阶段本身的进行过程；引擎据此把「移游标」与「产生效果」分开，
 * 使结算被打断（濒死等）后恢复时不会重复执行同一子步骤。
 */
export type PhaseStage = 'start' | 'body' | 'end'

/**
 * 回合游标：六个阶段 + 「回合开始时 / 回合结束时」两个时机 + 终局标记。
 * 注意 'game-over' 不是阶段，只是引擎的终止态。
 */
export type Phase = 'turn-start' | TurnPhase | 'turn-end' | 'game-over'

/** 伤害上下文：供「受到伤害后」技能与日志使用 */
export interface DamageCtx {
  source: PlayerIndex
  target: PlayerIndex
  amount: number
  /** 造成伤害的牌（透支"失去体力"时为 null） */
  card: VirtualCard | null
}

export type Prompt =
  | { kind: 'play'; player: PlayerIndex }
  | {
      kind: 'respond'
      /** 被询问的人（即打击的目标） */
      player: PlayerIndex
      /** 需要打出的牌种（对抗窗口由开启它的卡牌决定） */
      expected: CardKind
      /** 需要打出的张数（威压为 2） */
      need: number
      /** 已打出的张数 */
      got: number
      /** 对抗的发起者 */
      source: PlayerIndex
      card: VirtualCard | null
    }
  | { kind: 'dying'; player: PlayerIndex; dying: PlayerIndex }
  | { kind: 'trigger'; player: PlayerIndex; skill: SkillId }
  | { kind: 'discard'; player: PlayerIndex; count: number }

export type Action =
  /**
   * 使用一张牌（出牌阶段主动使用，或濒死时使用【回复】）。
   * targets 是卡牌文档 TargetSpec 的选择结果：单目标即长度 1，
   * 多目标（count）按文档要求给出全部目标；卡牌没有 target 时不得提供。
   */
  | { kind: 'use-card'; card: Card; as?: CardKind; via?: SkillId; targets?: PlayerIndex[] }
  /** 打出一张牌（响应【打击】时打出【防御】） */
  | { kind: 'play-card'; card: Card; as?: CardKind; via?: SkillId }
  /** 发动主动技：透支 / 疗愈（疗愈需指定目标，缺省为自己） */
  | { kind: 'activate'; skill: SkillId; cards?: Card[]; target?: PlayerIndex }
  /** 可选发动技能（夺食 / 狡计）的应答 */
  | { kind: 'trigger-choice'; accept: boolean }
  /** 弃牌阶段弃置若干手牌 */
  | { kind: 'discard-cards'; cards: Card[] }
  /** 结束出牌阶段 */
  | { kind: 'end-phase' }
  /** 放弃响应 / 放弃救援 */
  | { kind: 'cancel' }

export interface LogEntry {
  turn: number
  text: string
}

/**
 * 处理区条目：结算中的牌 + 它属于谁。
 * 一次【打击】的收尾会把攻方的打击牌与守方的防御牌一起送去弃牌堆，
 * 而弃牌堆是私有的，所以每张处理中的牌都必须记住自己的归属。
 */
export interface ProcessingCard {
  card: Card
  owner: PlayerIndex
}

/**
 * 结算帧（continuation stack）。栈顶帧结算完毕才回到下一帧。
 * 打击的响应 → 伤害 → 濒死 → 收尾 这条链就是靠帧的压栈/退栈来保证顺序的。
 */
export type Frame =
  /**
   * 对抗结算：等待响应者打出 `expected` 牌抵消。
   * 开启对抗的牌由 `card` 记录（夺食据此取回造成伤害的牌），
   * 未抵消时执行 `onUnmet`（通常造成伤害），由 DSL 的 contest 指令提供。
   */
  | {
      kind: 'contest'
      source: PlayerIndex
      target: PlayerIndex
      card: VirtualCard | null
      /** 开启对抗时当作的牌种（响应方据此判断能否响应） */
      openedBy: CardKind
      /** 需要打出的牌种 */
      expected: CardKind
      /** 需要打出的张数（威压为 2） */
      need: number
      got: number
      /** 本次结算消耗的牌（攻击牌 + 已打出的响应牌），收尾时各自进自己的弃牌堆 */
      spent: ProcessingCard[]
      /** 未抵消时的后续效果 */
      onUnmet: Effect[]
      ctx: EffectContext
    }
  /** 伤害已扣减体力：先依次询问「受到伤害后」技能，再做濒死检查 */
  | { kind: 'damage'; ctx: DamageCtx; triggers: TriggerRef[] }
  /** 濒死询问队列：按顺序逐个询问是否使用【回复】 */
  | { kind: 'dying'; dying: PlayerIndex; ask: PlayerIndex[] }
  /** 结算收尾：把仍在处理区的牌按归属移入各自的弃牌堆（已被夺食取走的牌自动跳过） */
  | { kind: 'flush'; cards: ProcessingCard[] }
  /** 延迟效果帧（DSL 效果的 after 列表）：当前结算链走完后按 LIFO 执行 */
  | { kind: 'effects'; effects: Effect[]; ctx: EffectContext }

/** 待处理的技能触发：谁拥有哪个技能，是否可选发动 */
export interface TriggerRef {
  owner: PlayerIndex
  skill: SkillId
  optional: boolean
}

export interface GameState {
  seed: number
  /** PRNG 内部状态，随状态一起序列化，保证可复现 */
  rngState: number
  /** 处理区（双方共享）：结算中的牌暂存于此，结算完全结束后才进各自的弃牌堆（夺食即从此处取回） */
  processing: ProcessingCard[]
  players: [PlayerState, PlayerState]
  active: PlayerIndex
  firstPlayer: PlayerIndex
  /** 从 1 开始计数；每次切换回合 +1 */
  turn: number
  /** 当前阶段/时机 */
  phase: Phase
  /** 当前阶段的子步骤（阶段开始时 / 阶段进行 / 阶段结束时） */
  phaseStage: PhaseStage
  /** 本回合尚未进行的阶段：可被「跳过阶段」移除，也可插入「额外的阶段」 */
  phaseQueue: TurnPhase[]
  /** 当前待输入项；为 null 表示引擎正在自动推进或已终局 */
  pending: Prompt | null
  /** 结算帧栈 */
  stack: Frame[]
  lastDamage: DamageCtx | null
  log: LogEntry[]
  result: { winner: PlayerIndex } | null
}
