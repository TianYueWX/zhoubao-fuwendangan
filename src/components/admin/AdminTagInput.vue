<script setup lang="ts">
/**
 * AdminTagInput.vue · 数组字段的多选标签输入器
 *
 * 替代 Element Plus 的 el-select(multiple + allow-create)。用原生
 * datalist 提供「全表已出现过的值」作为候选 —— 既能下拉选已有的,
 * 也能直接敲新值回车新建,且零依赖、可键盘操作。
 */
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string[] | null;
    options?: string[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  { options: () => [], placeholder: '输入后回车新建', disabled: false }
);

const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>();

const draft = ref('');
const listId = `tagd-${Math.random().toString(36).slice(2, 9)}`;

const current = computed<string[]>(() => props.modelValue ?? []);

/** 候选里剔除已选中的 */
const remaining = computed(() => {
  const taken = new Set(current.value);
  return props.options.filter((o) => !taken.has(o));
});

function add(raw: string): void {
  const v = raw.trim();
  if (!v) return;
  if (!current.value.includes(v)) emit('update:modelValue', [...current.value, v]);
  draft.value = '';
}

function remove(v: string): void {
  emit(
    'update:modelValue',
    current.value.filter((x) => x !== v)
  );
}

/** 逗号/顿号也当作提交键 —— 中文录入时很自然 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === '、') {
    e.preventDefault();
    add(draft.value);
    return;
  }
  if (e.key === 'Backspace' && !draft.value && current.value.length) {
    remove(current.value[current.value.length - 1]!);
  }
}
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-1.5 min-h-[34px] px-2 py-1.5 bg-card-bg border border-card-border rounded-lg transition-colors focus-within:border-brand"
  >
    <span
      v-for="v in current"
      :key="v"
      class="inline-flex items-center gap-1 text-[12px] leading-none px-1.5 py-1 rounded bg-brand-soft text-brand border border-brand-faint"
    >
      {{ v }}
      <button
        v-if="!disabled"
        class="hover:text-ink transition-colors"
        :title="`移除 ${v}`"
        @click="remove(v)"
      >
        ✕
      </button>
    </span>

    <input
      v-model="draft"
      :list="listId"
      :disabled="disabled"
      :placeholder="current.length ? '' : placeholder"
      class="flex-1 min-w-[90px] bg-transparent border-0 outline-none text-[13px] text-ink placeholder:text-ink-faint/70 disabled:opacity-40"
      @keydown="onKeydown"
      @change="add(draft)"
    />
    <datalist :id="listId">
      <option v-for="o in remaining" :key="o" :value="o" />
    </datalist>
  </div>
</template>
