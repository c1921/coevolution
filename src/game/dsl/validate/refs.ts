import type { Doc } from '../types'
import type { Issue, Ref } from './fieldTables'
import { push } from './primitives'

/**
 * 第二遍解析：结构校验全部通过后，统一检查**引用完整性**与内容级约束。
 *
 * 放在第二遍是因为引用可以指向"后面才出现"的文档；只有收齐全部文档才能判断
 * 存在性与死文档。这里的问题码只有 `unknown-ref` / `bad-combination` /
 * `missing-field` / `duplicate-id` / `dead-doc` 五种。
 */

export function resolveRefs(docs: Doc[], refs: Ref[], issues: Issue[]): void {
  const ids: Record<Ref['type'], Set<string>> = {
    skill: new Set(),
    card: new Set(),
    deck: new Set(),
  }
  for (const doc of docs) {
    if (doc.kind === 'skill') ids.skill.add(doc.id)
    if (doc.kind === 'card') ids.card.add(doc.id)
    if (doc.kind === 'deck') ids.deck.add(doc.id)
  }
  const cardDocs = new Map(docs.filter((doc) => doc.kind === 'card').map((doc) => [doc.id, doc]))
  for (const ref of refs) {
    if (!ids[ref.type].has(ref.id)) {
      push(issues, ref.path, 'unknown-ref', `引用了不存在的${refLabel(ref.type)} ${ref.id}`)
      continue
    }
    if (ref.type === 'card' && ref.expect) {
      const doc = cardDocs.get(ref.id)
      const usable =
        doc !== undefined &&
        (ref.expect === 'play' ? doc.play !== undefined : (doc.use ?? []).length > 0)
      if (!usable) {
        push(
          issues,
          ref.path,
          'bad-combination',
          `牌种 ${ref.id} 不能在「${ref.expect}」语境使用，这条转化永远不会生效`,
        )
      }
    }
  }

  // ruleset 必须恰好一份
  const rulesets = docs.filter((doc) => doc.kind === 'ruleset')
  if (rulesets.length === 0) {
    push(issues, '/', 'missing-field', '缺少 ruleset 文档（修正通道基准值）')
  } else if (rulesets.length > 1) {
    push(issues, '/', 'duplicate-id', `ruleset 只能有一份，实际 ${rulesets.length} 份`)
  }

  // 死文档：定义但没有任何内容引用，通常是拼写错误或残留
  const usedSkills = new Set(refs.filter((r) => r.type === 'skill').map((r) => r.id))
  const usedCards = new Set(refs.filter((r) => r.type === 'card').map((r) => r.id))
  const usedDecks = new Set(refs.filter((r) => r.type === 'deck').map((r) => r.id))
  for (const doc of docs) {
    if (doc.kind === 'skill' && !usedSkills.has(doc.id)) {
      push(issues, `/${doc.id}`, 'dead-doc', `技能 ${doc.id} 没有被任何物种引用`)
    }
    if (doc.kind === 'card' && !usedCards.has(doc.id)) {
      push(issues, `/${doc.id}`, 'dead-doc', `牌种 ${doc.id} 没有被任何牌组引用`)
    }
    if (doc.kind === 'deck' && !usedDecks.has(doc.id)) {
      push(issues, `/${doc.id}`, 'dead-doc', `牌组 ${doc.id} 没有被任何物种引用`)
    }
  }
}

function refLabel(type: Ref['type']): string {
  if (type === 'skill') return '技能'
  if (type === 'card') return '牌种'
  return '牌组'
}
