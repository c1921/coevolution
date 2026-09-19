<script setup lang="ts">
import { computed } from 'vue'
import type { CardOption } from '../game/skills'
import type { Card, SkillId } from '../game/types'
import {
  discardCount,
  errorMessage,
  humanPending,
  humanSkills,
  humanThreat,
  legalOptions,
  optionText,
  selectedCards,
  skillButtonLabel,
  submitActivate,
  submitCancel,
  submitDiscard,
  submitEndPhase,
  submitOption,
} from '../stores/game'
import { BTN, BTN_GHOST, BTN_PRIMARY } from './ui'

interface ActionButton {
  card: Card
  option: CardOption
  label: string
}

/** 已选手牌的合法操作；把牌与选项绑在一起，模板里无需再做空值判断 */
const actionButtons = computed<ActionButton[]>(() => {
  const card = selectedCards.value[0]
  if (!card) return []
  return legalOptions(card).map((option) => ({
    card,
    option,
    label: optionText(option),
  }))
})

const canDiscard = computed(() => selectedCards.value.length === discardCount.value)

/** 主动技按钮文案由 store 按技能文档生成（需要先选牌时提示） */
function skillButtonText(skill: SkillId): string {
  return skillButtonLabel(skill)
}
</script>

<template>
  <div class="rounded-xl border border-table-700 bg-table-900 p-3">
    <div class="flex flex-wrap items-center gap-2">
      <template v-if="humanPending">
        <!-- 出牌阶段 -->
        <template v-if="humanPending.kind === 'play'">
          <button
            v-for="(item, index) in actionButtons"
            :key="`use-${index}`"
            :class="BTN_PRIMARY"
            @click="submitOption(item.card, item.option)"
          >
            {{ item.label }}
          </button>
          <button
            v-for="skill in humanSkills"
            :key="skill"
            :class="BTN"
            @click="submitActivate(skill)"
          >
            {{ skillButtonText(skill) }}
          </button>
          <button :class="BTN_GHOST" @click="submitEndPhase">结束出牌阶段</button>
        </template>

        <!-- 响应【打击】 -->
        <template v-else-if="humanPending.kind === 'respond'">
          <button
            v-for="(item, index) in actionButtons"
            :key="`play-${index}`"
            :class="BTN_PRIMARY"
            @click="submitOption(item.card, item.option)"
          >
            {{ item.label }}
          </button>
          <button :class="BTN_GHOST" @click="submitCancel">放弃响应（承受伤害）</button>
        </template>

        <!-- 濒死求【回复】 -->
        <template v-else-if="humanPending.kind === 'dying'">
          <button
            v-for="(item, index) in actionButtons"
            :key="`dying-${index}`"
            :class="BTN_PRIMARY"
            @click="submitOption(item.card, item.option)"
          >
            {{ item.label }}
          </button>
          <button :class="BTN_GHOST" @click="submitCancel">
            {{ humanPending.dying === 0 ? '放弃自救' : '放弃救援' }}
          </button>
        </template>

        <!-- 弃牌阶段 -->
        <template v-else-if="humanPending.kind === 'discard'">
          <button :class="BTN_PRIMARY" :disabled="!canDiscard" @click="submitDiscard">
            确认弃置（{{ selectedCards.length }}/{{ discardCount }}）
          </button>
        </template>

        <!-- 可选发动技能由 PromptOverlay 处理 -->
        <span v-else class="text-sm text-ink-500">请选择是否发动技能</span>

        <span v-if="humanPending.kind !== 'trigger'" class="text-sm text-ink-500">
          {{ selectedCards.length === 0 ? '（先点选一张手牌）' : '' }}
        </span>
        <!-- 威胁会在自己的回合结束时结算为伤害：出牌阶段给一句可直接照做的提示 -->
        <span v-if="humanPending.kind === 'play' && humanThreat > 0" class="text-sm text-ember-400">
          你身上有 {{ humanThreat }} 点威胁：回合结束时结算为伤害，可打出【防御】抵消
        </span>
      </template>

      <span v-else class="text-sm text-ink-500">等待对手行动…</span>
    </div>

    <!-- 引擎拒绝的说明（含文档给出的目标/条件 reason）：不再静默失败 -->
    <p v-if="errorMessage" class="mt-2 text-sm text-ember-400">{{ errorMessage }}</p>
  </div>
</template>
