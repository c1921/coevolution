import {
  CARD_REFS,
  EFFECT_KINDS,
  LOG_PLAYER_FIELDS,
  LOG_PLAYER_ROOTS,
  LOG_ROOTS,
  LOG_VAR_ROOTS,
  MOVE_ZONES,
  PHASES,
  PICK_MODES,
  RARITIES,
  REWARD_KINDS,
} from '../kinds'
import type { RoleRef, ZoneName } from '../kinds'
import type { DocContext, Issue, Obj, Ref } from './fieldTables'
import { CONTEXT_ROLES, DOC_FIELDS, EFFECT_KEYS, EFFECT_REQUIRED } from './fieldTables'
import {
  asArray,
  asObj,
  asString,
  checkCount,
  checkEnum,
  checkKeys,
  checkRole,
  optionalRole,
  push,
} from './primitives'
import { checkCondition } from './conditionNode'
import { checkValue } from './valueNode'

/**
 * 效果 `Effect` 的校验，含日志模板与 `move-cards` 的牌区组合约束。
 *
 * `checkEffect` 是一个 18 分支的 switch：它按 `Effect['kind']` 逐条检查字段与
 * 组合约束。分支只增不减，因此整块放在一个文件里，不按指令再拆。
 */

export function checkLogTemplate(
  template: unknown,
  path: string,
  roles: readonly RoleRef[],
  issues: Issue[],
): void {
  if (typeof template !== 'string' || template.length === 0) {
    push(issues, path, 'bad-type', 'template 必须是非空字符串')
    return
  }
  const stripped = template.replace(/\{[^{}]*\}/g, '')
  if (stripped.includes('{') || stripped.includes('}')) {
    push(issues, path, 'bad-placeholder', '日志模板存在不配对的占位符花括号')
  }
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const token = match[1] ?? ''
    const [root, field, extra] = token.split('.')
    if (!root || !LOG_ROOTS.includes(root as (typeof LOG_ROOTS)[number])) {
      push(issues, path, 'bad-placeholder', `未知占位符 {${token}}`)
      continue
    }
    const isPlayer = LOG_PLAYER_ROOTS.includes(root as (typeof LOG_PLAYER_ROOTS)[number])
    if (extra !== undefined) {
      push(issues, path, 'bad-placeholder', `占位符 {${token}} 层级过深`)
      continue
    }
    if (field !== undefined) {
      if (!isPlayer) {
        push(issues, path, 'bad-placeholder', `占位符 {${token}} 不能带字段`)
      } else if (!LOG_PLAYER_FIELDS.includes(field as (typeof LOG_PLAYER_FIELDS)[number])) {
        push(issues, path, 'bad-placeholder', `玩家占位符没有字段 ${field}`)
      }
    }
    if (isPlayer && !roles.includes(root as RoleRef)) {
      push(
        issues,
        path,
        'unknown-role',
        `当前语境不允许占位符 {${root}}（可用：${roles.join(' / ')}）`,
      )
    }
  }
}

export function checkEffects(
  node: unknown,
  path: string,
  context: DocContext,
  issues: Issue[],
  refs: Ref[],
): void {
  const list = asArray(node)
  if (!list) {
    push(issues, path, 'bad-type', '效果列表必须是数组')
    return
  }
  if (list.length === 0) {
    push(issues, path, 'bad-combination', '效果列表不能为空')
    return
  }
  list.forEach((item, i) => checkEffect(item, `${path}/${i}`, context, issues, refs))
}

export function checkEffect(
  node: unknown,
  path: string,
  context: DocContext,
  issues: Issue[],
  refs: Ref[],
): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', '效果必须是对象')
    return
  }
  const kind = checkEnum(obj, 'kind', EFFECT_KINDS, path, issues, 'unknown-instruction')
  if (!kind) return
  checkKeys(obj, path, EFFECT_KEYS[kind] ?? ['kind'], [], issues)
  // 条件必填（效果节点的必填按 kind 而定，无法写进并表，见 fieldSpecs 的 EFFECT_REQUIRED）
  for (const key of EFFECT_REQUIRED[kind] ?? []) {
    if (!(key in obj)) {
      push(issues, `${path}#/${key}`, 'missing-field', `缺少必填字段 ${key}`)
    }
  }
  const roles = CONTEXT_ROLES[context]

  switch (kind) {
    case 'log':
      checkLogTemplate(obj.template, `${path}#/template`, roles, issues)
      if (obj.vars !== undefined) {
        const vars = asObj(obj.vars)
        if (!vars) {
          push(issues, `${path}#/vars`, 'bad-type', 'vars 必须是对象')
        } else {
          for (const [name, value] of Object.entries(vars)) {
            if (!LOG_VAR_ROOTS.includes(name as (typeof LOG_VAR_ROOTS)[number])) {
              push(
                issues,
                `${path}#/vars#/${name}`,
                'bad-placeholder',
                `vars 只能绑定非玩家占位符（${LOG_VAR_ROOTS.join(' / ')}）`,
              )
              continue
            }
            checkValue(value, `${path}#/vars#/${name}`, roles, issues)
          }
        }
      }
      break
    case 'threat':
    case 'offset-threat':
    case 'lose-hp':
    case 'heal':
      checkRole(obj, 'target', roles, path, issues)
      checkValue(obj.amount, `${path}#/amount`, roles, issues)
      break
    case 'draw':
      checkRole(obj, 'target', roles, path, issues)
      checkValue(obj.count, `${path}#/count`, roles, issues)
      break
    case 'pay-energy':
    case 'gain-energy':
      checkRole(obj, 'target', roles, path, issues)
      checkValue(obj.amount, `${path}#/amount`, roles, issues)
      break
    case 'move-cards':
      checkMoveCards(obj, path, context, roles, issues, refs)
      break
    case 'record-card-use': {
      checkRole(obj, 'of', roles, path, issues)
      const cardKind = asString(obj.cardKind)
      if (cardKind) refs.push({ path: `${path}#/cardKind`, type: 'card', id: cardKind })
      else push(issues, `${path}#/cardKind`, 'bad-type', 'cardKind 必须是牌种 id')
      break
    }
    case 'record-skill-use': {
      const skill = asString(obj.skill)
      if (skill) refs.push({ path: `${path}#/skill`, type: 'skill', id: skill })
      else push(issues, `${path}#/skill`, 'bad-type', 'skill 必须是技能 id')
      break
    }
    case 'contest': {
      checkRole(obj, 'responder', roles, path, issues)
      const expected = asString(obj.expectedCard)
      if (expected) refs.push({ path: `${path}#/expectedCard`, type: 'card', id: expected })
      else push(issues, `${path}#/expectedCard`, 'bad-type', 'expectedCard 必须是牌种 id')
      checkValue(obj.need, `${path}#/need`, roles, issues)
      for (const branch of ['onMet', 'onUnmet'] as const) {
        if (obj[branch] !== undefined) {
          checkEffects(obj[branch], `${path}#/${branch}`, 'contest', issues, refs)
        }
      }
      break
    }
    case 'contest-contribute':
      if (context !== 'play') {
        push(issues, path, 'bad-combination', 'contest-contribute 只能出现在卡牌的 play 变体中')
      }
      checkValue(obj.amount, `${path}#/amount`, roles, issues)
      break
    case 'resolve-dying':
      if (context !== 'use-dying') {
        push(issues, path, 'bad-combination', 'resolve-dying 只能出现在卡牌的 dying 语境中')
      }
      checkRole(obj, 'of', roles, path, issues)
      break
    case 'skip-phase':
      checkEnum(obj, 'phase', PHASES, path, issues)
      break
    case 'extra-phase':
      checkEnum(obj, 'phase', PHASES, path, issues)
      checkEnum(obj, 'position', ['next', 'last'], path, issues)
      break
    case 'for-each-target':
      checkEffects(obj.effects, `${path}#/effects`, context, issues, refs)
      break
    case 'if':
      checkCondition(obj.condition, `${path}#/condition`, roles, issues, refs)
      checkEffects(obj.then, `${path}#/then`, context, issues, refs)
      if (obj.else !== undefined) {
        checkEffects(obj.else, `${path}#/else`, context, issues, refs)
      }
      break
    case 'offer-reward':
      checkOfferReward(obj, path, roles, issues)
      break
    default:
      break
  }
}

/**
 * `offer-reward` 的组合校验：卡牌奖励与服务奖励的字段互斥。
 *  - `card` 允许 `candidates` / `allowSkip` / `weights`；
 *  - `service` 允许 `healAmount` / `removeFloor`。
 * 用错一组字段会得到 `bad-combination`（带 JSON 路径），避免"写了却不生效"。
 */
function checkOfferReward(
  obj: Obj,
  path: string,
  roles: readonly RoleRef[],
  issues: Issue[],
): void {
  const reward = checkEnum(obj, 'reward', REWARD_KINDS, path, issues, 'unknown-instruction')
  if (!reward) return

  const cardOnly = ['candidates', 'allowSkip', 'weights'] as const
  const serviceOnly = ['healAmount', 'removeFloor'] as const
  const forbidden = reward === 'card' ? serviceOnly : cardOnly
  for (const key of forbidden) {
    if (obj[key] !== undefined) {
      push(
        issues,
        `${path}#/${key}`,
        'bad-combination',
        `${key} 只能用于 ${reward === 'card' ? 'service' : 'card'} 奖励`,
      )
    }
  }

  if (reward === 'card') {
    if (obj.candidates !== undefined) checkCount(obj, 'candidates', path, issues, 1)
    if (obj.allowSkip !== undefined && typeof obj.allowSkip !== 'boolean') {
      push(issues, `${path}#/allowSkip`, 'bad-type', 'allowSkip 必须是布尔值')
    }
    if (obj.weights !== undefined) checkWeights(obj.weights, `${path}#/weights`, issues)
  } else {
    if (obj.healAmount !== undefined) {
      checkValue(obj.healAmount, `${path}#/healAmount`, roles, issues)
    }
    if (obj.removeFloor !== undefined) checkCount(obj, 'removeFloor', path, issues, 0)
  }
}

/** 稀有度权重：三个键都必须给出非负整数 */
function checkWeights(node: unknown, path: string, issues: Issue[]): void {
  const obj = asObj(node)
  if (!obj) {
    push(issues, path, 'bad-type', 'weights 必须是对象')
    return
  }
  for (const key of Object.keys(obj)) {
    if (!RARITIES.includes(key as (typeof RARITIES)[number])) {
      push(issues, `${path}#/${key}`, 'unknown-key', `weights 只接受稀有度 ${RARITIES.join(' / ')}`)
    }
  }
  for (const rarity of RARITIES) {
    const value = obj[rarity]
    if (value === undefined) {
      push(issues, `${path}#/${rarity}`, 'missing-field', `weights 缺少稀有度 ${rarity}`)
      continue
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      push(issues, `${path}#/${rarity}`, 'bad-number', '权重必须是非负整数')
    }
  }
}

function checkMoveCards(
  obj: Obj,
  path: string,
  context: DocContext,
  roles: readonly RoleRef[],
  issues: Issue[],
  refs: Ref[],
): void {
  for (const side of ['from', 'to'] as const) {
    const zone = asObj(obj[side])
    if (!zone) {
      push(issues, `${path}#/${side}`, 'bad-type', `${side} 必须是牌区对象`)
      continue
    }
    checkKeys(
      zone,
      `${path}#/${side}`,
      DOC_FIELDS.zoneRef.allowed,
      DOC_FIELDS.zoneRef.required,
      issues,
    )
    const zoneName = checkEnum(zone, 'zone', MOVE_ZONES, `${path}#/${side}`, issues)
    optionalRole(zone, 'of', roles, `${path}#/${side}`, issues)
    void zoneName
  }

  const pick = asObj(obj.pick)
  if (!pick) {
    push(issues, `${path}#/pick`, 'bad-type', 'pick 必须是取牌对象')
    return
  }
  checkKeys(pick, `${path}#/pick`, DOC_FIELDS.pick.allowed, DOC_FIELDS.pick.required, issues)
  const mode = checkEnum(pick, 'mode', PICK_MODES, `${path}#/pick`, issues, 'unknown-pick-mode')
  if (!mode) return

  const fromZone = asObj(obj.from)?.zone as ZoneName | undefined
  const toZone = asObj(obj.to)?.zone as ZoneName | undefined

  if (mode === 'random') {
    checkCount(pick, 'count', `${path}#/pick`, issues, 1)
    if (fromZone !== 'hand') {
      push(issues, `${path}#/pick`, 'bad-combination', 'random 只能从手牌取牌')
    }
  }
  if (mode === 'all') {
    if (fromZone === undefined || !['hand', 'discard'].includes(fromZone)) {
      push(issues, `${path}#/pick`, 'bad-combination', 'all 只能作用于手牌或弃牌堆')
    }
  }
  if (mode === 'specific') {
    const card = checkEnum(pick, 'card', CARD_REFS, `${path}#/pick`, issues)
    if (fromZone !== 'processing') {
      push(issues, `${path}#/pick`, 'bad-combination', 'specific 只能从处理区取牌')
    }
    void card
  }
  if (mode === 'played') {
    if (!['use-play', 'use-dying', 'play'].includes(context)) {
      push(issues, `${path}#/pick`, 'bad-combination', 'played 只能出现在卡牌的使用/打出效果中')
    }
    if (fromZone !== 'hand') {
      push(issues, `${path}#/pick`, 'bad-combination', 'played 只能从手牌取牌')
    }
  }
  if (mode === 'cost') {
    if (context !== 'activate') {
      push(issues, `${path}#/pick`, 'bad-combination', 'cost 只能出现在主动技的发动效果中')
    }
    if (fromZone !== 'hand') {
      push(issues, `${path}#/pick`, 'bad-combination', 'cost 只能从手牌取牌')
    }
  }
  if (toZone === 'processing' && fromZone !== 'hand' && mode !== 'specific') {
    push(issues, `${path}#/to`, 'bad-combination', '只有手牌可以进入处理区')
  }

  const cardKind = asString(pick.cardKind)
  if (cardKind) refs.push({ path: `${path}#/pick/cardKind`, type: 'card', id: cardKind })
}
