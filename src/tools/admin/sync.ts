/* ================================================================
 * src/tools/admin/sync.ts
 *
 * 数据同步的数据层:把 sync/ 的纯逻辑接上 Supabase。
 *
 * 三条边界(承接后台的约定):
 *   ① 只写「接口拥有」的列,人工维护列(keyword / advanced_tag / deck_limit /
 *      *_en / tts_cdn / print_order / is_default)一律不产出、不覆盖;
 *   ② is_banned 默认**不写** —— 它是人工维护列,详见 sync/exporters.ts 的
 *      CARDS_BASE_OPTIONAL_COLUMNS 注释。仅当显式勾选时才纳入;
 *   ③ 直写依赖唯一约束(card_prints(card_no_extend,language)、
 *      card_icons(name_zh)),须先执行 supabase/sync-constraints.sql。
 * ============================================================== */

import { restSelect, restUpsert } from '../sources/rest';
import type { CardIconRow, CardPrintExportRow, CardsBaseRow } from '../sync/normalize';
import type { SeriesPreset } from '../sync/exporters';

/* ──────────────────────── 读取库内现状(供差异比对) ──────────────────────── */

export interface ExistingSnapshot {
  cards: CardsBaseRow[];
  prints: CardPrintExportRow[];
  icons: CardIconRow[];
  seriesCodes: string[];
  /** 卡号前缀 → 系列代码(快速模式推断 series_name 用) */
  seriesByPrefix: Record<string, string>;
}

/** 差异比对需要读取的列(diff 只在接口拥有的列上比较) */
const EXISTING_CARD_COLUMNS =
  'card_no,card_name_cn,sub_title_cn,card_color_list,region,tag,champion_tag,effect_cn,flavor_text_cn,energy,return_energy,power,rarity_name,series_name,card_category';

const EXISTING_PRINT_COLUMNS =
  'card_no_extend,language,rarity_name,extend_rarity_name,img_cdn,back_image,artist,series,flavor_text_cn,is_promo';

const EXISTING_ICON_COLUMNS = 'name_zh,name_en,url,storage_type,isWhite';

async function selectAllPaged<T>(table: string, columns: string, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { rows } = await restSelect<T>(table, { columns, limit: pageSize, offset });
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function loadExisting(): Promise<ExistingSnapshot> {
  const [cards, prints, icons, series] = await Promise.all([
    selectAllPaged<CardsBaseRow>('cards_base', EXISTING_CARD_COLUMNS),
    selectAllPaged<CardPrintExportRow>('card_prints', EXISTING_PRINT_COLUMNS).then((rows) =>
      // 只比对简体中文行 —— 接口只产出 SC
      rows.filter((r) => r.language === 'SC')
    ),
    selectAllPaged<CardIconRow>('card_icons', EXISTING_ICON_COLUMNS),
    selectAllPaged<{ code: string }>('series', 'code')
  ]);

  const seriesByPrefix: Record<string, string> = {};
  for (const c of cards) {
    const prefix = String(c.card_no ?? '').split('-')[0];
    if (prefix && c.series_name && !seriesByPrefix[prefix]) seriesByPrefix[prefix] = c.series_name;
  }

  return {
    cards,
    prints,
    icons,
    seriesCodes: series.map((s) => s.code),
    seriesByPrefix
  };
}

/* ──────────────────────── 写入 ──────────────────────── */

const UPSERT_CHUNK = 200;

async function upsertChunked(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  let done = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const written = await restUpsert(table, chunk, onConflict);
    // upsert 返回实际写入的行数;为 0 说明被 RLS 拒绝,必须显式报错而不是当作成功
    if (!written.length) {
      throw new Error(
        `${table}:服务端未写入任何行(第 ${i + 1}–${i + chunk.length} 行)。` +
          '账号可能不是管理员,或缺少唯一约束(请先执行 supabase/sync-constraints.sql)'
      );
    }
    done += chunk.length;
    onProgress?.(Math.min(done, rows.length), rows.length);
    // 让出主线程,避免长任务把界面卡死
    await new Promise((r) => setTimeout(r, 0));
  }
  return done;
}

export interface ApplyOptions {
  includeBanList: boolean;
  onProgress?: (label: string, done: number, total: number) => void;
}

export interface ApplyResult {
  series: number;
  cards: number;
  prints: number;
  icons: number;
  /** 因找不到父卡而无法绑定 card_id 的印刷版本数 */
  orphanPrints: number;
}

/**
 * 直接写入。顺序不能变:先 series(字典)→ cards(拿到 id)→ prints(靠 card_no
 * 解析 card_id)→ icons。
 */
export async function applyDataset(
  dataset: {
    cards: CardsBaseRow[];
    prints: CardPrintExportRow[];
    icons: CardIconRow[];
    seriesPresets: SeriesPreset[];
  },
  options: ApplyOptions
): Promise<ApplyResult> {
  const now = new Date().toISOString();
  const result: ApplyResult = { series: 0, cards: 0, prints: 0, icons: 0, orphanPrints: 0 };

  // ① 系列预置(缺失系列,占位名称)
  if (dataset.seriesPresets.length) {
    options.onProgress?.('系列预置', 0, dataset.seriesPresets.length);
    await upsertChunked(
      'series',
      dataset.seriesPresets.map((p) => ({ ...p, is_standard: true, is_active: true })),
      'code'
    );
    result.series = dataset.seriesPresets.length;
  }

  // ② 卡牌主数据
  if (dataset.cards.length) {
    const rows = dataset.cards.map((c) => {
      const row: Record<string, unknown> = { ...c, updated_at: now };
      // is_banned 默认剔除 —— 保住人工禁限表
      if (!options.includeBanList) delete row.is_banned;
      return row;
    });
    result.cards = await upsertChunked('cards_base', rows, 'card_no', (d, t) =>
      options.onProgress?.('卡牌主数据', d, t)
    );
  }

  // ③ 印刷版本:card_id 需按父卡号解析
  if (dataset.prints.length) {
    const baseNos = [...new Set(dataset.prints.map((p) => p.base_card_no))];
    const idMap = new Map<string, string>();
    for (let i = 0; i < baseNos.length; i += 200) {
      const chunk = baseNos.slice(i, i + 200);
      const { rows } = await restSelect<{ id: string; card_no: string }>('cards_base', {
        columns: 'id,card_no',
        filters: [{ column: 'card_no', op: 'in', value: chunk }]
      });
      for (const r of rows) idMap.set(r.card_no, r.id);
    }

    const payload: Record<string, unknown>[] = [];
    for (const p of dataset.prints) {
      const cardId = idMap.get(p.base_card_no);
      if (!cardId) {
        result.orphanPrints += 1;
        continue; // 父卡不存在就不写 —— 宁可留空也不要写成孤儿行
      }
      payload.push({
        card_id: cardId,
        card_no_extend: p.card_no_extend,
        language: p.language,
        rarity_name: p.rarity_name,
        extend_rarity_name: p.extend_rarity_name,
        img_cdn: p.img_cdn,
        back_image: p.back_image,
        artist: p.artist,
        series: p.series,
        flavor_text_cn: p.flavor_text_cn,
        is_promo: p.is_promo,
        updated_at: now
      });
    }
    result.prints = await upsertChunked('card_prints', payload, 'card_no_extend,language', (d, t) =>
      options.onProgress?.('印刷版本', d, t)
    );
  }

  // ④ 关键词图标
  if (dataset.icons.length) {
    result.icons = await upsertChunked(
      'card_icons',
      dataset.icons.map((i) => ({ ...i, updated_at: now })),
      'name_zh',
      (d, t) => options.onProgress?.('关键词图标', d, t)
    );
  }

  return result;
}

/* ──────────────────────── 站点卡表快照(P5b) ──────────────────────── */

export interface SnapshotRows {
  cards: Array<Record<string, unknown>>;
  prints: Array<Record<string, unknown>>;
}

/**
 * 拉取生成站点快照所需的**全量原始行**。
 *
 * 注意与 loadExisting() 的区别:那个只取差异比对用的少数列;
 * 快照是给周报站离线预加载用的,必须与库中列一一对应(含 created_at /
 * updated_at / deck_limit / created_at 等),否则站点侧字段会缺。
 */
export async function loadSnapshotRows(
  onProgress?: (label: string, done: number, total: number) => void
): Promise<SnapshotRows> {
  onProgress?.('读取卡牌主数据', 0, 2);
  const cards = await selectAllPaged<Record<string, unknown>>('cards_base', '*', 1000);
  onProgress?.('读取印刷版本', 1, 2);
  const prints = await selectAllPaged<Record<string, unknown>>('card_prints', '*', 1000);
  onProgress?.('读取完成', 2, 2);
  return { cards, prints };
}
