<script setup lang="ts">
import { SPECIES } from '../game/data/species'
import type { SpeciesId } from '../game/types'
import { BTN_PRIMARY } from './ui'

defineProps<{ options: SpeciesId[] }>()
const emit = defineEmits<{ pick: [species: SpeciesId] }>()
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center gap-6 p-4">
    <header class="text-center">
      <h1 class="text-3xl font-bold text-ink-100">选择出战代号</h1>
      <p class="mt-2 text-sm text-ink-300">
        从随机抽取的 3 个代号中选 1 个出战；AI 会从其余代号中随机选 1 个。
      </p>    </header>

    <div class="grid gap-4 sm:grid-cols-3">
      <article
        v-for="id in options"
        :key="id"
        class="flex flex-col rounded-xl border border-table-600 bg-table-800 p-4 text-center"
      >
        <h2 class="text-lg font-semibold text-ink-100">
          {{ SPECIES[id].name }}
        </h2>

        <div class="mt-2 flex justify-center gap-1">
          <span
            v-for="i in SPECIES[id].maxHp"
            :key="i"
            class="h-3 w-3 rounded-full border border-ember-600 bg-ember-400"
          />
        </div>
        <p class="mt-1 text-xs text-ink-500">体力上限 {{ SPECIES[id].maxHp }}</p>

        <div class="mt-3 flex-1 space-y-2 text-left">
          <div v-for="skill in SPECIES[id].skills" :key="skill.id">
            <p class="text-sm font-semibold text-jade-400">{{ skill.name }}</p>
            <p class="text-xs leading-snug text-ink-300">{{ skill.text }}</p>
          </div>
          <!-- 暂未配置技能的代号：保留占位，待内容补齐 -->
          <p v-if="SPECIES[id].skills.length === 0" class="text-xs text-ink-500">
            暂无技能（待重新设计）
          </p>
        </div>

        <button :class="BTN_PRIMARY" class="mt-4" @click="emit('pick', id)">
          选择 {{ SPECIES[id].name }}
        </button>
      </article>
    </div>
  </div>
</template>
