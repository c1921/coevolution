<script setup lang="ts">
import { beginDraft } from '../stores/game'
import { BTN_PRIMARY, PANEL } from './ui'
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-5 p-4">
    <header class="text-center">
      <h1 class="text-4xl font-bold text-ink-100">协同进化</h1>
      <p class="mt-2 text-ink-300">1v1 代号对决 · 三张基本牌 · 完备结算</p>
    </header>

    <section :class="PANEL" class="text-sm text-ink-300">
      <h2 class="mb-2 text-base font-semibold text-ink-100">三张基本牌</h2>
      <ul class="space-y-1">
        <li>
          <b class="text-ink-100">打击</b>：消耗 1 点能量，对对方造成 1
          点伤害，其可打出【防御】抵消。
        </li>
        <li>
          <b class="text-ink-100">防御</b>：消耗 1 点能量，抵消一次【打击】，只能在响应时打出。
        </li>
        <li><b class="text-ink-100">回复</b>：消耗 2 点能量，回复 1 点体力，濒死时可用来续命。</li>
      </ul>
    </section>

    <section :class="PANEL" class="text-sm text-ink-300">
      <h2 class="mb-2 text-base font-semibold text-ink-100">规则要点</h2>
      <ul class="list-inside list-disc space-y-1">
        <li>单将决胜：体力归零即败。</li>
        <li>起手 4 张；先手第一回合少摸 1 张，此后每回合摸 2 张。</li>
        <li>
          <b>能量</b>：每回合开始时回复至上限（默认 3 点）。使用与<b>打出</b>卡牌都要支付能量，
          响应【防御】、濒死【回复】同样消耗 —— 留多少能量给防守，是你的取舍。
        </li>
        <li><b>打击</b>不再限制每回合张数，只要能量够就能连续使用（可被【防御】抵消）。</li>
        <li>体力降到 0 即濒死，可用<b>回复</b>自救（需 2 点能量，留不住就只能阵亡）。</li>
        <li>主动技与弃牌不消耗能量。</li>
        <li>弃牌阶段手牌上限 = 当前体力值。</li>
        <li>第 21 回合起进入<b>消耗战</b>：回合开始失去体力，每 5 回合递增 1 点。</li>
      </ul>
    </section>

    <button :class="BTN_PRIMARY" class="mx-auto px-8 py-3 text-base" @click="beginDraft()">
      开始游戏
    </button>
  </div>
</template>
