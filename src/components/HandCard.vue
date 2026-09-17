<script setup lang="ts">
import { computed } from 'vue'
import { CARD_NAME, CARD_DEFS } from '../game/data/cardDefs'
import { isRedCard, rankLabel, SUIT_SYMBOL } from '../game/data/deck'
import type { Card } from '../game/types'

const props = defineProps<{
  card: Card
  selected?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ pick: [uid: number] }>()

const red = computed(() => isRedCard(props.card))
const cost = computed(() => CARD_DEFS[props.card.kind].cost)
</script>

<template>
  <button
    type="button"
    :title="CARD_DEFS[card.kind].text"
    :disabled="disabled"
    class="relative h-24 w-16 shrink-0 rounded-lg border-2 bg-face px-1 py-0.5 text-left shadow-md transition"
    :class="[
      selected ? '-translate-y-2 border-jade-400' : 'border-table-600',
      disabled ? 'opacity-40' : 'hover:-translate-y-1',
    ]"
    @click="emit('pick', card.uid)"
  >
    <span
      class="block text-xs leading-tight font-semibold"
      :class="red ? 'text-face-red' : 'text-face-black'"
    >
      {{ SUIT_SYMBOL[card.suit] }}{{ rankLabel(card.rank) }}
    </span>
    <!-- 能量费用：与牌面说明一致（打击 1 / 防御 1 / 回复 2） -->
    <span
      class="absolute top-0.5 right-1 rounded-sm border border-jade-600 bg-jade-400/90 px-1 text-[10px] leading-tight font-bold text-table-950"
      title="使用 / 打出这张牌需要支付的能量"
    >
      {{ cost }}
    </span>
    <span class="mt-7 block text-center text-sm font-bold text-face-black">
      {{ CARD_NAME[card.kind] }}
    </span>
  </button>
</template>
