# 内容 DSL 参考

本文档描述「协同进化」规则引擎引入的 JSON 内容 DSL：游戏内容（技能、卡牌、时机规则、代号、牌组、规则常量）以 JSON 写在 `src/game/data/dsl/**`，由 `src/game/dsl/**` 的解释层读取与结算。

适用版本：`DSL_VERSION = 1`（`src/game/dsl/kinds.ts`）。每份文档的 `dslVersion` 必须等于它。

- 词表（所有判别式 `kind` 的唯一事实来源）：`src/game/dsl/kinds.ts`
- IR 类型：`src/game/dsl/types.ts`
- 字段表（唯一事实来源）：`src/game/dsl/fieldSpecs.ts`
- 加载期校验器：`src/game/dsl/validate/`（`index.ts` 是入口与公开导出）
- 注册表与查询：`src/game/dsl/registry.ts`
- 运行时上下文与角色解析：`src/game/dsl/runtime.ts`
- 求值：`src/game/dsl/value.ts`（数值 + 通道聚合）、`condition.ts`、`target.ts`
- 日志渲染：`src/game/dsl/template.ts`
- JSON Schema 生成：`src/game/dsl/schema.ts`（产物 `src/game/data/dsl/schema.json`）

---

## 1. 定位与边界

DSL 只承载**内容**，不承载**结算机器**。判断一段逻辑该不该进 DSL，用这条线：它是「某个技能/卡牌做了什么」，还是「引擎如何推进与保证不变式」。

### 属于数据（写进 `src/game/data/dsl/**`）

| 内容 | 文档种类 | 例子 |
|---|---|---|
| 代号：体力上限、技能表、牌组 | `species` | `species/defensive.json` |
| 技能：常驻修正、牌面转化、触发、主动技 | `skill` | `skills/charge.json`、`skills/assault.json` |
| 卡牌：费用、`use` / `play` 变体与效果、`rarity` / `upgradeTo` | `card` | `cards/strike.json`、`cards/bludgeon.json`（奖励池）、`cards/strike-plus.json`（升级版） |
| 注册在时点上的非技能效果（含奖励节奏） | `rule` | `rules/attrition.json`（消耗战）、`rules/reward-card.json` / `rules/reward-service.json`（奖励三选一） |
| 牌组：牌种与张数 | `deck` | `decks/basic.json` |
| 七个修正通道的基准值 | `ruleset` | `rules/base.json` |

### 仍属于引擎机械（不进 DSL）

| 机械 | 位置 |
|---|---|
| 阶段游标与剩余阶段队列 `phase` / `phaseStage` / `phaseQueue` | `src/game/rules/phase.ts` |
| 结算帧栈 `state.stack` 与待输入项 `state.pending`（`Frame` / `Prompt`） | `src/game/engine/`（`stack.ts` 推动、`actions.ts` 应用）、`src/game/types.ts` |
| 濒死帧 → 死亡结算（救援已禁用，不再逐个询问） | `src/game/rules/dying.ts`、`src/game/rules/death.ts` |
| 手牌上限（`hand-limit` 通道，基准 0；上限 0 时弃牌阶段自动弃光手牌） | `src/game/rules/turn.ts` 的 `handLimit` / `rules/discard.ts` |
| 牌数守恒不变式 | `src/game/rules/cardZones.ts` 的 `assertConservation` |
| 能量不变式（`0..上限`） | `src/game/rules/energy.ts` 的 `assertEnergyBounds` |
| 随机数（种子化 PRNG、洗牌、随机取牌） | `src/game/rng.ts` |
| 距离 / 攻击范围 | `src/game/rules/distance.ts` |

效果指令只描述「发生什么」，帧栈、`pending`、濒死与收尾仍由引擎决定「何时发生、按什么顺序恢复」。

---

## 2. 加载、校验与顺序

### 2.1 静态打包，导入即校验

`registry.ts` 在模块顶层用 Vite 的 glob 静态导入全部内容文档：

```ts
const RAW_DOCS = import.meta.glob('../data/dsl/*/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>
```

因此：

- 内容在构建时被打包，**没有运行时热更新**（改 JSON 需重新构建/刷新）。
- 目录约定为固定两层：`data/dsl/<目录>/<文件>.json`（glob 是 `*/*.json`）。新增内容 = 新增一个 JSON 文件。
- 导入 `registry.ts` 即触发校验：`loadBuiltin()` → `createRegistry()` → `validateDocs()`。任何非法文档都会抛 `DslLoadError`。

`DslLoadError` 的 `message` 逐条列出全部问题（JSON 路径 + 错误码 + 说明），`issues` 字段保留结构化列表：

```
DSL 文档校验失败（2 项）：
  species/offensive.json#/skills/0 [unknown-ref] 引用了不存在的技能 nope
  /ghost [dead-doc] 技能 ghost 没有被任何代号引用
```

校验契约（见 `validate/index.ts` 顶注）：只要 `issues` 非空，调用方必须抛错，绝不能使用返回的 `docs`——结构校验不通过时这些对象不具备 IR 的字段保证。

### 2.2 顺序即结算顺序

所有文档按 `(priority ?? 100, id)` 升序（`registry.ts` 的 `order`），代号的技能表用同一规则排序：

```ts
function order<T extends { id: string; priority?: number }>(docs: T[]): T[] {
  return [...docs].sort(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id),
  )
}
```

`priority` 缺省为 `100`；同优先级按 `id` 字典序。修正聚合、触发收集、主动技枚举都依赖这个确定性顺序。

### 2.3 代号顺序与固定种子抽将

代号在注册表里的顺序由 `priority` 决定（`registry.test.ts` 断言 `speciesIds()`），因此依赖代号顺序的抽将（`rollDraft`）在固定种子下结果由这个顺序决定——调整顺序会改变既有种子的抽将结果。当前是 4 个功能代号：

| priority | 10 | 20 | 30 | 40 |
|---|---|---|---|---|
| 代号 | `offensive`（进攻型） | `counter`（反击型） | `defensive`（防御型） | `morph`（转化型） |

`rollDraft(seed)` 返回 `{ playerOptions, rngState }`：从 4 个代号里抽 3 个作为玩家的候选（没有 `aiOptions`）。AI 的候选池在 `createGame` 里才确定——「除玩家所选之外的全部代号」——再由 AI 从中随机选 1 个。

### 2.4 引用完整性与约束（第二遍解析）

`resolveRefs` 在结构校验之后统一解析：

- 技能 ↔ 代号（`species.skills`）、牌组 ↔ 牌种（`deck.cards[].kind`）、代号 ↔ 牌组（`species.deck`）、技能/效果里的 `skill` / `cardKind` / `expectedCard` / `from` / `to` / `respondsTo` 等引用。
- 卡牌的 `upgradeTo` 也必须指向存在的牌种；指向自己报 `bad-combination`，指向一个**自身也声明了 `upgradeTo`** 的牌同样报 `bad-combination`（禁链式升级）。
- `ruleset` 必须**恰好一份**。
- 死文档（`dead-doc`）：技能未被任何代号引用、牌组未被任何代号引用都会报错；**牌种只要有 `rarity`（在奖励池里）就不算死文档**，否则必须被某个牌组引用。

---

## 3. 文档种类与字段

### 3.1 公共信封（`DocBase`）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `$schema` | 否 | `string` | 内容文档统一为 `"../schema.json"`（`schema.test.ts` 断言） |
| `dslVersion` | 是 | `1` | 必须等于 `DSL_VERSION` |
| `kind` | 是 | `DocKind` | `species` / `skill` / `card` / `ruleset` / `deck` / `rule` |
| `id` | 是 | 非空字符串 | 全局唯一 |
| `priority` | 否 | 非负整数 | 缺省 `100`；决定结算/注册顺序 |

### 3.2 `species` — 代号

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` | 是 | 非空字符串 | 代号名（如「进攻型」） |
| `maxHp` | 是 | ≥ 1 整数 | 体力上限 |
| `skills` | 是 | `string[]` | 技能 id 列表；空数组合法 |
| `deck` | 是 | `string` | 牌组 id |

代号文档只描述规则数据，没有界面外观字段；界面/战报标签直接用 `name`。

`species/defensive.json`：

```json
{
  "$schema": "../schema.json",
  "dslVersion": 1,
  "kind": "species",
  "id": "defensive",
  "priority": 30,
  "name": "防御型",
  "maxHp": 4,
  "skills": ["charge"],
  "deck": "guarded"
}
```

内置的 4 个代号都是 `maxHp` 4，各带一个技能：`offensive` → `assault`（`deck: aggressive`）、`counter` → `riposte`（`deck: basic`）、`defensive` → `charge`（`deck: guarded`）、`morph` → `convert`（`deck: aggressive`）。

### 3.3 `skill` — 技能

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` / `text` | 是 | 非空字符串 | 技能名与描述 |
| `modifiers` | 否 | `Modifier[]` | 常驻通道修正（如蓄能） |
| `transforms` | 否 | `Transform[]` | 牌面转化（如转换） |
| `trigger` | 否 | `TriggerSpec` | 触发型（如反击） |
| `activate` | 否 | `ActivateSpec` | 主动技（如强袭） |

技能必须至少声明 `modifiers` / `transforms` / `trigger` / `activate` 之一（`bad-combination`）。技能分类（`SKILL_KINDS` 的 `transform` / `modifier` / `trigger` / `active`）由文档结构派生，不单独存储。

`skills/charge.json`（常驻修正）：

```json
{
  "$schema": "../schema.json",
  "dslVersion": 1,
  "kind": "skill",
  "id": "charge",
  "priority": 20,
  "name": "蓄能",
  "text": "你每回合的能量上限 +2。",
  "modifiers": [
    { "channel": "energy-max", "op": "add", "value": { "kind": "const", "value": 2 } }
  ]
}
```

`skills/convert.json`（转化，`contexts` ∈ `use` / `play`）：

```json
"transforms": [
  { "from": "defend", "to": "strike", "contexts": ["use"] },
  { "from": "strike", "to": "defend", "contexts": ["use"] }
]
```

`TRANSFORM_CONTEXTS` 仍含 `play`，但内置内容没有任何卡牌声明 `play` 变体，因此当前只有 `use` 语境的转化是活的（见 8.1）。

`skills/assault.json`（主动技，字段见 `ActivateSpec`）：

```json
"activate": {
  "timing": "play",
  "oncePerTurn": true,
  "costCards": { "count": { "kind": "const", "value": 1 } },
  "target": { "scope": "opponent", "required": false, "alive": true },
  "effects": [ ... ],
  "ui": { "buttonLabel": "发动【强袭】（先点选一张手牌）" }
}
```

| `activate` 字段 | 必填 | 说明 |
|---|---|---|
| `timing` | 是 | 目前只允许 `"play"` |
| `oncePerTurn` | 否 | 布尔；`true` 时记入本回合技能使用记录 |
| `costCards` | 否 | `{ count: Value, cardKind?: string }`，需先弃置的手牌 |
| `requires` | 否 | 发动条件（非空数组） |
| `target` | 否 | `TargetSpec` |
| `effects` / `after` | `effects` 必填 | 立即效果 / 延迟效果（见第 7 节） |
| `ui` | 否 | 目前只有 `buttonLabel` |

### 3.4 `card` — 卡牌

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` / `short` / `text` | 是 | 非空字符串 | 牌名、短描述、卡面文案 |
| `cost` | 是 | `Value` | 费用；当它是 `const` 时必须 ≥ 1 |
| `use` | 否 | `UseVariant[]` | 使用变体（`play` / `dying`，同语境不可重复） |
| `play` | 否 | `PlayVariant` | 响应变体（`respondsTo`）；**占位，当前无内容使用** |
| `rarity` | 否 | `common` / `uncommon` / `rare` | 稀有度；**声明了才进奖励池**（基础牌与升级版都不声明） |
| `upgradeTo` | 否 | 牌种 id | 升级后的牌种；升级奖励把目标牌的 `kind` 就地改成它（`uid` 不变）。升级版不得再声明（禁链式升级），也不能自指 |

卡牌至少需要 `use` 或 `play` 之一。费用下限由 `cost-below-minimum` 强制：0 费 + 无次数限制的【打击】会形成无限连击。

`cards/strike.json`（节选）：

```json
"cost": { "kind": "const", "value": 1 },
"use": [
  {
    "context": "play",
    "target": { "scope": "opponent", "required": false, "alive": true, "range": true },
    "effects": [ ... ]
  }
]
```

`UseVariant`：`context`（`play` / `dying`）、`target?`、`requires?`、`effects`、`after?`。
`PlayVariant`：`respondsTo`（它响应哪种牌开启的对抗）、`requires?`、`effects`。**这是对抗机制的占位**：内置内容里没有任何卡牌声明 `play` 变体，`respondsTo` 字段当前无内容使用，因此不要把它当成活的防御机制。

**卡牌的目标是「使用时选择」的**：`use.target` 与主动技的 `target` 规格完全同源（第 9 节），
候选不唯一或声明了 `required` 时界面会弹目标选择器，提交走 `Action.use-card.targets`。
`count`（多目标）只允许出现在卡牌的 `use` 变体上——主动技的 `target` 带 `count` 会被 `bad-combination` 拒绝。

`cards/defend.json`（节选，**自己回合抵消威胁**的 `use` 变体）：

```json
"use": [
  {
    "context": "play",
    "target": { "scope": "self", "required": false, "alive": true },
    "requires": [
      {
        "kind": "compare",
        "op": "gte",
        "left": { "kind": "ref", "ref": "threat", "of": "self" },
        "right": { "kind": "const", "value": 1 },
        "reason": "你没有需要抵消的威胁"
      }
    ],
    "effects": [
      { "kind": "move-cards", "from": { "zone": "hand", "of": "self" }, "to": { "zone": "discard", "of": "self" }, "pick": { "mode": "played" } },
      { "kind": "offset-threat", "target": "self", "amount": { "kind": "const", "value": 1 } },
      { "kind": "log", "template": "{self} 使用{usedAs}，抵消 1 点威胁{self.energyTag}" }
    ]
  }
]
```

`play` 变体（旧的响应式防御）在仓库里已无内容声明，取而代之的是上面这种「出牌阶段用【防御】抵消自己威胁」的写法（威胁机制见 3.5、第 6、10 节）。

#### 稀有度、升级与奖励池

- **奖励池 = 所有声明了 `rarity` 的牌种**（`src/game/rules/reward.ts` 的 `rewardPool()`）。候选与权重都由这条结构规则派生，代码里**没有任何牌种 id**。
- 基础牌声明 `upgradeTo` 指向自己的升级版；升级版是**独立牌种文档**（`id` 用 `-plus` 后缀），不声明 `rarity`，因此天然不入池；也不再声明 `upgradeTo`，加载期会以 `bad-combination` 拒绝链式升级。
- 升级是「就地改 `kind`」：`uid` 不变、牌区不变，因此不破坏牌数守恒，也不需要重建牌组。
- 一个最小例子：

```json
{
  "kind": "card",
  "id": "temper",
  "name": "淬火",
  "short": "测试",
  "text": "测试",
  "cost": { "kind": "const", "value": 1 },
  "rarity": "common",
  "upgradeTo": "temper-plus",
  "use": [{ "context": "play", "effects": [{ "kind": "log", "template": "{self} 使用{usedAs}" }] }]
}
```

`dsl/extensibility.test.ts` 用一份这样的牌验证了「升级后 `kind` 变化、`uid` 不变、守恒成立」。

### 3.5 `ruleset` — 规则常量

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `channels` | 是 | `Record<Channel, number>` | 必须为**全部**七个通道给出非负整数基准值 |

缺少任一通道报 `missing-field`；未知键报 `unknown-channel`。`baseChannel(channel)` 读取基准值。

**每条通道的基准值都是"默认值"**；除 `defend-need-against` 只服务占位对抗外，其余通道都被引擎真实消费（`dsl/channels.test.ts` 逐条以行为断言守卫，占位通道用合成 `contest` 内容驱动）：

| 通道 | 基准含义 | 引擎消费点 | 修正语义 |
|---|---|---|---|
| `energy-max` | 每回合能量上限（3） | `rules/energy.ts` `energyMax` | 绝对值，`set` 即覆盖上限 |
| `defend-need-against` | **占位**：对抗机制里抵消一次攻击需要的响应牌张数（1） | 仅 `contest` 帧（`dsl/primitives.ts` `pushContest`）；内置内容没有 `play` 变体，实战不可达 | 绝对值，当前无内置内容使用 |
| `threat-per-attack` | 每次攻击叠加的威胁点数（1） | `skills/index.ts` `threatPerAttack`（【打击】的 `threat` 效果） | 绝对值；内置内容不改该通道，技能修正可覆盖 |
| `draw-count` | 摸牌阶段摸几张（5） | `rules/turn.ts` `drawCount` | 偏移量：先手首回合再 −1 |
| `hand-limit` | 弃牌阶段手牌上限（0） | `rules/turn.ts` `handLimit` | 绝对值：上限 = 通道值（夹到非负）；基准 0 时全部手牌自动弃置、不询问，技能的 `add` 放宽后才会让玩家挑牌 |
| `card-cost` | 牌面费用的偏移（0） | `rules/energy.ts` `energyCost` | 偏移量：费用 = 牌种费用 + 修正，**最终不低于 1** |
| `attack-range` | 攻击范围（1） | `rules/distance.ts` `isInRange` | 绝对值，1v1 座位距离恒为 1 |

需要「默认 + 偏移」两段合成的通道用 `channelBonus(state, channel, p)`（= 聚合值 − 基准值）；绝对值语义直接用 `channelValue`。

`rules/base.json`：

```json
{
  "$schema": "../schema.json",
  "dslVersion": 1,
  "kind": "ruleset",
  "id": "base",
  "priority": 0,
  "channels": {
    "energy-max": 3,
    "defend-need-against": 1,
    "threat-per-attack": 1,
    "draw-count": 5,
    "hand-limit": 0,
    "card-cost": 0,
    "attack-range": 1
  }
}
```

### 3.6 `deck` — 牌组

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `cards` | 是 | `{ kind: string, count: number }[]` | 非空；`count` ≥ 1；`kind` 必须是存在的牌种 |

`decks/basic.json`：

```json
"cards": [
  { "kind": "strike", "count": 8 },
  { "kind": "defend", "count": 4 }
]
```

### 3.7 `rule` — 时机规则

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `on` | 是 | `Timing` | `{ at: 'turn-start' }` / `turn-end` / `{ at: 'phase-start' \| 'phase-end', phase }` / `after-damage` / `after-threat` |
| `when` | 否 | `Condition[]` | 非空数组；全部成立才执行 `effects` |
| `effects` | 是 | `Effect[]` | 非空；按声明顺序执行 |

`rules/attrition.json`（节选，消耗战）：

```json
"on": { "at": "turn-start" },
"when": [
  {
    "kind": "compare",
    "op": "gte",
    "left": { "kind": "ref", "ref": "turn" },
    "right": { "kind": "const", "value": 21 }
  }
],
"effects": [
  { "kind": "if", "condition": { ... }, "then": [ { "kind": "log", "template": "消耗战开始：此后每回合开始时，回合角色失去体力（每 5 回合递增 1 点）" } ] },
  { "kind": "log", "template": "消耗战：{active} 失去 {amount} 点体力", "vars": { "amount": { ... } } },
  { "kind": "lose-hp", "target": "active", "amount": { ... } }
]
```

消耗战从原先硬编码的 `TURN_TIMING_EFFECTS`（`rules/turn.ts`）迁出，成为一份 `rule` 文档；引擎对 `turn-start` 时机的规则按注册顺序执行。

---

## 4. 数值表达式 `Value`

### 4.1 节点（`VALUE_KINDS`）

| `kind` | 允许字段 | 语义 |
|---|---|---|
| `const` | `value: number` | 有限数字常量 |
| `ref` | `ref: ValueRefName`、`of?: RoleRef` | 读取运行时数值；`of` 缺省 `self` |
| `add` | `of: Value[]`（≥1） | 求和 |
| `sub` | `of: Value[]`（≥1） | 从首项起依次相减；只有一项时为其本身 |
| `mul` | `of: Value[]`（≥1） | 求积（初值 1） |
| `min` | `of: Value[]`（≥1） | 最小值 |
| `max` | `of: Value[]`（≥1） | 最大值 |
| `floor-div` | `of: Value`、`by: Value` | `Math.floor(of / by)`；`by` 为 0 抛 `RuleError` |
| `clamp` | `of: Value`、`min: number`、`max: number` | 夹取到 `[min, max]` |
| `channel` | `channel: Channel`、`of: RoleRef`（必填） | 读取 **`of` 这个角色**在某通道上的聚合值 |

### 4.2 可读取的数值（`VALUE_REF_NAMES`）

| `ref` | 含义 | 是否需要角色 |
|---|---|---|
| `hp` / `maxHp` | 当前 / 上限体力 | 是 |
| `handCount` / `deckCount` / `discardCount` | 手牌 / 牌组 / 弃牌堆张数 | 是 |
| `energy` | 当前能量 | 是 |
| `energyMax` | 能量上限；走 `energy-max` 通道（含技能修正） | 是 |
| `threat` | 当前威胁点数（攻击叠加、回合结束结算为伤害；见 3.5 与第 10 节） | 是 |
| `turn` | 当前回合数 | 否 |
| `damageAmount` | 触发事件里的伤害量（`ctx.damage?.amount ?? 0`） | 否 |

需要角色的 `ref` 会经 `requireRole` 解析；语境里没有该角色时抛 `RuleError`（结算路径上不允许静默取值）。`turn` / `damageAmount` 与角色无关，先于角色校验处理。

### 4.3 通道聚合

`channelValue(state, channel, subject)`：

1. 取 `ruleset` 里的基准值；
2. 按 `(priority, id)` 顺序遍历 `subject` 代号的技能，对匹配通道的每条 `modifier` 依次应用：`add` 累加、`set` 覆盖、`min` / `max` 夹取。

`subject` 是「该数值属于谁」：修正的归属由调用方给出——能量上限的修正看自己，攻击叠加威胁的修正看【打击】的使用者。内置内容不改 `threat-per-attack`（基准值即生效值），但技能修正可以覆盖它。修正值本身可以是任意 `Value`，因此修正与求值互相递归。

七条通道里，`defend-need-against` 只由占位对抗机制消费（内置内容没有 `play` 变体，因此实战不可达）；其余六条**全部**被引擎消费（摸牌数、手牌上限、费用、攻击范围也走通道，见 3.5 的表），因此内容侧的修正不会"校验通过但不生效"。引擎读通道时统一遵守两条夹取规则：摸牌数、手牌上限、攻击范围夹到非负，牌面费用夹到 ≥ 1（0 费 + 无次数限制 = 无限连击）。

### 4.4 递归深度保护

`value.ts` 的 `MAX_DEPTH = 16`：

- `evalValue` 超过深度抛 `RuleError('数值表达式递归过深（检查通道是否自引用）')`；
- `channelValue` 超过深度抛 `` RuleError(`通道 ${channel} 的修正递归过深`) ``。

因此「通道读取自身的修正值」这类自引用会变成显式报错，而不是栈溢出（`value.test.ts` 有断言）。

`Channel` 词表（`CHANNELS`）：`energy-max`、`defend-need-against`（占位）、`threat-per-attack`、`draw-count`、`hand-limit`、`card-cost`、`attack-range`。

---

## 5. 条件 `Condition`

所有条件都是纯数据，由 `condition.ts` 用封闭 `switch` 解释。`not` / `all` / `any` / `if.then` / `if.else` 会递归校验。

| `kind` | 允许字段 | 成立条件 |
|---|---|---|
| `always` | — | 恒真 |
| `not` | `of: Condition` | 子条件为假 |
| `all` | `of: Condition[]`（≥1） | 全部成立 |
| `any` | `of: Condition[]`（≥1） | 任一成立 |
| `compare` | `op: CompareOp`、`left: Value`、`right: Value` | 按 `lt` / `lte` / `gt` / `gte` / `eq` / `neq` 比较 |
| `alive` | `of: RoleRef` | 角色存在且 `alive` |
| `has-cards` | `of: RoleRef`、`zone: ZoneName`、`atLeast: Value` | 该牌区张数 ≥ `atLeast` |
| `card-kind-count` | `of: RoleRef`、`zone`、`cardKind: string`、`atLeast: Value` | 该牌区中指定牌种的张数 ≥ `atLeast` |
| `in-processing` | `card: CardRef` | 引用的牌当前在处理区 |
| `card-transformed` | — | 本次使用/打出的牌经转化（`usedCard.via !== undefined`） |
| `picked-count` | `atLeast: Value` | 最近一次取牌 `picked` 的张数 ≥ `atLeast` |
| `skill-unused` | `skill: string` | `ctx.self` 本回合尚未发动该技能 |
| `is-active` | — | `ctx.self === state.active` |
| `phase-is` | `phase: TurnPhase` | 当前阶段等于 `phase` |

**每个条件都可以带 `reason: string`**：条件不成立时，合法性判定会把这句话直接回给玩家，
所以"为什么不能这么做"也是内容，写在文档里而不是散落在引擎分支中。例如
`cards/defend.json` 的 `requires` 带 `"reason": "你没有需要抵消的威胁"`，
`cards/plunder.json` 的 `requires` 带 `"reason": "对手没有手牌"`。
没有 `reason` 的条件失败时返回通用说明（`firstFailed` 只报最外层不成立的节点）。

`ZoneName`（`ZONE_NAMES`）：`hand` / `discard` / `processing` / `deck`。
`CardRef`（`CARD_REFS`）：`event-card`（触发事件里被绑定的牌；回合结束的威胁结算不携带牌，为「无牌」）/ `used-card`（本次使用的牌）/ `cost-card`（第一张费用牌）。
`Phase`（`PHASES` / `TURN_PHASES`，两者由 `kinds.test.ts` 断言一致）：`prepare` → `judge` → `draw` → `play` → `discard` → `end`。

`has-cards` / `card-kind-count` 用 `requireRole`（缺角色即抛错）；`alive` 用 `resolveRole`（缺角色视为不成立）。`card-kind-count` 的 `cardKind` 与 `skill-unused` 的 `skill` 都参与交叉引用校验。

`when` / `requires` / `TargetSpec.conditions` 都必须是非空数组（`bad-combination`），且 `TargetSpec.conditions` 只允许 `self` 与 `target` 两个角色。

---

## 6. 效果 `Effect`

`EFFECT_KINDS` 就是「标准指令集」——**没有 native 逃生舱**：所有效果都必须能表达为数据，解释器对每种指令 `switch` 并以 `never` 穷尽断言收尾，新增 `kind` 时漏实现会编译报错。

| `kind` | 允许字段 | 作用 |
|---|---|---|
| `log` | `template: string`、`vars?: Record<string, Value>` | 渲染一条内容侧战报（见第 11 节） |
| `threat` | `target: RoleRef`、`amount: Value` | 给目标叠加威胁（**攻击的唯一途径**）；施加者恒为效果归属者 `ctx.self` |
| `offset-threat` | `target: RoleRef`、`amount: Value` | 抵消目标的威胁，结果夹到 0（【防御】） |
| `lose-hp` | `target`、`amount` | 失去体力；**不**触发「受到伤害后」技能，但降到 0 及以下仍会压入濒死帧（随后死亡，救援已禁用） |
| `heal` | `target`、`amount` | 回复体力（不超过上限） |
| `draw` | `target: RoleRef`、`count: Value` | 从目标自己的牌组摸牌（牌组耗尽时洗回自己的弃牌堆） |
| `move-cards` | `from: ZoneRef`、`to: ZoneRef`、`pick: CardPick` | 牌区之间移动（见下表） |
| `pay-energy` | `target`、`amount` | 支付能量（不得越界） |
| `gain-energy` | `target`、`amount` | 获得能量（受 `0..上限` 不变式约束） |
| `record-card-use` | `of: RoleRef`、`cardKind: string` | 记录牌种使用次数（统计用） |
| `record-skill-use` | `skill: string` | 记录技能已发动（配合 `oncePerTurn` / `skill-unused`） |
| `contest` | `responder: RoleRef`、`expectedCard: string`、`need: Value`、`onMet?: Effect[]`、`onUnmet?: Effect[]` | **占位**：开启一次对抗（询问 `responder` 打出 `expectedCard`，收尾由引擎负责）；内置内容无人声明 `play` 变体，因此不可达 |
| `contest-contribute` | `amount: Value` | **占位**：向当前对抗贡献张数；**只能出现在卡牌的 `play` 变体** |
| `resolve-dying` | `of: RoleRef` | 结束濒死结算；**只能出现在卡牌的 `dying` 变体** |
| `skip-phase` | `phase: TurnPhase` | 从本回合剩余阶段计划中删除该阶段 |
| `extra-phase` | `phase: TurnPhase`、`position: 'next' \| 'last'` | 插入一个额外阶段 |
| `for-each-target` | `effects: Effect[]` | 对每个选定目标各执行一次子效果：迭代时把 `target` 临时绑定为当前目标（多目标牌的唯一正确写法） |
| `if` | `condition: Condition`、`then: Effect[]`、`else?: Effect[]` | 条件分支；`then` / `else` 都是非空效果列表 |
| `offer-reward` | `reward: 'card' \| 'service'`（必填）、`candidates?`、`allowSkip?`、`weights?`、`healAmount?`、`removeFloor?` | 压入奖励结算帧，让双方各做一次三选一（见 §6.2） |

**威胁是基础伤害机制**：攻击不再直接扣体力，而是用 `threat` 给目标叠加威胁；承受者在自己的出牌阶段打出【防御】，用 `offset-threat` 抵消；其**回合结束时**剩余威胁结算为等量伤害（走伤害帧：先 emit `after-damage` 触发，再做濒死检查），随后威胁归零、不跨回合累积。`damage` 指令已从 `EFFECT_KINDS` 删除。
每次 `threat` 效果叠加威胁后，引擎还会立刻压入**威胁帧**逐个询问 / 执行 `after-threat` 触发（【反击】就在这里）。

【打击】按 `threat-per-attack` 通道叠加威胁（基准值见 `rules/base.json`；内置内容未修改该通道，技能修正可覆盖）：

```json
{ "kind": "threat", "target": "target", "amount": { "kind": "channel", "channel": "threat-per-attack", "of": "self" } }
```

【防御】抵消自己 1 点威胁（`requires` 要求自己至少有 1 点威胁）：

```json
{ "kind": "offset-threat", "target": "self", "amount": { "kind": "const", "value": 1 } }
```

`for-each-target` 的语义细节：

- 目标来自 `ctx.targets`（多目标解析结果）；单目标语境下退化为执行一次；
- 每次迭代使用**子上下文**，因此迭代内的 `{amount}` / `{picked}` 等绑定**不会**冒泡到外层；
- 一个目标都没有（既没有 `ctx.targets` 也没有 `ctx.target`）时抛 `RuleError`，属于文档与调用点不匹配；
- 声明了 `count` 的变体里，任何**不在** `for-each-target` 内、直接引用角色 `target` 的效果
  （含日志占位符与条件）都会被加载期校验器以 `bad-combination` 拒绝——多目标下 `ctx.target` 不绑定，
  这样能避免「以为打了全体、实际只打了一个」。

示例——`cards/storm.json`（`{ "mode": "all" }`，对每名角色（含自己）叠加 2 点威胁）：

```json
{
  "kind": "for-each-target",
  "effects": [
    { "kind": "threat", "target": "target", "amount": { "kind": "const", "value": 2 } }
  ]
}
```

`ZoneRef`：`{ zone: MOVE_ZONES, of?: RoleRef }`，其中 `MOVE_ZONES = hand / discard / processing`。**`deck` 不能被 `move-cards` 直接引用**，只能通过 `draw` 访问，避免绕过洗回逻辑。

### 6.1 `move-cards` 的 `pick` 模式与牌区组合

`CardPick`：`mode`（必填）、`count?: number`、`cardKind?: string`、`card?: CardRef`。

| `mode` | 额外字段 | `from` 限制 | 语境限制 |
|---|---|---|---|
| `played` | — | 必须是 `hand` | 只能出现在卡牌的 `use-play` / `use-dying` / `play` 效果中 |
| `cost` | — | 必须是 `hand` | 只能出现在主动技的 `activate` 效果中 |
| `random` | `count`（≥1） | 必须是 `hand` | — |
| `specific` | `card`（`CardRef`） | 必须是 `processing` | — |
| `all` | — | 只能是 `hand` 或 `discard` | — |

另外一条组合约束：`to.zone === 'processing'` 时，必须 `from.zone === 'hand'` 或 `mode === 'specific'`（只有手牌可以进入处理区，处理区内部取牌除外）。

示例——【打击】/【防御】的 `played`（把自己用的那张牌从手牌送进弃牌堆）：

```json
{
  "kind": "move-cards",
  "from": { "zone": "hand", "of": "self" },
  "to": { "zone": "discard", "of": "self" },
  "pick": { "mode": "played" }
}
```

示例——【强袭】的 `cost`（弃置一张费用牌）：

```json
{
  "kind": "move-cards",
  "from": { "zone": "hand", "of": "self" },
  "to": { "zone": "discard", "of": "self" },
  "pick": { "mode": "cost" }
}
```

**处理区与 `specific` / `event-card` 当前只服务占位对抗**：它们原本用于「把造成伤害/被响应的牌压入处理区、事后再取回」的响应链，而内置内容没有任何卡牌声明 `play` 变体，`contest` 不可达，因此实战中不会有牌进入处理区。新增反制内容前不要照抄旧的响应式写法。

效果列表与条件列表都**不能为空数组**（`bad-combination`）。

### 6.2 `offer-reward` — 奖励三选一

`offer-reward` 是**唯一会打开交互式奖励的指令**：它不立即询问，而是把一帧奖励结算压进帧栈
（`dsl/primitives.ts` 的 `pushRewardFrame`），等当前时机的全部规则执行完后，引擎从栈顶开始逐个询问。

字段（`reward` 必填，两组字段互斥，写错一组报 `bad-combination`）：

| `reward` | 允许字段 | 语义 |
|---|---|---|
| `card` | `candidates?`（默认 3）、`allowSkip?`、`weights?`（`common`/`uncommon`/`rare` 三个非负整数） | 从奖励池按权重抽 `candidates` 张不重复的牌；选中后**直接进手牌**（`cardTotal += 1`，uid 用 `state.nextUid`）；`allowSkip` 决定能否跳过 |
| `service` | `healAmount?`（`Value`）、`removeFloor?` | 升级 / 移除 / 回复三选一；回复量取 `healAmount`，移除下限取 `removeFloor`（移除后「牌组+手牌+弃牌堆」不得少于它） |

要点：

- **压帧顺序反直觉**：同一时机上的规则按 `priority` **升序执行**，而 `advance()` 从**栈顶**结算，
  因此**后压的帧先弹**。内置的两份奖励规则把服务放在 `priority: 20`、卡牌放在 `priority: 30`，
  于是卡牌三选一先弹、服务三选一后弹——想要「A 先于 B」，就让 A 的规则**后执行**（priority 更大）。
- **询问顺序**：从回合角色起按座次（`aliveOrderFrom(state, state.active)`），双方各选一次；
  非回合角色同样会被询问，因此界面只依据 `pending.kind`，不能看 `state.phase`。
- **两步询问**：服务奖励选定「升级 / 移除」时不立即出选牌，而是先记 `pendingPick`，
  下一轮 `stepFrame` 才出 `pick-card`（候选按 `uid` 升序现算）。
- **可用性现算**：满血不能回复、没有 `upgradeTo` 的牌不能升级、移除后不足下限不能移除；
  三项都不可用时跳过该玩家并记战报，避免出现无解的待输入项。
- **战报**：每个选择写一行日志，玩家能看到对手拿到了什么。

最小例子（`rules/reward-card.json`，第 3 的倍数回合抽三选一）：

```json
{
  "kind": "rule",
  "id": "reward-card",
  "priority": 30,
  "on": { "at": "turn-start" },
  "when": [
    { "kind": "compare", "op": "eq",
      "left": { "kind": "mul", "of": [
        { "kind": "floor-div", "of": { "kind": "ref", "ref": "turn" }, "by": { "kind": "const", "value": 3 } },
        { "kind": "const", "value": 3 }] },
      "right": { "kind": "ref", "ref": "turn" } }
  ],
  "effects": [
    { "kind": "offer-reward", "reward": "card", "candidates": 3, "allowSkip": true,
      "weights": { "common": 60, "uncommon": 30, "rare": 10 } }
  ]
}
```

---

## 7. 延迟语义：`effects` 与 `after`

这是 DSL 里最需要理解的一条时序约定：

- **`effects` 按声明顺序逐条执行。**
- **`after` 不立即执行**：它被推迟，作为一份延迟效果压入结算帧栈（`Frame.effects`，见 `../src/game/types.ts`），等**当前这条结算链全部走完**——包括伤害、「受到伤害后」询问、濒死询问与结算收尾——之后再按 **LIFO（后进先出）** 出栈执行。

所以 `after` 表达的是「先付出代价，若还能继续，再拿收益」。

### 7.1 已有例子：合成技能（内置内容暂无 `after`）

内置技能目前都不声明 `after`（【强袭】只有立即 `effects`），下面用一个合成技能说明它的时机：

```json
"activate": {
  "timing": "play",
  "effects": [
    { "kind": "log", "template": "{self} 发动【示例】" },
    { "kind": "lose-hp", "target": "self", "amount": { "kind": "const", "value": 1 } }
  ],
  "after": [{ "kind": "draw", "target": "self", "count": { "kind": "const", "value": 2 } }]
}
```

结算顺序：

1. 立即打印「发动【示例】」；
2. `lose-hp 1` 扣减体力，若降到 0 及以下则**立即压入濒死帧**；
3. 濒死帧随即走死亡结算（救援机制已禁用，不询问任何角色）；
4. 只有**存活**下来，才轮到延迟的 `draw 2` 摸两张牌。

这正是「先安排摸牌帧，再 `loseHp`」的同一语义：摸牌被压在濒死结算之下，濒死被打断/阵亡时不会先摸牌。`src/game/dsl/effect.test.ts` 的「`after` 先压栈，等当前结算链走完才执行（失去体力类技能的语义）」与「`lose-hp`：失去体力且不触发受到伤害后技能」守住了这条行为。

同一条约定也适用于 `TriggerSpec.after` 与 `UseVariant.after`：它们都在当前结算链结束后才执行。

---

## 8. 语境与角色

### 8.1 语境决定可用角色（`CONTEXT_ROLES`）

角色（`ROLES`）：`self` / `target` / `source` / `active` / `dying` / `opponent`。

| 语境 | 出现位置 | 允许的角色 |
|---|---|---|
| `activate` | `skill.activate.effects` / `after` / `requires` | `self` `target` `active` `opponent` |
| `use-play` | `card.use[context="play"]` 的效果与 `requires` | `self` `target` `active` `opponent` |
| `use-dying` | `card.use[context="dying"]` 的效果与 `requires` | `self` `target` `dying` `active` `opponent` |
| `play` | **占位**：`card.play.effects` / `requires`（内置内容没有任何卡牌声明 `play` 变体） | `self` `source` `active` `opponent` |
| `trigger` | `skill.trigger.effects` / `after` / `when` | `self` `target` `source` `active` `opponent` |
| `contest` | **占位**：`contest.onMet` / `contest.onUnmet` 内部（内置内容无人声明 `play`，`contest` 不可达） | `self` `target` `active` `opponent` |
| `rule` | `rule.effects` / `when` | `self` `active` |
| `modifier` | `modifier.value` | `self` |

表里真正承载攻击/防御内容的是 `use-play`：【打击】与【防御】都是 `card.use[context="play"]` 的变体，【防御】在这里读 `threat(self)` 并 `offset-threat` 自己。`play` 与 `contest` 两行只是保留的占位语境，当前没有内容使用。

在 `effects` 之外的字段还有各自的角色集合：`card.cost` 与 `activate.costCards.count` 只允许 `self`；`TargetSpec.conditions` 只允许 `self` / `target`。

语境里不允许的角色报 `unknown-role`（例如在 `use-play` 里写 `{source}`）；根本不在 `ROLES` 里的名字报 `bad-type`。

### 8.2 运行时绑定（`EffectContext`）

```ts
export interface EffectContext {
  self: PlayerIndex        // 技能/卡牌的归属者；规则的 self = 当前回合角色
  active: PlayerIndex      // 事件发生时的回合角色
  target?: PlayerIndex     // 主动技的选择结果 / 卡牌的使用目标
  source?: PlayerIndex     // 伤害/威胁来源 / 卡牌使用者
  dying?: PlayerIndex      // 濒死者
  usedUid?: number         // 本次使用/打出的牌在手牌中的 uid
  usedCard?: VirtualCard   // 本次使用/打出的虚拟牌（含 via 转化信息）
  costCards: number[]      // 已支付的费用牌 uid
  picked?: number[]        // 最近一次 move-cards 实际取到的牌 uid
  lastAmount?: number      // 最近一次数值效果的结果（日志 {amount}）
  damage?: DamageCtx       // 触发事件里的伤害上下文（当前只在回合结束的威胁结算时产生）
}
```

这些字段必须可序列化（会随结算帧进入 `GameState`，测试用 `structuredClone` 快照），因此不能放函数或类实例。

| 绑定 | 由什么写入 |
|---|---|
| `self` / `active` | 调用点建立上下文（`baseContext`；规则的 `self` 为回合角色） |
| `target` | 技能/卡牌的 `TargetSpec` 解析结果 |
| `source` | 伤害来源 / 卡牌使用者（触发语境里指「谁造成了这次伤害」） |
| `dying` | 濒死（仅 `dying` 语境变体使用；救援已禁用，引擎当前不会建立该上下文） |
| `usedUid` / `usedCard` | 本次使用或打出的牌（含 `via` 转化） |
| `costCards` | `move-cards` 的 `pick.mode = "cost"` 支付的牌 |
| `picked` | 最近一次 `move-cards` 实际取到的牌 |
| `lastAmount` | 最近一次数值类指令的结果 |
| `damage` | 伤害事件（当前唯一来源是回合结束的威胁结算，携带 1v1 唯一对手作为来源） |

角色解析：`resolveRole` 缺失时返回 `undefined`；`requireRole` 缺失时抛 `` RuleError(`当前结算语境没有角色 ${role}，DSL 文档与调用点不匹配`) ``。`opponent` 定义为「`self` 之外的另一个玩家」。

---

## 9. 目标选取 `TargetSpec`

`TargetSpec` 出现在 `ActivateSpec.target`、`UseVariant.target`：

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `scope` | 是 | `TargetScope` | `self` / `any` / `opponent` / `others` / `dying` |
| `required` | 否 | `boolean` | `true` 表示必须显式指定目标（界面需要目标选择器） |
| `default` | 否 | `TargetDefault` | `self` / `opponent`；缺省字段缺失时按「唯一候选 → 自己」回退 |
| `alive` | 是 | `boolean` | `true` 时过滤掉阵亡角色 |
| `range` | 否 | `boolean` | `true` 时要求距离在攻击范围内（打击） |
| `conditions` | 否 | `Condition[]` | 对候选逐个求值 |
| `count` | 否 | `TargetCount` | 目标个数；缺省为单选 1 个 |

`count` 的两种模式（`TARGET_COUNT_MODES`）：

| 模式 | 含义 |
|---|---|
| `{ "mode": "all" }` | 不需要玩家选择，结算作用于**全部合法候选**（按座次序）；显式目标必须与候选集完全一致 |
| `{ "mode": "exactly", "count": Value }` | 必须显式指定恰好 N 个互不重复的合法目标；候选不足 N 时报「符合条件的目标不足 N 个」 |

`count` 的额外约束：与 `default` 不能同时出现（多目标没有「缺省单目标」的概念，`bad-combination`）；
`exactly` 的个数表达式在**还没选出目标**的环境求值，因此只允许 `self` / `active` 角色，`const` 时须 ≥ 1。
多目标变体里的效果必须用 `for-each-target` 引用 `target`（见第 6 节）。主动技暂不支持 `count`。

`scope` 的候选集合：`self` → 自己；`any` → 双方；`opponent` → 对手；`others` → 除自己外；`dying` → `ctx.dying`（没有濒死者则为空）。候选再依次按 `alive`、`range`、`conditions` 过滤。

**`conditions` 求值时会临时把 `target` 绑定为该候选**（`ctx.target = index`），因此 `{ "kind": "ref", "ref": "hp", "of": "target" }` 读取的是候选的体力。合法性判定与结算共用 `target.ts` 的同一套规则，避免「校验通过但结算取到别的目标」。

### 9.1 例子：任意已受伤角色

内置内容**已删除全部回血牌**（回复 / 急救及其升级版），但 `scope: any` + 条件过滤这条规格仍然有效。
下面是等价的规格（测试用 `fixtures.ts` 的合成牌 `test-aid` 注入同一份规格）：

```json
"target": {
  "scope": "any",
  "required": false,
  "default": "self",
  "alive": true,
  "conditions": [
    {
      "kind": "compare",
      "op": "lt",
      "left": { "kind": "ref", "ref": "hp", "of": "target" },
      "right": { "kind": "ref", "ref": "maxHp", "of": "target" },
      "reason": "目标角色体力已满，无法回复"
    }
  ]
}
```

（旧版此处引用 `cards/first-aid.json`；该牌已随「删除回血牌」移除。）

```json
"target": {
  "scope": "any",
  "required": false,
  "default": "self",
  "alive": true,
  "conditions": [
    {
      "kind": "compare",
      "op": "lt",
      "left": { "kind": "ref", "ref": "hp", "of": "target" },
      "right": { "kind": "ref", "ref": "maxHp", "of": "target" },
      "reason": "目标角色体力已满，无法回复"
    }
  ]
}
```

`resolveTargetChoices` 的规则：显式目标必须在候选内；`required: true` 时必须提供；否则用 `default`（再退化为唯一候选 → 自己）；`count.mode = all` 直接返回全部候选，`exactly` 则要求恰好 N 个；**候选为空时返回 `{ ok: false, reason: '没有符合条件的目标' }`**——声明了 `target` 就不能"无目标地"继续结算，否则效果里引用 `target` 时会在更深处抛错（攻击范围、存活条件这类修正都能让候选变空）。
单选路径由 `resolveTargetChoice`（内部调用 `resolveTargetChoices` 并取第一个目标）承担，既有调用点不必改。

### 9.2 目标选择入口（界面 / AI / 合法性接线）

目标解析只有 `game/skills/index.ts` 的 `targetChoice(state, p, spec, dying?)` 一个核心入口，
主动技与卡牌各有一个薄封装：

| 入口 | 用途 |
|---|---|
| `targetChoice(state, p, spec, dying?)` | 核心：把 `TargetSpec` 解析成候选、缺省目标与「要不要选、选几个」 |
| `activationTargetChoice(state, p, skill)` | 主动技：取 `skillDoc(skill).activate?.target` |
| `cardTargetChoice(state, p, kind, context, dying?)` | 卡牌：取 `useVariantOf(kind, context)?.target`（濒死语境需传濒死者绑定 `scope: dying`） |

三者返回同一个 `TargetChoice`：

| 字段 | 说明 |
|---|---|
| `spec` | 目标规格；没有声明 `target` 时为 `undefined`（提交不带目标） |
| `candidates` | 已按 `alive` / 距离 / `conditions` 过滤的合法候选 |
| `fallback` | 单选且不需要玩家选择时提交所用的目标（= 合法的文档缺省目标） |
| `mustChoose` | 界面/AI 是否必须先选定目标 |
| `multi` | 是否需要选定多个（`exactly` 且 N > 1） |
| `size` | 需要选定的目标个数（`all` 模式为候选个数） |

单选时 `mustChoose = spec.required === true || candidates.length > 1 || fallback === undefined`；
返回 `null` 表示现在不能用（没有对应的变体，或声明了 `target` 却一个候选都没有，此时按钮不出现）。

- `activeOptions` 与 `checkActivate` 共用它：前者按「存在一个合法候选」决定按钮是否出现，后者用玩家最终选定的目标重算 `requires`，所以**可用 ⟺ 提交必成功**。卡牌侧同样：`stores/selectors.ts` 的 `legalOptions` 用 `cardTargetChoice` 判定牌面是否可用，`checkUseCard` 用 `resolveTargetChoices` 校验提交的目标。
- 多候选或缺省目标不合格时，界面进入目标选择态（`stores/state.ts` 的 `pendingTarget`、`stores/selection.ts` 的 `chooseTarget`，技能与卡牌共用），候选列表由 `dsl/target.ts` 的 `targetScopeMembers` 给出**过滤前**的 scope 成员，不可选的候选附上 `conditions` 里的 `reason`；多目标需要勾选后点「确定」。
- AI（`game/ai/index.ts`）同样由文档结构派生：`chooseActivationTarget` 与 `chooseCardTargets` 对「伤害 `target`」的效果选对手、其余选自己，再退回 `fallback` 与候选顺序；`all` 模式不传目标（由引擎作用于全部候选）。

---

## 10. 时机与触发

`TIMING_KINDS`：`turn-start`、`turn-end`、`phase-start`、`phase-end`、`after-damage`、`after-threat`。

| 时机 | 谁来执行 | 说明 |
|---|---|---|
| `turn-start` / `turn-end` | `rule` | 回合边界；消耗战挂在 `turn-start`，威胁结算在 `turn-end` 的最后一步 |
| `phase-start` / `phase-end` | `rule` | 阶段边界，需要 `phase` 字段；非这两个时机的 `at` 不允许带 `phase` |
| `after-damage` | `trigger` | 事件类时机：引擎**只在回合结束的威胁结算**（走伤害帧）里 emit，用于「受到伤害后」技能（内置内容暂无） |
| `after-threat` | `trigger` | 事件类时机：每次 `threat` 效果叠加威胁后 emit（带 `{threat:{source,target,amount}}` payload），用于「受到威胁后」技能（内置【反击】） |

要点：

- **引擎 emit 的事件类时机有 `after-damage` 与 `after-threat`**，也是仅有的两个允许 `optional: true` 的时机（`validate/docs.ts` 的 `checkSkill` 拒绝其它时机 + `optional: true`，报 `bad-combination`）。
  两者都由结算帧驱动：伤害帧在濒死检查之前逐个询问，威胁帧在威胁叠加后立刻逐个询问；不可选的立即执行。
  `after-threat` 的 payload 是 `{ threat: { source, target, amount } }`（`contextFor` 同时把 `target` / `source` 绑进语境）。
  两条防连锁规则：`source === target`（自己给自己叠威胁）不触发；**栈上已有威胁帧时不再收集**（反击造成的威胁不会再触发反击）。
- **伤害与威胁是两个触发点**：`threat` 指令叠加威胁后立刻 emit `after-threat`（【反击】在这里还手）；而伤害要等到承受者自己的回合结束、剩余威胁结算时才由 `dealDamage` emit `after-damage`，随后做濒死检查。因此「先叠的威胁」不会立刻变成伤害，但会立刻触发 `after-threat`。
- 触发型的其它字段：`on`（必填）、`optional?`（当前只有 `after-damage` / `after-threat` 可为 `true`）、`when?`（非空条件数组）、`effects`（必填）、`after?`。
- 非可选的时机技能与 `rule` 按注册顺序（`priority`, `id`）依次执行；`trigger` 里可选的技能由引擎询问玩家，玩家应答后再结算其 `effects`。
- 内置的触发技只有一个：反击型【反击】挂在 `after-threat` 上（`optional: true`，令来源获得 1 点威胁）。**「每回合限一次」的写法**是 `when` 里加 `skill-unused`、`effects` 里先 `record-skill-use`——记录在技能拥有者身上，并在**其自己的回合开始时**重置（与主动技的 `oncePerTurn` 同一套语义）。`optional: true` + 限一次的技能示例——`skills/riposte.json`：

```json
"trigger": {
  "on": { "at": "after-threat" },
  "optional": true,
  "when": [
    { "kind": "alive", "of": "source" },
    { "kind": "skill-unused", "skill": "riposte" }
  ],
  "effects": [
    { "kind": "record-skill-use", "skill": "riposte" },
    { "kind": "threat", "target": "source", "amount": { "kind": "const", "value": 1 } },
    { "kind": "log", "template": "{self} 发动【反击】，向 {source} 反击" }
  ]
}
```

`when` 只是**发动前**的可用性条件；真正「是否发动」由玩家应答决定。`when` 是可选的，省略它就表示只要发生该事件就能选择发动；合成示例如下：

```json
"trigger": {
  "on": { "at": "after-threat" },
  "optional": true,
  "effects": [ { "kind": "draw", "target": "self", "count": { "kind": "const", "value": 1 } } ]
}
```

> 注意：校验器接受 `TIMING_KINDS` 里的任意 `at`，但引擎今天只执行 `turn-start` / `turn-end` / `phase-start` / `phase-end` 四类 `rule` 时机，并且只 emit `after-damage` / `after-threat` 两个事件。**只声明引擎会 emit 的时机**，否则文档合法但永远不会执行。

---

## 11. 日志模板

内容侧战报用 `log` 指令的 `template` 渲染；机制侧消息（伤害、摸牌、濒死、对抗进度等）仍由引擎直接写入战报。二者分两类来源，避免内容文档重复描述机制。

### 11.1 占位符文法

- `{root}`：根占位符；
- `{root.field}`：玩家类根占位符可带一个字段；根占位符与字段之间的分隔符是 `.`（`token.split('.')`），层级超过两层报「层级过深」；
- 花括号必须配对，否则报 `bad-placeholder`；
- 未知根占位符、玩家根占位符的非法字段、当前语境不允许的角色，都在**加载期**报错——不会等到结算时才渲染出 `undefined`。

`LOG_ROOTS` 白名单：

| 根占位符 | 含义 |
|---|---|
| `self` / `target` / `source` / `active` / `dying` | 玩家标签（代号名，如 `进攻型`），可带字段 |
| `usedRaw` | 本次使用/打出的**实际**牌：`【防御】` |
| `usedAs` | 本次使用/打出的**当作**牌：`【打击】` |
| `via` | 转化技能名：`转换` |
| `cost` | 已支付的费用牌：`【打击】、【防御】` |
| `picked` | 最近一次 `move-cards` 取到的牌 |
| `amount` | 最近一次数值结果 |
| `turn` | 当前回合数 |

玩家占位符允许的字段（`LOG_PLAYER_FIELDS`）：`hp` / `maxHp` / `energy` / `energyMax` / `threat` / `handCount` / `energyTag`。其中 `energyTag` 渲染为 `（能量 2/3）`，`energyMax` 会实时读取 `energy-max` 通道（含蓄能修正），`threat` 读取该玩家当前的威胁点数（威胁机制见第 6、10 节）。

### 11.2 显式绑定 `log.vars`

`vars` 允许把根占位符显式绑定到一个 `Value`，且**优先于自动绑定**：

```json
{
  "kind": "log",
  "template": "消耗战：{active} 失去 {amount} 点体力",
  "vars": {
    "amount": {
      "kind": "add",
      "of": [
        { "kind": "const", "value": 1 },
        {
          "kind": "floor-div",
          "of": {
            "kind": "sub",
            "of": [
              { "kind": "ref", "ref": "turn" },
              { "kind": "const", "value": 21 }
            ]
          },
          "by": { "kind": "const", "value": 5 }
        }
      ]
    }
  }
}
```

`vars` 的键只能是 `LOG_VAR_ROOTS`（`amount` / `turn`）——只允许数值类占位符，避免把 `usedAs` 这类字符串占位符绑成数字；绑定其它键报 `bad-placeholder`。

### 11.3 已有模板片段

```json
{ "kind": "log", "template": "{self} 发动【{via}】，将{usedRaw}当{usedAs}对 {target} 使用{self.energyTag}" }
```

```json
{ "kind": "log", "template": "{self} 发动【强袭】，弃置{cost}，强攻 {target}" }
```

```json
{ "kind": "log", "template": "{self} 使用{usedAs}救援 {target}（体力 {target.hp}/{target.maxHp}）{self.energyTag}" }
```

```json
{ "kind": "log", "template": "{self} 使用{usedAs}，抵消 1 点威胁（剩余威胁 {self.threat}）{self.energyTag}" }
```

---

## 12. 校验错误码 `IssueCode`

每条问题都是 `{ path, code, message }`；`path` 用 `#/` 表示字段（如 `species/offensive.json#/skills/0`），`issues` 按路径与错误码排序。

| `code` | 含义 | 例子 |
|---|---|---|
| `version` | `dslVersion` 不等于 `DSL_VERSION` | `dslVersion: 99` → `species/offensive.json#/dslVersion` |
| `unknown-kind` | 文档 `kind` 不在 `DOC_KINDS` | `kind: "monster"` |
| `unknown-key` | 出现未定义字段（拼写错误也要报） | 把 `kind` 写成 `Kind` → `...#/Kind` |
| `missing-field` | 缺少必填字段 | 删掉 `card.cost`；`ruleset.channels` 少一个通道；`offer-reward` 缺 `reward`；`weights` 缺某个稀有度 |
| `bad-type` | 类型/枚举不合法（未指定专用码时的兜底） | `compare.op` 不是 `lt/lte/...`；`required` 不是布尔；`activate.timing` 不是 `play`；`rarity` 不是词表内的值 |
| `bad-number` | 数字不满足「有限整数 / 下限」 | `maxHp: 0`；`clamp.min` 不是数字；通道基准值不是非负整数；`weights` 出现负数 |
| `bad-combination` | 结构组合非法 | 空 `effects` / 空 `when`；`move-cards` 的牌区与 `mode` 不匹配；`contest-contribute` 不在 `play`；`resolve-dying` 不在 `dying`；技能没声明任何部件；卡牌既无 `use` 也无 `play`；`offer-reward` 用错一组字段或 `upgradeTo` 自指/链式升级 |
| `unknown-ref` | 交叉引用指向不存在的文档 | `species.skills: ["nope"]`；`deck.cards[].kind: "hex"`；`card.upgradeTo: "nope"` |
| `duplicate-id` | `id` 重复 | 两个代号都叫 `offensive`；第二份 `ruleset`；同一卡牌两个 `context: "play"` |
| `unknown-role` | 角色合法但当前语境不允许 | 在 `use-play` 里写 `{source}` |
| `unknown-channel` | 通道不在 `CHANNELS` | `modifiers[].channel: "mana-max"`；`ruleset.channels` 多一个 `mana-max` |
| `unknown-instruction` | 数值节点 `kind` 或效果 `kind` 未知 | `{ "kind": "power", ... }`；`{ "kind": "execute", ... }` |
| `unknown-condition` | 条件 `kind` 未知 | `{ "kind": "moon-phase" }` |
| `unknown-pick-mode` | `pick.mode` 不在 `PICK_MODES` | `pick.mode: "any"` |
| `bad-placeholder` | 日志占位符非法 | `{who}`；`{self.mana}`；`{self}` 少半个花括号；`vars` 绑定 `usedAs` |
| `cost-below-minimum` | `const` 费用 < 1 | `cost: { "kind": "const", "value": 0 }` → `cards/strike.json#/cost#/value` |
| `dead-doc` | 文档未被引用（拼写错误或残留） | 技能 `ghost` 没被任何代号引用 → `/ghost` |

校验器**一次报出全部问题**（不遇错即停），但一个错误常连带产生衍生问题（例如悬空引用会让被引用的技能变成 `dead-doc`），因此测试通常只锁定目标错误码。

---

## 13. 扩展指南

核心前提：**新增内容只改 JSON**；只有引入引擎尚不支持的**新机制**时，才需要新增一条指令原语（即在 `kinds.ts` 加入新的 `kind`，并在解释器里实现它）。这是刻意的设计——**没有 native 逃生舱**，效果必须能表达为数据，否则就要正式扩展指令集并同时更新词表、类型、校验器与选择器。

改完 JSON 后跑一次加载即可暴露全部结构问题——非法文档会在导入时以 `DslLoadError` 列出所有问题（含 JSON 路径）。

### 13.1 新增一个技能

1. 新建 `src/game/data/dsl/skills/<id>.json`，写上信封（`dslVersion: 1`、`kind: "skill"`、`id`、`priority`）与 `name` / `text`。
2. 至少声明 `modifiers` / `transforms` / `trigger` / `activate` 之一（否则 `bad-combination`）。
3. 用 `priority` 决定结算顺序（越小越先；同值按 `id` 字典序）。修正聚合、触发收集与主动技枚举都依赖这个顺序。
4. 把技能 id 加进某个代号的 `species.skills`（`src/game/data/dsl/species/<id>.json`），否则该技能是 `dead-doc`。`skillsOf(speciesId)` 会按 `(priority, id)` 返回该代号的技能。

选择机制：

- 常驻数值 → `modifiers`（通道 + `add`/`set`/`min`/`max` + `Value`）。例：蓄能 `energy-max` +2。通道也可以被覆盖（`set`），但内置内容不再修改 `threat-per-attack`。
- 牌面转化 → `transforms`（`from`、`to`、`contexts: ["use"] / ["play"]`；`play` 语境当前没有内容使用）。例：转换把【防御】当【打击】、把【打击】当【防御】使用。
- 「受到威胁后」可选发动 → `trigger`（`on: { "at": "after-threat" }`、`optional: true`、`when`、`effects`）。例：反击（令来源获得 1 点威胁，来源即本次施加威胁的人）。也可以用 `after-damage` 挂在伤害帧上（内置内容暂无）。
- 出牌阶段主动技 → `activate`（`timing: "play"`、`oncePerTurn`、`costCards`、`target`、`effects`、`after`）。例：强袭（弃一张手牌令对方获得 2 点威胁）。

### 13.2 新增一张卡牌

1. 新建 `src/game/data/dsl/cards/<id>.json`，写上信封与 `name` / `short` / `text` / `cost`。
2. `cost` 若是 `const`，必须 ≥ 1（`cost-below-minimum`）。
3. 声明 `use`（`context: "play"` 和/或 `"dying"`，同一语境不可重复）；`play`（`respondsTo`）是**占位对抗机制**的字段，内置内容无人使用，新增反制内容前不要照抄旧的响应式写法。
4. 把 `{ kind: <id>, count: n }` 加进某个牌组的 `cards`（`decks/<id>.json`），否则牌种是 `dead-doc`。
   **奖励新卡是例外**：声明 `rarity` 后它就在奖励池里，不必进牌组（`refs.ts` 对声明了稀有度的牌种免除 `dead-doc`）。
5. 变体里的效果用第 6 节的指令集表达；引用牌种时（`pick.cardKind`，以及占位对抗才用到的 `expectedCard`、`respondsTo`、`contest`）必须指向存在的牌。
6. 想做**升级版**：写一份独立牌种（`id` 用 `-plus`、`name` 用 `+`），在基础牌上声明 `upgradeTo` 指向它；
   升级版**不写** `rarity`（不入奖励池）、**不写** `upgradeTo`（禁链式升级，加载期拒绝）。

注意 `move-cards` 的约束：`played` 从手牌取（使用/打出的那张），`cost` 从手牌取费用牌，`specific` 只能从处理区取；`to.zone = "processing"` 只允许从手牌进入。处理区与 `specific` 目前只服务占位对抗，实战中不会有牌进入。

**要写攻击牌**：用 `threat` 叠加威胁，一般读 `threat-per-attack` 通道（【打击】）。例：【风暴】用 `count: all` + `for-each-target` 内 `threat` 2；【强袭】直接对对方 `threat` 2。**不要再写 `damage` 指令**（已从 `EFFECT_KINDS` 删除）。

**要写防御牌**：用 `use`（`context: "play"`）变体，`scope: self`，`requires` 读 `threat(self) >= 1`，效果是 `offset-threat` 自己 1 点（【防御】）。响应窗口式的 `play` 变体不再需要。

**要写触发技**：挂 `after-threat`（每次被叠威胁时触发，如反击给来源叠威胁）或 `after-damage`（回合结束的威胁结算兑现时触发）。

**要写「使用时选目标」的牌**：在 `use.target` 上给目标规格（第 9 节）。候选不唯一或缺省目标不合格时界面会自动弹选择器，
提交带上 `Action.use-card.targets`；引擎与合法性判定都不需要改。

**要写多目标牌**：给 `use.target` 加 `count`，效果里用 `for-each-target` 包住所有引用 `target` 的指令（含 `threat`）。
范例见 `cards/storm.json`（`{ "mode": "all" }` + `for-each-target` 内 `threat` 2）与 `dsl/extensibility.test.ts` 的 `exactly` 用例。

### 13.3 新增一个代号

1. 新建 `src/game/data/dsl/species/<id>.json`，字段 `name` / `maxHp` / `skills` / `deck`。
2. `skills` 里的每个 id、`deck` 引用的牌组都必须已存在。
3. `priority` 决定抽将顺序（`speciesIds()` → `rollDraft`）。给一个不与现有代号冲突的值；固定种子下的抽将结果会随代号顺序变化，若要保持既有种子结果，把新代号插在顺序末尾（更大的 `priority`）。

### 13.4 新增一条时机规则

1. 新建 `src/game/data/dsl/rules/<id>.json`，`kind: "rule"`，字段 `on` / `when?` / `effects`。
2. `on` 只声明引擎会执行/emit 的时机：`turn-start` / `turn-end` / `phase-start` / `phase-end`（需要 `phase`）。事件类时机有 `after-damage` / `after-threat`，只用于 `trigger`。
3. 规则按注册顺序执行；`when` 全部成立才执行 `effects`。
4. 想发奖励就用 `effects: [{ kind: "offer-reward", reward: "card" | "service", ... }]`（§6.2）。
   同一时机上多份奖励规则时，**priority 更大的先弹**（规则先执行、帧后进先出）；
   内置的消耗战（priority 10）排在两份奖励规则之前，因此「先扣血、扣死了就不再发奖励」。

### 13.5 怎么验证新增内容

- **视图是实时的**：`data/species.ts` 的 `SPECIES` 与 `data/cardDefs.ts` 的 `CARD_DEFS` / `CARD_NAME`
  都是按注册表派生的 Proxy，所以"改一份 JSON"会立刻反映到体力上限、技能表、牌名与费用上。
- **测试里替换一份文档**：用 `registryToDocs()` 拿完整内容集 → 按 id 过滤掉要改的那份 → 追加新文档 →
  `createRegistry(...)`；再用 `withRegistry(synthetic, () => { ... })` 包住要跑的流程（结束时自动还原）。
  必须用完整内容集，否则牌数守恒与引用完整性会失败。
- **手写最小夹具**：只想测校验/求值时用 `fixtures.ts` 的 `baseDocs()` + `mutateDoc()` 更快。
- 端到端范例见 `src/game/dsl/extensibility.test.ts`（新主动技、新攻击牌 + 牌组、改体力上限、使用时选目标的牌、多目标牌）。

### 13.6 什么时候必须动引擎

只有下列情况需要改代码，且改动是「扩展指令集」而不是「加内容」：

- 需要一条现有 `EFFECT_KINDS` 无法表达的效果 → 在 `kinds.ts` 增加 `kind`，在 `fieldSpecs.ts` 的 `EFFECT_SPECS` 加一条（字段与类型一起写），解释器的 `switch` 补一支（`never` 穷尽断言会强制补全）。
  漏改 `fieldSpecs.ts` 或 `types.ts` 的联合类型都会**编译失败**，不需要再手工核对字段表；
- 需要引擎 emit 一个新的事件时机（新 `TIMING_KINDS`）→ 在引擎的 emit 点接入，并更新 `TIMING_KINDS` 词表；
- 需要新的可读数值（`VALUE_REF_NAMES`）或新的修正通道（`CHANNELS`，同时补 `ruleset.channels`）。

---

## 14. 测试与 Schema

### 14.1 测试文件

| 文件 | 覆盖内容 |
|---|---|
| `src/game/dsl/kinds.test.ts` | 词表一致性：`PHASES` 与引擎 `TURN_PHASES` 相同；校验器为每种数值/条件/指令都定义了字段表；词表无重复项；`DSL_VERSION` 与文档一致 |
| `src/game/dsl/validate.test.ts` | 逐项制造错误：信封、数值/条件、效果、日志模板、引用与死文档、技能/卡牌结构，并断言错误码与 `path` |
| `src/game/dsl/registry.test.ts` | 内置内容全部通过校验；代号/牌种顺序；`skillsOf` 排序；`DslLoadError` 携带全部问题且按路径排序；`withRegistry` 注入与还原 |
| `src/game/dsl/value.test.ts` | 常量与四则运算、`floor-div` / `clamp`、读取角色数值、消耗战表达式、通道聚合（蓄能）、修正值可为表达式、通道自引用报错 |
| `src/game/dsl/condition.test.ts` | 每种条件（`always`/`not`/`all`/`any`、`compare`、`alive`/`has-cards`/`card-kind-count`、`in-processing`、`card-transformed`/`picked-count`、`skill-unused`/`is-active`/`phase-is`） |
| `src/game/dsl/target.test.ts` | 「任意已受伤角色」候选与缺省目标（内联规格）、打击的 scope、`required`、`alive` 过滤、`range`；多目标 `resolveTargetChoices`：`all` / `exactly`、候选不足、重复目标、条件 reason 沿用、单选规格拒绝多目标 |
| `src/game/dsl/template.test.ts` | 普通/转化使用、濒死救援、`{cost}`、`vars` 优先于自动绑定、能量标签反映修正后的上限、未定义字段抛错 |
| `src/game/dsl/effect.test.ts` | 每条效果指令：`log`/`threat`/`offset-threat`/`lose-hp`/`heal`/`draw`/能量/计数/阶段、四种取牌模式、`contest` 与 `contest-contribute`、`resolve-dying`、`for-each-target`（逐目标执行、单目标退化、上下文不冒泡、无目标报错）、`after` 的延迟语义 |
| `src/game/dsl/effects.test.ts` | 效果树结构查询：`effectsInclude` 递归进 `if` / `contest` / `for-each-target`；`effectsHarmChosenTarget` 区分「打向选定目标」与「打向自己」；`findEffect` 返回命中的节点 |
| `src/game/dsl/event.test.ts` | `sameTiming`、消耗战规则按回合生效、触发收集与 `when` 条件（含 `after-threat` 的 payload）、`runTrigger`（反击）、不可选触发立即执行、可选触发只支持 `after-damage` / `after-threat` |
| `src/game/dsl/schema.test.ts` | 没有孤儿 `$defs` 节点；提交的 `schema.json` 与代码生成逐字节一致；每份内容文档过一遍 schema；schema 能拒绝多余键与错误判别式；每份文档 `$schema` 指向 `../schema.json` |
| `src/game/dsl/guards.test.ts` | 应用代码零内容 id（白名单不过期）、不 import node 内置模块、**运行时依赖图零环**（强连通分量比对）、README 测试表覆盖全部测试文件、stores 只从 barrel 进入 |
| `src/game/dsl/channels.test.ts` | 通道接线验收：七条通道逐条注入修正并断言**引擎行为**随之改变（摸牌数、手牌上限、费用与费用下限 1、攻击范围、能量上限、每次攻击叠加的威胁、占位对抗的抵消张数）；探针表与 `CHANNELS` 必须一一对应（新增通道忘了接线即失败） |
| `src/game/dsl/extensibility.test.ts` | 扩展验收：新主动技、新攻击牌（含牌组与守恒校验）、改体力上限、使用时选目标的牌、多目标牌、带 `upgradeTo` 的牌都只改文档即可端到端生效 |
| `src/game/rules/reward.test.ts` | 奖励节奏（3/4/6/12 回合触发与「卡牌先于服务」）、奖励池与加权不重复抽取的确定性、跳过、服务三项与边界（满血 / 无可升级牌 / 移除下限） |
| `src/game/rules/deckEdit.test.ts` | 升级保 `uid`、移除进 `removed` 且不随洗回复活、移除下限被拒且状态不变 |

`src/game/dsl/fixtures.ts` 提供跨测试复用的夹具：`baseDocs()`（覆盖 ruleset + 1 牌 + 1 牌组 + 1 技能 + 1 代号的最小自洽文档集）、`mutateDoc(path, change)`（深拷贝后就地改某份文档，用来逐项制造错误）与 `contentWith(docs)`（以完整内容集为底按 id 替换/新增文档）。它不命名为 `*.test.ts`，避免被 vitest 当作测试文件收集。

`registry.ts` 另提供 `registryToDocs()`：把当前注册表还原成文档列表。做"只替换一份文档"的扩展性测试时需要一份完整自洽的内容集（牌数守恒、引用完整性都还要成立），用它作底最省事。

### 14.2 `schema.json` 是生成物

`src/game/data/dsl/schema.json`（JSON Schema draft 2020-12）由 `src/game/dsl/schema.ts` 从 `kinds.ts` 的词表与 `fieldSpecs.ts` 的字段表生成，**不是手写的**：

- 字段表（`fieldSpecs.ts`）是校验器与生成器共用的唯一来源，allowed 字段集合由字段表的键派生，
  因此不存在"校验器认识、schema 不认识"这种漂移；`schema.test.ts` 只额外检查没有孤儿 `$defs` 节点。
- `schema.test.ts` 把提交的 `schema.json` 与 `schemaJson()` 逐字节比对。字段/词表变了但没更新生成物时，用以下命令重新生成：

  ```bash
  UPDATE_DSL_SCHEMA=1 npx vitest run src/game/dsl/schema.test.ts
  ```

- schema 只覆盖**结构**：文档结构、允许/必填字段、判别式枚举、嵌套节点与取值类型。语义约束（引用完整性、费用 ≥ 1、牌区组合、占位符与角色可用性）无法用 JSON Schema 表达，由 `validate/` 在加载期强制——这是刻意的分工。
- 每份内容文档都以 `"$schema": "../schema.json"` 指向它，编辑器因此能补全与提示。

---

## 15. 已知限制

| 限制 | 说明 |
|---|---|
| 内容是构建期打包，不做热更新 | `registry.ts` 用 `import.meta.glob(..., { eager: true })` 静态导入；改 JSON 需重新构建/刷新，不存在运行时重新加载内容的入口 |
| `optional: true` 只支持 `after-damage` / `after-threat` | 其它时机 + `optional: true` 会被校验器以 `bad-combination` 拒绝 |
| 目标选择同时覆盖主动技与卡牌 | `activationTargetChoice` / `cardTargetChoice` 共用 `targetChoice`，服务可用性、校验、结算、界面与 AI；`Action.use-card.targets` 承载卡牌的目标选择结果 |
| 多目标只支持卡牌的使用变体 | `UseVariant.target.count` 已接通（`all` / `exactly` + `for-each-target`）；主动技的 `target` 带 `count` 会被 `bad-combination` 拒绝，仍是单选 |
| 多目标下 `ctx.target` 不绑定 | 声明了 `count` 的变体必须在 `for-each-target` 内引用 `target`（加载期守卫，`threat` 同样受约束）；迭代内的上下文写入不冒泡到外层 |
| 威胁来源不逐笔追踪 | 回合结束结算时，伤害来源按 1v1 的**唯一对手**记录（`otherPlayer`），不记录是哪张牌/哪个技能叠的；追责类效果只能拿到这个粗粒度来源 |
| 威胁不跨回合累积 | 威胁只在「施加者回合 → 承受者回合结束」之间存活一轮：回合结束时剩余威胁结算为等量伤害并立即归零，不做历史累计 |
| 手牌上限基准 0，与体力无关 | `handLimit` 直接取 `hand-limit` 通道值（夹到非负）；上限为 0 时弃牌阶段自动弃光手牌、不产生待输入项，上限 > 0 才需要玩家挑牌。威胁结算在弃牌阶段之后，因此将来若有放宽上限的效果，也按结算前的状态算 |
| `contest` / `play` 变体是占位 | 内置内容没有任何卡牌声明 `play` 变体，`contest` / `contest-contribute` 与 `defend-need-against` 通道当前不可达，只保留给后续反制机制 |
| 只声明引擎会 emit 的时机 | 校验器接受全部 `TIMING_KINDS`，但引擎今天只执行四个回合/阶段边界的 `rule` 时机，并且只 emit `after-damage`（回合结束的威胁结算）与 `after-threat`（每次叠加威胁后）两个事件；声明其它事件时机不会报错，但永远不会触发 |
| `move-cards` 不能访问 `deck` | 牌组只能通过 `draw` 访问，以免绕过洗回逻辑 |
| 牌面费用下限恒为 1 | `card-cost` 通道可以把费用压低，但 `energyCost` 最终夹到 ≥ 1；要与「【打击】没有次数限制」共存，这条下限不能放开 |
| 数值递归上限 16 | 表达式/通道递归超过 16 层抛 `RuleError`；这是防自引用与防栈溢出的硬保护 |
| 没有 native 逃生舱 | 效果必须表达为数据；无法表达的新机制只能扩展指令集（改词表、类型、校验器、解释器、schema），不能绕过校验直接调函数 |
| 濒死救援已禁用：濒死即阵亡 | `rules/dying.ts` 的 `DYING_RESCUE_ENABLED = false`，`engine/stack.ts` 的 `dying` 帧直接走死亡结算，不询问任何角色；内容层也没有任何牌声明 `dying` 变体。救援链路（`dying` 语境 + `resolve-dying` + 询问队列、合法性与界面分支）全部保留，把开关改回 `true` 即可恢复 |
| 奖励帧一次抽好双方共享的候选 | `offer-reward` 压帧时抽一次候选，两名玩家从同一组里选；没有「各自重抽」或「刷新候选」的字段，要改就调 `candidates` / `weights` / 周期 |
| 奖励的交互顺序由帧栈决定 | `offer-reward` 只压帧不立即询问，同一时机上的多份奖励规则「priority 大者先弹」；想要确定的顺序就必须显式写 `priority` |
| 手牌上限（`hand-limit` 通道，基准 0）、守恒/能量不变式、RNG、距离仍在引擎 | 这些是机器不变量，不属于内容；见第 1 节的边界表 |
