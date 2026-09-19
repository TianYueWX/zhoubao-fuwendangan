/** Database reads and reviewed single-record writes for the sync editor. */
import { restSelect, restInsert, restUpdate } from '../sources/rest';
import type { CardIconRow, CardPrintExportRow, CardsBaseRow } from '../sync/normalize';
import { executeOperation } from '../sync/write';
import type { ReviewOperation, Values } from '../sync/review';

export interface ExistingSnapshot {
  cards: CardsBaseRow[];
  prints: CardPrintExportRow[];
  icons: CardIconRow[];
  seriesCodes: string[];
  seriesByPrefix: Record<string, string>;
}
const EXISTING_CARD_COLUMNS = 'id,card_no,card_name_cn,sub_title_cn,card_color_list,region,tag,champion_tag,effect_cn,flavor_text_cn,energy,return_energy,power,rarity_name,series_name,card_category';
const EXISTING_PRINT_COLUMNS = 'id,card_id,card_no_extend,language,rarity_name,extend_rarity_name,img_cdn,artist,series,flavor_text_cn,is_promo';
const EXISTING_ICON_COLUMNS = 'id,name_zh,url,storage_type,isWhite';

async function selectAllPaged<T>(table: string, columns: string, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    // series 使用 code 主键，不存在 id 列。
    const order = table === 'series' ? 'code.asc' : 'id.asc';
    const { rows } = await restSelect<T>(table, { columns, order, limit: pageSize, offset });
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
export async function loadExisting(): Promise<ExistingSnapshot> {
  const [cards, prints, icons, series] = await Promise.all([
    selectAllPaged<CardsBaseRow>('cards_base', EXISTING_CARD_COLUMNS),
    selectAllPaged<CardPrintExportRow>('card_prints', EXISTING_PRINT_COLUMNS),
    selectAllPaged<CardIconRow>('card_icons', EXISTING_ICON_COLUMNS),
    selectAllPaged<{ code: string }>('series', 'code')
  ]);
  const seriesByPrefix: Record<string, string> = {};
  for (const c of cards) {
    const prefix = String(c.card_no ?? '').split('-')[0];
    if (prefix && c.series_name && !seriesByPrefix[prefix]) seriesByPrefix[prefix] = c.series_name;
  }
  return { cards, prints, icons, seriesCodes: series.map((s) => s.code), seriesByPrefix };
}
export async function applyReviewOperation(op: ReviewOperation): Promise<Values> {
  return executeOperation(op, {
    select: async (table, query) => (await restSelect<Values>(table, query)).rows,
    insert: (table, payload) => restInsert<Values>(table, payload),
    update: (table, payload, filters) => restUpdate<Values>(table, payload, filters)
  });
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
