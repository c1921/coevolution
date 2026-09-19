<script setup lang="ts">
import { SPECIES } from '../game/data/species'
import type { PlayerState } from '../game/types'
import HealthBar from './HealthBar.vue'

const props = defineProps<{
  player: PlayerState
  /** 能量上限（可能被技能修正，如防御型的【蓄能】），由上层按引擎规则计算 */
  energyMax: number
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

        <!-- 能量：回合开始时回复至上限，使用 / 打出卡牌都要支付 -->
        <div
          class="mt-1 flex items-center gap-1"
          title="回合开始时回复至上限；使用与打出卡牌都要消耗能量"
        >
          <span class="mr-0.5 text-xs text-ink-500">能量</span>
          <span
            v-for="i in energyMax"
            :key="i"
            class="h-3 w-3 rounded-sm border"
            :class="
              i <= player.energy ? 'border-jade-600 bg-jade-400' : 'border-table-600 bg-table-800'
            "
          />
          <span class="ml-1 text-xs text-ink-500">{{ player.energy }}/{{ energyMax }}</span>
        </div>

        <!-- 威胁：攻击不再直接扣血，而是叠加威胁；回合结束时剩余威胁结算为等量伤害 -->
        <div
          class="mt-1 flex items-center gap-1"
          title="受到的攻击会叠加威胁；你在自己的出牌阶段可打出【防御】抵消，回合结束时剩余威胁结算为等量伤害"
        >
          <span class="mr-0.5 text-xs text-ink-500">威胁</span>
          <span
            v-for="i in Math.max(player.threat, 0)"
            :key="i"
            class="h-3 w-3 rounded-sm border border-ember-600 bg-ember-400"
          />
          <span class="ml-1 text-xs text-ink-500">{{ player.threat }}</span>
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
