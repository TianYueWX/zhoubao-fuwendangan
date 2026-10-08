import { clone, parseDocument, type ImageAsset, type MakerDocument } from './model';

export interface SavedWork {
  document: MakerDocument;
  thumbnail: string;
}
let database: Promise<IDBDatabase> | undefined;
let pendingWrites: Promise<void> = Promise.resolve();
function db(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const r = indexedDB.open('rune.cardmaker.v1', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('works', { keyPath: 'document.id' });
      r.result.createObjectStore('assets', { keyPath: 'id' });
      r.result.createObjectStore('meta');
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => {
        d.close();
        database = undefined;
      };
      resolve(d);
    };
    r.onerror = () => {
      database = undefined;
      reject(new Error('本机作品库无法打开，请用 JSON 备份作品。'));
    };
    r.onblocked = () => {
      database = undefined;
      reject(new Error('请关闭其他卡牌工坊标签页，再打开作品库。'));
    };
  });
  return database;
}
async function read<T>(store: string, key?: string): Promise<T> {
  await pendingWrites.catch(() => undefined);
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store),
      r = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}
export async function listWorks(): Promise<SavedWork[]> {
  return (await read<SavedWork[]>('works')).sort((a, b) =>
    b.document.updatedAt.localeCompare(a.document.updatedAt),
  );
}
export async function loadWork(
  id: string,
): Promise<{ document: MakerDocument; assets: ImageAsset[]; thumbnail: string } | null> {
  const work = await read<SavedWork | undefined>('works', id);
  if (!work) return null;
  const document = parseDocument(work.document),
    ids = [...new Set(document.layers.map((l) => l.assetId))];
  const assets = await Promise.all(ids.map((id) => read<ImageAsset | undefined>('assets', id)));
  if (assets.some((a) => !a)) throw new Error('作品图片丢失，请从 JSON 备份恢复。');
  return { document, assets: assets as ImageAsset[], thumbnail: work.thumbnail };
}
export async function currentWork(): Promise<string | undefined> {
  return read<string | undefined>('meta', 'current');
}
export function saveWork(
  document: MakerDocument,
  assets: ImageAsset[],
  thumbnail: string,
): Promise<void> {
  const snapshot = clone(document),
    images = assets.map((asset) => ({ ...asset }));
  const write = pendingWrites
    .catch(() => undefined)
    .then(() => writeWork(snapshot, images, thumbnail));
  pendingWrites = write;
  return write;
}
async function writeWork(
  document: MakerDocument,
  images: ImageAsset[],
  thumbnail: string,
): Promise<void> {
  const d = await db(),
    work = { document, thumbnail };
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(['works', 'assets', 'meta'], 'readwrite');
    tx.objectStore('works').put(work);
    const assetStore = tx.objectStore('assets');
    for (const a of images) {
      const existing = assetStore.getKey(a.id);
      existing.onsuccess = () => {
        if (existing.result === undefined) assetStore.put(a);
      };
    }
    tx.objectStore('meta').put(document.id, 'current');
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(new Error('本机保存失败，可能空间不足。请立即导出 JSON 备份。'));
  });
}
export async function deleteWork(id: string): Promise<void> {
  await pendingWrites.catch(() => undefined);
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    // Assets can be shared by copies. Collect only images no remaining work uses.
    const tx = d.transaction(['works', 'assets', 'meta'], 'readwrite'),
      works = tx.objectStore('works');
    works.delete(id);
    const r = works.getAll();
    r.onsuccess = () => {
      const used = new Set(
        (r.result as SavedWork[]).flatMap((w) => w.document.layers.map((l) => l.assetId)),
      );
      const cursor = tx.objectStore('assets').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          if (!used.has(String(c.key))) c.delete();
          c.continue();
        }
      };
    };
    const meta = tx.objectStore('meta'),
      current = meta.get('current');
    current.onsuccess = () => {
      if (current.result === id) meta.delete('current');
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('删除失败。'));
  });
}
