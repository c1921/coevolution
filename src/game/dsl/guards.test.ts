import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cardIds, registry, skillDoc, speciesIds } from './registry'

/**
 * 守卫测试：用机械检查维持"内容全部在 JSON 里"这个约定。
 *
 * 1. `src/` 的应用代码里不允许出现任何内容 id（技能 / 物种 / 牌种）字面量——
 *    这些 id 只应出现在 data/dsl/*.json 与测试里。它防止日后有人图省事又加回
 *    `if (skill === 'xxx')` 的分支。
 * 2. 应用代码不允许 import node 内置模块（tsconfig.app 为了测试放开 node 类型后，
 *    这条守卫保证浏览器代码不会误用 fs/process）。
 */

const SRC = 'src'

/** 允许出现内容 id 的例外：文件 → id → 原因 */
const ALLOWED_IDS: Record<string, Record<string, string>> = {
  'src/game/ai/index.ts': {
    // 'heal' 既是牌种 id 也是效果指令名；这里出现的是效果指令名
    heal: '效果指令名与牌种 id 同名，此处指指令',
  },
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

/** 需要检查的应用代码文件：排除测试、DSL 运行时内部、内容文档与测试夹具 */
function appFiles(): string[] {
  return walk(SRC)
    .filter((path) => /\.(ts|vue)$/.test(path))
    .filter((path) => !path.endsWith('.test.ts'))
    .filter((path) => !path.startsWith(join(SRC, 'game/data/dsl')))
    .filter((path) => path !== join(SRC, 'game/dsl/fixtures.ts'))
    .sort()
}

/**
 * 需要守卫的内容 id。
 * 牌种 id 在 dsl/ 运行时内部不再检查：那里出现的 'heal' 等是**效果指令名**
 * （指令词表与牌种 id 恰好同名），不是对具体牌种的引用。
 */
function contentIds(): { id: string; what: string; checkInDsl: boolean }[] {
  const ids: { id: string; what: string; checkInDsl: boolean }[] = []
  for (const id of registry.skills.map((doc) => doc.id))
    ids.push({ id, what: '技能', checkInDsl: true })
  for (const id of cardIds()) ids.push({ id, what: '牌种', checkInDsl: false })
  for (const id of speciesIds()) ids.push({ id, what: '物种', checkInDsl: true })
  return ids
}

const DSL_RUNTIME = join(SRC, 'game/dsl')

function quotedOccurrences(source: string, id: string): number {
  const matches = source.match(new RegExp(`['"\`]${id}['"\`]`, 'g'))
  return matches?.length ?? 0
}

describe('守卫：内容 id 不得出现在应用代码里', () => {
  it('src/ 下没有技能/牌种/物种 id 字面量（除白名单）', () => {
    const offenders: string[] = []
    for (const path of appFiles()) {
      const source = readFileSync(path, 'utf8')
      for (const { id, what, checkInDsl } of contentIds()) {
        if (!checkInDsl && path.startsWith(DSL_RUNTIME)) continue
        const count = quotedOccurrences(source, id)
        if (count === 0) continue
        if (ALLOWED_IDS[path]?.[id]) continue
        offenders.push(`${path} 出现${what} id "${id}"（${count} 次）`)
      }
    }
    expect(offenders, `内容 id 应只出现在 data/dsl/*.json 中：\n${offenders.join('\n')}`).toEqual(
      [],
    )
  })

  it('白名单没有过期条目（每个列出的 id 确实出现了）', () => {
    for (const [path, entries] of Object.entries(ALLOWED_IDS)) {
      const source = readFileSync(path, 'utf8')
      for (const id of Object.keys(entries)) {
        expect(quotedOccurrences(source, id), `${path} 里已不再需要豁免 ${id}`).toBeGreaterThan(0)
      }
    }
  })

  it('应用代码不 import node 内置模块', () => {
    const offenders: string[] = []
    for (const path of appFiles()) {
      const source = readFileSync(path, 'utf8')
      if (/(from\s+['"]node:|require\(\s*['"]node:)/.test(source)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })

  it('守卫本身确实在扫描文件（防止路径写错导致空跑）', () => {
    const files = appFiles()
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain(join(SRC, 'game/engine.ts'))
    // 技能文档里当然有 id；确认内容 id 判定不是空集
    expect(contentIds().length).toBeGreaterThan(10)
    expect(skillDoc('assault').name).toBe('强袭')
  })
})
