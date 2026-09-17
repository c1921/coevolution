<script setup lang="ts">
import { gameState, human, isHumanTurn, isSelectable, isSelected, pickCard, deckCount, opponent, turnLabel } from '../stores/game'
import ActionBar from './ActionBar.vue'
import HandCard from './HandCard.vue'
import LogPanel from './LogPanel.vue'
import PlayerPanel from './PlayerPanel.vue'
import PromptOverlay from './PromptOverlay.vue'
</script>

<template>
  <div
    v-if="gameState && human && opponent"
    class="mx-auto flex h-dvh max-w-4xl flex-col gap-2 p-3"
  >
    <header class="flex items-center justify-between text-sm">
      <span class="font-semibold text-ink-100">协同进化 · 1v1</span>
      <span class="text-ink-300">{{ turnLabel }}</span>
      <span class="text-ink-500">牌堆 {{ deckCount }} 张</span>
    </header>

    <PlayerPanel
      :player="opponent"
      :active="!isHumanTurn"
      :human="false"
      :show-hand-count="true"
    />

    <section class="min-h-0 flex-1">
      <LogPanel :entries="gameState.log" />
    </section>

    <PlayerPanel :player="human" :active="isHumanTurn" :human="true" :show-hand-count="false" />

    <section class="flex min-h-28 items-end gap-2 overflow-x-auto pb-1">
      <HandCard
        v-for="card in human.hand"
        :key="card.uid"
        :card="card"
        :selected="isSelected(card.uid)"
        :disabled="!isSelectable(card)"
        @pick="pickCard"
      />
      <span v-if="human.hand.length === 0" class="text-sm text-ink-500">
        没有手牌 —— 只能结束阶段
      </span>
    </section>

    <ActionBar />
    <PromptOverlay />
  </div>
</template>
