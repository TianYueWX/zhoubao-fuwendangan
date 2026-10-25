/**
 * 卡池的云端读写。表结构与权限见 supabase/web-collection.sql：
 * 一行 = 一个账号的一张印本(卡号 + 语言) + 持有数量。
 *
 * 云端表没有 updated_at 触发器，时间戳由这里写入时带上。
 */
import { getAccessToken, isEditorialAdmin } from "@/tools/sources/auth";
import { readSupabaseConfig } from "@/tools/sources/config";
import {
  RestError,
  restDelete,
  restInsert,
  restSelectPrivate,
  restUpdate,
  restUpsert,
} from "@/tools/sources/rest";
import { clampQuantity } from "./model";

export const COLLECTION_TABLE = "web_collection";
const PAGE_SIZE = 1000;

export interface CollectionRow {
  id: string;
  owner_id: string;
  card_no: string;
  language: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

/** 与云卡组同一套身份校验：必须是带 admin 角色的管理员会话。 */
export async function collectionIdentity(): Promise<string> {
  if (!isEditorialAdmin.value) throw new Error("请先使用管理员账号登录");
  const config = readSupabaseConfig();
  const token = await getAccessToken();
  if (!config || !token) throw new Error("管理员登录已失效，请重新登录");
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("无法验证管理员账号，请重新登录");
  const user = (await response.json()) as { id?: string; app_metadata?: { role?: string } };
  if (!user.id || user.app_metadata?.role !== "admin") throw new Error("当前账号没有管理员权限");
  return user.id;
}

/** 读回当前账号的全部卡池行。排序列唯一(card_no + language + id)，分页不会丢行。 */
export async function fetchCollection(owner: string): Promise<CollectionRow[]> {
  const rows: CollectionRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await restSelectPrivate<CollectionRow>(COLLECTION_TABLE, {
      filters: [{ column: "owner_id", op: "eq", value: owner }],
      order: "card_no.asc,language.asc,id.asc",
      limit: PAGE_SIZE,
      offset,
    });
    rows.push(...page.rows);
    if (page.rows.length < PAGE_SIZE) return rows;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof RestError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function isConflict(error: unknown): boolean {
  if (error instanceof RestError && (error.status === 409 || error.status === 400)) {
    return /唯一|unique|conflict|duplicate|42P10|23505/i.test(error.message);
  }
  return /唯一|unique|conflict|duplicate|42P10|23505/i.test(messageOf(error));
}

/**
 * 写入一张印本的数量：>=1 用 upsert，0 直接删行。
 * 若云端缺少 (owner_id, card_no, language) 唯一索引，upsert 会失败 —— 这时退回
 * 「先 PATCH，未命中再 INSERT」，保证功能不因少一条索引而不可用。
 */
export async function writeQuantity(
  owner: string,
  cardNo: string,
  language: string,
  quantity: number,
): Promise<CollectionRow | null> {
  const value = clampQuantity(quantity);
  const lang = language.trim().toUpperCase();
  if (value < 1) {
    await deleteQuantity(owner, cardNo, lang);
    return null;
  }
  const now = new Date().toISOString();
  const row = { owner_id: owner, card_no: cardNo, language: lang, quantity: value, updated_at: now };

  try {
    const rows = await restUpsert<CollectionRow>(
      COLLECTION_TABLE,
      [row],
      "owner_id,card_no,language",
    );
    if (rows[0]) return rows[0];
  } catch (error) {
    if (!isConflict(error)) throw error;
  }

  const filters = [
    { column: "owner_id" as const, op: "eq" as const, value: owner },
    { column: "card_no" as const, op: "eq" as const, value: cardNo },
    { column: "language" as const, op: "eq" as const, value: lang },
  ];
  const updated = await restUpdate<CollectionRow>(
    COLLECTION_TABLE,
    { quantity: value, updated_at: now },
    filters,
  );
  if (updated[0]) return updated[0];
  const inserted = await restInsert<CollectionRow>(COLLECTION_TABLE, row);
  return inserted[0] ?? null;
}

/** 删掉一格。行不存在也算成功（可能已被另一台设备删掉）。 */
export async function deleteQuantity(
  owner: string,
  cardNo: string,
  language: string,
): Promise<void> {
  await restDelete(COLLECTION_TABLE, [
    { column: "owner_id", op: "eq", value: owner },
    { column: "card_no", op: "eq", value: cardNo },
    { column: "language", op: "eq", value: language.trim().toUpperCase() },
  ]);
}

/** 把底层错误翻成人话，界面直接显示。 */
export function describeCollectionError(error: unknown): string {
  const message = messageOf(error);
  const status = error instanceof RestError ? error.status : 0;
  if (status === 0) return "网络不可达，改动已存在本机，恢复网络后会自动重试。";
  if (status === 401 || status === 403 || /permission denied|row-level security|权限不足/i.test(message)) {
    return "云端拒绝写入：请确认管理员登录仍有效，且账号在 Supabase app_metadata 里带 admin 角色。";
  }
  if (/does not exist|PGRST205|42P01/i.test(message)) {
    return "云端表还没建。请先在 Supabase SQL Editor 执行 supabase/web-collection.sql。";
  }
  if (/23514|violates check constraint|语言|language/i.test(message) && /check|constraint/i.test(message)) {
    return "这一格不符合云端约束（卡号格式或数量 1–999），请刷新后重试。";
  }
  return message || "写入失败，请稍后重试。";
}
