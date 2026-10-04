import { ref, type Ref } from 'vue';
import { fetchVersions, type VersionCategory } from './rest';
import { readSupabaseConfig } from './config';

const DB_NAME = 'riftbound-reference-cache';
const STORE_NAME = 'resources';
const DB_VERSION = 1;

interface CacheRecord<T> {
  key: string;
  category: VersionCategory;
  version: string | null;
  savedAt: string;
  data: T;
}

export interface VersionedResource<T> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  checking: Ref<boolean>;
  stale: Ref<boolean>;
  error: Ref<string>;
  savedAt: Ref<string>;
  load: (force?: boolean) => Promise<T | null>;
}

let database: Promise<IDBDatabase | null> | null = null;
let versionsInFlight: Promise<Map<string, string | null>> | null = null;
const memoryCache = new Map<string, CacheRecord<unknown>>();
const resourceInFlight = new Map<string, Promise<unknown>>();

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!database) {
    database = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return database;
}

async function readCache<T>(key: string): Promise<CacheRecord<T> | null> {
  const memory = memoryCache.get(key);
  if (memory) return memory as CacheRecord<T>;
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => {
      const value = request.result as CacheRecord<T> | undefined;
      if (value) memoryCache.set(key, value as CacheRecord<unknown>);
      resolve(value ?? null);
    };
    request.onerror = () => resolve(null);
  });
}

async function writeCache<T>(record: CacheRecord<T>): Promise<void> {
  memoryCache.set(record.key, record as CacheRecord<unknown>);
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

async function currentVersions(): Promise<Map<string, string | null>> {
  if (!versionsInFlight) {
    versionsInFlight = fetchVersions()
      .then((rows) => new Map(rows.map((row) => [row.name, row.updated_at])))
      .finally(() => { versionsInFlight = null; });
  }
  return versionsInFlight;
}

/** Load cached data immediately, then use the version table to decide whether to refresh it. */
export function useVersionedResource<T>(
  category: VersionCategory,
  fetcher: () => Promise<T>
): VersionedResource<T> {
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(true);
  const checking = ref(false);
  const stale = ref(false);
  const error = ref('');
  const savedAt = ref('');
  const project = readSupabaseConfig()?.url ?? 'unconfigured';
  const key = `public:${project}:${category}`;

  async function load(force = false): Promise<T | null> {
    const existing = resourceInFlight.get(key) as Promise<T | null> | undefined;
    if (existing && !force) return existing;
    const task = (async (): Promise<T | null> => {
      loading.value = true;
      checking.value = true;
      error.value = '';
      const cached = await readCache<T>(key).catch(() => null);
      if (cached) {
        data.value = cached.data;
        savedAt.value = cached.savedAt;
      }
      try {
        const versions = await currentVersions();
        const currentVersion = versions.get(category) ?? null;
        if (!force && cached && versions.has(category) && cached.version === currentVersion) {
          stale.value = false;
          return cached.data;
        }
        const fresh = await fetcher();
        const record: CacheRecord<T> = {
          key,
          category,
          version: currentVersion,
          savedAt: new Date().toISOString(),
          data: fresh,
        };
        await writeCache(record);
        data.value = fresh;
        savedAt.value = record.savedAt;
        stale.value = false;
        return fresh;
      } catch (cause) {
        stale.value = Boolean(cached);
        error.value = cause instanceof Error ? cause.message : '数据更新失败';
        if (cached) return cached.data;
        throw cause;
      } finally {
        checking.value = false;
        loading.value = false;
      }
    })();
    resourceInFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (resourceInFlight.get(key) === task) resourceInFlight.delete(key);
    }
  }

  return { data, loading, checking, stale, error, savedAt, load };
}
