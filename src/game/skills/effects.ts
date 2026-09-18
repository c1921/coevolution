import { skillDef } from '../data/species'
import { log, plainLabel, playerLabel } from '../log'
import { findInHand, moveHandToDiscard } from '../rules/cardZones'
import { loseHp } from '../rules/damage'
import { recordSkillUse } from '../rules/usage'
import type { Card, GameState, PlayerIndex, SkillId } from '../types'
import { RuleError } from '../util'

/**
 * 主动技（出牌阶段发动）：透支 / 疗愈。
 * 调用方（引擎）已完成合法性校验，这里只负责结算与战报。
 *
 * S7：本文件的 id 分支会被 skills/*.json 的 activate 规格 + 效果解释器取代，
 * 触发型技能（夺食 / 狡计）已经迁走（见 dsl/event.ts 的 runTrigger）。
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
    // 失去体力会立即做濒死检查，存活之后才摸两张牌。
    // S7：这段流程改由 skills/overexert.json 的 activate.effects / after 提供。
    state.stack.push({
      kind: 'effects',
      effects: [{ kind: 'draw', target: 'self', count: { kind: 'const', value: 2 } }],
      ctx: { self: p, active: state.active, costCards: [] },
    })
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
