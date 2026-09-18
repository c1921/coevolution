import { registry, skillDoc, skillKinds, speciesDoc, speciesIds } from '../dsl/registry'
import type { SkillDoc } from '../dsl/types'
import type { SkillDef, SkillId, SpeciesDef, SpeciesId } from '../types'

/**
 * 物种与技能元数据（由 DSL 文档派生）。
 *
 * 这里是"展示"视图（名字、头像、体力上限、技能的 id/名/分类/文案）；
 * 技能的**行为**由 dsl 解释器按文档执行，引擎不再关心具体技能 id。
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

export const SPECIES: Record<SpeciesId, SpeciesDef> = Object.fromEntries(
  registry.species.map((doc) => [
    doc.id,
    {
      id: doc.id,
      name: doc.name,
      emoji: doc.emoji,
      maxHp: doc.maxHp,
      skills: doc.skills.map((id) => skillView(skillDoc(id))),
    },
  ]),
)

/** 全部物种 id，顺序即注册表顺序（由物种文档的 priority 决定） */
export const SPECIES_IDS: SpeciesId[] = speciesIds()

export function speciesDef(species: SpeciesId): SpeciesDef {
  const view = SPECIES[species]
  if (!view) throw new Error(`未知物种 id：${species}`)
  return view
}

/** 该物种是否拥有某技能 */
export function hasSkill(species: SpeciesId, skill: SkillId): boolean {
  return speciesDoc(species).skills.includes(skill)
}

/** 技能的展示视图 */
export function skillDef(skill: SkillId): SkillDef {
  return skillView(skillDoc(skill))
}
