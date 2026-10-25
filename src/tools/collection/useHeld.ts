/**
 * 只读地拿一份持有量索引，供构筑页 / 卡组详情页算「持 N」「缺卡」「完成度」。
 * 不做写入队列：这两个页面只读卡池，改动仍只在卡池页发生。
 */
import { computed, shallowRef, ref, type Ref } from "vue";
import type { CardRecord } from "@/components/carddex/types";
import { isEditorialAdmin } from "@/tools/sources/auth";
import { collectionIdentity, describeCollectionError, fetchCollection } from "./api";
import { buildHeldIndex, entriesFromRows, type CollectionMap } from "./model";
import { loadCachedEntries } from "./storage";

export function useHeld(records: Ref<readonly CardRecord[]>) {
  const entries = shallowRef<CollectionMap>(new Map());
  const ready = ref(false);
  const error = ref("");
  const held = computed(() => buildHeldIndex(entries.value, records.value));

  async function load(): Promise<void> {
    if (!isEditorialAdmin.value) return;
    try {
      const owner = await collectionIdentity();
      const cached = loadCachedEntries(owner);
      if (cached) entries.value = cached.entries;
      let loaded = false;
      try {
        entries.value = entriesFromRows(await fetchCollection(owner));
        loaded = true;
      } catch (cause) {
        error.value = describeCollectionError(cause);
        if (!cached) throw cause;
      }
      if (loaded) error.value = "";
      ready.value = true;
    } catch (cause) {
      error.value = describeCollectionError(cause);
      ready.value = true;
    }
  }

  return { entries, held, ready, error, load, reload: load };
}
