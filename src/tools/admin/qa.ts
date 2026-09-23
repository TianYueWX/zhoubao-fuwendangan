/**
 * QA 同步的数据层：读库内现状 + 执行审核后的写入计划。
 * 写入走 sources/rest.ts（用户 JWT，命中 RLS 的 is_card_admin 策略）。
 */
import { restDelete, restInsert, restSelect, restUpdate, touchVersion } from '../sources/rest'
import { planQaInsert, planQaUpdate, type QaDbEntry, type QaPlan } from '../sync/qa'

export interface QaLinkRow {
  qa_id: string
  card_no: string
  position: number
}

export interface QaExisting {
  entries: QaDbEntry[]
  links: QaLinkRow[]
  /** cards_base 现有编号，用于判断关联是否可建 */
  cardNos: Set<string>
  /** 编号 → 中文名，用于展示 */
  nameByNo: Map<string, string>
}

const QA_ENTRY_COLUMNS = 'id,source,source_id,question,answer,question_en,answer_en'
const QA_LINK_COLUMNS = 'qa_id,card_no,position'

async function selectAllPaged<T>(table: string, columns: string, order: string, pageSize = 1000): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { rows } = await restSelect<T>(table, { columns, order, limit: pageSize, offset })
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

export async function loadQaExisting(): Promise<QaExisting> {
  const [entries, links, cards] = await Promise.all([
    selectAllPaged<QaDbEntry>('qa_entries', QA_ENTRY_COLUMNS, 'id.asc'),
    selectAllPaged<QaLinkRow>('qa_entry_cards', QA_LINK_COLUMNS, 'qa_id.asc'),
    selectAllPaged<{ card_no: string; card_name_cn: string | null }>('cards_base', 'card_no,card_name_cn', 'card_no.asc')
  ])
  const cardNos = new Set<string>()
  const nameByNo = new Map<string, string>()
  for (const c of cards) {
    cardNos.add(c.card_no)
    nameByNo.set(c.card_no, c.card_name_cn ?? c.card_no)
  }
  return { entries, links, cardNos, nameByNo }
}

export interface QaApplyResult {
  entry: QaDbEntry
}

/**
 * 执行一条 QA 计划：
 *   ① 写入/更新 qa_entries（仅勾选字段）
 *   ② 删除失效关联、插入新增关联
 * 失败即抛错，由调用方保留编辑状态。
 */
export async function applyQaPlan(plan: QaPlan): Promise<QaApplyResult> {
  let entry: QaDbEntry
  if (plan.entry.kind === 'insert') {
    const rows = await restInsert<QaDbEntry>('qa_entries', plan.entry.payload)
    if (!rows[0]?.id) throw new Error('QA 新增失败:服务端未返回记录(可能是权限不足)')
    entry = rows[0]
  } else if (Object.keys(plan.entry.payload).length) {
    const rows = await restUpdate<QaDbEntry>(
      'qa_entries',
      { ...plan.entry.payload, updated_at: new Date().toISOString() },
      [{ column: 'id', op: 'eq', value: plan.entry.id! }]
    )
    if (!rows[0]?.id) throw new Error('QA 更新失败:记录不存在或无写入权限')
    entry = rows[0]
  } else {
    const { rows } = await restSelect<QaDbEntry>('qa_entries', {
      columns: QA_ENTRY_COLUMNS,
      filters: [{ column: 'id', op: 'eq', value: plan.entry.id! }],
      limit: 1
    })
    if (!rows[0]) throw new Error('QA 更新失败:记录不存在')
    entry = rows[0]
  }

  if (plan.linkRemoves.length) {
    await restDelete('qa_entry_cards', [
      { column: 'qa_id', op: 'eq', value: entry.id },
      { column: 'card_no', op: 'in', value: plan.linkRemoves }
    ])
  }
  if (plan.linkAdds.length) {
    const rows = await restInsert('qa_entry_cards', plan.linkAdds.map((l) => ({
      qa_id: entry.id,
      card_no: l.card_no,
      position: l.position
    })))
    if (rows.length !== plan.linkAdds.length) throw new Error('QA 关联写入不完整(卡号可能不存在或权限不足)')
  }
  return { entry }
}

/** 编辑器提交的正文补丁。 */
export interface QaEntryPatch {
  question: string
  answer: string
  question_en: string | null
  answer_en: string | null
}

/** 保存已有 QA：正文 + 关联卡增删，复用 applyQaPlan 的落库校验。 */
export async function saveQaEntry(
  id: string,
  patch: QaEntryPatch,
  desiredLinks: readonly string[],
  currentLinks: readonly string[]
): Promise<QaDbEntry> {
  const { entry } = await applyQaPlan(planQaUpdate(id, { ...patch }, desiredLinks, currentLinks))
  return entry
}

/** 手动新增 QA（source=manual），并建立关联。 */
export async function createQaEntry(patch: QaEntryPatch, desiredLinks: readonly string[]): Promise<QaDbEntry> {
  const { entry } = await applyQaPlan(planQaInsert({ ...patch }, desiredLinks))
  return entry
}

/** 删除 QA 条目（qa_entry_cards 由外键 on delete cascade 一并清理）。 */
export async function deleteQaEntry(id: string): Promise<void> {
  const rows = await restDelete<QaDbEntry>('qa_entries', [{ column: 'id', op: 'eq', value: id }])
  if (!rows.length) throw new Error('删除失败:记录不存在或权限不足')
}

/** 触碰 version.name='qa'，通知客户端刷新问答缓存。 */
export function publishQa(): Promise<void> {
  return touchVersion('qa')
}
