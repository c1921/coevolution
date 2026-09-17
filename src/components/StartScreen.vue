<script setup lang="ts">
import { beginDraft } from '../stores/game'
import { BTN_PRIMARY, PANEL } from './ui'
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-5 p-4">
    <header class="text-center">
      <h1 class="text-4xl font-bold text-ink-100">协同进化</h1>
      <p class="mt-2 text-ink-300">1v1 物种对决 · 三张基本牌 · 完备结算</p>
    </header>

    <section :class="PANEL" class="text-sm text-ink-300">
      <h2 class="mb-2 text-base font-semibold text-ink-100">三张基本牌</h2>
      <ul class="space-y-1">
        <li><b class="text-ink-100">打击</b>：对对方造成 1 点伤害，其可打出【防御】抵消。</li>
        <li><b class="text-ink-100">防御</b>：抵消一次【打击】，只能在响应时打出。</li>
        <li><b class="text-ink-100">回复</b>：回复 1 点体力，濒死时可用来续命。</li>
      </ul>
    </section>

    <section :class="PANEL" class="text-sm text-ink-300">
      <h2 class="mb-2 text-base font-semibold text-ink-100">规则要点</h2>
      <ul class="list-inside list-disc space-y-1">
        <li>单将决胜：体力归零即败。</li>
        <li>起手 4 张；先手第一回合少摸 1 张，此后每回合摸 2 张。</li>
        <li><b>打击</b>每回合限一次，可被<b>防御</b>抵消（【威压】需两张）。</li>
        <li>体力降到 0 即濒死，可用<b>回复</b>自救。</li>
        <li>弃牌阶段手牌上限 = 当前体力值。</li>
        <li>第 21 回合起进入<b>消耗战</b>：回合开始失去体力，每 5 回合递增 1 点。</li>
      </ul>
    </section>

    <button :class="BTN_PRIMARY" class="mx-auto px-8 py-3 text-base" @click="beginDraft()">
      开始游戏
    </button>
  </div>
</template>
