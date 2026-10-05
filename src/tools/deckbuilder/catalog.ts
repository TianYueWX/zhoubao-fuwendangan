import { computed, onMounted } from 'vue';
import { store, loadCardData } from '@/store/analysis';
import { buildCarddexData } from '@/components/carddex/data';
import { useVersionedResource } from '@/tools/sources/versionedCache';
import { restSelectAll } from '@/tools/sources/rest';
import { readSupabaseConfig } from '@/tools/sources/config';
import { cardIndex } from './model';

type Row = Record<string, unknown>;
const cards = useVersionedResource('cards', () => restSelectAll<Row>('cards_base', { order: 'card_no.asc,id.asc' }));
const prints = useVersionedResource('prints', () => restSelectAll<Row>('card_prints', { order: 'card_no_extend.asc,id.asc' }));
const icons = useVersionedResource('icons', () => restSelectAll<Row>('card_icons', { order: 'name_zh.asc' }).catch(() => []));
const data = computed(() => buildCarddexData(cards.data.value ?? (store.cardBase ?? []).map(r => ({ ...r })), prints.data.value ?? (store.cardPrints ?? []).map(r => ({ ...r })), icons.data.value ?? [], [], []));
const index = computed(() => cardIndex(data.value.records));
export function useBuilderCatalog() {
  async function reload(force = false): Promise<void> {
    if (store.cardDataStatus === 'failed' || !store.cardBase) await loadCardData();
    if (readSupabaseConfig()) {
      await Promise.allSettled([cards.load(force), prints.load(force), icons.load(force)]);
      // Retry an empty cache left by the previous icon query.
      if (!force && icons.data.value?.length === 0) await icons.load(true).catch(() => undefined);
    }
  }
  onMounted(() => { void reload(); });
  return {
    records: computed(() => data.value.records), index, icons: computed(() => data.value.icons),
    loading: computed(() => !data.value.records.length && (store.cardDataStatus === 'loading' || (readSupabaseConfig() && (cards.loading.value || prints.loading.value)))),
    sourceNote: computed(() => cards.data.value && prints.data.value ? (cards.stale.value || prints.stale.value ? '缓存卡表 · 更新暂不可用' : '卡表已就绪') : data.value.records.length ? '内置卡表 · 正在检查更新' : '卡表暂不可用'),
    reload,
  };
}
