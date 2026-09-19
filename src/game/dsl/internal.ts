import { log, playerLabel } from '../log'
import { nextInt } from '../rng'
import { addExtraPhase, skipPhase } from '../rules/phase'
import { removeFromHand, drawCards, takeFromProcessing } from '../rules/cardZones'
import { addThreat, offsetThreat } from '../rules/threat'
import type { Card, GameState, PlayerIndex, ProcessingCard, TurnPhase } from '../types'
import { RuleError } from '../util'
import { evalValue } from './value'
import { requireRole, resolveCardRef, zoneCards } from './runtime'
import type { EvalEnv, EffectContext } from './runtime'
import type { RoleRef } from './kinds'
import type { CardPick, Effect, ZoneRef } from './types'

/**
 * 引擎原语：DSL 效果解释器与引擎共用的状态变更操作。
 *
 * 这里只做"机制"（牌区迁移、体力、能量、帧压栈），不含任何具体内容判断；
 * 所有语义都来自文档。效果解释器（effect.ts）是这些原语的唯一调用者。
 */

/** 取牌：按 pick 描述从 from 牌区挑出牌（不移动） */
function pickCards(
  state: GameState,
  env: EvalEnv,
  from: ZoneRef,
  pick: CardPick,
): Card[] {
  const owner: PlayerIndex = from.of ? requireRole(env, from.of) : env.ctx.self
  const pool = zoneCards(state, owner, from.zone)
  const matches = (card: Card): boolean =>
    pick.cardKind === undefined || card.kind === pick.cardKind

  switch (pick.mode) {
    case 'played': {
      const uid = env.ctx.usedUid
      if (uid === undefined) throw new RuleError('played 取牌需要「已使用/打出的牌」上下文')
      const card = pool.find((item) => item.uid === uid)
      return card ? [card] : []
    }
    case 'cost': {
      return env.ctx.costCards
        .map((uid) => pool.find((item) => item.uid === uid))
        .filter((card): card is Card => card !== undefined)
    }
    case 'specific': {
      const ref = pick.card ?? 'event-card'
      const card = resolveCardRef(env, ref)
      if (!card) return []
      // specific 只能指向处理区（校验器已强制），按 uid 在共享处理区里找
      return state.processing.some((entry) => entry.card.uid === card.uid) ? [card] : []
    }
    case 'random': {
      const count = Math.max(0, pick.count ?? 1)
      const candidates = pool.filter(matches)
      const taken: Card[] = []
      for (let i = 0; i < count && candidates.length > 0; i++) {
        const draw = nextInt(state.rngState, candidates.length)
        state.rngState = draw.state
        const [card] = candidates.splice(draw.value, 1)
        if (card) taken.push(card)
      }
      return taken
    }
    case 'all':
      return pool.filter(matches)
  }
}

/** 把一张牌从某玩家的某牌区取出（处理区按 uid 取，与归属无关） */
function removeFromZone(
  state: GameState,
  owner: PlayerIndex,
  zone: ZoneRef['zone'],
  card: Card,
): void {
  switch (zone) {
    case 'hand':
      removeFromHand(state, owner, card)
      return
    case 'discard': {
      const pile = state.players[owner].discard
      const at = pile.findIndex((item) => item.uid === card.uid)
      if (at < 0) throw new RuleError(`弃牌堆中不存在 uid=${card.uid} 的牌`)
      pile.splice(at, 1)
      return
    }
    case 'processing': {
      if (!takeFromProcessing(state, card.uid)) {
        throw new RuleError(`处理区中不存在 uid=${card.uid} 的牌`)
      }
      return
    }
    case 'deck':
      throw new RuleError('deck 只能由 draw 指令访问')
  }
}

/** 把一张牌放入某玩家的某牌区 */
function addToZone(
  state: GameState,
  owner: PlayerIndex,
  zone: ZoneRef['zone'],
  card: Card,
): void {
  switch (zone) {
    case 'hand':
      state.players[owner].hand.push(card)
      return
    case 'discard':
      state.players[owner].discard.push(card)
      return
    case 'processing': {
      const entry: ProcessingCard = { card, owner }
      state.processing.push(entry)
      return
    }
    case 'deck':
      throw new RuleError('deck 只能由 draw 指令访问')
  }
}

/**
 * move-cards 指令：按 pick 取牌并从 from 迁移到 to。
 * 取到的牌 uid 记入 ctx.picked（供 {picked} 与 picked-count 使用）。
 */
export function moveCards(
  state: GameState,
  env: EvalEnv,
  effect: Extract<Effect, { kind: 'move-cards' }>,
): Card[] {
  const toOwner: PlayerIndex = effect.to.of ? requireRole(env, effect.to.of) : env.ctx.self
  const picked = pickCards(state, env, effect.from, effect.pick)
  // 处理区是共享区，removeFromZone 按 uid 取牌、不看归属；其余牌区用 from.of（缺省为自己）
  const fromOwner: PlayerIndex = effect.from.of ? requireRole(env, effect.from.of) : env.ctx.self

  for (const card of picked) {
    removeFromZone(state, fromOwner, effect.from.zone, card)
    addToZone(state, toOwner, effect.to.zone, card)
  }
  env.ctx.picked = picked.map((card) => card.uid)
  return picked
}

/** 压入延迟效果帧（after 列表） */
export function pushEffectsFrame(
  state: GameState,
  effects: readonly Effect[],
  ctx: EffectContext,
): void {
  if (effects.length === 0) return
  state.stack.push({ kind: 'effects', effects: [...effects], ctx })
}

/** 压入对抗帧（contest 指令） */
export function pushContestFrame(
  state: GameState,
  env: EvalEnv,
  effect: Extract<Effect, { kind: 'contest' }>,
): void {
  const responder = requireRole(env, effect.responder)
  const used = env.ctx.usedCard ?? null
  const need = Math.max(0, Math.floor(evalValue(env, effect.need)))
  const spent: ProcessingCard[] = used ? [{ card: used.source, owner: env.ctx.self }] : []
  state.stack.push({
    kind: 'contest',
    source: env.ctx.self,
    target: responder,
    card: used,
    openedBy: used?.as ?? effect.expectedCard,
    expected: effect.expectedCard,
    need,
    got: 0,
    spent,
    onUnmet: effect.onUnmet ? [...effect.onUnmet] : [],
    // 未抵消分支以"发起者打响应者"为语境
    ctx: { ...env.ctx, source: env.ctx.self, target: responder },
  })
}

/**
 * 给当前对抗累加抵消进度（contest-contribute 指令）。
 *
 * 同时把本次打出的牌记入对抗的 spent 列表——它已经由 move-cards 进入处理区，
 * 收尾时必须按归属进弃牌堆，否则会永远留在处理区（牌数守恒会立刻发现）。
 * 保持静默：抵消进度与「被抵消」属于机制战报，由引擎在贡献后统一输出。
 */
export function contributeToContest(
  state: GameState,
  env: EvalEnv,
  amount: number,
): void {
  const top = state.stack[state.stack.length - 1]
  if (!top || top.kind !== 'contest') {
    throw new RuleError('contest-contribute 需要位于对抗结算中')
  }
  top.got += Math.max(0, Math.floor(amount))

  const used = env.ctx.usedCard
  if (used && !top.spent.some((entry) => entry.card.uid === used.source.uid)) {
    top.spent.push({ card: used.source, owner: env.ctx.self })
  }
}

/** 回复体力（不超过上限） */
export function healHp(state: GameState, p: PlayerIndex, amount: number): void {
  const player = state.players[p]
  player.hp = Math.min(player.hp + amount, player.maxHp)
}

/** 造成威胁：叠加到目标身上，由其在自己的回合抵消、在自己的回合结束时兑现为伤害 */
export function threatFor(
  state: GameState,
  env: EvalEnv,
  target: RoleRef,
  amount: number,
): void {
  const victim = requireRole(env, target)
  // 施加者恒为效果归属者：技能触发里的 source 是"伤害来源"（受害者视角），不是施加者
  addThreat(state, victim, env.ctx.self, amount)
}

/** 抵消威胁（【防御】） */
export function offsetThreatFor(
  state: GameState,
  env: EvalEnv,
  target: RoleRef,
  amount: number,
): void {
  offsetThreat(state, requireRole(env, target), amount)
}

/** 摸牌（含牌组耗尽洗回） */
export function drawFor(state: GameState, p: PlayerIndex, count: number): void {
  const drawn = drawCards(state, p, count)
  log(state, `${playerLabel(state, p)} 摸了 ${drawn.length} 张牌`)
}

/** 支付能量（不足即抛错，调用方应先校验） */
export function spendEnergy(state: GameState, p: PlayerIndex, amount: number): void {
  const player = state.players[p]
  if (player.energy < amount) {
    throw new RuleError(`能量不足：需要 ${amount} 点，当前 ${player.energy} 点`)
  }
  player.energy -= amount
}

/** 获得能量（不超过上限由不变式校验兜底） */
export function gainEnergy(state: GameState, p: PlayerIndex, amount: number): void {
  state.players[p].energy += amount
}

/**
 * 濒死脱离：体力回到 0 以上时弹出濒死帧。
 * 与旧实现一致：只有确实在濒死结算中（栈顶是濒死帧）才弹栈并记战报。
 */
export function resolveDying(state: GameState, env: EvalEnv, role: RoleRef): void {
  const dying = requireRole(env, role)
  if (state.players[dying].hp <= 0) return
  const top = state.stack[state.stack.length - 1]
  if (top && top.kind === 'dying') {
    state.stack.pop()
    log(state, `${playerLabel(state, dying)} 脱离濒死状态`)
  }
}

/** 跳过阶段 / 插入额外阶段（复用 rules/phase.ts 的原语） */
export function skipPhaseFor(state: GameState, phase: TurnPhase): void {
  skipPhase(state, phase)
}

export function addExtraPhaseFor(
  state: GameState,
  phase: TurnPhase,
  position: 'next' | 'last',
): void {
  addExtraPhase(state, phase, position)
}
