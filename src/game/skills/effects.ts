import { skillDef } from '../data/species'
import { log, plainLabel, playerLabel } from '../log'
import { nextInt } from '../rng'
import { findInHand, moveHandToDiscard, takeFromProcessing } from '../rules/cardZones'
import { loseHp } from '../rules/damage'
import { recordSkillUse } from '../rules/usage'
import type { Card, DamageCtx, GameState, PlayerIndex, SkillId } from '../types'
import { RuleError } from '../util'

/**
 * 主动技（出牌阶段发动）：透支 / 疗愈。
 * 调用方（引擎）已完成合法性校验，这里只负责结算与战报。
 */
export function applyActiveSkill(
  state: GameState,
  p: PlayerIndex,
  skill: SkillId,
  card: Card | undefined,
  target: PlayerIndex,
): void {
  if (skill === 'overexert') {
    log(state, `${playerLabel(state, p)} 发动【透支】`)
    // 失去体力会立即做濒死检查，存活之后才摸两张牌
    state.stack.push({ kind: 'draw', player: p, count: 2 })
    loseHp(state, p, 1)
    return
  }

  if (skill === 'mend') {
    const real = card ? findInHand(state, p, card.uid) : undefined
    if (!real) throw new RuleError('疗愈需要弃置一张手牌')
    moveHandToDiscard(state, p, real)
    // 疗愈是「出牌阶段限一次」的技能，记入本回合的技能使用记录
    recordSkillUse(state, p, 'mend')

    const targetPlayer = state.players[target]
    targetPlayer.hp = Math.min(targetPlayer.hp + 1, targetPlayer.maxHp)
    log(
      state,
      `${playerLabel(state, p)} 发动【疗愈】，弃置 ${plainLabel(real)}，令 ${playerLabel(state, target)} 回复 1 点体力（体力 ${targetPlayer.hp}/${targetPlayer.maxHp}）`,
    )
    return
  }

  throw new RuleError(`【${skillDef(skill).name}】无法主动发动`)
}

/**
 * 「受到伤害后」的可选技能：夺食 / 狡计。
 * 注意此刻造成伤害的牌仍在处理区，夺食正是从处理区把它取回手牌。
 */
export function applyTriggerSkill(
  state: GameState,
  p: PlayerIndex,
  skill: SkillId,
  ctx: DamageCtx,
): void {
  if (skill === 'snatch') {
    const virtual = ctx.card
    const taken = virtual ? takeFromProcessing(state, virtual.source.uid) : undefined
    if (!taken) {
      log(state, `${playerLabel(state, p)} 发动【夺食】，但该牌已不在处理区`)
      return
    }
    // 夺来的牌从此归获得者所有：之后弃置 / 洗回都进获得者自己的牌区
    state.players[p].hand.push(taken.card)
    log(state, `${playerLabel(state, p)} 发动【夺食】，获得 ${plainLabel(taken.card)}`)
    return
  }

  if (skill === 'guile') {
    const source = state.players[ctx.source]
    if (source.hand.length === 0) {
      log(state, `${playerLabel(state, p)} 发动【狡计】，但对方没有手牌`)
      return
    }
    const pick = nextInt(state.rngState, source.hand.length)
    state.rngState = pick.state
    const taken = source.hand.splice(pick.value, 1)[0]
    if (!taken) throw new RuleError('狡计取牌失败')
    state.players[p].hand.push(taken)
    // 手牌是隐藏信息，战报不公开具体是哪一张
    log(
      state,
      `${playerLabel(state, p)} 发动【狡计】，获得 ${playerLabel(state, ctx.source)} 的一张手牌`,
    )
    return
  }

  throw new RuleError(`【${skillDef(skill).name}】不是受到伤害后可发动的技能`)
}
