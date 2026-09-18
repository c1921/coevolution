import { getRegistry, skillDoc, skillKinds, speciesDoc, speciesIds } from '../dsl/registry'
import type { SkillDoc } from '../dsl/types'
import type { SkillDef, SkillId, SpeciesDef, SpeciesId } from '../types'

/**
 * 物种与技能元数据（由 DSL 文档实时派生）。
 *
 * 这里是"展示"视图（名字、头像、体力上限、技能的 id/名/分类/文案）；
 * 技能的**行为**由 dsl 解释器按文档执行，引擎不再关心具体技能 id。
 *
 * 视图是**实时**的：注册表被替换（测试注入内容、将来做内容热加载）时，
 * 引擎与界面立刻看到新内容，因此改体力上限、加技能都只需要改 JSON。
 *
 * 技能分类（kind）不存储在文档里，而是由文档结构派生（见 registry.ts 的 skillKinds）：
 * transforms→transform、modifiers→passive、trigger→trigger、activate→active。
 */

function skillView(doc: SkillDoc): SkillDef {
  return {
    id: doc.id,
    name: doc.name,
    kind: skillKinds(doc)[0] ?? 'passive',
    text: doc.text,
  }
}

export function speciesDef(species: SpeciesId): SpeciesDef {
  const doc = speciesDoc(species)
  return {
    id: doc.id,
    name: doc.name,
    emoji: doc.emoji,
    maxHp: doc.maxHp,
    skills: doc.skills.map((id) => skillDef(id)),
  }
}

/**
 * 物种视图表（`SPECIES[id]`）。用 Proxy 实时派生，而不是在导入时快照，
 * 这样"改一份 JSON"就能改变体力上限/技能表，引擎与界面代码都不用动。
 * 未知 id 返回 undefined，与普通对象取值一致。
 */
export const SPECIES: Record<SpeciesId, SpeciesDef> = new Proxy(
  {} as Record<SpeciesId, SpeciesDef>,
  {
    get: (_target, key) => (typeof key === 'string' ? speciesDef(key) : undefined),
    has: (_target, key) => typeof key === 'string' && key in getRegistry().speciesById,
    ownKeys: () => speciesIds(),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
)

/**
 * 全部物种 id 的快照（注册表首次加载时的顺序）。
 * 需要"当前注册表"的顺序请用 dsl/registry 的 `speciesIds()`。
 */
export const SPECIES_IDS: SpeciesId[] = speciesIds()

/** 该物种是否拥有某技能 */
export function hasSkill(species: SpeciesId, skill: SkillId): boolean {
  return speciesDoc(species).skills.includes(skill)
}

/** 技能的展示视图 */
export function skillDef(skill: SkillId): SkillDef {
  return skillView(skillDoc(skill))
}
