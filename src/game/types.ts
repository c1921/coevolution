// 协同进化 · 1v1 —— 领域类型定义
// 本文件与整个 src/game 目录都是纯 TypeScript，不依赖 Vue，以便被 vitest 直接单测。
// 注意：tsconfig 开启了 erasableSyntaxOnly，因此禁止使用 enum，
// 所有枚举语义一律用字符串字面量联合类型表达。

/** 花色 */
export type Suit = 'spade' | 'heart' | 'club' | 'diamond'

/** 基本牌种类：打击 / 防御 / 回复 */
export type CardKind = 'strike' | 'defend' | 'heal'

export type PlayerIndex = 0 | 1

export interface Card {
  /** 全局唯一；洗牌与牌区流转都不改变它，用于"牌数守恒"校验 */
  uid: number
  kind: CardKind
  suit: Suit
  /** 1=A，11=J，12=Q，13=K。MVP 无判定，点数仅用于展示 */
  rank: number
}

/**
 * 转化后的"虚拟牌"。猛扑 / 疾影 / 灵草产生的牌统一用它表示，
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

export type SpeciesId =
  | 'tiger'
  | 'bear'
  | 'leopard'
  | 'wolf'
  | 'deer'
  | 'lion'
  | 'ox'
  | 'fox'

export type SkillId =
  | 'pounce'
  | 'roar'
  | 'flicker'
  | 'snatch'
  | 'herb'
  | 'mend'
  | 'menace'
  | 'overexert'
  | 'guile'

/** transform=转化型 / passive=常驻型 / trigger=受到伤害后可选发动 / active=出牌阶段主动技 */
export type SkillKind = 'transform' | 'passive' | 'trigger' | 'active'

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
  /** 本回合已使用【打击】的张数，回合开始时清零 */
  strikesUsedThisTurn: number
  /** 疗愈每回合限一次 */
  mendUsedThisTurn: boolean
}

export type Phase =
  | 'turn-start'
  | 'draw'
  | 'play'
  | 'discard'
  | 'turn-end'
  | 'game-over'

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
      /** 需要打出的【防御】张数（威压为 2） */
      need: number
      /** 已打出的张数 */
      got: number
      /** 打击的使用者 */
      source: PlayerIndex
      card: VirtualCard
    }
  | { kind: 'dying'; player: PlayerIndex; dying: PlayerIndex }
  | { kind: 'trigger'; player: PlayerIndex; skill: SkillId; ctx: DamageCtx }
  | { kind: 'discard'; player: PlayerIndex; count: number }

export type Action =
  /** 使用一张牌（出牌阶段主动使用，或濒死时使用【回复】） */
  | { kind: 'use-card'; card: Card; as?: CardKind; via?: SkillId }
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
 * 结算帧（continuation stack）。栈顶帧结算完毕才回到下一帧。
 * 打击的响应 → 伤害 → 濒死 → 收尾 这条链就是靠帧的压栈/退栈来保证顺序的。
 */
export type Frame =
  /** 一次【打击】的结算：等待目标打出【防御】 */
  | {
      kind: 'strike'
      source: PlayerIndex
      target: PlayerIndex
      card: VirtualCard
      /** 需要打出的【防御】张数（威压为 2） */
      need: number
      got: number
      /** 本次结算消耗的牌（打击牌 + 已打出的防御牌），收尾时由处理区进弃牌堆 */
      spent: Card[]
    }
  /** 伤害已扣减体力：先依次询问「受到伤害后」技能，再做濒死检查 */
  | { kind: 'damage'; ctx: DamageCtx; triggers: SkillId[] }
  /** 濒死询问队列：按顺序逐个询问是否使用【回复】 */
  | { kind: 'dying'; dying: PlayerIndex; ask: PlayerIndex[] }
      /** 结算收尾：把仍在处理区的牌移入弃牌堆（已被夺食取走的牌自动跳过） */
  | { kind: 'flush'; cards: Card[] }
  /** 延迟摸牌（透支在濒死结算存活后再摸两张） */
  | { kind: 'draw'; player: PlayerIndex; count: number }

export interface GameState {
  seed: number
  /** PRNG 内部状态，随状态一起序列化，保证可复现 */
  rngState: number
  deck: Card[]
  discard: Card[]
  /** 处理区：结算中的牌暂存于此，结算完全结束后才进弃牌堆（夺食即从此处取回） */
  processing: Card[]
  players: [PlayerState, PlayerState]
  active: PlayerIndex
  firstPlayer: PlayerIndex
  /** 从 1 开始计数；每次切换回合 +1 */
  turn: number
  phase: Phase
  /** 当前待输入项；为 null 表示引擎正在自动推进或已终局 */
  pending: Prompt | null
  /** 结算帧栈 */
  stack: Frame[]
  lastDamage: DamageCtx | null
  log: LogEntry[]
  result: { winner: PlayerIndex } | null
}
