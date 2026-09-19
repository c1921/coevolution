# 实施规格：体力 10 · 奖励三选一 · 新卡（供 AI 编程执行）

> 用途：把本文件当作**唯一任务书**执行，不要自由发挥数值与命名。
> 参数已冻结（§1）；范围与禁令见 §2 / §11；改完必须过 §10 的门禁命令。
> 项目约定见 `AGENTS.md`、`.agents/git.md`、`docs/dsl.md`、`README.md`。

---

## 0. 完成定义

- 「做完」= §3 的任务全部勾选 + §10 的门禁全绿 + README/`docs/dsl.md`/`schema.json` 同步。
- 每个阶段（P0~P3）独立可提交、可回滚；提交信息按 `.agents/git.md`（`type: 中文描述`，正文符号列表 ≤70 字/条），提交后 `git push origin main`。**未经人类确认不要提交**。

---

## 1. 冻结参数（不得自行更改）

| 参数 | 值 | 落点 |
|---|---|---|
| 物种体力上限 | `10`（四个代号统一） | `src/game/data/dsl/species/*.json` 的 `maxHp` |
| 卡牌数值缩放 | **不做**（打击 1 威胁 / 防御抵消 1 / 回复 1 / 急救 1 / 风暴 2 保持原值） | 不动 `rules/base.json` 与现有卡 |
| 手牌上限 | `min(当前体力, 6) + hand-limit 通道修正` | `src/game/rules/turn.ts` 的 `handLimit()`，新增常量 `HAND_LIMIT_MAX = 6` |
| 消耗战 | **不动**（21 回合起、每 5 回合 +1） | `data/dsl/rules/attrition.json` |
| 卡牌三选一节奏 | 全局回合数 `turn % 3 === 0` 时触发，**双方各选一次**（从回合角色起按座次） | 新规则文档 `rules/reward-card.json` |
| 服务三选一节奏 | `turn % 4 === 0` 时触发，**双方各选一次**，排在卡牌三选一之后 | 新规则文档 `rules/reward-service.json` |
| 服务选项 | 升级 / 移除 / 回复（回复 `3` 点体力，满血禁用；移除后「牌组+手牌+弃牌堆」不得 < `5` 张） | 同上 |
| 卡牌奖励 | 抽 **3** 张不重复；稀有度权重 common/uncommon/rare = `60/30/10`；**可跳过**；选中的牌**直接进手牌** | `rules/reward-card.json` + `rules/reward.ts` |
| 升级 / 移除选牌 | **自由选一张**，候选 = 自己的牌组 + 手牌 + 弃牌堆（不含移除区） | `rules/reward.ts` |
| 奖励触发位置 | 回合开始时（`refillEnergy` 之后、摸牌阶段之前） | 见 §5 的 `offer-reward` |

---

## 2. 范围

**做**：物种体力 10；手牌上限改为 `min(体力,6)`；10 张新卡 + 5 张基础牌升级版；奖励机制（卡牌三选一 + 升级/移除/回复三选一）的 DSL、引擎、AI、界面、测试、文档。

**不做**（不要顺手实现）：
- 状态/增益系统（力量 / 敏捷 / 易伤 / 虚弱 / 中毒 / 金属化）；
- 消耗区（exhaust）、遗物、金币、地图、局外进程；
- 数值缩放与消耗战调整（§1 冻结）；
- `gain-energy` 类新卡（现规则下回合开始已回满，且 `gainEnergy` 越上限会被不变式判错）。

---

## 3. 任务分解（按顺序执行，每项含完成判据）

**P0 数值与规则包**
- [ ] 四份物种 JSON 的 `maxHp` → 10
- [ ] `rules/turn.ts` 的 `handLimit()` → `Math.max(0, Math.min(hp, HAND_LIMIT_MAX) + channelBonus(state,'hand-limit',p))`；导出 `HAND_LIMIT_MAX`
- [ ] 全仓测试扫一遍写死的体力期望：`makeState` 从 `SPECIES[species].maxHp` 取最大值，因此 `hp).toBe(4)` 之类的断言（`rules/{strike,threat,useTarget,energy,turn}.test.ts`、`skills/{transform,active}.test.ts`、`dsl/{effect,channels,extensibility,value}.test.ts`、`stores/game.test.ts`，共 12 个文件）会集体变红，按语义改成 10（或改成引用 `maxHp`，不要再写死数字）
- [ ] `rules/turn.test.ts` 的手牌上限用例改为新口径（原 `handLimit = hp = 3` 的例子现在要按 `min(hp,6)` 算）
- 判据：`npm test` 全绿；`engine.test.ts` 的 200 局自对局全部终局

**P1 新卡与升级版（纯 JSON）**
- [ ] 10 张新卡文档（§4.2）+ 5 张升级版（§4.3）+ 基础牌加 `upgradeTo`
- [ ] `dsl/extensibility.test.ts` 加一条端到端用例：注入一张带 `upgradeTo` 的新牌 → 升级后 `kind` 变化、`uid` 不变、守恒成立
- [ ] AI 的 utility 策略与自伤门槛（§7）——**必须与 P1 同批**，否则新卡对 AI 是死牌
- 判据：新卡能被 AI 实际打出（在 `ai/index.test.ts` 断言至少两类新卡会被选用）

**P2 奖励机制**
- [ ] DSL：`offer-reward` 指令 + `CardDoc.rarity`/`upgradeTo`（§5）
- [ ] 引擎：`Prompt`/`Action`/`Frame` 扩展、`rules/reward.ts`、守恒改动态基准（§6）
- [ ] 两份奖励规则文档（§4.4）
- [ ] AI：`reward` 与 `pick-card` 两类待输入项（§7）
- [ ] 界面：`RewardOverlay.vue` + store 选择器/动作（§8）
- [ ] `UPDATE_DSL_SCHEMA=1 npx vitest run src/game/dsl/schema.test.ts` 重生成 `schema.json`
- [ ] 测试：`rules/reward.test.ts`、`rules/deckEdit.test.ts`、`ai/reward.test.ts`、`stores/reward.test.ts`；README 测试表补行
- 判据：`engine.test.ts` 的 200 局自对局在**带奖励**的情况下全部终局、守恒、同种子可复现

**P3 平衡重测与文档同步**
- [ ] 200 局自对局统计（口径同 `engine.test.ts`），对照 §10 门槛
- [ ] 若门槛不过：按 §10 的「第一顺位旋钮」调整（改 JSON 参数，不改结构）
- [ ] README 五处同步：卡牌表 / 对局流程 / 平衡观察 / 已知简化 / 可调旋钮
- [ ] `docs/dsl.md` 补新指令与卡牌新字段

---

## 4. 内容改动（JSON）

### 4.1 物种

`src/game/data/dsl/species/{offensive,counter,defensive,morph}.json`：`maxHp: 4 → 10`，其余不动。

### 4.2 新卡 10 张

**每张卡的固定样板**（`use[0]`，`context: "play"`）：`effects` 前两条固定为

```json
{ "kind": "move-cards", "from": { "zone": "hand", "of": "self" }, "to": { "zone": "discard", "of": "self" }, "pick": { "mode": "played" } },
{ "kind": "log", "template": "{self} 对 {target} 使用{usedAs}{self.energyTag}" }
```

（治疗/摸牌类把日志模板改成对应文案；攻击类可在 log 前加 `{ "kind": "record-card-use", "of": "self", "cardKind": "<id>" }`，与既有【打击】【风暴】一致，纯统计。）

> **易错点**：日志模板的占位符按「当前语境允许的角色」在加载期校验（`validate/effectNode.ts`）。**没有 `target` 的牌（`backflip` / `tactics` / `plunder` / `sprint`）不得在模板里写 `{target}`**，只用 `{self}` / `{usedAs}`（如 `"{self} 使用{usedAs}，摸 2 张牌{self.energyTag}"`），否则 `dsl/registry.ts` 导入即抛 `DslLoadError`。

**攻击牌的 `target` 统一写成与【打击】相同的一份**（`combo` / `iron-wave` / `bash` / `bludgeon` / `bloodrage` / `heavy-press`）：

```json
"target": { "scope": "opponent", "required": false, "alive": true, "range": true }
```

| id | 名 | 费用 | rarity | 效果节点（样板之后追加） | 备注 |
|---|---|---|---|---|---|
| `combo` | 连击 | 1 | common | `{"kind":"threat","target":"target","amount":{"kind":"const","value":2}}` | 攻击牌 target 见上 |
| `iron-wave` | 铁斩波 | 1 | common | `{"kind":"threat","target":"target","amount":{"kind":"const","value":1}}` + `{"kind":"offset-threat","target":"self","amount":{"kind":"const","value":1}}` | 攻防一体；AI 按 attack 用 |
| `backflip` | 后空翻 | 1 | common | `{"kind":"offset-threat","target":"self","amount":{"kind":"const","value":2}}` + `{"kind":"draw","target":"self","count":{"kind":"const","value":1}}` | 无 `target`；`requires`: `{"kind":"compare","op":"gte","left":{"kind":"ref","ref":"threat","of":"self"},"right":{"kind":"const","value":1},"reason":"你没有需要抵消的威胁"}` |
| `bash` | 痛击 | 2 | uncommon | `{"kind":"threat","target":"target","amount":{"kind":"const","value":3}}` | — |
| `bludgeon` | 重锤 | 3 | rare | `{"kind":"threat","target":"target","amount":{"kind":"const","value":5}}` | — |
| `bloodrage` | 血怒 | 1 | uncommon | `{"kind":"lose-hp","target":"self","amount":{"kind":"const","value":1}}` + `{"kind":"threat","target":"target","amount":{"kind":"const","value":3}}` | `lose-hp` 不是伤害、不触发【反击】 |
| `tactics` | 战术演习 | 1 | common | `{"kind":"draw","target":"self","count":{"kind":"const","value":2}}` | 无 `target`；utility，见 §7 |
| `plunder` | 掠夺 | 1 | uncommon | `{"kind":"move-cards","from":{"zone":"hand","of":"opponent"},"to":{"zone":"discard","of":"opponent"},"pick":{"mode":"random","count":1}}` | 无 `target`；`requires`: `{"kind":"has-cards","of":"opponent","zone":"hand","atLeast":{"kind":"const","value":1},"reason":"对手没有手牌"}` |
| `heavy-press` | 重压 | 2 | uncommon | `{"kind":"threat","target":"target","amount":{"kind":"clamp","of":{"kind":"floor-div","of":{"kind":"ref","ref":"handCount","of":"self"},"by":{"kind":"const","value":2}},"min":1,"max":4}}` | 与 `min(体力,6)` 手牌上限协同 |
| `sprint` | 疾跑 | 1 | uncommon | `{"kind":"extra-phase","phase":"draw","position":"next"}` | 无 `target`；本回合额外一次摸牌阶段 |

可选补两张（同样零引擎改动）：`bulwark` 铁壁（2 费，uncommon，`offset-threat` self 3）、`mend` 圣疗（2 费，common，`heal` self 2）。

### 4.3 升级版与 `upgradeTo`

- 5 张升级版各自是**独立牌种文档**：`cards/strike-plus.json`（名「打击+」）、`defend-plus`、`heal-plus`、`first-aid-plus`、`storm-plus`；`id` 用 ASCII（`-plus` 后缀），`name` 用 `+`。
- 数值：打击+ 威胁 = `{"kind":"add","of":[{"kind":"channel","channel":"threat-per-attack","of":"self"},{"kind":"const","value":1}]}`（**保留通道语义**，不要写死 2）；防御+ 抵消 2；回复+ 回复 2；急救+ 回复 2；风暴+ 对称威胁 3。
- 基础牌文档加 `"upgradeTo": "<升级版 id>"`；升级版**不再**声明 `upgradeTo`（禁止链式升级）。
- 升级版**不写 `rarity`**（因此天然不进奖励池，见 §5）。

### 4.4 奖励规则文档

`src/game/data/dsl/rules/reward-card.json`：

```json
{
  "$schema": "../schema.json", "dslVersion": 1, "kind": "rule", "id": "reward-card", "priority": 30,
  "on": { "at": "turn-start" },
  "when": [{
    "kind": "compare", "op": "eq",
    "left": { "kind": "mul", "of": [
      { "kind": "floor-div", "of": { "kind": "ref", "ref": "turn" }, "by": { "kind": "const", "value": 3 } },
      { "kind": "const", "value": 3 }] },
    "right": { "kind": "ref", "ref": "turn" }
  }],
  "effects": [{ "kind": "offer-reward", "reward": "card", "candidates": 3, "allowSkip": true,
                "weights": { "common": 60, "uncommon": 30, "rare": 10 } }]
}
```

`rules/reward-service.json`：同结构，`priority: 20`、周期 `4`、`effects` 为
`{ "kind": "offer-reward", "reward": "service", "healAmount": 3, "removeFloor": 5 }`。

> **易错点（务必注意）**：同一时机上的规则文档按 `priority` 升序执行，而每个 `offer-reward` 只是**压帧**、不立即询问；`advance()` 从栈顶结算，因此**后压的帧先弹**。要让「卡牌三选一先于服务三选一」，服务规则必须**先执行**（`priority` 更小）。同时两者都排在消耗战（`priority: 10`）之后，所以消耗战先扣血、扣死了就不再发奖励。
> 必须有测试断言：`turn = 12` 时先弹卡牌三选一、再弹服务三选一（`rules/reward.test.ts`）。

---

## 5. DSL 扩展（逐文件，字段名照抄）

1. `dsl/kinds.ts`：`EFFECT_KINDS` 追加 `'offer-reward'`；新增 `REWARD_KINDS = ['card','service']` 与 `RARITIES = ['common','uncommon','rare']`（`as const`，禁止 enum）。
2. `dsl/types.ts`：
   - `Effect` 联合追加：
     ```ts
     | { kind: 'offer-reward'; reward: 'card' | 'service'; candidates?: number; allowSkip?: boolean
         weights?: { common: number; uncommon: number; rare: number }
         healAmount?: Value; removeFloor?: number }
     ```
   - `CardDoc` 追加 `rarity?: 'common'|'uncommon'|'rare'; upgradeTo?: string`。
3. `dsl/fieldSpecs.ts`：
   - `EFFECT_SPECS['offer-reward'] = { reward: { t:'enum', values: REWARD_KINDS }, candidates: INTEGER, allowSkip: BOOLEAN, weights: { t:'map', of: INTEGER, keys: RARITIES }, healAmount: VALUE, removeFloor: INTEGER }`，`required: ['reward']`；
   - `card` 节点加 `rarity: { t:'enum', values: RARITIES }` 与 `upgradeTo: STRING`。
   - **漏改会在文件末尾的编译期断言 `_EffectKindsMatchIr` / `_EffectSpecsMatchIr` 报错。**
4. `dsl/effect.ts`：`case 'offer-reward'` → 调用 `dsl/primitives.ts` 的新原语 `pushRewardFrame(state, env, effect)`（照抄 `pushContestFrame` 的形状：读参数 → `state.stack.push({ kind:'reward', ... })`）。`never` 穷尽检查会强制你补 case。
5. `dsl/validate/effectNode.ts`：组合校验——`reward:'card'` 才允许 `candidates/allowSkip/weights`；`reward:'service'` 才允许 `healAmount/removeFloor`；冲突报 `bad-combination`（带 JSON 路径）。`dsl/validate/docs.ts`：`rarity` 枚举、`upgradeTo` 必须指向存在的 card、目标不得再声明 `upgradeTo`（禁链、禁自指）。
6. `data/dsl/schema.json`：`UPDATE_DSL_SCHEMA=1 npx vitest run src/game/dsl/schema.test.ts` 重生成，**不要手改**（`schema.test.ts` 逐字节比对）。
7. `docs/dsl.md`：补 `offer-reward` 节点、`rarity` / `upgradeTo` 字段、语义与扩展示例。

奖励池定义（写在 `rules/reward.ts`，**不要写死牌种 id**）：候选池 = 所有 `rarity` ∈ {common,uncommon,rare} 的牌种；未声明 `rarity` 或声明为升级版的牌一律不入池。

---

## 6. 引擎与规则改动

### 6.1 类型（`src/game/types.ts`）

```ts
interface PlayerState { /* … */ removed: Card[] }          // 移除区：不参与摸牌，计入守恒
interface GameState { /* … */ nextUid: number; cardTotal: number }
type RewardKind = 'card' | 'service'
type Prompt = … 
  | { kind: 'reward'; player: PlayerIndex; reward: RewardKind; cards?: CardKind[]; allowSkip: boolean }
  | { kind: 'pick-card'; player: PlayerIndex; purpose: 'upgrade' | 'remove'; candidates: Card[] }
type Action = …
  | { kind: 'pick-reward'; card?: CardKind; service?: 'upgrade' | 'remove' | 'heal' }  // card 奖励给 card，service 奖励给 service
  | { kind: 'skip-reward' }
  | { kind: 'pick-own-card'; card: Card }
type Frame = … | { kind: 'reward'; ask: PlayerIndex[]; reward: RewardKind; cards?: CardKind[]; allowSkip: boolean; healAmount: number; removeFloor: number; pendingPick?: { player: PlayerIndex; purpose: 'upgrade' | 'remove' } }
```

`Prompt`/`Action`/`Frame` 的新变体会让所有 `switch`（`stores/selectors.ts` 的 `pendingHint`、`ai/index.ts`、`engine/actions.ts`、`engine/stack.ts`）编译报错——逐个补齐，不要用 `default` 掩盖。

### 6.2 `rules/reward.ts`（新文件）

导出**纯逻辑**：`rollRewardCards(state): CardKind[]`（按权重不重复抽 3，走 `nextInt(state.rngState, n)`；`rng.ts` 现成）、`upgradeCandidates(state, p)`、`removeCandidates(state, p)`（都按 `uid` 升序）、`applyPickReward`、`applySkipReward`、`applyPickOwnCard`。

帧的**压入原语** `pushRewardFrame(state, env, effect)` 放在 `dsl/primitives.ts`（它本来就 import `rules/*`，方向正确；反过来让 `rules/reward.ts` import `dsl/primitives.ts` 会违反零环守卫），内部调用 `rollRewardCards` 组好 `cards` 候选再 `state.stack.push`。

要点：
- 新牌 `{ uid: state.nextUid++, kind }` 进 `hand`，并 `state.cardTotal += 1`；
- 升级：把目标牌的 `kind` 改成 `cardDoc(kind).upgradeTo`，**`uid` 不变**（就地改对象即可）；
- 移除：从所在牌区（deck/hand/discard）取出，push 到 `players[p].removed`；
- 战报：每个动作 `log()` 一行（如「对手升级了【打击】」），玩家必须能看见对手的奖励结果；
- 帧的推进在 `engine/stack.ts` 的 `stepFrame` 加 `case 'reward'`，**照抄濒死帧 `case 'dying'` 的写法**：
  1. 帧上存 `pendingPick?: { player: PlayerIndex; purpose: 'upgrade' | 'remove' }`；
  2. `pendingPick` 存在 → 出 `pick-card` prompt（`candidates` 由 `upgradeCandidates`/`removeCandidates` 现算，按 `uid` 升序）；
  3. 否则 `ask[0]` 存在 → 出 `reward` prompt（卡牌奖励带 `cards` 候选，服务奖励带可用性）；
  4. `ask` 为空且无 `pendingPick` → 弹栈。
  服务奖励选定「升级 / 移除」时设置 `pendingPick`（**不要**动 `ask` 队列顺序），选定「回复」或卡牌奖励选定/跳过后 `ask.shift()`。

### 6.3 其他规则文件

| 文件 | 改动 |
|---|---|
| `rules/cardZones.ts` | `allCards()` 追加双方的 `removed`；`assertConservation()` 的期望值改为 `state.cardTotal`（初始 = `totalDeckSize(a,b)`）；`data/deck.ts` 的 `totalDeckSize` 只用于初始化 |
| `rules/turn.ts` | `handLimit()` 见 §1；回合开始时奖励由规则文档驱动，**不要**在这里写死 3/4 |
| `rules/legality.ts` | `checkPickReward`（必须 `pending.kind==='reward'` 且是自己的待输入项；`card` 必须在本次候选内；`service` 必须可用、且 `skip` 只允许 card 奖励）、`checkPickOwnCard`（牌必须在自己牌组/手牌/弃牌堆；`upgrade` 需目标有 `upgradeTo`；`remove` 需移除后总数 ≥ `removeFloor`） |
| `engine/actions.ts` | 三个新 applier，形状照抄现有：`ensure(check…)` → 应用 → 不动回合循环（奖励在回合开始时，流程会自动继续） |
| `engine/setup.ts` | 初始化 `players[*].removed = []`、`nextUid = 双方牌组张数之和`、`cardTotal = 同上` |
| `testUtils.ts` | `makeState` 同步补这三个字段（否则所有单测构造的状态不合法） |

---

## 7. AI（`src/game/ai/index.ts`，不得引用任何内容 id）

1. `aiDecide` 补 `case 'reward'` / `case 'pick-card'`：
   - 卡牌三选一评分 = 文档结构派生：`threat` 值/费用、`heal` 值/费用、`draw` 张数、`offset-threat` 值/费用加权求和（utility 给低基础分）；取最高分，跳过阈值以下。
   - 服务三选一：体力 < 50% → `heal`；牌组（deck+hand+discard）> 26 张或攻击牌占比过低 → `remove`（用 `worstCards()` 的优先级挑最弱一张）；否则 → `upgrade`（优先 `cardRole==='attack'` 的未升级牌）。
   - `pick-card`：从候选里按同一套评分挑最高分。
2. `decidePlay` 补 **utility 分支**（当前 `cardRole` 把抽牌/额外阶段/干扰类都归为 `utility`，AI 完全不会用）：
   - 含 `draw` 且手牌 ≤ 3 → 使用；
   - 含 `move-cards` 且 `from.of === 'opponent'`（弃对手手牌）且对手手牌 ≥ 3 → 使用；
   - 含 `extra-phase` 且能量 ≥ 1 → 使用。
   实现方式沿用 `effectsInclude`（`dsl/effects.ts`）判定结构，**不要**写牌种 id。
3. `selfHarmWorthwhile()`：把门槛从「自伤量」改为「收益 − 自伤」比较（否则【血怒】类自伤牌几乎不会被使用）；新阈值常量集中在文件顶部。
4. 目标选择：已有 `chooseCardTargets` 会按文档结构处理 `threat`（选对手）与 `offset-threat`/`heal`/`draw`（选自己），新卡不需要额外分支；只有 `plunder`（`from.of: opponent`）需要 utility 分支的候选判断。

---

## 8. 界面

- 新增 `components/RewardOverlay.vue`（全屏 `z-30` 覆盖层，结构照抄 `PromptOverlay.vue` 的目标选择器）：
  - `humanPending.kind === 'reward'` 时渲染三选一（卡牌奖励显示牌名/费用/稀有度/效果 + 「跳过」；服务奖励显示升级/移除/回复 + 禁用原因）；
  - `humanPending.kind === 'pick-card'` 时渲染自己的牌列表（按 `uid` 排序，显示所在牌区与升级预览），点击提交。
  - **只依赖 `humanPending.kind`，不要判断 `state.phase`**：奖励发生在「回合开始时」，且非回合角色也会被询问。
- `stores/state.ts`：新增 `rewardSelection = ref<...>(null)`（服务奖励的中间选择态）。
- `stores/selectors.ts`：新增 `rewardOptions` / `pickCardOptions` / 文案；`pendingHint` 的 `switch` 补两个 case（`assertNever` 会提醒）。
- `stores/actions.ts`：`submitRewardCard(kind)` / `submitRewardService(kind)` / `submitSkipReward()` / `submitPickOwnCard(card)`；沿用 `act()`（它负责清空选择态、捕获 `RuleError`、`pump()`）。
- `components/GameBoard.vue`：挂载 `<RewardOverlay />`（与 `PromptOverlay` 并列）。
- 项目约定：组件只做渲染，派生逻辑一律放在 `selectors.ts`。

---

## 9. 测试与机械守卫

**新增**：`rules/reward.test.ts`（节奏：`turn=3/4/6/12` 的触发与顺序；抽 3 张不重复且确定；跳过；服务三项；边界：无可升级牌 / 牌太少 / 满血）、`rules/deckEdit.test.ts`（升级保 `uid`、移除进 `removed` 且守恒、洗回牌组仍正确、移除下限）、`ai/reward.test.ts`（AI 三类决策与 utility 策略，且不引用牌 id）、`stores/reward.test.ts`（人类侧三选一 → 提交 → 状态推进；非法选择报文档 reason）。

**必改**：`engine.test.ts`（200 局带奖励仍终局且守恒，确定性复现）、`rules/turn.test.ts`（手牌上限新口径 + P0 的体力期望）、P0 列出的 12 个写死体力期望的测试文件、`testUtils.ts` 的 `makeState`（补 `removed` / `nextUid` / `cardTotal`）、`dsl/{kinds,validate,schema,extensibility}.test.ts`（新指令/新字段/新端到端用例）、`components/render.test.ts`（奖励覆盖层冒烟）。（`data/deck.test.ts` 的「20 张 / 合计 40」仍然成立，不必改。）

**机械守卫（漏了必红）**：
- `dsl/guards.test.ts`：README「测试覆盖」表必须列出每个新 `*.test.ts`；应用代码零内容 id（奖励逻辑不得出现 `'strike'` 之类字面量）；运行时依赖图零环——`rules/reward.ts` 只 import `dsl/registry` / `rules/cardZones` / `rng` / `log` / `types` / `util`，**不得 import `dsl/effect`、`dsl/primitives` 或 `engine/*`**（帧的压入放在 `dsl/primitives.ts`，方向是 dsl → rules，与 `rules/dying.ts` 直接 `state.stack.push` 的做法一致）。
- `dsl/schema.test.ts`：`schema.json` 必须重新生成且逐字节一致。
- `dsl/registry.test.ts` / `kinds.test.ts`：注册表顺序与词表一致性。

---

## 10. 门禁与验收

**每次提交前**：`npm test`、`npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run build` 全绿（CI 同款）。

**P3 平衡门槛**（200 局 AI 自对局，口径同 `engine.test.ts`；不足则按「第一顺位旋钮」调，均为 JSON 改动）：

| 指标 | 门槛 | 第一顺位旋钮 |
|---|---|---|
| 中位局长 | 16 ~ 22 回合 | > 22 → 消耗战提前到 15 回合起 / 每 4 回合 +1；仍不达标 → 申请恢复数值 ×2 |
| 消耗战收尾比例 | ≤ 40% | 同上 |
| 先手胜率 | 45% ~ 58% | 先手不再少摸（第一回合摸 2 张）、后手第一回合摸 3 张（现为 1 / 2 张，改 `rules/turn.ts` 的 `FIRST_TURN_DRAW` 语义） |
| 代号胜场差 | 最多 / 最少 ≤ 2 倍 | 调 `data/dsl/skills/*.json` 数值 |
| 硬不变式 | 200 局全部终局 + 牌数守恒（含加牌/移除）+ 能量/威胁边界 + 同种子逐行复现 | 不许放宽断言 |

**对照基线**（改动前的实测值，用于判断是否退化）：中位 15 回合、先手 56%、代号胜场 反击 81 / 进攻 57 / 防御 37 / 转化 25；只改体力不改别的会变成中位 24 回合、68% 由消耗战收尾——若 P3 结果接近后者，说明新卡与奖励没能补上节奏。

---

## 11. 硬约束（违反即返工）

1. **内容与代码分离**：新增牌/技能/数值一律加 JSON；引擎、legality、AI、界面不得出现牌种/技能 id（`dsl/guards.test.ts` 守卫）。
2. **禁止 `enum`**（`tsconfig` 开了 `erasableSyntaxOnly`），一律 `as const` 元组 + 字符串字面量联合。
3. **单一事实来源**：字段表只写在 `dsl/fieldSpecs.ts`；`schema.json` 只由生成器产出；`docs/dsl.md` 与 `README.md` 必须同步。
4. **确定性**：任何随机都必须走 `state.rngState`（`rng.ts`），不得用 `Math.random()`。
5. **不变式**：任何新机制都要让 `assertConservation` / `assertEnergyBounds` / `assertThreatBounds` 在每次 `submit` 后成立；不许放宽或跳过断言。
6. **非法动作不改状态**：新动作一律「先 `ensure(check…)` 再改状态」，错误信息用文档里的 `reason`。
7. **UI 不写逻辑**：派生放 `stores/selectors.ts`，组件只 `v-for`/`v-if`。
8. **不要动**：`data/dsl/schema.json` 手改、`docs/` 与 `README.md` 的 Prettier 格式（已在 `.prettierignore`）、`package-lock.json`。

---

## 12. 提交切分（建议粒度）

| 提交 | 内容 | 类型 |
|---|---|---|
| 1 | 物种体力 10 + 手牌上限 `min(体力,6)` + 相关测试期望 | `feat` |
| 2 | 10 张新卡 + 5 张升级版 + `upgradeTo`（纯 JSON）+ AI utility/自伤门槛 | `feat` |
| 3 | `offer-reward` DSL + 卡牌新字段 + 校验 + schema + `docs/dsl.md` | `feat` |
| 4 | 奖励机制引擎/规则/prompt/action/守恒改造 + 测试 | `feat` |
| 5 | 奖励界面（overlay + store） | `feat` |
| 6 | AI 奖励决策 + 测试 | `feat` |
| 7 | 平衡重测后的参数与 README 同步 | `docs` |

提交信息按 `.agents/git.md`：`<type>: <中文描述 ≤100 字>`，空行后符号列表（每条 ≤70 字）；提交后立即 `GIT_TERMINAL_PROMPT=0 git push origin main`，并用 `git status -sb` 确认无 ahead/behind。
