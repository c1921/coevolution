<script setup lang="ts">
import { SPECIES } from '../game/data/species'
import type { PlayerState } from '../game/types'
import HealthBar from './HealthBar.vue'

const props = defineProps<{
  player: PlayerState
  active: boolean
  human: boolean
  /** 人类玩家的手牌单独展示，这里只显示张数 */
  showHandCount: boolean
}>()

const species = () => SPECIES[props.player.species]
</script>

<template>
  <section
    class="rounded-xl border p-3 transition"
    :class="active ? 'border-jade-400 bg-table-800' : 'border-table-700 bg-table-900'"
  >
    <div class="flex items-center gap-3">
      <span class="text-4xl" :class="player.alive ? '' : 'grayscale'">{{ species().emoji }}</span>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-ink-100">
            {{ species().name }}
          </span>
          <span
            v-if="active && player.alive"
            class="rounded bg-jade-600 px-1.5 py-0.5 text-xs text-ink-100"
          >
            当前回合
          </span>
          <span
            v-if="!player.alive"
            class="rounded bg-ember-600 px-1.5 py-0.5 text-xs text-ink-100"
          >
            已阵亡
          </span>
          <span class="text-xs text-ink-500">{{ human ? '你' : 'AI' }}</span>
        </div>

        <div class="mt-1">
          <HealthBar :hp="player.hp" :max-hp="player.maxHp" />
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-1">
          <span
            v-for="skill in species().skills"
            :key="skill.id"
            :title="skill.text"
            class="cursor-help rounded border border-table-600 px-1.5 py-0.5 text-xs text-ink-300"
          >
            {{ skill.name }}
          </span>
          <span v-if="showHandCount" class="ml-auto text-xs text-ink-500">
            手牌 {{ player.hand.length }} 张
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
