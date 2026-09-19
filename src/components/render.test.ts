import { describe, expect, it } from 'vitest'
import { createSSRApp, isRef } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from '../App.vue'
import { CARD_DEFS, CARD_NAME } from '../game/data/cardDefs'
import { SPECIES } from '../game/data/species'
import { advance } from '../game/engine'
import { makeState } from '../game/testUtils'
import {
  act,
  backToStart,
  beginDraft,
  chooseSpecies,
  draftOptions,
  gameState,
  legalOptions,
  pickCard,
  pickCardOptions,
  rewardCardOptions,
  rewardServiceOptions,
  screen,
  submitOption,
  submitRewardService,
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
    expect(html).toContain('选择出战代号')
    for (const id of draftOptions.value) expect(html).toContain(SPECIES[id].name)
  })

  it('选定物种后对局页有内容（而不是只剩背景）', async () => {
    chooseSpecies(draftOptions.value[0]!)

    const html = await renderApp()
    expect(html).toContain('协同进化 · 1v1')
    expect(html).toContain('第 1 回合')
    expect(html).toContain('结束出牌阶段')
    // 威胁是本作的基础伤害机制：面板上必须能看到它
    expect(html).toContain('威胁')
    // 阶段说明整体走 store 的 pendingHint（组件不再自己拼这句话）
    expect(html).toContain('你的出牌阶段')

    backToStart()
  })

  it('面板显示双方的威胁点数', async () => {
    backToStart()
    gameState.value = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerThreat: 2,
      aiThreat: 1,
    })
    screen.value = 'battle'

    const html = await renderApp()
    expect(html).toContain('威胁')
    expect(html).toContain('>2<')
    expect(html).toContain('>1<')
    // 出牌阶段给出可照做的提示
    expect(html).toContain('你身上有 2 点威胁')

    backToStart()
  })

  it('使用卡牌需要选目标时同样弹出目标选择器（牌名与提示可见）', async () => {
    backToStart()
    gameState.value = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      playerHp: 2,
      aiHp: 2,
      playerHand: [{ kind: 'first-aid' }],
    })
    screen.value = 'battle'

    const card = gameState.value.players[0].hand[0]!
    pickCard(card.uid)
    submitOption(
      card,
      legalOptions(card).find((o) => o.as === 'first-aid')!,
    )

    const html = await renderApp()
    expect(html).toContain(`使用【${CARD_NAME['first-aid']}】`)
    expect(html).toContain('选择目标')
    expect(html).toContain(SPECIES.defensive.name)

    backToStart()
  })

  it('非法操作的中文说明会显示在界面上（不再静默失败）', async () => {
    backToStart()
    gameState.value = makeState({
      playerSpecies: 'counter',
      aiSpecies: 'defensive',
      playerHand: [{ kind: 'defend' }],
    })
    screen.value = 'battle'

    // 没有威胁时使用【防御】：文档 reason 作为错误说明显示出来
    act({ kind: 'use-card', card: gameState.value.players[0].hand[0]! })

    const html = await renderApp()
    expect(html).toContain('没有需要抵消的威胁')

    backToStart()
  })

  /** 装载一个「回合开始时」的奖励询问点（第 3 回合卡牌、第 4 回合服务） */
  function renderRewardTurn(turn: number): Promise<string> {
    backToStart()
    const state = makeState({
      playerSpecies: 'offensive',
      aiSpecies: 'defensive',
      phase: 'turn-start',
    })
    state.turn = turn
    state.active = 0
    advance(state)
    gameState.value = state
    screen.value = 'battle'
    return renderApp()
  }

  it('奖励覆盖层：卡牌三选一显示候选牌名与「跳过」按钮', async () => {
    const html = await renderRewardTurn(3)
    expect(html).toContain('奖励三选一')
    expect(html).toContain('选择一张牌，直接加入手牌')
    for (const option of rewardCardOptions.value) expect(html).toContain(option.name)
    expect(html).toContain('跳过')
    backToStart()
  })

  it('奖励覆盖层：服务三选一显示三项，满血时回复被禁用并给出原因', async () => {
    const html = await renderRewardTurn(4)
    expect(html).toContain('升级一张牌')
    expect(html).toContain('移除一张牌')
    for (const option of rewardServiceOptions.value) expect(html).toContain(option.label)
    expect(html).toContain('体力已满')
    backToStart()
  })

  it('奖励覆盖层：升级选牌列出自己的牌并显示升级预览', async () => {
    await renderRewardTurn(4)
    submitRewardService('upgrade')
    expect(pickCardOptions.value.length).toBeGreaterThan(0)

    const html = await renderApp()
    expect(html).toContain('选择要升级的牌')
    for (const option of pickCardOptions.value) expect(html).toContain(option.name)
    backToStart()
  })
})
