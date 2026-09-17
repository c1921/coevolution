<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LogEntry } from '../game/types'

const props = defineProps<{ entries: LogEntry[] }>()

const box = ref<HTMLElement | null>(null)

watch(
  () => props.entries.length,
  async () => {
    await nextTick()
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  },
  { immediate: true },
)
</script>

<template>
  <div
    ref="box"
    class="h-full overflow-y-auto rounded-lg border border-table-700 bg-table-950/60 p-3 text-sm leading-relaxed"
  >
    <p
      v-for="(entry, index) in entries"
      :key="index"
      class="whitespace-pre-wrap"
      :class="entry.text.startsWith('——') ? 'mt-2 font-semibold text-jade-400' : 'text-ink-300'"
    >
      {{ entry.text }}
    </p>
  </div>
</template>
