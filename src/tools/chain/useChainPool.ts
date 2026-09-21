/* ================================================================
 * src/tools/chain/useChainPool.ts
 *
 * 结算链推演 —— 卡池接入(把内置卡表变成可搜索的卡池)。
 *
 * 为什么不用 store.result.catalog:
 *   result 只在**分析过数据包之后**才存在,而结算链推演是独立小工具,
 *   不该要求用户先上传赛事数据。这里直接从 store.cardBase / cardPrints
 *   (随站点预加载的静态卡表)构建目录,因此工具在「零数据包」下可用。
 *
 * 代价说明:buildCardCatalog 会遍历 2400+ 行印刷版本,属于一次性的
 * 同步开销(实测毫秒级),用 computed 做记忆化,只在卡表变化时重算。
 * ============================================================== */

import { computed } from 'vue';
import type { CardCatalog } from '@/types';
import { buildCardCatalog } from '@/utils/dataParser';
import { store } from '@/store/analysis';
import { buildChainPool, type ChainPoolItem } from './pool';

/**
 * 由内置卡表构建的卡牌目录 + 平卡卡池。
 * 返回值全部是 computed,可直接在模板里用。
 */
export function useChainPool() {
  /** 卡牌目录(卡图裁决在里面,天然 SC 优先) */
  const catalog = computed<CardCatalog | null>(() => {
    if (!store.cardBase || !store.cardPrints) return null;
    return buildCardCatalog(store.cardBase, store.cardPrints);
  });

  /** 平卡卡池(上游口径:extend_rarity_name === '平卡') */
  const pool = computed<ChainPoolItem[]>(() =>
    buildChainPool(store.cardBase, store.cardPrints, catalog.value)
  );

  /** 卡表载入状态,供视图给出「加载中 / 失败 / 就绪」三态 */
  const status = computed<'loading' | 'ready' | 'failed'>(() => {
    if (store.cardDataStatus === 'failed') return 'failed';
    if (pool.value.length > 0) return 'ready';
    return 'loading';
  });

  /**
   * 按编号查卡图。
   * 盘内卡只存了编号,不存图 URL —— 图 URL 属于「当前环境的卡表事实」,
   * 存进盘里会让导出的文件绑死某个 CDN 版本,不利于长期可读。
   */
  const imageOf = (cardId: string): string => catalog.value?.cardImg.get(cardId) ?? '';

  return { catalog, pool, status, imageOf };
}
