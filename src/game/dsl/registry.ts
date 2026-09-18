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
  if (!ruleset) throw new DslLoadError([{ path: '/', code: 'missing-field', message: '缺少 ruleset' }])

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

/** 某物种是否拥有某技能 */
export function speciesHasSkill(speciesId: string, skillId: string): boolean {
  return speciesDoc(speciesId).skills.includes(skillId)
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

/** 供测试读取原始文档（校验前） */
export function rawDocPaths(): string[] {
  return Object.keys(RAW_DOCS)
}

export type { Doc }
