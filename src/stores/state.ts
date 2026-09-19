import { ref } from 'vue'
import type { Card, CardKind, GameState, PlayerIndex, SkillId, SpeciesId } from '../game/types'

/**
 * 界面状态层：**只有可变的响应式源**，没有任何派生与逻辑。
 *
 * 这是 `stores/` 目录的叶子模块，其余模块都从这里读/写状态：
 *  - `selectors.ts` 只读（派生视图）
 *  - `actions.ts` 读写（提交引擎动作）
 *  - `aiDriver.ts` 读写（驱动 AI）
 *  - `selection.ts` 读写（手牌与目标选择态）
 *  - `session.ts` 读写（抽将 / 开局 / 回首页）
 *
 * 之所以把 ref 单独摆在最底层：`actions.ts` 需要"提交后清空选择态"，
 * 而 `selection.ts` 又需要调用 `actions.ts` 的 `act()`。ref 下沉到本模块后
 * 两边都只依赖叶子，依赖图保持无环（`game/dsl/guards.test.ts` 守卫零环）。
 *
 * 注意：状态层**不引入 Pinia**，仍是模块级单例。组件与测试直接 import 这些 ref
 * （测试还会写 `gameState.value = ...`），工厂化会是一次独立的、破坏性更大的改动。
 */

export type Screen = 'start' | 'draft' | 'battle'

/** 玩家固定为下标 0（先手），AI 为下标 1 */
export const HUMAN: PlayerIndex = 0
export const AI_PLAYER: PlayerIndex = 1

export const screen = ref<Screen>('start')
export const draftOptions = ref<SpeciesId[]>([])
/** 引擎状态用 reactive 包裹：引擎就地修改它，界面自动刷新 */
export const gameState = ref<GameState | null>(null)
export const selected = ref<number[]>([])
export const errorMessage = ref<string | null>(null)

/** 正在为哪个主动技或哪张牌选择目标；null 表示不在目标选择态 */
export type PendingTarget =
  | { kind: 'skill'; skill: SkillId; cards?: Card[] }
  | { kind: 'card'; card: Card; as: CardKind; via?: SkillId }

export const pendingTarget = ref<PendingTarget | null>(null)
/** 多选时已勾选的目标（单选点一下即提交，不留状态） */
export const chosenTargets = ref<PlayerIndex[]>([])
