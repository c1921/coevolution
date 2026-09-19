import type {
  CardDoc,
  DeckDoc,
  Doc,
  Registry,
  RuleDoc,
  RulesetDoc,
  SkillDoc,
  SpeciesDoc,
} from './types'
import type { Channel, SkillKind } from './kinds'
import type { Effect, TargetSpec, Value } from './types'
import { effectsInclude } from './effects'
import { validateDocs } from './validate'
import type { Issue } from './validate'

/**
 * 注册表：data/dsl/*.json 的唯一入口。
 *
 *  - **导入即校验**：任何一份文档不合法就抛 DslLoadError 并列出全部问题（含 JSON 路径），
 *    开发与测试期立刻失败，而不是在结算途中才炸。
 *  - **顺序即结算顺序**：所有文档按 (priority, id) 升序；物种的技能表也按同一规则排序，
 *    因此修正聚合、触发收集、主动技枚举都具备确定性。
 *  - **可注入**：createRegistry 是纯函数，withRegistry 供测试注入合成文档，
 *    用来证明"新增内容无需改代码"。
 */

export class DslLoadError extends Error {
  readonly issues: Issue[]
  constructor(issues: Issue[]) {
    super(
      `DSL 文档校验失败（${issues.length} 项）：\n` +
        issues.map((issue) => `  ${issue.path} [${issue.code}] ${issue.message}`).join('\n'),
    )
    this.name = 'DslLoadError'
    this.issues = issues
  }
}

function order<T extends { id: string; priority?: number }>(docs: T[]): T[] {
  return [...docs].sort(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id),
  )
}

function indexById<T extends { id: string }>(docs: T[]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const doc of docs) out[doc.id] = doc
  return out
}

export function createRegistry(raws: { path: string; value: unknown }[]): Registry {
  const { docs, issues } = validateDocs(raws)
  if (issues.length > 0) throw new DslLoadError(issues)

  const species = order(docs.filter((doc): doc is SpeciesDoc => doc.kind === 'species'))
  const skills = order(docs.filter((doc): doc is SkillDoc => doc.kind === 'skill'))
  const cards = order(docs.filter((doc): doc is CardDoc => doc.kind === 'card'))
  const decks = order(docs.filter((doc): doc is DeckDoc => doc.kind === 'deck'))
  const rules = order(docs.filter((doc): doc is RuleDoc => doc.kind === 'rule'))
  const rulesets = docs.filter((doc): doc is RulesetDoc => doc.kind === 'ruleset')
  const ruleset = rulesets[0]
  if (!ruleset)
    throw new DslLoadError([{ path: '/', code: 'missing-field', message: '缺少 ruleset' }])

  const skillById = indexById(skills)
  const speciesById = indexById(species)

  return {
    dslVersion: ruleset.dslVersion,
    species,
    skills,
    cards,
    decks,
    rules,
    ruleset,
    speciesById,
    skillById,
    cardById: indexById(cards),
    deckById: indexById(decks),
  }
}

/** 读取当前注册表（withRegistry 期间是被替换过的那份） */
export function getRegistry(): Registry {
  return registry
}

/** 构建时静态导入全部内容文档；顺序由文档自身的 priority 决定 */
const RAW_DOCS = import.meta.glob('../data/dsl/*/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

function loadBuiltin(): Registry {
  const raws = Object.entries(RAW_DOCS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, value]) => ({ path: path.replace('../data/dsl/', ''), value }))
  return createRegistry(raws)
}

/** 模块级单例：导入本模块即完成校验 */
export let registry: Registry = loadBuiltin()

/**
 * 临时替换注册表（仅测试使用）：用于注入合成物种/技能/卡牌，
 * 验证"新增内容零代码改动"。异常与正常返回都会还原。
 */
export function withRegistry<T>(next: Registry, fn: () => T): T {
  const previous = registry
  registry = next
  try {
    return fn()
  } finally {
    registry = previous
  }
}

/** 技能文档（不存在即抛错：引用完整性已在加载期校验） */
export function skillDoc(id: string): SkillDoc {
  const doc = registry.skillById[id]
  if (!doc) throw new Error(`未知技能 id：${id}`)
  return doc
}

/** 牌面文档 */
export function cardDoc(id: string): CardDoc {
  const doc = registry.cardById[id]
  if (!doc) throw new Error(`未知牌种 id：${id}`)
  return doc
}

/** 物种文档 */
export function speciesDoc(id: string): SpeciesDoc {
  const doc = registry.speciesById[id]
  if (!doc) throw new Error(`未知物种 id：${id}`)
  return doc
}

/** 某物种的技能文档，按 (priority, id) 排序——修正聚合与触发收集都依赖这个顺序 */
export function skillsOf(speciesId: string): SkillDoc[] {
  return speciesDoc(speciesId)
    .skills.map((id) => skillDoc(id))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id))
}

/**
 * 技能分类（由文档结构派生，不再存储）：
 * transforms→transform、modifiers→passive、trigger→trigger、activate→active。
 * 顺序固定，因此多类技能的展示用 kind 也是确定的。
 */
export function skillKinds(doc: SkillDoc): SkillKind[] {
  const kinds: SkillKind[] = []
  if ((doc.transforms?.length ?? 0) > 0) kinds.push('transform')
  if ((doc.modifiers?.length ?? 0) > 0) kinds.push('passive')
  if (doc.trigger) kinds.push('trigger')
  if (doc.activate) kinds.push('active')
  return kinds
}

/** 某物种的牌组文档 */
export function deckOf(speciesId: string): DeckDoc {
  const species = speciesDoc(speciesId)
  const deck = registry.deckById[species.deck]
  if (!deck) throw new Error(`物种 ${speciesId} 引用了不存在的牌组 ${species.deck}`)
  return deck
}

/** 全部物种 id（按注册表顺序） */
export function speciesIds(): string[] {
  return registry.species.map((doc) => doc.id)
}

/** 全部牌种 id（按注册表顺序） */
export function cardIds(): string[] {
  return registry.cards.map((doc) => doc.id)
}

/** 牌面名 */
export function cardName(id: string): string {
  return cardDoc(id).name
}

/** 修正通道基准值（ruleset 保证每个通道都有定义） */
export function baseChannel(channel: Channel): number {
  const value = registry.ruleset.channels[channel]
  if (value === undefined) throw new Error(`ruleset 未定义通道 ${channel} 的基准值`)
  return value
}

/**
 * 把当前注册表还原成原始文档列表（等价于 data/dsl/** 的 JSON 内容）。
 *
 * 用途：测试与调试。"替换其中一份文档"的扩展性测试需要一份完整、自洽的内容集，
 * 这样牌数守恒、引用完整性与 schema 校验都仍然成立。
 */
export function registryToDocs(): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = []
  const emit = (dir: string, kind: string, docs: { id: string }[]): void => {
    for (const doc of docs) {
      out.push({
        path: `${dir}/${doc.id}.json`,
        value: { $schema: '../schema.json', dslVersion: registry.dslVersion, kind, ...doc },
      })
    }
  }
  emit('rules', 'ruleset', [registry.ruleset])
  emit('rules', 'rule', registry.rules)
  emit('decks', 'deck', registry.decks)
  emit('cards', 'card', registry.cards)
  emit('skills', 'skill', registry.skills)
  emit('species', 'species', registry.species)
  return out
}

/**
 * 牌面角色分类（由文档结构派生）：AI 与界面用它理解"这张牌是干什么的"，
 * 因此新增牌种不需要在 AI/界面里加分支。
 *  - attack  含 threat 效果（叠加威胁）
 *  - defense 含 offset-threat 效果（抵消威胁），或声明了 play 变体（占位对抗机制）
 *  - recovery 含 heal 效果（回复）
 *  - utility 其余
 */
export type CardRole = 'attack' | 'defense' | 'recovery' | 'utility'

// 效果树查询的实现搬到了 ./effects（纯叶子，AI 与注册表共用一份递归形状）；
// 这里原样转出，既有调用点（ai/index.ts、registry.test.ts）无需改动。
export { effectsInclude } from './effects'

export function cardRole(kind: string): CardRole {
  const doc = cardDoc(kind)
  if (doc.play) return 'defense'
  const effects = (doc.use ?? []).flatMap((variant) => variant.effects)
  if (effectsInclude(effects, 'threat')) return 'attack'
  if (effectsInclude(effects, 'offset-threat')) return 'defense'
  if (effectsInclude(effects, 'heal')) return 'recovery'
  return 'utility'
}

/** 目标规格是否可能把自己的角色算进目标 */
function mayTargetSelf(spec: TargetSpec | undefined): boolean {
  if (!spec) return false
  return spec.scope === 'any' || spec.scope === 'self'
}

/** 数值表达式取常量值（非 const 时保守按 1 计） */
function constOr(value: Value, fallback: number): number {
  if (value.kind === 'const') return value.value
  return fallback
}

/** 递归累计效果对自己造成的威胁（用于 AI 判断"这张牌会不会伤到自己"） */
function selfThreatOf(effects: readonly Effect[] | undefined, mayHitSelfTarget: boolean): number {
  let total = 0
  for (const effect of effects ?? []) {
    if (effect.kind === 'threat' || effect.kind === 'lose-hp') {
      if (effect.target === 'self') total += constOr(effect.amount, 1)
      else if (effect.target === 'target' && mayHitSelfTarget) total += constOr(effect.amount, 1)
    }
    if (effect.kind === 'for-each-target') {
      total += selfThreatOf(effect.effects, mayHitSelfTarget)
    }
    if (effect.kind === 'if') {
      const thenHarm = selfThreatOf(effect.then, mayHitSelfTarget)
      const elseHarm = selfThreatOf(effect.else, mayHitSelfTarget)
      total += Math.max(thenHarm, elseHarm)
    }
    if (effect.kind === 'contest') {
      total += Math.max(
        selfThreatOf(effect.onMet, mayHitSelfTarget),
        selfThreatOf(effect.onUnmet, mayHitSelfTarget),
      )
    }
  }
  return total
}

/**
 * 卡牌对自己造成的威胁点数（由文档结构派生，AI 用它决定"这张牌能不能打"）。
 * 0 表示不会伤到自己。对称威胁（如多目标牌）在 1v1 里必然包含自己，故计入。
 */
export function cardSelfThreat(kind: string): number {
  const doc = cardDoc(kind)
  let harm = 0
  for (const variant of doc.use ?? []) {
    harm = Math.max(harm, selfThreatOf(variant.effects, mayTargetSelf(variant.target)))
  }
  return harm
}

export type { Doc }
