import { describe, expect, it } from 'vitest'
import { TURN_PHASES } from '../rules/phase'
import {
  CHANNELS,
  CONDITION_KINDS,
  DOC_KINDS,
  DSL_VERSION,
  EFFECT_KINDS,
  LOG_ROOTS,
  PHASES,
  PICK_MODES,
  ROLES,
  TARGET_SCOPES,
  TIMING_KINDS,
  VALUE_KINDS,
  VALUE_REF_NAMES,
} from './kinds'
import { DOC_SCHEMA_KEYS } from './validate'
import { registry } from './registry'

/**
 * 词表一致性守卫：kinds.ts 是唯一事实来源，校验器的字段表与引擎的阶段表都必须与它对齐，
 * 否则会出现"词表里有、校验器不认识"或"引擎阶段与 DSL 阶段名不一致"的静默漂移。
 */
describe('DSL 词表', () => {
  it('DSL 版本与文档一致', () => {
    expect(DSL_VERSION).toBe(1)
    expect(registry.dslVersion).toBe(DSL_VERSION)
  })

  it('阶段名与引擎的 TURN_PHASES 完全一致', () => {
    expect(PHASES).toEqual(TURN_PHASES)
  })

  it('校验器为每种数值节点都定义了字段表', () => {
    expect(Object.keys(DOC_SCHEMA_KEYS.value).sort()).toEqual([...VALUE_KINDS].sort())
  })

  it('校验器为每种条件都定义了字段表', () => {
    expect(Object.keys(DOC_SCHEMA_KEYS.condition).sort()).toEqual([...CONDITION_KINDS].sort())
  })

  it('校验器为每种指令都定义了字段表', () => {
    expect(Object.keys(DOC_SCHEMA_KEYS.effect).sort()).toEqual([...EFFECT_KINDS].sort())
  })

  it('词表本身没有重复项', () => {
    const tables = {
      DOC_KINDS,
      VALUE_KINDS,
      VALUE_REF_NAMES,
      CONDITION_KINDS,
      EFFECT_KINDS,
      PICK_MODES,
      ROLES,
      CHANNELS,
      TARGET_SCOPES,
      TIMING_KINDS,
      LOG_ROOTS,
      PHASES,
    }
    for (const [name, table] of Object.entries(tables)) {
      expect(new Set(table).size, `${name} 有重复项`).toBe(table.length)
    }
  })

  it('卡牌引用与取牌模式是封闭词表', () => {
    expect(PICK_MODES).toContain('specific')
    expect(PICK_MODES).toContain('random')
    expect(ROLES).toContain('opponent')
    expect(TIMING_KINDS).toContain('after-damage')
  })
})
