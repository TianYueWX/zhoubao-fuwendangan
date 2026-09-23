/**
 * QA 同步的纯逻辑：接口行 → 归一化行、差异与写入计划。
 *
 * 无网络、无 Supabase，可离线单测。真实接口样例（2026-09-23）：
 *   cardNo: "OGN·021/298" / "UNL-074/219" / 令牌 "UNL-T06"
 *   归一化沿用 normalizeCardNo + baseCardNo，全部命中 cards_base.card_no。
 *
 * 约定：
 *   - question / answer 原样保存（含 Q： / A： 前缀）。
 *   - 本轮卡牌拉取中出现、但尚未写入 cards_base 的编号保留关联意图，并标记为 pending。
 *   - 其余归一化后仍不存在的编号不建关联，仅记入 unmatched 供界面告警。
 */
import type { ApiCommonQa } from './riftboundApi'
import { baseCardNo, normalizeCardNo } from './normalize'
import { textValue } from './review'

export type QaState = 'new' | 'update' | 'same' | 'blocked'

/** 接口行归一化后的目标数据（不直接落库）。 */
export interface QaIncoming {
  source_id: string
  question: string
  answer: string
  /** 归一化且存在于 cards_base 的编号，按接口顺序去重 */
  card_no_list: string[]
  /** 与 card_no_list 对应的展示名（取自 cards_base） */
  card_name_list: string[]
  /** 本轮卡牌拉取中存在、但尚未写入 cards_base 的编号 */
  pending_card_no_list: string[]
  /** 接口原始编号（含 ·、/总数），用于展示 */
  card_no_raw: string[]
  /** 归一化后仍不存在于 cards_base 的原始编号（跳过关联并告警） */
  unmatched: string[]
}

export interface QaDbEntry {
  id: string
  /** 数据来源渠道（xcx / manual / import…），编辑器展示用 */
  source?: string
  source_id: string | null
  question: string
  answer: string
  question_en: string | null
  answer_en: string | null
}

export interface QaDraft {
  question: string
  answer: string
  question_en: string | null
  answer_en: string | null
  card_no_list: string[]
}

export interface QaReviewRow {
  key: string
  incoming: QaIncoming
  draft: QaDraft
  /** 更新时勾选的字段 */
  selected: string[]
  included: boolean
  before?: QaDbEntry
  existingLinks: string[]
  /** 草稿关联里尚未存在于 cards_base 的本轮新卡 */
  pendingCardNos: string[]
  error: string
}

export interface QaEntryOperation {
  kind: 'insert' | 'update'
  id?: string
  payload: Record<string, unknown>
}

export interface QaLinkAdd {
  card_no: string
  position: number
}

export interface QaPlan {
  entry: QaEntryOperation
  linkAdds: QaLinkAdd[]
  linkRemoves: string[]
}

export const QA_UPDATE_FIELDS = ['question', 'answer', 'question_en', 'answer_en'] as const

/** 接口展示卡号 → cards_base.card_no（去语言/总数/促销后缀与印刷小写字母） */
export function normalizeQaCardNo(raw: string): string {
  return baseCardNo(normalizeCardNo(raw).extend)
}

/**
 * 官方 QA 接口的编号补零不一致（同一批里 OGN·055/298 与 OGN·55/298 并存），
 * 而 cards_base 统一补零。先精确匹配，不中再按「同前缀 / 同字母 / 同数字值 / 同后缀」
 * 在库内查找，从而兼容任意位宽，不写死 3 位。
 */
export function resolveQaCardNo(no: string, known: ReadonlySet<string>): string | null {
  if (!no) return null
  if (known.has(no)) return no
  const m = no.match(/^([A-Z0-9]+-)([A-Z]?)(\d+)([a-z]*)$/)
  if (!m) return null
  const prefix = m[1]!
  const letter = m[2]!
  const value = Number(m[3]!)
  const suffix = m[4]!
  for (const candidate of known) {
    const c = candidate.match(/^([A-Z0-9]+-)([A-Z]?)(\d+)([a-z]*)$/)
    if (c && c[1] === prefix && c[2] === letter && Number(c[3]) === value && c[4] === suffix) {
      return candidate
    }
  }
  return null
}

export function buildQaIncoming(
  item: ApiCommonQa,
  cardNos: ReadonlySet<string>,
  nameByNo: ReadonlyMap<string, string>,
  pendingCardNos: ReadonlySet<string> = new Set<string>()
): QaIncoming {
  const raws = (item.cardNo ?? []).filter((x): x is string => typeof x === 'string')
  const card_no_list: string[] = []
  const card_name_list: string[] = []
  const card_no_raw: string[] = []
  const pending_card_no_list: string[] = []
  const unmatched: string[] = []
  const seen = new Set<string>()
  for (const raw of raws) {
    card_no_raw.push(raw)
    const no = normalizeQaCardNo(raw)
    const known = resolveQaCardNo(no, cardNos)
    const resolved = known ?? resolveQaCardNo(no, pendingCardNos)
    if (resolved) {
      if (!seen.has(resolved)) {
        seen.add(resolved)
        card_no_list.push(resolved)
        card_name_list.push(nameByNo.get(resolved) ?? resolved)
        if (!known) pending_card_no_list.push(resolved)
      }
    } else {
      unmatched.push(raw)
    }
  }
  return {
    source_id: String(item.id),
    question: String(item.question ?? ''),
    answer: String(item.answer ?? ''),
    card_no_list,
    card_name_list,
    pending_card_no_list,
    card_no_raw,
    unmatched
  }
}

export function createQaReview(
  incoming: QaIncoming[],
  existing: QaDbEntry[],
  linksByQa: ReadonlyMap<string, string[]>
): QaReviewRow[] {
  const bySource = new Map<string, QaDbEntry>()
  for (const e of existing) if (e.source_id) bySource.set(String(e.source_id), e)
  return incoming.map((inc) => {
    const before = bySource.get(inc.source_id)
    return {
      key: `qa:${inc.source_id}`,
      incoming: inc,
      draft: {
        question: inc.question,
        answer: inc.answer,
        question_en: before?.question_en ?? null,
        answer_en: before?.answer_en ?? null,
        card_no_list: [...inc.card_no_list]
      },
      selected: [],
      included: true,
      before,
      existingLinks: before ? [...(linksByQa.get(before.id) ?? [])] : [],
      pendingCardNos: [...inc.pending_card_no_list],
      error: ''
    }
  })
}

function fieldValue(source: QaDbEntry | QaDraft, field: string): unknown {
  return (source as unknown as Record<string, unknown>)[field]
}

/** 仅比较有差异的正文列；编号数组单独走 linkDiff。 */
export function qaChangedFields(row: QaReviewRow): string[] {
  if (!row.before) return []
  return QA_UPDATE_FIELDS.filter((f) => textValue(fieldValue(row.before!, f)) !== textValue(fieldValue(row.draft, f)))
}

export function qaLinkDiff(row: QaReviewRow): { adds: string[]; removes: string[] } {
  const wanted = [...new Set(row.draft.card_no_list)]
  const current = new Set(row.existingLinks)
  const adds = wanted.filter((n) => !current.has(n))
  const removes = row.existingLinks.filter((n) => !wanted.includes(n))
  return { adds, removes }
}

export interface QaReviewState {
  kind: QaState
  changed: string[]
  reason: string
}

export function qaState(row: QaReviewRow): QaReviewState {
  const changed = qaChangedFields(row)
  const { adds, removes } = qaLinkDiff(row)
  let reason = row.error
  if (!textValue(row.draft.question)) reason = '问题不能为空'
  else if (!textValue(row.draft.answer)) reason = '答案不能为空'
  else {
    const waiting = row.pendingCardNos.filter((n) => row.draft.card_no_list.includes(n))
    if (waiting.length) reason = `等待卡牌提交：${waiting.join('、')}`
  }
  if (reason) return { kind: 'blocked', changed, reason }
  if (!row.before) return { kind: 'new', changed, reason: '' }
  if (!changed.length && !adds.length && !removes.length) return { kind: 'same', changed, reason: '' }
  return { kind: 'update', changed, reason: '' }
}

/** 更新时只写入勾选且确有差异的字段；无变化返回 null。 */
export function buildQaPlan(row: QaReviewRow): QaPlan | null {
  const state = qaState(row)
  if (state.kind === 'blocked') throw new Error(state.reason)
  if (state.kind === 'same') return null
  const { adds, removes } = qaLinkDiff(row)
  const wanted = [...new Set(row.draft.card_no_list)]
  const positionOf = (cardNo: string) => wanted.indexOf(cardNo)
  if (state.kind === 'new') {
    return {
      entry: {
        kind: 'insert',
        payload: {
          source: 'xcx',
          source_id: row.incoming.source_id,
          question: row.draft.question,
          answer: row.draft.answer,
          question_en: row.draft.question_en,
          answer_en: row.draft.answer_en
        }
      },
      linkAdds: wanted.map((card_no) => ({ card_no, position: positionOf(card_no) })),
      linkRemoves: []
    }
  }
  const fields = state.changed.filter((f) => row.selected.includes(f))
  if (!fields.length && !adds.length && !removes.length) return null
  const payload: Record<string, unknown> = {}
  for (const f of fields) payload[f] = fieldValue(row.draft, f)
  return {
    entry: { kind: 'update', id: row.before!.id, payload },
    linkAdds: adds.map((card_no) => ({ card_no, position: positionOf(card_no) })),
    linkRemoves: removes
  }
}

/** 编辑部直接编辑已有 QA 的写入计划：字段 + 关联增删（position 按目标顺序）。 */
export function planQaUpdate(
  id: string,
  patch: Record<string, unknown>,
  desiredLinks: readonly string[],
  currentLinks: readonly string[]
): QaPlan {
  const wanted = [...new Set(desiredLinks)]
  const current = new Set(currentLinks)
  const positionOf = (cardNo: string) => wanted.indexOf(cardNo)
  return {
    entry: { kind: 'update', id, payload: { ...patch } },
    linkAdds: wanted.filter((n) => !current.has(n)).map((card_no) => ({ card_no, position: positionOf(card_no) })),
    linkRemoves: currentLinks.filter((n) => !wanted.includes(n))
  }
}

/** 编辑部手动新增 QA 的写入计划：source=manual、无上游 source_id。 */
export function planQaInsert(
  patch: Record<string, unknown>,
  desiredLinks: readonly string[]
): QaPlan {
  const wanted = [...new Set(desiredLinks)]
  return {
    entry: {
      kind: 'insert',
      payload: { source: 'manual', source_id: null, ...patch }
    },
    linkAdds: wanted.map((card_no, position) => ({ card_no, position })),
    linkRemoves: []
  }
}

export interface QaSummary {
  total: number
  newCount: number
  updateCount: number
  sameCount: number
  blockedCount: number
  unmatched: string[]
}

export function summarizeQa(rows: QaReviewRow[]): QaSummary {
  let newCount = 0
  let updateCount = 0
  let sameCount = 0
  let blockedCount = 0
  const unmatched = new Set<string>()
  for (const row of rows) {
    const kind = qaState(row).kind
    if (kind === 'new') newCount++
    else if (kind === 'update') updateCount++
    else if (kind === 'same') sameCount++
    else blockedCount++
    for (const raw of row.incoming.unmatched) unmatched.add(raw)
  }
  return { total: rows.length, newCount, updateCount, sameCount, blockedCount, unmatched: [...unmatched] }
}

export interface QaTextSegment {
  text: string
  bold: boolean
}

/**
 * 仅用于展示层：原文不变，将卡名、关键词与费用标记为粗体片段。
 * 返回纯文本分段，避免 v-html 带来的注入风险。
 */
export function segmentQaText(value: string): QaTextSegment[] {
  const text = String(value ?? '')
  const pattern = /(【[^】\r\n]+】|<[^<>\r\n]+>|\[[^\[\]\r\n]+\])/g
  const out: QaTextSegment[] = []
  let start = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > start) out.push({ text: text.slice(start, index), bold: false })
    out.push({ text: match[0], bold: true })
    start = index + match[0].length
  }
  if (start < text.length) out.push({ text: text.slice(start), bold: false })
  return out
}
