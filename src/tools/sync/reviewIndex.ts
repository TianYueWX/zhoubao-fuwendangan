/** Build lookup tables once per snapshot / identity edit, not once per rendered row.
 *
 * Every key here must mirror the matching rule used by review.ts exactly, or the
 * indexed and scanning paths disagree:
 *   - existing bases  → identity(name, subtitle)   (trimmed name + subtitle)
 *   - existing prints → normalized extend + language
 *   - draft prints    → **raw** extend + language (reviewState compares drafts verbatim)
 * Builders therefore stay in sync with review.ts by construction, and the offline
 * suite asserts both paths return identical results for the same inputs.
 */
import type { ExistingSnapshot } from '../admin/sync'
import { identity, printIdentity, type ReviewRow, type Values } from './review'
import { normalizeCardNo } from './normalize'

export interface ExistingReviewIndex {
  bases: Map<string, Values[]>
  baseNumbers: Set<unknown>
  /** 官网卡表同步：按 card_no 直接定位基础卡（card_no 唯一）。 */
  basesByNumber: Map<string, Values>
  /** 官网卡表同步：星号/SP/超编号印刷用英文名＋副标题回找基础卡。 */
  basesByEnIdentity: Map<string, Values[]>
  basesByEnName: Map<string, Values[]>
  prints: Map<string, Values[]>
  icons: Map<unknown, Values>
  series: Set<string>
}
export interface DraftReviewIndex {
  rows: Map<string, ReviewRow>
  baseCounts: Map<string, number>
  printCounts: Map<string, number>
}
export type ReviewIndex = ExistingReviewIndex & DraftReviewIndex
function append(map: Map<string, Values[]>, key: string, row: Values): void {
  const group = map.get(key)
  if (group) group.push(row); else map.set(key, [row])
}
function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}
export function indexExisting(ex: ExistingSnapshot): ExistingReviewIndex {
  const bases = new Map<string, Values[]>()
  const basesByNumber = new Map<string, Values>()
  const basesByEnIdentity = new Map<string, Values[]>()
  const basesByEnName = new Map<string, Values[]>()
  const prints = new Map<string, Values[]>()
  const baseNumbers = new Set<unknown>()
  const icons = new Map<unknown, Values>()
  for (const card of ex.cards) {
    append(bases, identity(card.card_name_cn, card.sub_title_cn), card as unknown as Values)
    baseNumbers.add(card.card_no)
    const value = card as unknown as Values
    if (card.card_no && !basesByNumber.has(card.card_no)) basesByNumber.set(card.card_no, value)
    // 英文身份的匹配规则与 galleryReview 保持一致（trim 后比较）。
    append(
      basesByEnIdentity,
      JSON.stringify([String(card.card_name_en ?? '').trim(), String(card.sub_title_en ?? '').trim()]),
      value
    )
    append(basesByEnName, String(card.card_name_en ?? '').trim(), value)
  }
  for (const print of ex.prints) append(prints,
    printIdentity(normalizeCardNo(print.card_no_extend).extend, print.language), print as unknown as Values)
  // First match wins, matching `ex.icons.find(...)` rather than a last-wins Map seed.
  for (const icon of ex.icons) if (!icons.has(icon.name_zh)) icons.set(icon.name_zh, icon as unknown as Values)
  return {
    bases,
    baseNumbers,
    basesByNumber,
    basesByEnIdentity,
    basesByEnName,
    prints,
    icons,
    series: new Set(ex.seriesCodes)
  }
}
export function indexDrafts(rows: ReviewRow[]): DraftReviewIndex {
  const byKey = new Map<string, ReviewRow>()
  const baseCounts = new Map<string, number>()
  const printCounts = new Map<string, number>()
  for (const row of rows) {
    byKey.set(row.key, row)
    if (row.table === 'cards_base') tally(baseCounts, identity(row.draft.card_name_cn, row.draft.sub_title_cn))
    else if (row.table === 'card_prints') tally(printCounts, printIdentity(row.draft.card_no_extend, row.draft.language))
  }
  return { rows: byKey, baseCounts, printCounts }
}
/** One combined index; rebuilding on every edit is O(rows) and stays cheap. */
export function buildReviewIndex(ex: ExistingSnapshot, rows: ReviewRow[]): ReviewIndex {
  return { ...indexExisting(ex), ...indexDrafts(rows) }
}
