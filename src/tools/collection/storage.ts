/**
 * 卡池的本机状态：一份「已确认的云端快照」缓存，加一份「还没写成功的格子」清单。
 * 刷新页面时先把缓存画出来，再拉云端；失败的格子从 pending 里继续重试。
 */
import type { ActiveFilter, NumericFilters } from "@/components/carddex/types";
import { entriesFromSnapshot, toSnapshot, type CollectionEntry, type CollectionMap } from "./model";

export const CACHE_KEY = "rune.collection.v1";
export const UI_KEY = "rune.collection.ui.v1";

export type CollectionViewMode = "owned" | "all";
export type CollectionSort = "default" | "name" | "quantity" | "updated";

export interface CollectionCache {
  formatVersion: 1;
  owner: string;
  savedAt: string;
  entries: CollectionEntry[];
  pending: CollectionEntry[];
}

export interface CollectionUi {
  view: CollectionViewMode;
  sort: CollectionSort;
  filters: ActiveFilter[];
  numeric: NumericFilters;
  languages: string[];
  versions: string[];
  sections: Record<string, boolean>;
}

const DEFAULT_NUMERIC: NumericFilters = {
  energy: { min: 0, max: 99 },
  returnEnergy: { min: 0, max: 99 },
  power: { min: 0, max: 99 },
};

export const DEFAULT_UI: CollectionUi = {
  view: "owned",
  sort: "default",
  filters: [],
  numeric: DEFAULT_NUMERIC,
  languages: [],
  versions: [],
  sections: {},
};

function readRaw<T>(key: string): T | null {
  try {
    const text = window.localStorage.getItem(key);
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 私密模式或空间满：缓存失败不影响主流程 */
  }
}

export function readCache(owner: string): CollectionCache | null {
  const raw = readRaw<CollectionCache>(CACHE_KEY);
  if (!raw || raw.formatVersion !== 1 || raw.owner !== owner) return null;
  if (!Array.isArray(raw.entries)) return null;
  return {
    formatVersion: 1,
    owner: raw.owner,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    entries: raw.entries,
    pending: Array.isArray(raw.pending) ? raw.pending : [],
  };
}

export function writeCache(
  owner: string,
  entries: CollectionMap,
  savedAt: string,
  pending: CollectionMap,
): void {
  writeRaw(CACHE_KEY, {
    formatVersion: 1,
    owner,
    savedAt,
    entries: toSnapshot(entries),
    pending: toSnapshot(pending),
  } satisfies CollectionCache);
}

export function loadCachedEntries(owner: string): { entries: CollectionMap; pending: CollectionMap; savedAt: string } | null {
  const cache = readCache(owner);
  if (!cache) return null;
  return {
    entries: entriesFromSnapshot(cache.entries),
    pending: entriesFromSnapshot(cache.pending),
    savedAt: cache.savedAt,
  };
}

export function clearCache(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function readUi(): CollectionUi {
  const raw = readRaw<Partial<CollectionUi>>(UI_KEY);
  if (!raw || typeof raw !== "object") return { ...DEFAULT_UI };
  const view: CollectionViewMode = raw.view === "all" ? "all" : "owned";
  const sort: CollectionSort =
    raw.sort === "name" || raw.sort === "quantity" || raw.sort === "updated" ? raw.sort : "default";
  return {
    view,
    sort,
    filters: Array.isArray(raw.filters) ? raw.filters : [],
    numeric: raw.numeric && typeof raw.numeric === "object" ? raw.numeric : DEFAULT_NUMERIC,
    languages: Array.isArray(raw.languages) ? raw.languages.map(String) : [],
    versions: Array.isArray(raw.versions) ? raw.versions.map(String) : [],
    sections: raw.sections && typeof raw.sections === "object" ? raw.sections : {},
  };
}

export function writeUi(ui: CollectionUi): void {
  writeRaw(UI_KEY, ui);
}
