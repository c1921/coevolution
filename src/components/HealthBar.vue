<script setup lang="ts">
defineProps<{ hp: number; maxHp: number }>()
</script>

<template>
  <div class="flex items-center gap-1">
    <span
      v-for="i in maxHp"
      :key="i"
      class="h-3 w-3 rounded-full border"
      :class="
        i <= Math.max(0, hp)
          ? 'border-ember-600 bg-ember-400'
          : 'border-table-600 bg-table-800'
      "
    />
    <span class="ml-1 text-xs text-ink-500">{{ Math.max(0, hp) }}/{{ maxHp }}</span>
  </div>
</template>
