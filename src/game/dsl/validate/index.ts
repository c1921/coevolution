import type { Doc } from '../types'
import type { Issue, RawDoc, Ref, ValidatedDocs } from './fieldTables'
import { checkDoc } from './docs'
import { resolveRefs } from './refs'

/**
 * DSL 运行时校验器：把 data/dsl/*.json 从 unknown 收敛为 IR 类型。
 *
 * 设计要点：
 *  - **严格字段**：任何多余键都报 unknown-key——JSON 没有编译期检查，拼错 `Kind`
 *    这类问题必须在加载期暴露，而不是静默取默认值。
 *  - **一次报全部问题**：不做"遇错即停"，所有 issue 连同 JSON 路径一起返回并排序，
 *    便于快照测试与定位。
 *  - **引用完整性**：物种↔技能、牌组↔牌种、技能↔技能引用在第二遍统一解析。
 *  - **守住引擎不变量**：费用 ≥ 1（否则 0 费 + 无次数限制的【打击】= 无限连击）、
 *    计数 ≥ 1、牌区组合合法、日志占位符在白名单内。
 *
 * 契约：只要 issues 非空，调用方（registry）必须抛错，绝不能使用返回的 docs——
 * 结构校验不通过时这些对象不具备 IR 的字段保证。
 *
 * 模块划分（本目录）：
 *  - `fieldTables.ts`  契约类型 + 结构字段表（唯一来源，schema 生成器也读它）
 *  - `primitives.ts`   单字段校验原语
 *  - `valueNode.ts` / `conditionNode.ts` / `effectNode.ts` / `targetNode.ts`
 *                      四类节点各自的校验
 *  - `docs.ts`         按文档种类分派
 *  - `refs.ts`         第二遍的交叉引用解析
 *  - `index.ts`        对外入口与公开导出（本文件）
 */

export function validateDocs(raws: RawDoc[]): ValidatedDocs {
  const issues: Issue[] = []
  const refs: Ref[] = []
  const docs: Doc[] = []
  const seenIds = new Set<string>()

  for (const raw of raws) {
    docs.push(checkDoc(raw, issues, refs, seenIds))
  }
  resolveRefs(docs, refs, issues)
  issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))
  return { docs, issues }
}

/**
 * 公开导出面：**只有下面这几项**是校验器对外的 API。
 * 其余（字段表、原语、各节点校验函数）是实现细节，直接按路径 import 即可，
 * 不要从这里二次转出——那样会让内部重构变成破坏性变更。
 */
export type { IssueCode, Issue, RawDoc, ValidatedDocs, FieldSet } from './fieldTables'
export { DOC_FIELDS, DOC_SCHEMA_KEYS } from './fieldTables'
