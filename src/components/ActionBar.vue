<script setup lang="ts">
import {
  actionButtons,
  canConfirmDiscard,
  cancelLabel,
  discardCount,
  errorMessage,
  humanPending,
  humanSkills,
  pendingHint,
  selectedCards,
  skillButtonLabel,
  submitActivate,
  submitCancel,
  submitDiscard,
  submitEndPhase,
  submitOption,
} from '../stores/game'
import { BTN, BTN_GHOST, BTN_PRIMARY } from './ui'

/**
 * 操作栏。这里**不做任何推导**：按钮列表、文案、可点状态全部来自 store 的选择器，
 * 组件只负责把它们摆出来。威胁与阶段提示统一走 `pendingHint`
 * （曾在这里另写一份，与 store 的文案重复且只在这一处可见）。
 */
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
            {{ skillButtonLabel(skill) }}
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
          <button :class="BTN_GHOST" @click="submitCancel">{{ cancelLabel }}</button>
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
          <button :class="BTN_GHOST" @click="submitCancel">{{ cancelLabel }}</button>
        </template>

        <!-- 弃牌阶段 -->
        <template v-else-if="humanPending.kind === 'discard'">
          <button :class="BTN_PRIMARY" :disabled="!canConfirmDiscard" @click="submitDiscard">
            确认弃置（{{ selectedCards.length }}/{{ discardCount }}）
          </button>
        </template>

        <!-- 可选发动技能由 PromptOverlay 处理 -->
        <span v-else class="text-sm text-ink-500">请选择是否发动技能</span>

        <!-- 阶段说明：唯一事实来源在 store 的 pendingHint（含威胁提示） -->
        <span v-if="pendingHint" class="text-sm text-ink-300">{{ pendingHint }}</span>
      </template>

      <span v-else class="text-sm text-ink-500">等待对手行动…</span>
    </div>

    <!-- 引擎拒绝的说明（含文档给出的目标/条件 reason）：不再静默失败 -->
    <p v-if="errorMessage" class="mt-2 text-sm text-ember-400">{{ errorMessage }}</p>
  </div>
</template>
