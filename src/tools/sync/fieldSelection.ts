/**
 * 批量勾选「更新字段」的共用规则（小程序审核 review.ts 与官网审核 galleryReview.ts 共用）。
 *
 * 审核面板的默认口径是「更新字段一条都不勾」，逐条确认后才写库。这里只解决
 * 「一屏几十行、每行都要展开编辑器逐个打勾」的重复劳动：把某一行或某一筛选范围内
 * 的**差异字段**一次性勾上。是否提交仍然由提交按钮决定，本模块不碰网络与草稿值。
 *
 * 安全边界：
 *  - 只处理 kind === 'update' 的行；新增行没有可勾字段，blocked 行不允许提交。
 *  - 赋值即整体替换 selected，草稿改回原值后留下的陈旧项会被顺手清掉。
 *  - 只勾选 state.changed 里的字段，界面上勾不到的值不会被批量放行。
 */
import type { ReviewState } from './review'

/** 审核行的最小结构：两种审核行的 selected 都是字段名数组。 */
export interface SelectableRow {
  selected: string[]
}

export interface FieldSelectionPlan {
  /** 命中差异字段的行数 */
  rows: number
  /** 命中的差异字段总数 */
  fields: number
}

export interface FieldSelectionResult<T extends SelectableRow> extends FieldSelectionPlan {
  /** 被改写的行，按传参顺序 */
  written: T[]
}

/** 可批量勾选的字段：只有「库内已存在 + 有差异」的行才允许；其余一律为空。 */
export function selectableFields(state: ReviewState): string[] {
  return state.kind === 'update' ? state.changed : []
}

function collect<T extends SelectableRow>(
  rows: readonly T[],
  stateOf: (row: T) => ReviewState
): { row: T; fields: string[] }[] {
  const targets: { row: T; fields: string[] }[] = []
  for (const row of rows) {
    const fields = selectableFields(stateOf(row))
    if (fields.length) targets.push({ row, fields })
  }
  return targets
}

/** 统计范围内可勾选的差异字段，不修改任何行（供按钮文案与禁用态使用）。 */
export function fieldSelectionPlan<T extends SelectableRow>(
  rows: readonly T[],
  stateOf: (row: T) => ReviewState
): FieldSelectionPlan {
  let fields = 0
  const targets = collect(rows, stateOf)
  for (const target of targets) fields += target.fields.length
  return { rows: targets.length, fields }
}

/** 勾选范围内全部差异字段，整体替换 selected，返回改写的行与字段数。 */
export function applyFieldSelection<T extends SelectableRow>(
  rows: readonly T[],
  stateOf: (row: T) => ReviewState
): FieldSelectionResult<T> {
  const targets = collect(rows, stateOf)
  let fields = 0
  for (const target of targets) {
    target.row.selected = [...target.fields]
    fields += target.fields.length
  }
  return { rows: targets.length, fields, written: targets.map((t) => t.row) }
}

/** 清空给定行的字段勾选，返回清掉的字段数。 */
export function clearFieldSelection(rows: readonly SelectableRow[]): number {
  let cleared = 0
  for (const row of rows) {
    cleared += row.selected.length
    row.selected = []
  }
  return cleared
}

/**
 * 行内计数：只数「现在仍然是差异」的已勾字段。
 * 草稿改回库内值后 changed 会少一项，此时不能继续报成已勾选。
 */
export function selectedFieldCount(row: SelectableRow, state: ReviewState): number {
  return state.changed.filter((field) => row.selected.includes(field)).length
}

/** 该行的差异字段是否已全部勾选（差异为空时不算全选）。 */
export function allFieldsSelected(row: SelectableRow, state: ReviewState): boolean {
  return state.kind === 'update' && state.changed.length > 0 && state.changed.every((field) => row.selected.includes(field))
}
