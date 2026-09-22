<script setup lang="ts">
import { ref, watch } from "vue";
import type { CarddexLocale, SortField, SortRule } from "./types";
const props = defineProps<{
  open: boolean;
  locale: CarddexLocale;
  rules: SortRule[];
}>();
const emit = defineEmits<{ close: []; apply: [rules: SortRule[]] }>();
const draft = ref<SortRule[]>([]);
watch(
  () => props.open,
  (open) => {
    if (open) draft.value = props.rules.map((r) => ({ ...r }));
  },
);
const fields: Array<[SortField, string, string]> = [
  ["name", "卡名", "Name"],
  ["cardNo", "编号", "Number"],
  ["category", "类别", "Category"],
  ["color", "颜色", "Color"],
  ["series", "系列", "Series"],
  ["rarity", "稀有度", "Rarity"],
  ["power", "战力", "Power"],
  ["energy", "法力", "Energy"],
  ["returnEnergy", "符能", "Rune"],
];
function add(): void {
  const f = fields.find(([key]) => !draft.value.some((r) => r.field === key));
  if (f) draft.value.push({ id: crypto.randomUUID(), field: f[0], asc: true });
}
function move(i: number, by: number): void {
  const j = i + by;
  if (j < 0 || j >= draft.value.length) return;
  const next = [...draft.value];
  const [row] = next.splice(i, 1);
  if (row) next.splice(j, 0, row);
  draft.value = next;
}
</script>
<template>
  <Teleport to="body"
    ><div v-if="open" class="backdrop" @mousedown.self="emit('close')">
      <section class="dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <small>{{ locale === "zh" ? "结果次序" : "Result order" }}</small>
            <h2>{{ locale === "zh" ? "多条件排序" : "Multi-key sort" }}</h2>
          </div>
          <button @click="emit('close')">✕</button>
        </header>
        <div class="rules">
          <div v-for="(rule, i) in draft" :key="rule.id" class="rule">
            <span>{{ i + 1 }}</span>
            <select v-model="rule.field">
              <option
                v-for="f in fields"
                :key="f[0]"
                :value="f[0]"
                :disabled="draft.some((r) => r !== rule && r.field === f[0])"
              >
                {{ f[locale === "zh" ? 1 : 2] }}
              </option>
            </select>
            <select v-model="rule.asc">
              <option :value="true">
                {{ locale === "zh" ? "升序" : "Ascending" }}
              </option>
              <option :value="false">
                {{ locale === "zh" ? "降序" : "Descending" }}
              </option>
            </select>
            <div>
              <button :disabled="i === 0" @click="move(i, -1)">↑</button
              ><button :disabled="i === draft.length - 1" @click="move(i, 1)">
                ↓
              </button>
            </div>
            <button class="remove" @click="draft.splice(i, 1)">×</button>
          </div>
          <button v-if="draft.length < fields.length" class="add" @click="add">
            ＋ {{ locale === "zh" ? "添加排序条件" : "Add sort key" }}
          </button>
        </div>
        <footer>
          <button @click="emit('close')">
            {{ locale === "zh" ? "取消" : "Cancel" }}</button
          ><button class="primary" @click="emit('apply', draft)">
            {{ locale === "zh" ? "应用" : "Apply" }}
          </button>
        </footer>
      </section>
    </div></Teleport
  >
</template>
<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(35, 32, 28, 0.5);
  backdrop-filter: blur(4px);
}
.dialog {
  width: min(620px, 96vw);
  max-height: 85vh;
  overflow: hidden;
  background: var(--color-card-bg);
  border: 1px solid var(--color-panel-border);
  border-radius: 13px;
  box-shadow: 0 25px 70px rgba(20, 15, 10, 0.3);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-panel-border);
}
header small {
  color: var(--color-brand);
  letter-spacing: 0.15em;
  font-size: 9px;
}
h2 {
  font-family: "Noto Serif SC", serif;
  font-size: 19px;
  font-weight: 800;
}
.rules {
  padding: 16px 20px;
  overflow-y: auto;
}
.rule {
  display: grid;
  grid-template-columns: 24px 1fr 118px 58px 24px;
  gap: 7px;
  align-items: center;
  margin-bottom: 8px;
}
.rule > span {
  color: var(--color-text-subtle);
  font-size: 10px;
}
.rule select {
  min-width: 0;
  padding: 7px;
  border: 1px solid var(--color-card-border);
  border-radius: 7px;
  background: var(--color-page-bg);
  font-size: 11px;
}
.rule div {
  display: flex;
}
.rule button {
  padding: 4px;
  color: var(--color-text-muted);
}
.rule button:disabled {
  opacity: 0.25;
}
.remove {
  font-size: 18px !important;
}
.add {
  width: 100%;
  padding: 9px;
  border: 1px dashed var(--color-card-border);
  border-radius: 8px;
  color: var(--color-brand);
  font-size: 11px;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 13px 20px;
  border-top: 1px solid var(--color-panel-border);
}
footer button {
  padding: 8px 15px;
  border: 1px solid var(--color-card-border);
  border-radius: 8px;
  font-size: 11px;
}
.primary {
  background: var(--color-brand);
  color: var(--color-brand-ink);
  border-color: var(--color-brand) !important;
}
@media (max-width: 560px) {
  .rule {
    grid-template-columns: 20px 1fr 90px 24px;
  }
  .rule div {
    display: none;
  }
}
</style>
