import { CHANNELS, DOC_KINDS, DSL_VERSION, USE_CONTEXTS } from '../kinds'
import type { RoleRef } from '../kinds'
import type { Doc } from '../types'
import type { Issue, Obj, RawDoc, Ref } from './fieldTables'
import { CONTEXT_ROLES, DOC_FIELDS } from './fieldTables'
import {
  asArray,
  asNumber,
  asObj,
  asString,
  checkCount,
  checkEnum,
  checkKeys,
  checkText,
  isObj,
  push,
} from './primitives'
import { checkCondition } from './conditionNode'
import { checkEffects } from './effectNode'
import { checkValue } from './valueNode'
import {
  checkModifier,
  checkTarget,
  checkTiming,
  checkTransform,
  guardMultiTargetEffects,
  targetDeclaresCount,
} from './targetNode'

/**
 * 按文档种类分派的校验：公共信封（dslVersion / id / priority）之后，
 * 交给对应的 `check<Kind>`。
 *
 * 注意 `checkDoc` 在结构不合法时会**伪造**一份最小的 `rule` 文档返回：
 * 契约是"只要 issues 非空，调用方必须抛错"，这份返回值只是让类型完整、
 * 绝不会被使用（见 validate/index.ts 顶注）。
 */

export function checkDoc(raw: RawDoc, issues: Issue[], refs: Ref[], seenIds: Set<string>): Doc {
  const path = raw.path
  if (!isObj(raw.value)) {
    push(issues, path, 'bad-type', '文档必须是 JSON 对象')
    return {
      dslVersion: DSL_VERSION,
      kind: 'rule',
      id: path,
      on: { at: 'turn-start' },
      effects: [],
    }
  }
  const node = raw.value
  const kind = checkEnum(node, 'kind', DOC_KINDS, path, issues, 'unknown-kind')

  if (!kind) {
    return {
      dslVersion: DSL_VERSION,
      kind: 'rule',
      id: path,
      on: { at: 'turn-start' },
      effects: [],
    }
  }

  if (node.dslVersion !== DSL_VERSION) {
    push(
      issues,
      `${path}#/dslVersion`,
      'version',
      `dslVersion 必须是 ${DSL_VERSION}，实际为 ${JSON.stringify(node.dslVersion)}`,
    )
  }
  const id = asString(node.id)
  if (!id || id.length === 0) {
    push(issues, `${path}#/id`, 'bad-type', 'id 必须是非空字符串')
  } else if (seenIds.has(id)) {
    push(issues, `${path}#/id`, 'duplicate-id', `id ${id} 重复`)
  } else {
    seenIds.add(id)
  }
  checkCount(node, 'priority', path, issues, 0)

  switch (kind) {
    case 'species':
      checkSpecies(node, path, issues, refs)
      break
    case 'skill':
      checkSkill(node, path, issues, refs)
      break
    case 'card':
      checkCard(node, path, issues, refs)
      break
    case 'ruleset':
      checkRuleset(node, path, issues)
      break
    case 'deck':
      checkDeck(node, path, issues, refs)
      break
    case 'rule':
      checkRule(node, path, issues, refs)
      break
  }

  return node as unknown as Doc
}

export function checkSpecies(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.species.allowed, DOC_FIELDS.species.required, issues)
  checkText(node, 'name', path, issues)
  checkCount(node, 'maxHp', path, issues, 1)
  const skills = asArray(node.skills)
  if (!skills) {
    push(issues, `${path}#/skills`, 'bad-type', 'skills 必须是数组')
  } else {
    skills.forEach((item, i) => {
      if (typeof item === 'string')
        refs.push({ path: `${path}#/skills/${i}`, type: 'skill', id: item })
      else push(issues, `${path}#/skills/${i}`, 'bad-type', '技能引用必须是字符串 id')
    })
  }
  const deck = asString(node.deck)
  if (deck) refs.push({ path: `${path}#/deck`, type: 'deck', id: deck })
  else push(issues, `${path}#/deck`, 'bad-type', 'deck 必须是牌组 id')
}

export function checkSkill(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.skill.allowed, DOC_FIELDS.skill.required, issues)
  for (const key of ['name', 'text'] as const) checkText(node, key, path, issues)

  const hasParts =
    node.modifiers !== undefined ||
    node.transforms !== undefined ||
    node.trigger !== undefined ||
    node.activate !== undefined
  if (!hasParts) {
    push(
      issues,
      path,
      'bad-combination',
      '技能必须至少声明 modifiers / transforms / trigger / activate 之一',
    )
  }

  if (node.modifiers !== undefined) {
    const list = asArray(node.modifiers)
    if (!list || list.length === 0) {
      push(issues, `${path}#/modifiers`, 'bad-combination', 'modifiers 不能为空数组')
    } else {
      list.forEach((item, i) => checkModifier(item, `${path}#/modifiers/${i}`, issues, refs))
    }
  }

  if (node.transforms !== undefined) {
    const list = asArray(node.transforms)
    if (!list || list.length === 0) {
      push(issues, `${path}#/transforms`, 'bad-combination', 'transforms 不能为空数组')
    } else {
      list.forEach((item, i) => checkTransform(item, `${path}#/transforms/${i}`, issues, refs))
    }
  }

  if (node.trigger !== undefined) {
    const trigger = asObj(node.trigger)
    if (!trigger) {
      push(issues, `${path}#/trigger`, 'bad-type', 'trigger 必须是对象')
    } else {
      checkKeys(
        trigger,
        `${path}#/trigger`,
        DOC_FIELDS.trigger.allowed,
        DOC_FIELDS.trigger.required,
        issues,
      )
      checkTiming(trigger.on, `${path}#/trigger#/on`, issues)
      if (trigger.optional !== undefined && typeof trigger.optional !== 'boolean') {
        push(issues, `${path}#/trigger#/optional`, 'bad-type', 'optional 必须是布尔值')
      }
      const at = asObj(trigger.on)?.at
      if (trigger.optional === true && at !== 'after-damage') {
        push(
          issues,
          `${path}#/trigger#/optional`,
          'bad-combination',
          '当前只有 after-damage 时机的技能支持可选发动',
        )
      }
      if (trigger.when !== undefined) {
        checkConditionList(
          trigger.when,
          `${path}#/trigger#/when`,
          CONTEXT_ROLES.trigger,
          issues,
          refs,
        )
      }
      checkEffects(trigger.effects, `${path}#/trigger#/effects`, 'trigger', issues, refs)
      if (trigger.after !== undefined) {
        checkEffects(trigger.after, `${path}#/trigger#/after`, 'trigger', issues, refs)
      }
    }
  }

  if (node.activate !== undefined) {
    checkActivate(node.activate, `${path}#/activate`, issues, refs)
  }
}

export function checkConditionList(
  node: unknown,
  path: string,
  roles: readonly RoleRef[],
  issues: Issue[],
  refs: Ref[],
): void {
  const list = asArray(node)
  if (!list || list.length === 0) {
    push(issues, path, 'bad-combination', '条件列表不能为空')
    return
  }
  list.forEach((item, i) => checkCondition(item, `${path}/${i}`, roles, issues, refs))
}

export function checkActivate(node: unknown, path: string, issues: Issue[], refs: Ref[]): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', 'activate 必须是对象')
    return
  }
  checkKeys(obj, path, DOC_FIELDS.activate.allowed, DOC_FIELDS.activate.required, issues)
  const timing = checkEnum(obj, 'timing', ['play'], path, issues)
  void timing
  if (obj.oncePerTurn !== undefined && typeof obj.oncePerTurn !== 'boolean') {
    push(issues, `${path}#/oncePerTurn`, 'bad-type', 'oncePerTurn 必须是布尔值')
  }
  if (obj.costCards !== undefined) {
    const cost = asObj(obj.costCards)
    if (!cost) {
      push(issues, `${path}#/costCards`, 'bad-type', 'costCards 必须是对象')
    } else {
      checkKeys(
        cost,
        `${path}#/costCards`,
        DOC_FIELDS.costCards.allowed,
        DOC_FIELDS.costCards.required,
        issues,
      )
      checkValue(cost.count, `${path}#/costCards#/count`, ['self'], issues)
      const cardKind = asString(cost.cardKind)
      if (cardKind) refs.push({ path: `${path}#/costCards#/cardKind`, type: 'card', id: cardKind })
    }
  }
  if (obj.requires !== undefined) {
    checkConditionList(obj.requires, `${path}#/requires`, CONTEXT_ROLES.activate, issues, refs)
  }
  if (obj.target !== undefined) {
    // 主动技仍是单选：count 只在卡牌的使用变体上生效
    checkTarget(obj.target, `${path}#/target`, issues, refs, false)
  }
  checkEffects(obj.effects, `${path}#/effects`, 'activate', issues, refs)
  if (obj.after !== undefined) {
    checkEffects(obj.after, `${path}#/after`, 'activate', issues, refs)
  }
  if (obj.ui !== undefined) {
    const ui = asObj(obj.ui)
    if (!ui) {
      push(issues, `${path}#/ui`, 'bad-type', 'ui 必须是对象')
    } else {
      checkKeys(ui, `${path}#/ui`, DOC_FIELDS.ui.allowed, DOC_FIELDS.ui.required, issues)
      if (ui.buttonLabel !== undefined) checkText(ui, 'buttonLabel', `${path}#/ui`, issues)
    }
  }
}

export function checkCard(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.card.allowed, DOC_FIELDS.card.required, issues)
  for (const key of ['name', 'short', 'text'] as const) checkText(node, key, path, issues)
  checkValue(node.cost, `${path}#/cost`, ['self'], issues)
  const cost = asObj(node.cost)
  if (cost && cost.kind === 'const') {
    const value = asNumber(cost.value)
    if (value !== undefined && value < 1) {
      push(
        issues,
        `${path}#/cost#/value`,
        'cost-below-minimum',
        '费用必须 ≥ 1：0 费与「无次数限制的打击」组合会形成无限连击',
      )
    }
  }

  const hasUse = node.use !== undefined
  const hasPlay = node.play !== undefined
  if (!hasUse && !hasPlay) {
    push(issues, path, 'bad-combination', '卡牌至少需要 use 或 play 之一')
  }

  if (hasUse) {
    const list = asArray(node.use)
    if (!list || list.length === 0) {
      push(issues, `${path}#/use`, 'bad-combination', 'use 不能为空数组')
    } else {
      const seen = new Set<string>()
      list.forEach((item, i) => {
        const variantPath = `${path}#/use/${i}`
        const variant = asObj(item)
        if (!variant) {
          push(issues, variantPath, 'bad-type', 'use 变体必须是对象')
          return
        }
        checkKeys(
          variant,
          variantPath,
          DOC_FIELDS.useVariant.allowed,
          DOC_FIELDS.useVariant.required,
          issues,
        )
        const context = checkEnum(variant, 'context', USE_CONTEXTS, variantPath, issues)
        if (context) {
          if (seen.has(context)) {
            push(issues, `${variantPath}#/context`, 'duplicate-id', `use 语境 ${context} 重复`)
          }
          seen.add(context)
        }
        if (variant.target !== undefined) {
          checkTarget(variant.target, `${variantPath}#/target`, issues, refs)
        }
        if (variant.requires !== undefined) {
          checkConditionList(
            variant.requires,
            `${variantPath}#/requires`,
            context === 'dying' ? CONTEXT_ROLES['use-dying'] : CONTEXT_ROLES['use-play'],
            issues,
            refs,
          )
        }
        checkEffects(
          variant.effects,
          `${variantPath}#/effects`,
          context === 'dying' ? 'use-dying' : 'use-play',
          issues,
          refs,
        )
        if (variant.after !== undefined) {
          checkEffects(
            variant.after,
            `${variantPath}#/after`,
            context === 'dying' ? 'use-dying' : 'use-play',
            issues,
            refs,
          )
        }
        // 多目标变体：目标引用必须写在 for-each-target 内（否则 ctx.target 不会绑定）
        if (targetDeclaresCount(variant.target)) {
          guardMultiTargetEffects(variant.effects, `${variantPath}#/effects`, issues)
          if (variant.after !== undefined) {
            guardMultiTargetEffects(variant.after, `${variantPath}#/after`, issues)
          }
        }
      })
    }
  }

  if (hasPlay) {
    const play = asObj(node.play)
    if (!play) {
      push(issues, `${path}#/play`, 'bad-type', 'play 必须是对象')
    } else {
      checkKeys(
        play,
        `${path}#/play`,
        DOC_FIELDS.playVariant.allowed,
        DOC_FIELDS.playVariant.required,
        issues,
      )
      const respondsTo = asString(play.respondsTo)
      if (respondsTo) refs.push({ path: `${path}#/play#/respondsTo`, type: 'card', id: respondsTo })
      else push(issues, `${path}#/play#/respondsTo`, 'bad-type', 'respondsTo 必须是牌种 id')
      if (play.requires !== undefined) {
        checkConditionList(
          play.requires,
          `${path}#/play#/requires`,
          CONTEXT_ROLES.play,
          issues,
          refs,
        )
      }
      checkEffects(play.effects, `${path}#/play#/effects`, 'play', issues, refs)
    }
  }
}

export function checkRuleset(node: Obj, path: string, issues: Issue[]): void {
  checkKeys(node, path, DOC_FIELDS.ruleset.allowed, DOC_FIELDS.ruleset.required, issues)
  const channels = asObj(node.channels)
  if (!channels) {
    push(issues, `${path}#/channels`, 'bad-type', 'channels 必须是对象')
    return
  }
  for (const channel of CHANNELS) {
    if (!(channel in channels)) {
      push(issues, `${path}#/channels#/${channel}`, 'missing-field', `缺少通道 ${channel} 的基准值`)
    }
  }
  for (const [key, value] of Object.entries(channels)) {
    if (!CHANNELS.includes(key as (typeof CHANNELS)[number])) {
      push(issues, `${path}#/channels#/${key}`, 'unknown-channel', `未知修正通道 ${key}`)
      continue
    }
    const num = asNumber(value)
    if (num === undefined || !Number.isInteger(num) || num < 0) {
      push(issues, `${path}#/channels#/${key}`, 'bad-number', '通道基准值必须是非负整数')
    }
  }
}

export function checkDeck(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.deck.allowed, DOC_FIELDS.deck.required, issues)
  const list = asArray(node.cards)
  if (!list || list.length === 0) {
    push(issues, `${path}#/cards`, 'bad-combination', 'cards 不能为空数组')
    return
  }
  list.forEach((item, i) => {
    const entryPath = `${path}#/cards/${i}`
    const entry = asObj(item)
    if (!entry) {
      push(issues, entryPath, 'bad-type', '牌组条目必须是对象')
      return
    }
    checkKeys(entry, entryPath, DOC_FIELDS.deckEntry.allowed, DOC_FIELDS.deckEntry.required, issues)
    const cardKind = asString(entry.kind)
    if (cardKind) refs.push({ path: `${entryPath}#/kind`, type: 'card', id: cardKind })
    else push(issues, `${entryPath}#/kind`, 'bad-type', 'kind 必须是牌种 id')
    checkCount(entry, 'count', entryPath, issues, 1)
  })
}

export function checkRule(node: Obj, path: string, issues: Issue[], refs: Ref[]): void {
  checkKeys(node, path, DOC_FIELDS.rule.allowed, DOC_FIELDS.rule.required, issues)
  checkTiming(node.on, `${path}#/on`, issues)
  if (node.when !== undefined) {
    checkConditionList(node.when, `${path}#/when`, CONTEXT_ROLES.rule, issues, refs)
  }
  checkEffects(node.effects, `${path}#/effects`, 'rule', issues, refs)
}
