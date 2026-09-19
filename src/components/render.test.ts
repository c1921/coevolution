import { describe, expect, it } from 'vitest'
import { createSSRApp, isRef } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from '../App.vue'
import { CARD_DEFS, CARD_NAME } from '../game/data/cardDefs'
import { SPECIES } from '../game/data/species'
import { makeState } from '../game/testUtils'
import {
  act,
  backToStart,
  beginDraft,
  chooseSpecies,
  draftOptions,
  gameState,
  pickCard,
  screen,
  submitActivate,
} from '../stores/game'

/**
 * 界面渲染冒烟测试：模板里的视图映射会被 `unref()` 包裹，
 * 而 unref 会读 `__v_isRef` 这类 Vue 内部键——视图 Proxy 必须像普通对象一样
 * 对未知键返回 undefined，否则渲染函数直接抛错、整个页面只剩背景
 * （08d0a5f 把物种视图改成实时 Proxy 时引入的回归，本测试专门防住它）。
 */

const VIEWS: [string, Record<string, unknown>][] = [
  ['SPECIES', SPECIES],
  ['CARD_DEFS', CARD_DEFS],
  ['CARD_NAME', CARD_NAME],
]

function renderApp(): Promise<string> {
  return renderToString(createSSRApp(App))
}

describe('界面渲染：视图 Proxy 必须容忍 Vue 的内部键探测', () => {
  it('对 __v_isRef 等未知键返回 undefined，不抛错', () => {
    for (const [name, view] of VIEWS) {
      expect(isRef(view), `${name} 不应被当成 ref`).toBe(false)
      for (const key of ['__v_isRef', '__v_raw', '__v_isReactive', 'no-such-id']) {
        expect(() => view[key], `${name}.${key} 取值不应抛错`).not.toThrow()
        expect(view[key], `${name}.${key} 应为 undefined`).toBeUndefined()
      }
    }
  })

  it('开始游戏后抽将页有内容', async () => {
    beginDraft(20240919)
    expect(draftOptions.value.length).toBeGreaterThan(0)

    const html = await renderApp()
    expect(html).toContain('选择你的物种')
    for (const id of draftOptions.value) expect(html).toContain(SPECIES[id].name)
  })

  it('选定物种后对局页有内容（而不是只剩背景）', async () => {
    chooseSpecies(draftOptions.value[0]!)

    const html = await renderApp()
    expect(html).toContain('协同进化 · 1v1')
    expect(html).toContain('第 1 回合')
    expect(html).toContain('结束出牌阶段')

    backToStart()
  })

  it('需要选目标时弹出目标选择器，并列出不可选的原因', async () => {
    backToStart()
    gameState.value = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHp: 3,
      aiHp: 2,
      playerHand: [{ kind: 'strike' }],
    })
    screen.value = 'battle'

    pickCard(gameState.value.players[0].hand[0]!.uid)
    submitActivate('mend')

    const html = await renderApp()
    expect(html).toContain('选择目标')
    expect(html).toContain(SPECIES.bear.name)
    expect(html).toContain('目标角色体力已满，无法回复')

    backToStart()
  })

  it('非法操作的中文说明会显示在界面上（不再静默失败）', async () => {
    backToStart()
    gameState.value = makeState({
      playerSpecies: 'deer',
      aiSpecies: 'bear',
      playerHand: [{ kind: 'defend' }],
    })
    screen.value = 'battle'

    act({ kind: 'play-card', card: gameState.value.players[0].hand[0]!, as: 'defend' })

    const html = await renderApp()
    expect(html).toContain('当前不是打出响应牌的时机')

    backToStart()
  })
})
