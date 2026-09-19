import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cardIds, registry, skillDoc, speciesIds } from './registry'

/**
 * 守卫测试：用机械检查维持几条靠人记不住的约定。
 *
 * 1. `src/` 的应用代码里不允许出现任何内容 id（技能 / 物种 / 牌种）字面量——
 *    这些 id 只应出现在 data/dsl/*.json 与测试里。它防止日后有人图省事又加回
 *    `if (skill === 'xxx')` 的分支。
 * 2. 应用代码不允许 import node 内置模块（tsconfig.app 为了测试放开 node 类型后，
 *    这条守卫保证浏览器代码不会误用 fs/process）。
 * 3. **应用代码的运行时依赖图不允许有环**（`import type` 不算边）。ESM 的循环
 *    依赖靠求值顺序侥幸成立，任何一次"在模块顶层多做一件事"都可能炸掉它，
 *    所以这里用强连通分量把它钉死。存量债务见 ALLOWED_CYCLES。
 * 4. README 的「测试覆盖」表必须列出每个测试文件——那张表是人工维护的，
 *    没有守卫就会在下次加测试时悄悄过期。
 */

const SRC = 'src'
const README = 'README.md'

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
    expect(files).toContain(join(SRC, 'game/engine/index.ts'))
    // 技能文档里当然有 id；确认内容 id 判定不是空集
    expect(contentIds().length).toBeGreaterThan(10)
    expect(skillDoc('assault').name).toBe('强袭')
  })
})

/* ------------------------------------------------------------------ 依赖图守卫
 * 只保留会**在运行时加载模块**的 import：`import type` / `export type` 在
 * 编译后被抹掉（erasableSyntaxOnly + verbatimModuleSyntax），不构成运行时依赖。
 * -------------------------------------------------------------------------- */

/** 匹配 `import ... from './x'` / `export ... from './x'`（允许跨行） */
const FROM_CLAUSE = /(?:^|\n)[ \t]*(import|export)\s+([\s\S]*?)from\s*['"](\.[^'"]+)['"]/g
/** 匹配只有副作用的 `import './x'` */
const BARE_IMPORT = /(?:^|\n)[ \t]*import\s+['"](\.[^'"]+)['"]/g

/** src 下全部源码文件（含测试；测试是叶子，不会引入环，但一并纳入更省心） */
function sourceFiles(): string[] {
  return walk(SRC)
    .filter((path) => /\.(ts|vue)$/.test(path))
    .sort()
}

function resolveSpecifier(spec: string, from: string, known: Set<string>): string | undefined {
  const base = normalize(join(dirname(from), spec))
  return [`${base}.ts`, `${base}.vue`, join(base, 'index.ts')].find((candidate) =>
    known.has(candidate),
  )
}

/** 一个文件的运行时依赖（已解析为仓库内的真实路径） */
function runtimeDepsOf(path: string, known: Set<string>): string[] {
  const source = readFileSync(path, 'utf8')
  const specs = new Set<string>()
  for (const match of source.matchAll(FROM_CLAUSE)) {
    // `import type {…}` / `export type {…}` 编译后消失，不是运行时边
    if (/^\s*type\b/.test(match[2] ?? '')) continue
    specs.add(match[3] ?? '')
  }
  for (const match of source.matchAll(BARE_IMPORT)) specs.add(match[1] ?? '')
  return [...specs]
    .map((spec) => resolveSpecifier(spec, path, known))
    .filter((hit): hit is string => hit !== undefined)
}

/** Tarjan 强连通分量：只返回"非平凡"的分量（多于一个节点，或自引用） */
function runtimeCycles(): string[][] {
  const files = sourceFiles()
  const known = new Set(files)
  const graph = new Map(files.map((path) => [path, runtimeDepsOf(path, known)]))
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let counter = 0

  const visit = (v: string): void => {
    index.set(v, counter)
    low.set(v, counter)
    counter += 1
    stack.push(v)
    onStack.add(v)
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number))
      }
    }
    if (low.get(v) !== index.get(v)) return
    const component: string[] = []
    let popped: string
    do {
      popped = stack.pop() as string
      onStack.delete(popped)
      component.push(popped)
    } while (popped !== v)
    components.push(component)
  }

  for (const file of files) if (!index.has(file)) visit(file)

  return components
    .filter((c) => c.length > 1 || (graph.get(c[0] as string) ?? []).includes(c[0] as string))
    .map((c) => [...c].sort())
    .sort((a, b) => (a[0] as string).localeCompare(b[0] as string))
}

/**
 * 允许存在的运行时循环依赖。**当前为空：应用代码的依赖图是一条 DAG。**
 *
 * 这里曾经列着 5 个文件构成的强连通分量 ——
 * `dsl/effect` ⇄ `dsl/event` ⇄ `dsl/internal` ⇄ `rules/damage` ⇄ `rules/threat`。
 * 根因是 `rules/damage.ts` 为了收集「受到伤害后」触发而 import `dsl/event.ts`，
 * 而 event 依赖解释器 `dsl/effect.ts`，解释器又反过来 import damage 与 threat。
 * 修法是把触发收集拆到 `dsl/triggers.ts`（不依赖解释器），
 * 于是 `damage → triggers` 成为一条指向叶子的边。
 *
 * 这个常量保留为空数组而不是删掉检查：它是"新环必须显式登记"的闸门。
 * 真要临时接受一条环，就按同一格式加进来并在结论里说明原因。
 */
const ALLOWED_CYCLES: string[][] = []

describe('守卫：运行时依赖图不允许有环', () => {
  it('非平凡强连通分量与白名单完全一致（白名单为空即必须是 DAG）', () => {
    const cycles = runtimeCycles()
    const rendered = cycles.map((c) => c.join(' ⇄ ')).join('\n  ')
    expect(
      cycles,
      `运行时循环依赖（import type 不算边）：\n  ${rendered}\n` +
        '新引入的环必须拆掉；确需保留则显式登记到 ALLOWED_CYCLES 并说明原因。',
    ).toEqual(ALLOWED_CYCLES)
  })

  it('守卫本身确实在建图（防止 glob/解析写错导致空跑）', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(50)
    const known = new Set(files)
    // 抽查两条已知存在的依赖，确认解析器真的解析出了仓库内路径
    expect(runtimeDepsOf(join(SRC, 'game/engine/index.ts'), known)).toContain(
      join(SRC, 'game/engine/actions.ts'),
    )
    expect(runtimeDepsOf(join(SRC, 'game/engine/actions.ts'), known)).toContain(
      join(SRC, 'game/dsl/effect.ts'),
    )
    // `import type` 必须被跳过：engine/index.ts 对 types 的引入是 type-only
    expect(runtimeDepsOf(join(SRC, 'game/engine/index.ts'), known)).not.toContain(
      join(SRC, 'game/types.ts'),
    )
  })
})

describe('守卫：README 的测试覆盖表不许腐烂', () => {
  /** README 用反引号列出测试文件；各处前缀不一致（有的相对 src/game，有的相对 src），故按文件名匹配 */
  function readmeMentions(file: string): boolean {
    const base = file.split('/').pop() as string
    for (const match of readFileSync(README, 'utf8').matchAll(/`([^`]*)`/g)) {
      const text = match[1] ?? ''
      if (text === base || text.endsWith(`/${base}`)) return true
    }
    return false
  }

  it('每个 *.test.ts 都在 README 的测试覆盖表里', () => {
    const tests = sourceFiles().filter((path) => path.endsWith('.test.ts'))
    expect(tests.length).toBeGreaterThan(20)
    const missing = tests.filter((path) => !readmeMentions(path))
    expect(missing, `README.md 的「测试覆盖」表缺少这些测试文件：\n${missing.join('\n')}`).toEqual(
      [],
    )
  })
})

describe('守卫：界面状态层只从 barrel 进入', () => {
  /**
   * `stores/` 被拆成若干子模块后，`game.ts` 是唯一入口。绕过它直接 import
   * `stores/state` 之类会**跳过 `selection.ts` 的模块级 watch**
   * （待输入项变化时清空选择态），界面就会出现残留的过期选择。
   * 这条守卫把"只从 barrel 进"钉死，避免日后又抄近路。
   */
  const STORE_SUBMODULES = [
    'stores/state',
    'stores/selectors',
    'stores/actions',
    'stores/aiDriver',
    'stores/selection',
    'stores/session',
  ]

  it('stores/ 之外没有文件直接 import 子模块', () => {
    const offenders: string[] = []
    for (const path of sourceFiles()) {
      if (path.startsWith(join(SRC, 'stores') + '/')) continue
      const source = readFileSync(path, 'utf8')
      for (const sub of STORE_SUBMODULES) {
        if (source.includes(`/${sub}'`) || source.includes(`/${sub}"`)) {
          offenders.push(`${path} 直接 import 了 ${sub}，请改为 import '../stores/game'`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('守卫本身确实在扫描（barrel 自己当然会 import 子模块）', () => {
    const barrel = readFileSync(join(SRC, 'stores/game.ts'), 'utf8')
    for (const sub of STORE_SUBMODULES) {
      expect(barrel).toContain(`'./${sub.replace('stores/', '')}'`)
    }
    expect(sourceFiles().length).toBeGreaterThan(50)
  })
})
