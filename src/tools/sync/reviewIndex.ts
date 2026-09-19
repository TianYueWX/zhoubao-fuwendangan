/** Build lookup tables once per snapshot / identity edit, not once per rendered row. */
import type { ExistingSnapshot } from '../admin/sync'
import { identity, type ReviewRow, type Values } from './review'
import { normalizeCardNo } from './normalize'

export const printIdentity = (number: unknown, language: unknown): string => JSON.stringify([number, language])
export interface ExistingReviewIndex {
  bases: Map<string, Values[]>
  baseNumbers: Set<unknown>
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
export function indexExisting(ex: ExistingSnapshot): ExistingReviewIndex {
  const bases = new Map<string, Values[]>()
  const prints = new Map<string, Values[]>()
  const baseNumbers = new Set<unknown>()
  for (const card of ex.cards) {
    append(bases, identity(card.card_name_cn, card.sub_title_cn), card as unknown as Values)
    baseNumbers.add(card.card_no)
  }
  for (const print of ex.prints) append(prints,
    printIdentity(normalizeCardNo(print.card_no_extend).extend, print.language), print as unknown as Values)
  return { bases, baseNumbers, prints,
    icons: new Map(ex.icons.map((icon) => [icon.name_zh, icon as unknown as Values])),
    series: new Set(ex.seriesCodes) }
}
export function indexDrafts(rows: ReviewRow[]): DraftReviewIndex {
  const byKey = new Map<string, ReviewRow>()
  const baseCounts = new Map<string, number>()
  const printCounts = new Map<string, number>()
  for (const row of rows) {
    byKey.set(row.key, row)
    if (row.table === 'cards_base') {
      const key = identity(row.draft.card_name_cn, row.draft.sub_title_cn)
      baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1)
    } else if (row.table === 'card_prints') {
      const key = printIdentity(row.draft.card_no_extend, row.draft.language)
      printCounts.set(key, (printCounts.get(key) ?? 0) + 1)
    }
  }
  return { rows: byKey, baseCounts, printCounts }
}
