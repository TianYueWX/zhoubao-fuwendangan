<script setup lang="ts">
import { ref } from 'vue';
import { ArrowDown, ArrowUp, Minus, Plus, RotateCcw } from '@lucide/vue';
import BuilderModal from './BuilderModal.vue';
import {
  DECK_SORT_FIELDS,
  DEFAULT_DECK_SORT,
  activeSortRules,
  type DeckSortRule
} from '@/tools/deckbuilder/sort';

const props = defineProps<{ rules: readonly DeckSortRule[] }>();
const emit = defineEmits<{ close: []; apply: [rules: DeckSortRule[]] }>();

const draft = ref<DeckSortRule[]>(props.rules.map((rule) => ({ ...rule })));
let seed = 0;

function add(): void {
  const next = DECK_SORT_FIELDS.find((field) => !draft.value.some((rule) => rule.field === field.id));
  if (!next) return;
  draft.value.push({ id: `sort-new-${seed++}`, field: next.id, asc: true });
}

function move(index: number, by: number): void {
  const target = index + by;
  if (target < 0 || target >= draft.value.length) return;
  const next = [...draft.value];
  const [row] = next.splice(index, 1);
  if (row) next.splice(target, 0, row);
  draft.value = next;
}

function reset(): void {
  draft.value = DEFAULT_DECK_SORT.map((rule) => ({ ...rule }));
}

function apply(): void {
  emit('apply', activeSortRules(draft.value).map((rule, index) => ({ ...rule, id: `sort-${index}` })));
}
</script>

<template>
  <BuilderModal title="排序卡表" @close="emit('close')">
    <p class="sort-intro">
      按以下条件依次比较；条件相同时保持构筑时的原始顺序。排序只影响浏览，不改动卡组本身。
    </p>
    <div class="sort-rules">
      <div v-for="(rule, index) in draft" :key="rule.id" class="sort-rule">
        <span class="sort-index">{{ index + 1 }}</span>
        <select v-model="rule.field" :aria-label="`排序条件 ${index + 1} 字段`">
          <option
            v-for="field in DECK_SORT_FIELDS"
            :key="field.id"
            :value="field.id"
            :disabled="draft.some((item) => item !== rule && item.field === field.id)"
          >
            {{ field.label }}
          </option>
        </select>
        <select v-model="rule.asc" :aria-label="`排序条件 ${index + 1} 方向`">
          <option :value="true">升序</option>
          <option :value="false">降序</option>
        </select>
        <div class="sort-move">
          <button type="button" aria-label="上移" :disabled="index === 0" @click="move(index, -1)">
            <ArrowUp :size="15" />
          </button>
          <button type="button" aria-label="下移" :disabled="index === draft.length - 1" @click="move(index, 1)">
            <ArrowDown :size="15" />
          </button>
        </div>
        <button type="button" class="sort-remove" aria-label="删除这条排序" @click="draft.splice(index, 1)">
          <Minus :size="15" />
        </button>
      </div>
      <button v-if="draft.length < DECK_SORT_FIELDS.length" type="button" class="sort-add" @click="add">
        <Plus :size="14" aria-hidden="true" /> 添加排序条件
      </button>
    </div>
    <template #footer>
      <button type="button" class="b-btn" @click="reset"><RotateCcw :size="14" aria-hidden="true" /> 恢复默认</button>
      <button type="button" class="b-btn" @click="emit('close')">取消</button>
      <button type="button" class="b-btn b-primary" @click="apply">应用</button>
    </template>
  </BuilderModal>
</template>

<style scoped>
.sort-intro {
  margin: 0 0 14px;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.7;
}
.sort-rules {
  display: grid;
  gap: 8px;
}
.sort-rule {
  display: grid;
  grid-template-columns: 20px minmax(0, 260px) 96px 60px 32px;
  justify-content: start;
  align-items: center;
  gap: 8px;
}
.sort-index {
  color: var(--color-text-subtle);
  font-size: 11px;
}
.sort-rule select {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--color-card-border);
  border-radius: 7px;
  background: var(--color-page-bg);
  font-size: 13px;
}
.sort-move {
  display: flex;
}
.sort-move button,
.sort-remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  color: var(--color-text-muted);
}
.sort-move button:disabled {
  opacity: 0.25;
}
.sort-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px;
  border: 1px dashed var(--color-card-border);
  border-radius: 8px;
  color: var(--color-brand);
  font-size: 13px;
}
.sort-add:hover {
  background: var(--color-brand-soft);
}
.b-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 40px;
  padding: 9px 14px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  background: var(--color-card-bg);
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}
.b-btn:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}
.b-primary {
  border-color: var(--color-brand);
  background: var(--color-brand);
  color: var(--color-brand-ink);
}
@media (max-width: 520px) {
  .sort-rule {
    grid-template-columns: 16px minmax(0, 1fr) 78px 32px;
  }
  .sort-move {
    display: none;
  }
}
</style>
