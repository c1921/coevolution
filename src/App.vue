<script setup lang="ts">
import DraftScreen from './components/DraftScreen.vue'
import GameBoard from './components/GameBoard.vue'
import StartScreen from './components/StartScreen.vue'
import { chooseSpecies, draftOptions, screen } from './stores/game'
</script>

<template>
  <StartScreen v-if="screen === 'start'" />
  <DraftScreen v-else-if="screen === 'draft'" :options="draftOptions" @pick="chooseSpecies" />
  <GameBoard v-else />
</template>
