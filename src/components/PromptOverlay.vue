<script setup lang="ts">
import { skillDef } from '../game/data/species'
import {
  backToStart,
  beginDraft,
  cancelTarget,
  chooseTarget,
  chosenTargets,
  confirmTargets,
  errorMessage,
  humanPending,
  over,
  pendingTarget,
  pendingTargetChoice,
  pendingTargetOptions,
  resultText,
  submitTrigger,
  targetPickerHint,
  targetPickerTitle,
  targetsReady,
} from '../stores/game'
import { BTN, BTN_GHOST, BTN_PRIMARY } from './ui'

/**
 * 覆盖层：目标选择器、可选技能的询问、终局结算。
 * 标题与说明文案来自 store 的选择器（`targetPickerTitle` / `targetPickerHint`），
 * 组件只负责渲染。
 */
</script>

<template>
  <!-- 目标选择器：候选来自文档的 TargetSpec，不可选的附文档 reason；多目标需勾选后确认 -->
  <div
    v-if="pendingTarget && humanPending?.kind === 'play'"
    class="fixed inset-0 z-20 grid place-items-center bg-black/60 p-4"
  >
    <div class="w-full max-w-sm rounded-xl border border-table-600 bg-table-800 p-5">
      <p class="text-center text-lg font-semibold text-ink-100">{{ targetPickerTitle }}</p>
      <p class="mt-1 text-center text-sm text-ink-300">{{ targetPickerHint }}</p>

      <div class="mt-4 flex flex-col gap-2">
        <div v-for="option in pendingTargetOptions" :key="option.index">
          <button
            :class="[
              option.selectable ? (chosenTargets.includes(option.index) ? BTN : BTN_PRIMARY) : BTN,
              'w-full',
            ]"
            :disabled="!option.selectable"
            @click="chooseTarget(option.index)"
          >
            {{ option.label }}{{ chosenTargets.includes(option.index) ? ' ✓' : '' }}
          </button>
          <p v-if="option.reason" class="mt-1 text-xs text-ink-500">{{ option.reason }}</p>
        </div>
      </div>

      <p v-if="errorMessage" class="mt-3 text-center text-sm text-ember-400">{{ errorMessage }}</p>

      <div class="mt-5 flex justify-center gap-3">
        <button
          v-if="pendingTargetChoice?.multi"
          :class="BTN_PRIMARY"
          :disabled="!targetsReady"
          @click="confirmTargets"
        >
          确定（{{ chosenTargets.length }}/{{ pendingTargetChoice.size }}）
        </button>
        <button :class="BTN_GHOST" @click="cancelTarget">取消</button>
      </div>
    </div>
  </div>

  <!-- 受到伤害后的可选发动技能 -->
  <div
    v-if="humanPending?.kind === 'trigger'"
    class="fixed inset-0 z-20 grid place-items-center bg-black/60 p-4"
  >
    <div class="w-full max-w-sm rounded-xl border border-table-600 bg-table-800 p-5 text-center">
      <p class="text-lg font-semibold text-ink-100">
        {{ skillDef(humanPending.skill).name }}
      </p>
      <p class="mt-2 text-sm text-ink-300">{{ skillDef(humanPending.skill).text }}</p>
      <div class="mt-5 flex justify-center gap-3">
        <button :class="BTN_PRIMARY" @click="submitTrigger(true)">发动</button>
        <button :class="BTN_GHOST" @click="submitTrigger(false)">不发动</button>
      </div>
    </div>
  </div>

  <!-- 终局 -->
  <div v-if="over" class="fixed inset-0 z-30 grid place-items-center bg-black/70 p-4">
    <div class="w-full max-w-sm rounded-xl border border-jade-400 bg-table-800 p-6 text-center">
      <p class="text-2xl font-bold text-jade-400">对局结束</p>
      <p class="mt-2 text-ink-100">{{ resultText }}</p>
      <div class="mt-5 flex justify-center gap-3">
        <button :class="BTN_PRIMARY" @click="beginDraft()">再来一局</button>
        <button :class="BTN" @click="backToStart()">返回首页</button>
      </div>
    </div>
  </div>
</template>
