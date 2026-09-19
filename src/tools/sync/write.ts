import type { RestFilter, RestQuery } from '../sources/rest'
import { equivalent, identity, validateOperation, type ReviewOperation, type Values } from './review'
import { normalizeCardNo } from './normalize'

export interface ReviewTransport {
  select: (table: string, query: RestQuery) => Promise<Values[]>
  insert: (table: string, payload: Values) => Promise<Values[]>
  update: (table: string, payload: Values, filters: RestFilter[]) => Promise<Values[]>
}
export async function executeOperation(op: ReviewOperation, transport: ReviewTransport): Promise<Values> {
  validateOperation(op)
  let result: Values[]
  if (op.kind === 'update') {
    const filters: RestFilter[] = [{ column: 'id', op: 'eq', value: op.id! }]
    const current = await transport.select(op.table, { filters, limit: 1 })
    if (current.length !== 1) throw new Error('记录不存在或无读取权限，请重新读取库内现状')
    if (Object.entries(op.expected).some(([f, v]) => !equivalent(current[0]?.[f], v))) throw new Error('所选字段已被其他操作修改，请重读后重新审核')
    // Guard the interval between reading and PATCH when timestamps are available.
    if (current[0]?.updated_at) filters.push({ column: 'updated_at', op: 'eq', value: String(current[0].updated_at) })
    result = await transport.update(op.table, { ...op.payload, updated_at: new Date().toISOString() }, filters)
  } else {
    if (op.table === 'cards_base') {
      // Same-name rows may have whitespace/NULL differences, so normalize in memory.
      const existing: Values[] = []
      for (let offset = 0; ; offset += 1000) {
        const page = await transport.select('cards_base', { columns: 'id,card_no,card_name_cn,sub_title_cn', order: 'id.asc', limit: 1000, offset })
        existing.push(...page)
        if (page.length < 1000) break
      }
      if (existing.some((r) => identity(r.card_name_cn, r.sub_title_cn) === identity(op.payload.card_name_cn, op.payload.sub_title_cn))) throw new Error('同名同副标题基础卡已存在，请重新读取后关联')
      if (existing.some((r) => r.card_no === op.payload.card_no)) throw new Error('基础编号已被占用，请重新审核')
    }
    if (op.table === 'card_prints') {
      const matches: Values[] = []
      for (let offset = 0; ; offset += 1000) {
        const page = await transport.select('card_prints', { columns: 'id,card_no_extend,language', order: 'id.asc',
          filters: [{ column: 'language', op: 'eq', value: String(op.payload.language) }], limit: 1000, offset })
        matches.push(...page)
        if (page.length < 1000) break
      }
      if (matches.some((r) => normalizeCardNo(String(r.card_no_extend)).extend === op.payload.card_no_extend)) throw new Error('印刷版本已存在，请重新读取后按字段更新')
    }
    result = await transport.insert(op.table, op.payload)
  }
  const primaryKey = op.table === 'series' ? 'code' : 'id'
  if (result.length !== 1 || !result[0]?.[primaryKey]) throw new Error('服务端未返回唯一的已写入记录；可能数据已变更或权限不足，请重新读取确认')
  return result[0]
}
