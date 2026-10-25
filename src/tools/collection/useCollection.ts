/**
 * 卡池的读写编排：乐观更新 → 300ms 合并 → 串行上送 → 失败进 pending 等重试。
 * 页面卸载/刷新前会把 pending 写进本机缓存，下次进入继续重试。
 */
import { computed, onBeforeUnmount, shallowRef, ref } from "vue";
import { isEditorialAdmin } from "@/tools/sources/auth";
import {
  collectionIdentity,
  describeCollectionError,
  fetchCollection,
  writeQuantity,
} from "./api";
import {
  clampQuantity,
  collectionKey,
  entriesFromRows,
  totalQuantity,
  type CollectionMap,
} from "./model";
import { loadCachedEntries, writeCache } from "./storage";

export type CollectionPhase = "idle" | "loading" | "ready" | "error" | "blocked";

interface QueueItem {
  cardNo: string;
  language: string;
  quantity: number;
}

const FLUSH_DELAY_MS = 300;

export function useCollection() {
  const entries = shallowRef<CollectionMap>(new Map());
  const pending = shallowRef<CollectionMap>(new Map());
  const phase = ref<CollectionPhase>("idle");
  const error = ref("");
  const savedAt = ref("");
  const syncing = ref(false);
  const owner = ref("");

  const queue = new Map<string, QueueItem>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;

  const unsavedCount = computed(() => pending.value.size);
  const totalHeld = computed(() => totalQuantity(entries.value));

  function persist(): void {
    if (!owner.value) return;
    writeCache(owner.value, entries.value, savedAt.value, pending.value);
  }

  function warnBeforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault();
    event.returnValue = "";
  }

  function syncBeforeUnload(): void {
    if (typeof window === "undefined") return;
    const dirty = pending.value.size > 0;
    window.removeEventListener("beforeunload", warnBeforeUnload);
    if (dirty) window.addEventListener("beforeunload", warnBeforeUnload);
  }

  async function load(force = false): Promise<void> {
    if (!isEditorialAdmin.value) {
      phase.value = "blocked";
      return;
    }
    if (phase.value === "loading" || (phase.value === "ready" && !force && owner.value)) return;
    phase.value = "loading";
    error.value = "";
    try {
      const id = await collectionIdentity();
      owner.value = id;
      const cached = loadCachedEntries(id);
      if (cached) {
        entries.value = cached.entries;
        pending.value = cached.pending;
        savedAt.value = cached.savedAt;
        for (const [key, entry] of cached.pending) {
          queue.set(key, { cardNo: entry.cardNo, language: entry.language, quantity: entry.quantity });
        }
        if (cached.entries.size) phase.value = "ready";
      }
      const rows = await fetchCollection(id);
      const merged = entriesFromRows(rows);
      // 待重试的格子比云端新，覆盖回去。
      for (const [key, entry] of pending.value) merged.set(key, entry);
      entries.value = merged;
      savedAt.value = new Date().toISOString();
      phase.value = "ready";
      persist();
      syncBeforeUnload();
      if (queue.size) void flush();
    } catch (cause) {
      error.value = describeCollectionError(cause);
      phase.value = entries.value.size ? "ready" : "error";
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, FLUSH_DELAY_MS);
  }

  /** 设定某一格的数量；0 表示没有这张卡。 */
  function setQuantity(cardNo: string, language: string, quantity: number): void {
    const lang = language.trim().toUpperCase();
    const value = clampQuantity(quantity);
    const key = collectionKey(cardNo, lang);
    const now = new Date().toISOString();

    const next = new Map(entries.value);
    if (value < 1) next.delete(key);
    else next.set(key, { cardNo, language: lang, quantity: value, updatedAt: now });
    entries.value = next;

    const pendingNext = new Map(pending.value);
    pendingNext.set(key, { cardNo, language: lang, quantity: value, updatedAt: now });
    pending.value = pendingNext;

    queue.set(key, { cardNo, language: lang, quantity: value });
    error.value = "";
    persist();
    syncBeforeUnload();
    schedule();
  }

  function bump(cardNo: string, language: string, delta: number): void {
    const key = collectionKey(cardNo, language);
    const current = entries.value.get(key)?.quantity ?? 0;
    setQuantity(cardNo, language, current + delta);
  }

  async function flush(): Promise<void> {
    if (flushing || !owner.value || !queue.size) return;
    flushing = true;
    syncing.value = true;
    try {
      while (queue.size) {
        const first = queue.entries().next();
        if (first.done) break;
        const [key, item] = first.value;
        try {
          await writeQuantity(owner.value, item.cardNo, item.language, item.quantity);
          if (queue.get(key) === item) queue.delete(key);
          if (!queue.has(key)) {
            const pendingNext = new Map(pending.value);
            pendingNext.delete(key);
            pending.value = pendingNext;
          }
          savedAt.value = new Date().toISOString();
          error.value = "";
        } catch (cause) {
          // 留在 queue / pending 里，等用户点重试或下次进入页面。
          error.value = describeCollectionError(cause);
          break;
        }
      }
    } finally {
      flushing = false;
      syncing.value = false;
      persist();
      syncBeforeUnload();
    }
  }

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    if (typeof window !== "undefined") window.removeEventListener("beforeunload", warnBeforeUnload);
    if (queue.size) void flush();
    persist();
  });

  return {
    entries,
    pending,
    phase,
    error,
    savedAt,
    syncing,
    owner,
    unsavedCount,
    totalHeld,
    load,
    setQuantity,
    bump,
    flush,
    retry: flush,
  };
}
