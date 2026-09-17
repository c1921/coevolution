import type { SpeciesDef, SpeciesId, SkillDef, SkillId } from '../types'

/**
 * 技能按效果分为四类：
 *  - transform 转化型：把一种牌当另一种牌使用 / 打出
 *  - passive   常驻型：修改规则
 *  - trigger   触发型：受到伤害后可选发动
 *  - active    主动型：出牌阶段主动发动
 */
const SKILLS: Record<SkillId, SkillDef> = {
  pounce: {
    id: 'pounce',
    name: '猛扑',
    kind: 'transform',
    text: '你可以将一张红色牌当【打击】使用或打出。',
  },
  roar: {
    id: 'roar',
    name: '怒吼',
    kind: 'passive',
    text: '你每回合的能量上限 +2。',
  },
  flicker: {
    id: 'flicker',
    name: '疾影',
    kind: 'transform',
    text: '你可以将【打击】当【防御】、【防御】当【打击】使用或打出。',
  },
  snatch: {
    id: 'snatch',
    name: '夺食',
    kind: 'trigger',
    text: '当你受到伤害后，你可以获得造成此伤害的牌。',
  },
  herb: {
    id: 'herb',
    name: '灵草',
    kind: 'transform',
    text: '你的回合外，你可以将一张红色牌当【回复】使用。',
  },
  mend: {
    id: 'mend',
    name: '疗愈',
    kind: 'active',
    text: '出牌阶段限一次，你可以弃置一张手牌，令一名已受伤的角色回复 1 点体力。',
  },
  menace: {
    id: 'menace',
    name: '威压',
    kind: 'passive',
    text: '你使用【打击】时，目标需依次打出两张【防御】才能抵消。',
  },
  overexert: {
    id: 'overexert',
    name: '透支',
    kind: 'active',
    text: '出牌阶段，你可以失去 1 点体力，然后摸两张牌。',
  },
  guile: {
    id: 'guile',
    name: '狡计',
    kind: 'trigger',
    text: '当你受到伤害后，你可以获得伤害来源的一张手牌。',
  },
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  tiger: {
    id: 'tiger',
    name: '虎',
    emoji: '🐯',
    maxHp: 4,
    skills: [SKILLS.pounce],
  },
  bear: {
    id: 'bear',
    name: '熊',
    emoji: '🐻',
    maxHp: 4,
    skills: [SKILLS.roar],
  },
  leopard: {
    id: 'leopard',
    name: '豹',
    emoji: '🐆',
    maxHp: 4,
    skills: [SKILLS.flicker],
  },
  wolf: {
    id: 'wolf',
    name: '狼',
    emoji: '🐺',
    maxHp: 4,
    skills: [SKILLS.snatch],
  },
  deer: {
    id: 'deer',
    name: '鹿',
    emoji: '🦌',
    maxHp: 3,
    skills: [SKILLS.herb, SKILLS.mend],
  },
  lion: {
    id: 'lion',
    name: '狮',
    emoji: '🦁',
    maxHp: 4,
    skills: [SKILLS.menace],
  },
  ox: {
    id: 'ox',
    name: '牛',
    emoji: '🐂',
    maxHp: 4,
    skills: [SKILLS.overexert],
  },
  fox: {
    id: 'fox',
    name: '狐',
    emoji: '🦊',
    maxHp: 3,
    skills: [SKILLS.guile],
  },
}

export const SPECIES_IDS: SpeciesId[] = [
  'tiger',
  'bear',
  'leopard',
  'wolf',
  'deer',
  'lion',
  'ox',
  'fox',
]

export function speciesDef(species: SpeciesId): SpeciesDef {
  return SPECIES[species]
}

/** 该物种是否拥有某技能 */
export function hasSkill(species: SpeciesId, skill: SkillId): boolean {
  return SPECIES[species].skills.some((s) => s.id === skill)
}

export function skillDef(skill: SkillId): SkillDef {
  return SKILLS[skill]
}
