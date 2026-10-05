import { getAccessToken, isEditorialAdmin } from '@/tools/sources/auth';
import { readSupabaseConfig } from '@/tools/sources/config';
import { restSelectPrivate, restInsert, restUpdate, restDelete } from '@/tools/sources/rest';
import { cloneDeck, parseDeck, type BuilderDeck } from './model';

const TABLE = 'web_decks';
export interface CloudDeck { id: string; owner_id: string; name: string; document: BuilderDeck; updated_at: string }
export async function cloudIdentity(): Promise<string> {
  if (!isEditorialAdmin.value) throw new Error('请先使用管理员账号登录');
  const config = readSupabaseConfig(); const token = await getAccessToken();
  if (!config || !token) throw new Error('管理员登录已失效，请重新登录');
  const response = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('无法验证管理员账号，请重新登录');
  const user = await response.json() as { id?: string; app_metadata?: { role?: string } };
  if (!user.id || user.app_metadata?.role !== 'admin') throw new Error('当前账号没有管理员权限');
  return user.id;
}
function normalize(row: CloudDeck): CloudDeck { return { ...row, document: { ...parseDeck(row.document), id: row.id } }; }
export async function listCloud(owner: string): Promise<CloudDeck[]> {
  const all = new Map<string,CloudDeck>();
  for (let offset=0;;offset+=1000) {
    const { rows } = await restSelectPrivate<CloudDeck>(TABLE, { filters: [{ column: 'owner_id', op: 'eq', value: owner }], order: 'updated_at.desc,id.asc', limit: 1000, offset });
    for (const row of rows) all.set(row.id,normalize(row));
    if (rows.length<1000) return [...all.values()];
  }
}
export async function loadCloud(id: string, owner: string): Promise<CloudDeck> {
  const { rows } = await restSelectPrivate<CloudDeck>(TABLE, { filters: [{ column: 'id', op: 'eq', value: id }, { column: 'owner_id', op: 'eq', value: owner }], limit: 1 });
  if (!rows[0]) throw new Error('云端卡组不存在，或不属于当前账号');
  return normalize(rows[0]);
}
export async function saveCloud(deck: BuilderDeck, owner: string, existing: CloudDeck | null): Promise<CloudDeck> {
  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();
  const document = { ...cloneDeck(parseDeck(deck)), id, name: deck.name.trim() || '未命名卡组', updatedAt: now, savedAt: now };
  const rows = existing
    ? await restUpdate<CloudDeck>(TABLE, { name: document.name, document }, [{ column: 'id', op: 'eq', value: existing.id }, { column: 'owner_id', op: 'eq', value: owner }, { column: 'updated_at', op: 'eq', value: existing.updated_at }])
    : await restInsert<CloudDeck>(TABLE, { id, owner_id: owner, name: document.name, document });
  if (!rows[0]) throw new Error('云端卡组已被更新或权限已改变。请重新载入，或保存为新卡组；当前草稿仍保留。');
  return normalize(rows[0]);
}
export async function deleteCloud(row: CloudDeck, owner: string): Promise<void> {
  const rows = await restDelete(TABLE, [{ column: 'id', op: 'eq', value: row.id }, { column: 'owner_id', op: 'eq', value: owner }, { column: 'updated_at', op: 'eq', value: row.updated_at }]);
  if (!rows.length) throw new Error('卡组已被更新或删除，请刷新云端卡组库');
}
