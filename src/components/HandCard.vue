<script setup lang="ts">
import { computed } from 'vue'
import { CARD_NAME, CARD_DEFS } from '../game/data/cardDefs'
import { energyCost } from '../game/rules/energy'
import { gameState, HUMAN } from '../stores/game'
import type { Card } from '../game/types'

const props = defineProps<{
  card: Card
  selected?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ pick: [uid: number] }>()

const def = computed(() => CARD_DEFS[props.card.kind])

/** 费用按付费者求值（card-cost 通道可修正）；无对局时退回牌种文档的基准费用 */
const cost = computed(() => {
  const state = gameState.value
  return state ? energyCost(state, HUMAN, props.card.kind) : def.value.cost
})
</script>

<template>
  <button
    type="button"
    :title="def.text"
    :disabled="disabled"
    class="relative h-24 w-16 shrink-0 rounded-lg border-2 bg-face px-1 py-0.5 text-left shadow-md transition"
    :class="[
      selected ? '-translate-y-2 border-jade-400' : 'border-table-600',
      disabled ? 'opacity-40' : 'hover:-translate-y-1',
    ]"
    @click="emit('pick', card.uid)"
  >
    <!-- 能量费用：与卡面效果说明一致（打击 1 / 防御 1 / 回复 2），可按通道修正 -->
    <span
      class="absolute top-0.5 right-1 rounded-sm border border-jade-600 bg-jade-400/90 px-1 text-[10px] leading-tight font-bold text-table-950"
      title="使用 / 打出这张牌需要支付的能量"
    >
      {{ cost }}
    </span>
    <span class="mt-1 block text-center text-sm font-bold text-face-black">
      {{ CARD_NAME[card.kind] }}
    </span>
    <!-- 卡面只有效果与费用：没有花色与点数 -->
    <span class="mt-1 block text-center text-[10px] leading-tight text-face-black/70">
      {{ def.short }}
    </span>
  </button>
</template>
