<script setup lang="ts">
import {
  humanPending,
  pickCardOptions,
  pickCardTitle,
  rewardAllowSkip,
  rewardCardOptions,
  rewardServiceOptions,
  submitPickOwnCard,
  submitRewardCard,
  submitRewardService,
  submitSkipReward,
} from '../stores/game'
import { BTN, BTN_GHOST, BTN_PRIMARY } from './ui'

/**
 * 奖励覆盖层：卡牌三选一、服务三选一（升级 / 移除 / 回复）、升级/移除选牌。
 *
 * 只判断 `humanPending.kind`，**不看 `state.phase`**：奖励发生在「回合开始时」，
 * 而且非回合角色也会被询问，用阶段判断会漏掉一半情况。
 * 派生数据（候选、可用性、禁用原因）全部来自 store 的选择器，组件只做渲染。
 */

/** 稀有度的展示名（界面文案，与内容无关） */
const RARITY_LABEL: Record<string, string> = {
  common: '普通',
  uncommon: '稀有',
  rare: '史诗',
}
</script>

<template>
  <!-- 卡牌奖励：三选一 + 跳过 -->
  <div
    v-if="humanPending?.kind === 'reward' && humanPending.reward === 'card'"
    class="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4"
  >
    <div class="w-full max-w-md rounded-xl border border-table-600 bg-table-800 p-5">
      <p class="text-center text-lg font-semibold text-ink-100">奖励三选一</p>
      <p class="mt-1 text-center text-sm text-ink-300">选择一张牌，直接加入手牌</p>

      <div class="mt-4 flex flex-col gap-2">
        <button
          v-for="option in rewardCardOptions"
          :key="option.kind"
          :class="[BTN_PRIMARY, 'w-full text-left']"
          @click="submitRewardCard(option.kind)"
        >
          <span class="font-semibold">{{ option.name }}</span>
          <span class="ml-2 text-xs text-ink-300">
            {{ RARITY_LABEL[option.rarity] }} · {{ option.cost }} 能量
          </span>
          <span class="mt-1 block text-xs text-ink-300">{{ option.short }}</span>
        </button>
      </div>

      <div v-if="rewardAllowSkip" class="mt-5 flex justify-center">
        <button :class="BTN_GHOST" @click="submitSkipReward()">跳过</button>
      </div>
    </div>
  </div>

  <!-- 服务奖励：升级 / 移除 / 回复；不可用的选项禁用并给出原因 -->
  <div
    v-if="humanPending?.kind === 'reward' && humanPending.reward === 'service'"
    class="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4"
  >
    <div class="w-full max-w-sm rounded-xl border border-table-600 bg-table-800 p-5">
      <p class="text-center text-lg font-semibold text-ink-100">奖励三选一</p>
      <p class="mt-1 text-center text-sm text-ink-300">升级一张牌 / 移除一张牌 / 回复体力</p>

      <div class="mt-4 flex flex-col gap-2">
        <div v-for="option in rewardServiceOptions" :key="option.service">
          <button
            :class="[option.enabled ? BTN_PRIMARY : BTN, 'w-full']"
            :disabled="!option.enabled"
            @click="submitRewardService(option.service)"
          >
            {{ option.label }}
          </button>
          <p v-if="!option.enabled && option.reason" class="mt-1 text-xs text-ink-500">
            {{ option.reason }}
          </p>
        </div>
      </div>
    </div>
  </div>

  <!-- 升级 / 移除选牌：列出自己的牌组 + 手牌 + 弃牌堆 -->
  <div
    v-if="humanPending?.kind === 'pick-card'"
    class="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4"
  >
    <div
      class="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-table-600 bg-table-800 p-5"
    >
      <p class="text-center text-lg font-semibold text-ink-100">{{ pickCardTitle }}</p>

      <div class="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <button
          v-for="option in pickCardOptions"
          :key="option.card.uid"
          :class="[BTN, 'w-full text-left']"
          @click="submitPickOwnCard(option.card)"
        >
          <span class="font-semibold">{{ option.name }}</span>
          <span class="ml-2 text-xs text-ink-500">（{{ option.zone }}）</span>
          <span v-if="option.upgradedName" class="ml-2 text-xs text-jade-400">
            → {{ option.upgradedName }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
