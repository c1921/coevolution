import { describe, expect, it } from 'vitest'
import { hasSkill, SPECIES, SPECIES_IDS } from '../data/species'
import { baseDocs } from '../dsl/fixtures'
import { createRegistry, registry, skillDoc, withRegistry } from '../dsl/registry'
import { BASE_ENERGY_MAX, energyMax } from '../rules/energy'
import { energyMaxBonus, threatPerAttack } from '../skills'
import { makeState } from '../testUtils'

describe('常驻型技能', () => {
  it('蓄能：能量上限 +2', () => {
    const defensive = makeState({ playerSpecies: 'defensive', aiSpecies: 'offensive' })
    const offensive = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })

    expect(energyMaxBonus(defensive, 0)).toBe(2)
    expect(energyMaxBonus(offensive, 0)).toBe(0)
    expect(energyMax(defensive, 0)).toBe(BASE_ENERGY_MAX + 2)
    expect(energyMax(offensive, 0)).toBe(BASE_ENERGY_MAX)
  })

  it('threat-per-attack 基准值：没有技能修正时每张【打击】1 点威胁', () => {
    const offensive = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
    expect(threatPerAttack(offensive, 0)).toBe(1)
  })

  it('修正通道：换一份技能文档即可改变能量上限，引擎代码不用动', () => {
    const synthetic = createRegistry([
      ...baseDocs().filter((doc) => doc.path !== 'skills/charge.json'),
      {
        path: 'skills/charge.json',
        value: {
          dslVersion: 1,
          kind: 'skill',
          id: 'charge',
          name: '蓄能',
          text: '你每回合的能量上限 +1。',
          modifiers: [
            { channel: 'energy-max', op: 'add', value: { kind: 'const', value: 1 } },
          ],
        },
      },
    ])
    // 真实注册表里进攻型是【强袭】，没有能量修正；换成合成文档后上限随之改变
    const state = makeState({ playerSpecies: 'offensive', aiSpecies: 'defensive' })
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

  it('每个物种都有代号与体力上限', () => {
    expect(SPECIES_IDS).toHaveLength(4)
    for (const id of SPECIES_IDS) {
      const species = SPECIES[id]
      expect(species.name.length).toBeGreaterThan(0)
      expect(species.maxHp).toBeGreaterThanOrEqual(3)
      for (const skill of species.skills) {
        expect(skill.text.length).toBeGreaterThan(0)
      }
    }
  })

  it('每个物种都恰好有一个技能', () => {
    for (const id of SPECIES_IDS) {
      expect(SPECIES[id].skills.length, `${id} 没有技能`).toBeGreaterThan(0)
    }
    expect(SPECIES.offensive.skills.map((s) => s.id)).toEqual(['assault'])
    expect(SPECIES.counter.skills.map((s) => s.id)).toEqual(['riposte'])
    expect(SPECIES.defensive.skills.map((s) => s.id)).toEqual(['charge'])
    expect(SPECIES.morph.skills.map((s) => s.id)).toEqual(['convert'])
    expect(hasSkill('offensive', 'assault')).toBe(true)
    expect(hasSkill('offensive', 'charge')).toBe(false)
  })

  it('物种代号与技能名都不重复，且不再保留动物名', () => {
    const names = SPECIES_IDS.map((id) => SPECIES[id].name)
    expect(new Set(names).size).toBe(names.length)
    // 代号统一以「型」结尾，形象图标字段已移除
    for (const name of names) expect(name.endsWith('型')).toBe(true)

    const skillNames = SPECIES_IDS.flatMap((id) => SPECIES[id].skills.map((s) => s.name))
    expect(new Set(skillNames).size).toBe(skillNames.length)
  })
})
