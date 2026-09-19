<script setup lang="ts">
import { skillDef } from '../game/data/species'
import {
  backToStart,
  beginDraft,
  cancelSkillTarget,
  chooseSkillTarget,
  humanPending,
  over,
  pendingSkillTarget,
  pendingSkillTargetOptions,
  resultText,
  submitTrigger,
} from '../stores/game'
import { BTN, BTN_GHOST, BTN_PRIMARY } from './ui'
</script>

<template>
  <!-- 主动技的目标选择器：候选来自文档的 TargetSpec，不可选的附文档 reason -->
  <div
    v-if="pendingSkillTarget && humanPending?.kind === 'play'"
    class="fixed inset-0 z-20 grid place-items-center bg-black/60 p-4"
  >
    <div class="w-full max-w-sm rounded-xl border border-table-600 bg-table-800 p-5">
      <p class="text-center text-lg font-semibold text-ink-100">
        发动【{{ skillDef(pendingSkillTarget).name }}】
      </p>
      <p class="mt-1 text-center text-sm text-ink-300">选择目标</p>

      <div class="mt-4 flex flex-col gap-2">
        <div v-for="option in pendingSkillTargetOptions" :key="option.index">
          <button
            :class="[option.selectable ? BTN_PRIMARY : BTN, 'w-full']"
            :disabled="!option.selectable"
            @click="chooseSkillTarget(option.index)"
          >
            {{ option.label }}
          </button>
          <p v-if="option.reason" class="mt-1 text-xs text-ink-500">{{ option.reason }}</p>
        </div>
      </div>

      <div class="mt-5 flex justify-center">
        <button :class="BTN_GHOST" @click="cancelSkillTarget">取消</button>
      </div>
    </div>
  </div>

  <!-- 受到伤害后的可选发动技能（夺食 / 狡计） -->
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
