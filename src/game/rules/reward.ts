import { cardDoc, registry } from '../dsl/registry'
import { log, playerLabel } from '../log'
import { nextInt } from '../rng'
import type { Card, CardKind, Frame, GameState, PlayerIndex } from '../types'
import { RuleError } from '../util'

/**
 * 奖励机制的**纯逻辑**：抽候选、算可选牌、应用选择。
 *
 * 这里不压帧、不出 prompt——帧的压入住在 `dsl/primitives.ts` 的 `pushRewardFrame`
 * （方向是 dsl → rules，与 `rules/dying.ts` 直接 `state.stack.push` 一致），
 * 帧的推进住在 `engine/stack.ts` 的 `stepFrame`。本模块因此只依赖
 * `dsl/registry` / `rng` / `log` / `types` / `util`，不 import `engine/*`，
 * 也不 import `dsl/effect` 或 `dsl/primitives`，运行时依赖图保持无环（guards.test.ts）。
 *
 * 奖励池**不写死任何牌种 id**：候选池 = 所有声明了 `rarity` 的牌种；
 * 基础牌与升级版都不声明 rarity，因此天然不入池。
 */

/** 触发奖励帧的帧型（stepFrame / applier 共用） */
export type RewardFrame = Extract<Frame, { kind: 'reward' }>

/** 默认抽牌数与稀有度权重（内容可通过 offer-reward 指令覆盖） */
export const REWARD_CANDIDATES = 3
export const REWARD_WEIGHTS = { common: 60, uncommon: 30, rare: 10 } as const

/** 移除服务的默认下限：移除后「牌组 + 手牌 + 弃牌堆」不得少于它 */
export const REMOVE_FLOOR = 5

/** 奖励池：所有声明了稀有度的牌种，按注册表顺序（确定性） */
export function rewardPool(): CardKind[] {
  return registry.cards.filter((doc) => doc.rarity !== undefined).map((doc) => doc.id)
}

function weightOf(
  kind: CardKind,
  weights: { common: number; uncommon: number; rare: number },
): number {
  const rarity = cardDoc(kind).rarity
  return rarity === undefined ? 0 : weights[rarity]
}

/**
 * 按稀有度权重不重复地抽 `count` 张候选牌。
 * 每一步都走 `state.rngState`（确定性），同一状态必定得到同一组候选。
 * 池子不够 `count` 时返回池中全部（不重复）。
 */
export function rollRewardCards(
  state: GameState,
  count: number = REWARD_CANDIDATES,
  weights: { common: number; uncommon: number; rare: number } = REWARD_WEIGHTS,
): CardKind[] {
  const pool = rewardPool()
  const picked: CardKind[] = []
  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, kind) => sum + weightOf(kind, weights), 0)
    if (total <= 0) break
    const roll = nextInt(state.rngState, total)
    state.rngState = roll.state
    let acc = 0
    let index = pool.length - 1
    for (let i = 0; i < pool.length; i++) {
      acc += weightOf(pool[i] as CardKind, weights)
      if (roll.value < acc) {
        index = i
        break
      }
    }
    picked.push(pool.splice(index, 1)[0] as CardKind)
  }
  return picked
}

/* ------------------------------------------------------------------ 选牌候选 */

/** 自己的牌组 + 手牌 + 弃牌堆（不含移除区，也不含处理区） */
export function ownZones(player: { deck: Card[]; hand: Card[]; discard: Card[] }): Card[][] {
  return [player.deck, player.hand, player.discard]
}

/** 自己可被升级 / 移除的牌，按 uid 升序（顺序即界面与 AI 看到的顺序，确定性） */
export function ownCards(state: GameState, p: PlayerIndex): Card[] {
  const player = state.players[p]
  return [...player.deck, ...player.hand, ...player.discard].sort((a, b) => a.uid - b.uid)
}

/** 升级候选：自己在牌组/手牌/弃牌堆里、且文档声明了 upgradeTo 的牌 */
export function upgradeCandidates(state: GameState, p: PlayerIndex): Card[] {
  return ownCards(state, p).filter((card) => cardDoc(card.kind).upgradeTo !== undefined)
}

/** 移除候选：自己在牌组/手牌/弃牌堆里的全部牌 */
export function removeCandidates(state: GameState, p: PlayerIndex): Card[] {
  return ownCards(state, p)
}

/** 自己的「牌组 + 手牌 + 弃牌堆」张数（移除下限按它算） */
export function ownCardCount(state: GameState, p: PlayerIndex): number {
  const player = state.players[p]
  return player.deck.length + player.hand.length + player.discard.length
}

/** 移除一张牌后是否仍不少于 removeFloor */
export function canRemove(state: GameState, p: PlayerIndex, removeFloor: number): boolean {
  return ownCardCount(state, p) - 1 >= removeFloor
}

/** 该玩家的候选里是否存在这张 uid（升级与移除共用） */
export function findOwnCard(state: GameState, p: PlayerIndex, uid: number): Card | undefined {
  return ownCards(state, p).find((card) => card.uid === uid)
}

/** 服务奖励的三项是否可用（prompt / AI / 界面共用同一份判定） */
export interface ServiceAvailability {
  upgrade: boolean
  remove: boolean
  heal: boolean
}

export function serviceOptions(
  state: GameState,
  p: PlayerIndex,
  frame: { healAmount: number; removeFloor: number },
): ServiceAvailability {
  const player = state.players[p]
  return {
    upgrade: upgradeCandidates(state, p).length > 0,
    remove: canRemove(state, p, frame.removeFloor),
    heal: player.hp < player.maxHp && frame.healAmount > 0,
  }
}

/* ------------------------------------------------------------------ 应用选择 */

/** 当前栈顶的奖励帧；不在奖励结算中即抛规则错误 */
export function requireRewardFrame(state: GameState): RewardFrame {
  const top = state.stack[state.stack.length - 1]
  if (!top || top.kind !== 'reward') {
    throw new RuleError('当前不在奖励结算中')
  }
  return top
}

/** 从牌组/手牌/弃牌堆中取出某 uid 的牌（移除用），不改归属以外的东西 */
function takeOwnCard(state: GameState, p: PlayerIndex, uid: number): Card | undefined {
  for (const zone of ownZones(state.players[p])) {
    const at = zone.findIndex((card) => card.uid === uid)
    if (at >= 0) return zone.splice(at, 1)[0]
  }
  return undefined
}

/**
 * 卡牌奖励选定 / 服务奖励选定「回复」：结算完就把当前询问者移出队列。
 * 「升级 / 移除」不走这里，而是设置 `pendingPick` 等下一轮出 `pick-card`。
 */
export function applyPickReward(
  state: GameState,
  p: PlayerIndex,
  choice: { card?: CardKind; service?: 'upgrade' | 'remove' | 'heal' },
): void {
  const frame = requireRewardFrame(state)
  if (frame.reward === 'card') {
    const kind = choice.card
    if (kind === undefined || !(frame.cards ?? []).includes(kind)) {
      throw new RuleError('这张牌不在本次奖励候选中')
    }
    const card: Card = { uid: state.nextUid++, kind }
    state.players[p].hand.push(card)
    state.cardTotal += 1
    log(state, `${playerLabel(state, p)} 选择了奖励【${cardDoc(kind).name}】，加入手牌`)
    frame.ask.shift()
    return
  }

  if (choice.service === 'heal') {
    const player = state.players[p]
    const amount = Math.max(0, Math.floor(frame.healAmount))
    player.hp = Math.min(player.hp + amount, player.maxHp)
    log(state, `${playerLabel(state, p)} 选择回复体力至 ${player.hp}/${player.maxHp}`)
    frame.ask.shift()
    return
  }

  if (choice.service === 'upgrade' || choice.service === 'remove') {
    // 分两步询问：先记下意图，下一轮 stepFrame 才出 pick-card
    frame.pendingPick = { player: p, purpose: choice.service }
    return
  }

  throw new RuleError('奖励选择非法')
}

/** 放弃卡牌奖励：只有允许跳过时才能走到这里（合法性由 checkSkipReward 兜底） */
export function applySkipReward(state: GameState, p: PlayerIndex): void {
  const frame = requireRewardFrame(state)
  if (frame.reward !== 'card' || !frame.allowSkip) {
    throw new RuleError('本次奖励不能跳过')
  }
  log(state, `${playerLabel(state, p)} 放弃了卡牌奖励`)
  frame.ask.shift()
}

/**
 * 升级 / 移除选定的那张牌。
 * 升级**就地改 kind**，uid 不变（牌数守恒与 uid 唯一性都不受影响）；
 * 移除把牌从所在牌区取出并 push 到 `players[p].removed`（仍计入守恒）。
 */
export function applyPickOwnCard(state: GameState, p: PlayerIndex, card: Card): void {
  const frame = requireRewardFrame(state)
  const pick = frame.pendingPick
  if (!pick || pick.player !== p) {
    throw new RuleError('当前没有待选牌的奖励')
  }
  const real = findOwnCard(state, p, card.uid)
  if (!real) throw new RuleError('这张牌不在你的牌组、手牌或弃牌堆中')

  if (pick.purpose === 'upgrade') {
    const from = real.kind
    const to = cardDoc(from).upgradeTo
    if (!to) throw new RuleError(`【${cardDoc(from).name}】没有可升级的版本`)
    real.kind = to
    log(state, `${playerLabel(state, p)} 将【${cardDoc(from).name}】升级为【${cardDoc(to).name}】`)
  } else {
    const taken = takeOwnCard(state, p, real.uid)
    if (!taken) throw new RuleError('这张牌不在你的牌组、手牌或弃牌堆中')
    state.players[p].removed.push(taken)
    log(state, `${playerLabel(state, p)} 移除了【${cardDoc(taken.kind).name}】`)
  }

  frame.pendingPick = undefined
  frame.ask.shift()
}
