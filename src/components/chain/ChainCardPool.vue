<script setup lang="ts">
/**
 * ChainCardPool.vue · 卡池侧栏
 *
 * 两个池子:
 *   - 卡牌列表:内置卡表的平卡全集(上游口径),按住拖出即克隆一张新卡
 *   - 自定义:用户自建的卡与「待处理效果」文本条目
 *
 * 池内节点带 data-pool-uid —— 拖拽层用它判断「这是模板,要克隆而不是移动」。
 * 卡池自身 put:false,因此不可能有东西被放进池子。
 *
 * 965 张卡一次性铺开会让低端机卡顿,这里做「分批显示 + 继续加载」,
 * 而不是上虚拟滚动 —— 后者在拖拽场景下与 SortableJS 的手感冲突。
 */
import { computed, ref, watch } from 'vue';
import type { ChainCustomCard, ChainCustomEffect } from '@/tools/chain/types';
import { searchPool, type ChainPoolItem } from '@/tools/chain/pool';
import { CARD_COLOR_HEX } from '@/utils/palette';
import { plainText } from './cardText';

/** 每批渲染的卡数 */
const PAGE_SIZE = 60;

const props = defineProps<{
  pool: readonly ChainPoolItem[];
  customCards: readonly ChainCustomCard[];
  customEffects: readonly ChainCustomEffect[];
  /** 编号 → 卡图 */
  imageOf: (cardId: string) => string;
  /** 卡池缩略图模式 */
  thumbMode: 'image' | 'text';
  status: 'loading' | 'ready' | 'failed';
}>();

const emit = defineEmits<{
  (e: 'add-custom-card'): void;
  (e: 'add-custom-effect'): void;
  (e: 'remove-custom-card', id: string): void;
  (e: 'remove-custom-effect', id: string): void;
  (e: 'update:thumbMode', mode: 'image' | 'text'): void;
}>();

const keyword = ref('');
const visibleCount = ref(PAGE_SIZE);
const poolOpen = ref(true);
const customOpen = ref(true);

/**
 * 拖拽源的两个真实容器。
 *
 * 为什么要把内部 DOM 暴露出去:
 *   SortableJS 必须挂在**真正装着卡片的那个元素**上,才能正确计算
 *   oldIndex/newIndex 并产出 clone 节点。宿主页面用模板 ref 拿不到
 *   组件内部的 div,所以在这里显式暴露。
 *   另:这里的类型是 Ref<Element> 而不是 Ref<HTMLElement>,与
 *   useChainDnd 的 Ref<HTMLElement | null> 不兼容,故由宿主统一
 *   归一化后再传入(见 ChainBoardView 的 poolListRef)。
 */
const poolListRef = ref<Element | null>(null);
const customListRef = ref<Element | null>(null);

defineExpose({ poolListRef, customListRef });

const filtered = computed(() => searchPool(props.pool, keyword.value));
const visible = computed(() => filtered.value.slice(0, visibleCount.value));
const hasMore = computed(() => filtered.value.length > visibleCount.value);

/** 搜索词变化时重置分页,否则搜到第 3 页再改词会看到空列表 */
watch(keyword, () => {
  visibleCount.value = PAGE_SIZE;
});

function loadMore(): void {
  visibleCount.value += PAGE_SIZE;
}

function colorStyle(colors: readonly string[]): Record<string, string> {
  const hexes = colors
    .map((c) => CARD_COLOR_HEX[c as keyof typeof CARD_COLOR_HEX])
    .filter((h): h is string => typeof h === 'string');
  if (hexes.length === 0) return { background: 'var(--color-map-ramp-2)' };
  return { background: `linear-gradient(135deg, ${hexes.join(', ')})` };
}

function subtitleOf(item: ChainPoolItem): string {
  return item.subtitle ? `${item.name} · ${item.subtitle}` : item.name;
}
</script>

<template>
  <aside class="chain-pool">
    <!-- ── 卡牌列表 ── -->
    <section class="pool-block">
      <header class="pool-head">
        <button type="button" class="pool-toggle" @click="poolOpen = !poolOpen">
          <span aria-hidden="true">{{ poolOpen ? '▾' : '▸' }}</span>
          卡牌列表
          <span class="pool-count tabular-nums">({{ filtered.length }})</span>
        </button>
        <div class="thumb-switch" role="group" aria-label="卡池显示方式">
          <button
            type="button"
            :class="{ active: thumbMode === 'image' }"
            title="缩略图"
            @click="emit('update:thumbMode', 'image')"
          >
            图
          </button>
          <button
            type="button"
            :class="{ active: thumbMode === 'text' }"
            title="纯文字"
            @click="emit('update:thumbMode', 'text')"
          >
            文
          </button>
        </div>
      </header>

      <template v-if="poolOpen">
        <input
          v-model="keyword"
          type="search"
          class="pool-search"
          placeholder="搜索卡名 / 编号 / 效果关键字…"
          aria-label="搜索卡牌"
        />

        <p v-if="status === 'loading'" class="pool-state">卡表载入中…</p>
        <p v-else-if="status === 'failed'" class="pool-state error">
          内置卡表加载失败。可在「数据管理」页手动上传卡表兜底。
        </p>
        <p v-else-if="filtered.length === 0" class="pool-state">没有匹配的卡牌</p>

        <!-- 拖拽源:data-pool-uid 标记这是模板 -->
        <div
          v-else
          ref="poolListRef"
          class="pool-list"
          data-drop-area="pool"
          :class="`thumb-${thumbMode}`"
        >
          <div
            v-for="item in visible"
            :key="item.id"
            class="pool-item"
            :data-pool-uid="item.id"
            :data-uid="`pool:${item.id}`"
            :title="`${subtitleOf(item)}\n${plainText(item.text, 160)}`"
          >
            <div v-if="thumbMode === 'image'" class="pool-thumb">
              <img
                v-if="imageOf(item.id)"
                :src="imageOf(item.id)"
                :alt="item.name"
                loading="lazy"
                draggable="false"
              />
              <span v-else class="pool-thumb-fallback" :style="colorStyle(item.colors)">
                {{ item.name }}
              </span>
            </div>
            <div class="pool-text">
              <span class="pool-name">
                {{ item.name }}
                <em v-if="item.subtitle" class="pool-sub">· {{ item.subtitle }}</em>
              </span>
              <span class="pool-meta tabular-nums">
                <b>{{ item.id }}</b>
                <i v-if="item.energy" class="pool-chip">费{{ item.energy }}</i>
                <i v-if="item.power" class="pool-chip">力{{ item.power }}</i>
                <i class="pool-chip">{{ item.category }}</i>
                <i v-if="item.banned" class="pool-chip banned">禁</i>
              </span>
            </div>
          </div>

          <button v-if="hasMore" type="button" class="pool-more" @click="loadMore">
            继续加载(还有 {{ filtered.length - visibleCount }} 张)
          </button>
        </div>
      </template>
    </section>

    <!-- ── 自定义 ── -->
    <section class="pool-block">
      <header class="pool-head">
        <button type="button" class="pool-toggle" @click="customOpen = !customOpen">
          <span aria-hidden="true">{{ customOpen ? '▾' : '▸' }}</span>
          自定义
          <span class="pool-count tabular-nums">
            ({{ customCards.length + customEffects.length }})
          </span>
        </button>
        <div class="custom-add">
          <button type="button" title="添加一张自定义卡" @click="emit('add-custom-card')">+ 卡</button>
          <button type="button" title="添加一条待处理效果" @click="emit('add-custom-effect')">+ 效果</button>
        </div>
      </header>

      <template v-if="customOpen">
        <p v-if="customCards.length === 0 && customEffects.length === 0" class="pool-state">
          还没有自定义条目。可添加卡库之外的卡,或临时记一条效果。
        </p>

        <div v-else ref="customListRef" class="pool-list" data-drop-area="custom-pool">
          <div
            v-for="card in customCards"
            :key="card.id"
            class="pool-item custom-item"
            :data-pool-uid="`custom:${card.id}`"
            :data-uid="`custom:${card.id}`"
          >
            <span class="pool-text">
              <span class="pool-name">{{ card.name }}</span>
              <span v-if="card.text" class="pool-sub-line">{{ plainText(card.text, 60) }}</span>
            </span>
            <button
              type="button"
              class="item-remove"
              title="从自定义池删除"
              @click.stop="emit('remove-custom-card', card.id)"
            >
              ×
            </button>
          </div>

          <div
            v-for="effect in customEffects"
            :key="effect.id"
            class="pool-item custom-item effect-item"
            :data-pool-uid="`effect:${effect.id}`"
            :data-uid="`effect:${effect.id}`"
          >
            <span class="pool-text">
              <span class="pool-name">{{ effect.text }}</span>
              <span class="pool-sub-line">待处理效果</span>
            </span>
            <button
              type="button"
              class="item-remove"
              title="从自定义池删除"
              @click.stop="emit('remove-custom-effect', effect.id)"
            >
              ×
            </button>
          </div>
        </div>
      </template>
    </section>

    <p class="pool-foot">
      把卡拖到左侧任一区域;卡池里的卡拖出即复制。把盘内的卡拖回这里 = 移出棋盘。
    </p>
  </aside>
</template>

<style scoped>
.chain-pool {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.pool-block {
  border: 1px solid var(--color-panel-border);
  border-radius: 10px;
  background: var(--color-panel-bg);
  padding: 9px 10px 10px;
}
.pool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pool-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-text-primary);
}
.pool-count { font-size: 10.5px; font-weight: 400; color: var(--color-text-subtle); }

.thumb-switch {
  display: inline-flex;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  overflow: hidden;
}
.thumb-switch button {
  padding: 1px 7px;
  font-size: 10px;
  color: var(--color-text-subtle);
  background: var(--color-card-bg);
}
.thumb-switch button.active {
  background: var(--color-brand);
  color: var(--color-brand-ink);
  font-weight: 600;
}

.pool-search {
  width: 100%;
  margin-top: 8px;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--color-panel-border);
  border-radius: 7px;
  background: var(--color-card-bg);
  color: var(--color-text-primary);
}
.pool-search:focus { border-color: var(--color-brand-faint); outline: none; }

.pool-state {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-subtle);
  text-align: center;
  padding: 12px 6px;
}
.pool-state.error { color: var(--color-brand); }

.pool-list {
  margin-top: 8px;
  max-height: 44vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;
}
.pool-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: grab;
  background: var(--color-card-bg);
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  transition: border-color 120ms, background-color 120ms;
}
.pool-item:hover {
  border-color: var(--color-brand-faint);
  background: var(--color-dropzone-hover-bg);
}
.pool-item:active { cursor: grabbing; }

.pool-thumb {
  flex: 0 0 auto;
  width: 30px;
  aspect-ratio: 5 / 7;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--color-card-border);
  background: var(--color-page-bg);
}
.pool-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pool-thumb-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 7px;
  color: #fff;
  text-align: center;
  line-height: 1.1;
  padding: 1px;
  overflow: hidden;
}

.pool-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pool-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pool-sub { font-style: normal; font-weight: 400; color: var(--color-text-subtle); font-size: 10px; }
.pool-sub-line {
  font-size: 9.5px;
  color: var(--color-text-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pool-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  color: var(--color-text-subtle);
  flex-wrap: wrap;
}
.pool-meta b { font-weight: 600; letter-spacing: 0.02em; }
.pool-chip {
  font-style: normal;
  padding: 0 3px;
  border: 1px solid var(--color-panel-border);
  border-radius: 3px;
}
.pool-chip.banned { border-color: var(--color-brand); color: var(--color-brand); font-weight: 700; }

.pool-more {
  margin-top: 5px;
  padding: 5px;
  font-size: 11px;
  border: 1px dashed var(--color-panel-border);
  border-radius: 7px;
  color: var(--color-text-muted);
}
.pool-more:hover { border-color: var(--color-brand); color: var(--color-brand); }

.custom-add { display: flex; gap: 4px; }
.custom-add button {
  font-size: 10px;
  padding: 1px 6px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-muted);
}
.custom-add button:hover { border-color: var(--color-brand); color: var(--color-brand); }

.custom-item { cursor: grab; }
.effect-item { border-left: 3px solid var(--color-accent); }
.item-remove {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
  color: var(--color-text-subtle);
}
.item-remove:hover { background: var(--color-brand-soft); color: var(--color-brand); }

.pool-foot {
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-text-subtle);
  padding: 0 2px;
}

/* 纯文字模式:把缩略图收掉 */
.thumb-text .pool-thumb { display: none; }
</style>
