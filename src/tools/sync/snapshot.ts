/* ================================================================
 * src/tools/sync/snapshot.ts
 *
 * 站点卡表快照导出 —— 编辑部与周报站之间的闭环。
 *
 * 周报站靠 public/data/cards_base_rows.csv + card_prints_rows.csv 预加载卡表,
 * 在此之前这两份文件只能手工从 Supabase 导出再提交进仓库。
 * 本模块把这一步变成一次点击:从库里实时拉全量 → 生成**格式完全一致**的 CSV。
 *
 * ⚠ 三处格式细节必须与现有文件严格一致,任一处不符都会静默破坏站点:
 *   ① 数组列用 **JSON 数组**(如 ["purple"]),不是 Postgres 的 {purple} ——
 *      站点用 JSON.parse 解析,喂 PG 格式会解析失败并静默退化成空数组,
 *      卡牌的颜色/地区/标签会全部消失而且不报错。
 *      注意:后台 sync/exporters.ts 的 pgArray() 产出的是 PG 格式,
 *      那套是给 SQL 导入用的,**不能直接用在这里**。
 *   ② **不加 BOM** —— 加了首列名会变成 "\ufeffid",站点按 id 关联卡与印刷
 *      版本时会全部落空。
 *   ③ **LF 换行**(现有文件如此),便于 git diff 干净。
 * ============================================================== */

/** 与 public/data/cards_base_rows.csv 表头逐字一致(26 列,顺序不可改) */
export const CARDS_BASE_SNAPSHOT_COLUMNS = [
  'id',
  'card_no',
  'card_name_cn',
  'card_name_en',
  'sub_title_cn',
  'sub_title_en',
  'card_color_list',
  'region',
  'tag',
  'keyword',
  'advanced_tag',
  'champion_tag',
  'effect_cn',
  'effect_en',
  'energy',
  'return_energy',
  'power',
  'rarity_name',
  'series_name',
  'flavor_text_cn',
  'flavor_text_en',
  'is_banned',
  'created_at',
  'updated_at',
  'card_category',
  'deck_limit'
] as const;

/** 与 public/data/card_prints_rows.csv 表头逐字一致(18 列) */
export const CARD_PRINTS_SNAPSHOT_COLUMNS = [
  'id',
  'card_id',
  'card_no_extend',
  'rarity_name',
  'extend_rarity_name',
  'back_image',
  'language',
  'img_cdn',
  'tts_cdn',
  'artist',
  'print_order',
  'is_default',
  'created_at',
  'updated_at',
  'is_promo',
  'series',
  'flavor_text_cn',
  'flavor_text_en'
] as const;

/** text[] 列:需编码成 JSON 数组 */
export const SNAPSHOT_JSON_ARRAY_FIELDS = [
  'card_color_list',
  'region',
  'tag',
  'keyword',
  'advanced_tag',
  'card_category'
] as const;

function csvCell(value: unknown, isJsonArray: boolean): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (isJsonArray) {
    // 数组 → JSON;非数组(脏数据)按空数组处理,避免产出非法 JSON
    s = JSON.stringify(Array.isArray(value) ? value : []);
  } else if (typeof value === 'boolean') {
    s = value ? 'true' : 'false';
  } else if (typeof value === 'object') {
    // jsonb 等对象列:序列化,保证不产出 [object Object]
    s = JSON.stringify(value);
  } else {
    /*
     * 换行归一化:库里的效果文本含大量 \r\n(实测 298 处),
     * 而仓库现有文件通篇无 CR。若不归一,每次导出都会带进一堆 CR,
     * git diff 会整篇飘红,且与站点现有快照不一致。
     * 对展示文本而言 CRLF → LF 是语义等价的。
     */
    s = String(value).replace(/\r\n?/g, '\n');
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 生成快照 CSV:无 BOM、LF 换行、数组列 JSON 编码。
 * 与后台 exporters.ts 的 toCsv 刻意分开 —— 那套是 BOM + CRLF + PG 数组,
 * 给 SQL/Table Editor 导入用的,格式不同不可混用。
 */
export function toSnapshotCsv(
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
  jsonArrayFields: readonly string[] = SNAPSHOT_JSON_ARRAY_FIELDS
): string {
  const arrFields = new Set<string>(jsonArrayFields);
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c], arrFields.has(c))).join(','));
  }
  return lines.join('\n') + '\n';
}

export function cardsBaseSnapshotCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  return toSnapshotCsv(CARDS_BASE_SNAPSHOT_COLUMNS, rows);
}

export function cardPrintsSnapshotCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  // 印刷版本没有 text[] 列
  return toSnapshotCsv(CARD_PRINTS_SNAPSHOT_COLUMNS, rows, []);
}

/** 快照文件应当写入的仓库路径(供界面提示) */
export const SNAPSHOT_TARGET = {
  cards: 'public/data/cards_base_rows.csv',
  prints: 'public/data/card_prints_rows.csv'
} as const;

/**
 * 按 **CSV 记录**切分,而不是按物理行。
 *
 * 关键:效果文本里有真实换行(实测 740 处含 LF),这些换行被包在引号内,
 * 一条记录因此会跨多个物理行。若按 `split('\n')` 切,含换行的记录会被切碎,
 * 列会整体错位 —— 那会让自检既误报(把好数据判成坏)又漏报。
 */
export function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      cur += ch;
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      }
    } else if (ch === '"') {
      inQuotes = true;
      cur += ch;
    } else if (ch === '\n') {
      records.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) records.push(cur);
  return records;
}

export interface SnapshotCheck {
  ok: boolean
  problems: string[]
  cards: number
  prints: number
}

/**
 * 落盘前的自检:表头是否与仓库现有文件一致、数组列能否被 JSON.parse、
 * 每条记录的格数是否正确。
 *
 * ⚠ 检查对象必须是**将要落盘的那份文本**,而不是拿原始行重新编码一遍 ——
 * 后者永远查不出问题(自己编的当然合法)。
 *
 * 这些错误一旦随快照提交,站点侧是**静默失效**(颜色丢失、卡图关联落空),
 * 所以宁可在导出前拦住。
 */
export function checkSnapshot(cardsCsv: string, printsCsv: string): SnapshotCheck {
  const problems: string[] = [];

  const cardsRecords = splitCsvRecords(cardsCsv).filter((r, i) => i === 0 || r !== '');
  const printsRecords = splitCsvRecords(printsCsv).filter((r, i) => i === 0 || r !== '');
  const cardsHeader = cardsRecords[0] ?? '';
  const printsHeader = printsRecords[0] ?? '';

  if (cardsHeader !== CARDS_BASE_SNAPSHOT_COLUMNS.join(',')) {
    problems.push('cards_base 表头与约定的 26 列不一致');
  }
  if (printsHeader !== CARD_PRINTS_SNAPSHOT_COLUMNS.join(',')) {
    problems.push('card_prints 表头与约定的 18 列不一致');
  }
  if (cardsCsv.startsWith('\uFEFF') || printsCsv.startsWith('\uFEFF')) {
    problems.push('带了 BOM —— 会让首列名变成 \\ufeffid,站点关联会全部落空');
  }
  if (cardsCsv.includes('\r') || printsCsv.includes('\r')) {
    problems.push('含 CR —— 现有文件通篇为 LF,提交后 git diff 会整篇飘红');
  }

  // 逐记录校验格数与数组列(用与站点相同的 JSON.parse)
  const arrayIdx = SNAPSHOT_JSON_ARRAY_FIELDS.map((f) => ({
    field: f,
    idx: CARDS_BASE_SNAPSHOT_COLUMNS.indexOf(f)
  }));
  let badArray = 0;
  let firstBadArray = '';
  let badWidth = 0;
  let firstBadWidth = '';
  for (let i = 1; i < cardsRecords.length; i += 1) {
    const cells = splitCsvLine(cardsRecords[i]!);
    if (cells.length !== CARDS_BASE_SNAPSHOT_COLUMNS.length) {
      badWidth += 1;
      if (!firstBadWidth) {
        firstBadWidth = `第 ${i} 条记录有 ${cells.length} 格,应为 ${CARDS_BASE_SNAPSHOT_COLUMNS.length}`;
      }
      continue;
    }
    for (const { field, idx } of arrayIdx) {
      const raw = cells[idx];
      if (raw === undefined || raw === '') continue;
      let valid = false;
      try {
        valid = Array.isArray(JSON.parse(raw));
      } catch {
        valid = false;
      }
      if (!valid) {
        badArray += 1;
        if (!firstBadArray) firstBadArray = `${field}=${raw.slice(0, 40)}`;
      }
    }
  }
  if (badWidth) problems.push(`${badWidth} 条记录格数不对(列错位),${firstBadWidth}`);
  if (badArray) {
    problems.push(
      `${badArray} 个数组单元格不是合法 JSON 数组(站点会解析失败并静默置空),例如 ${firstBadArray}`
    );
  }

  return {
    ok: problems.length === 0,
    problems,
    cards: Math.max(0, cardsRecords.length - 1),
    prints: Math.max(0, printsRecords.length - 1)
  };
}

/**
 * 极简 CSV 行拆分(支持双引号转义)。
 * 导出是为了让"自检"和"验收脚本"用**同一套**拆分逻辑 ——
 * 若各写一份,验收通过并不能证明 checkSnapshot 里的判断是对的。
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}
