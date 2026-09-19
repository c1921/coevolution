/**
 * 界面状态层的**统一入口**（barrel）。
 *
 * 组件与测试一律从这里 import（`import { ... } from '../stores/game'`），
 * 因此下面这次拆分对调用方是零改动：路径没变、名字没变、`gameState` /
 * `screen` 等 ref 仍是同一批对象（`export *` 转发的是绑定，不是快照，
 * 测试写 `gameState.value = ...` 照旧生效）。
 *
 * 依赖方向（`game/dsl/guards.test.ts` 守卫零环）：
 *
 *     state.ts   ← 只有 ref，叶子
 *     selectors.ts  → state            （只读派生）
 *     actions.ts    → state, selectors, aiDriver
 *     aiDriver.ts   → state
 *     selection.ts  → state, selectors, actions
 *     session.ts    → state, aiDriver
 *
 * 各模块的职责见其文件头注释。**新增模块时不要在子模块之间互相 import 成环**：
 * 需要共享的可变状态下沉到 `state.ts`。
 */

export * from './state'
export * from './selectors'
export * from './actions'
export * from './aiDriver'
export * from './selection'
export * from './session'
