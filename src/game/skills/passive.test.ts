import { describe, expect, it } from 'vitest'
import { hasSkill, SPECIES, SPECIES_IDS } from '../data/species'
import { baseDocs } from '../dsl/fixtures'
import { createRegistry, registry, skillDoc, withRegistry } from '../dsl/registry'
import { BASE_ENERGY_MAX, energyMax } from '../rules/energy'
import { energyMaxBonus, threatPerAttack } from '../skills'
import { makeState } from '../testUtils'

describe('常驻型技能', () => {
  it('怒吼：能量上限 +2', () => {
    const bear = makeState({ playerSpecies: 'bear', aiSpecies: 'tiger' })
    const tiger = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })

    expect(energyMaxBonus(bear, 0)).toBe(2)
    expect(energyMaxBonus(tiger, 0)).toBe(0)
    expect(energyMax(bear, 0)).toBe(BASE_ENERGY_MAX + 2)
    expect(energyMax(tiger, 0)).toBe(BASE_ENERGY_MAX)
  })

  it('威压：使每张【打击】造成 2 点威胁', () => {
    const lion = makeState({ playerSpecies: 'lion', aiSpecies: 'tiger' })
    const tiger = makeState({ playerSpecies: 'tiger', aiSpecies: 'lion' })

    expect(threatPerAttack(lion, 0)).toBe(2)
    expect(threatPerAttack(tiger, 0)).toBe(1)
  })

  it('修正通道：换一份技能文档即可改变能量上限，引擎代码不用动', () => {
    const synthetic = createRegistry([
      ...baseDocs().filter((doc) => doc.path !== 'skills/roar.json'),
      {
        path: 'skills/roar.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'roar',
          name: '怒吼',
          text: '你每回合的能量上限 +1。',
          modifiers: [
            { channel: 'energy-max', op: 'add', value: { kind: 'const', value: 1 } },
          ],
        },
      },
    ])
    // 虎本来没有技能；同一个 state 换一份技能文档后，上限随之改变
    const state = makeState({ playerSpecies: 'tiger', aiSpecies: 'bear' })
    expect(energyMax(state, 0)).toBe(BASE_ENERGY_MAX)
    expect(withRegistry(synthetic, () => energyMax(state, 0))).toBe(BASE_ENERGY_MAX + 1)
    expect(energyMax(state, 0)).toBe(BASE_ENERGY_MAX)
  })

  it('物种引用的技能都能解析，且注册表里没有孤儿技能', () => {
    const fromSpecies = new Set(SPECIES_IDS.flatMap((id) => SPECIES[id].skills.map((s) => s.id)))
    for (const id of fromSpecies) {
      // 引用完整性在加载期已强制，这里保证展示视图也拿得到名字与文案
      expect(skillDoc(id).name.length).toBeGreaterThan(0)
      expect(skillDoc(id).text.length).toBeGreaterThan(0)
    }
    expect(new Set(registry.skills.map((doc) => doc.id))).toEqual(fromSpecies)
  })

  it('每个物种都有名称、头像与体力上限', () => {
    expect(SPECIES_IDS).toHaveLength(8)
    for (const id of SPECIES_IDS) {
      const species = SPECIES[id]
      expect(species.name.length).toBeGreaterThan(0)
      expect(species.emoji.length).toBeGreaterThan(0)
      expect(species.maxHp).toBeGreaterThanOrEqual(3)
      for (const skill of species.skills) {
        expect(skill.text.length).toBeGreaterThan(0)
      }
    }
  })

  it('每个物种都至少有一个技能（虎的【猛扑】已补齐）', () => {
    for (const id of SPECIES_IDS) {
      expect(SPECIES[id].skills.length, `${id} 没有技能`).toBeGreaterThan(0)
    }
    expect(SPECIES.tiger.skills.map((s) => s.id)).toEqual(['pounce'])
    expect(SPECIES.deer.skills.map((s) => s.id)).toEqual(['mend'])
    expect(hasSkill('tiger', 'pounce')).toBe(true)
    expect(hasSkill('tiger', 'roar')).toBe(false)
  })

  it('物种名与技能名都不重复', () => {
    const names = SPECIES_IDS.map((id) => SPECIES[id].name)
    expect(new Set(names).size).toBe(names.length)

    const skillNames = SPECIES_IDS.flatMap((id) => SPECIES[id].skills.map((s) => s.name))
    expect(new Set(skillNames).size).toBe(skillNames.length)
  })
})
