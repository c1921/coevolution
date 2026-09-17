import { describe, expect, it } from 'vitest'
import { SPECIES, SPECIES_IDS } from '../data/species'
import { defendNeedAgainst, IMPLEMENTED_SKILLS, strikeLimit } from '../skills'
import { makeState } from '../testUtils'

describe('常驻型技能', () => {
  it('怒吼：解除每回合一次【打击】的限制', () => {
    const bear = makeState({ playerSpecies: 'bear', aiSpecies: 'tiger' })
    const tiger = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })

    expect(strikeLimit(bear, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(strikeLimit(tiger, 0)).toBe(1)
  })

  it('威压：使目标需要两张【防御】才能抵消', () => {
    const lion = makeState({ playerSpecies: 'lion', aiSpecies: 'tiger' })
    const tiger = makeState({ playerSpecies: 'tiger', aiSpecies: 'lion' })

    expect(defendNeedAgainst(lion, 0)).toBe(2)
    expect(defendNeedAgainst(tiger, 0)).toBe(1)
  })

  it('8 个物种的技能集合与已实现技能完全一致', () => {
    const fromSpecies = new Set(SPECIES_IDS.flatMap((id) => SPECIES[id].skills.map((s) => s.id)))
    expect(fromSpecies).toEqual(new Set(IMPLEMENTED_SKILLS))
  })

  it('每个物种都有名称、头像、体力上限与技能说明', () => {
    expect(SPECIES_IDS).toHaveLength(8)
    for (const id of SPECIES_IDS) {
      const species = SPECIES[id]
      expect(species.name.length).toBeGreaterThan(0)
      expect(species.emoji.length).toBeGreaterThan(0)
      expect(species.maxHp).toBeGreaterThanOrEqual(3)
      expect(species.skills.length).toBeGreaterThan(0)
      for (const skill of species.skills) {
        expect(skill.text.length).toBeGreaterThan(0)
      }
    }
  })

  it('物种名与技能名都不重复', () => {
    const names = SPECIES_IDS.map((id) => SPECIES[id].name)
    expect(new Set(names).size).toBe(names.length)

    const skillNames = SPECIES_IDS.flatMap((id) => SPECIES[id].skills.map((s) => s.name))
    expect(new Set(skillNames).size).toBe(skillNames.length)
  })
})
