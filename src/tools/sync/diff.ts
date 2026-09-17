/** 通用「接口行 vs 库内行」差异计算 */

export interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

export interface RowDiff<T> {
  key: string
  kind: 'new' | 'update' | 'same'
  after: T
  before?: T
  changes: FieldChange[]
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  return String(a) === String(b)
}

export function keyMap<T>(rows: T[], keyOf: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>()
  for (const r of rows) map.set(keyOf(r), r)
  return map
}

/**
 * 逐行比较：仅当 fields 中列出的字段发生变化才算 update。
 * 返回结果保序，方便导出与预览。
 */
export function diffRows<T extends Record<string, any>>(
  incoming: T[],
  existing: Map<string, T>,
  keyOf: (row: T) => string,
  fields: (keyof T)[]
): RowDiff<T>[] {
  const out: RowDiff<T>[] = []
  for (const row of incoming) {
    const key = keyOf(row)
    const before = existing.get(key)
    if (!before) {
      out.push({ key, kind: 'new', after: row, changes: [] })
      continue
    }
    const changes: FieldChange[] = []
    for (const f of fields) {
      if (!sameValue(row[f], before[f])) {
        changes.push({ field: String(f), from: before[f], to: row[f] })
      }
    }
    out.push({ key, kind: changes.length ? 'update' : 'same', after: row, before, changes })
  }
  return out
}

export interface DiffSummary {
  total: number
  newCount: number
  updateCount: number
  sameCount: number
}

export function summarize<T>(diffs: RowDiff<T>[]): DiffSummary {
  let n = 0
  let u = 0
  let s = 0
  for (const d of diffs) {
    if (d.kind === 'new') n++
    else if (d.kind === 'update') u++
    else s++
  }
  return { total: diffs.length, newCount: n, updateCount: u, sameCount: s }
}
