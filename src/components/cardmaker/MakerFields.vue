<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CardIcon } from '@/components/carddex/types';
import { DOMAINS, RARITIES, TYPES, type Domain, type MakerDocument } from '@/tools/cardmaker/model';
import { KEYWORDS, translateTags } from '@/tools/cardmaker/translations';
const props = defineProps<{ document: MakerDocument; tab: string; icons: CardIcon[] }>();
const copy = computed(() => props.document.copy[props.document.language]);
const effect = ref<HTMLTextAreaElement>(),
  translationNote = ref('');
function translate(): void {
  const result = translateTags(props.document.copy.zh.tags);
  props.document.copy.en.tags = result.text;
  translationNote.value = result.unknown.length
    ? `请手动核对：${result.unknown.join('、')}`
    : '已填入英文标签，可继续修改。';
}
function insert(before: string, after = ''): void {
  const input = effect.value,
    start = input?.selectionStart ?? copy.value.effect.length,
    end = input?.selectionEnd ?? start;
  copy.value.effect =
    copy.value.effect.slice(0, start) +
    before +
    copy.value.effect.slice(start, end) +
    after +
    copy.value.effect.slice(end);
  requestAnimationFrame(() => {
    input?.focus();
    input?.setSelectionRange(start + before.length, end + before.length);
  });
}
function domain(value: string, index: number): void {
  if (index === 1 && !value) props.document.domains = [props.document.domains[0]!];
  else props.document.domains[index] = value as Domain;
}
</script>
<template>
  <div class="maker-fields">
    <template v-if="tab === 'text'">
      <div class="mf-heading">
        <h2>卡面文字</h2>
        <div class="mf-language" aria-label="编辑语言">
          <button
            type="button"
            :class="{ active: document.language === 'zh' }"
            @click="document.language = 'zh'"
          >
            中文</button
          ><button
            type="button"
            :class="{ active: document.language === 'en' }"
            @click="document.language = 'en'"
          >
            English
          </button>
        </div>
      </div>
      <p class="mf-hint">
        两种语言分别保存，预览与导出使用当前语言。{{
          document.language === 'en' ? '未知标签保留原文，请手动填写英文。' : ''
        }}
      </p>
      <label
        >卡牌名称<input v-model="copy.name" maxlength="200" placeholder="为这张卡起个名字"
      /></label>
      <label
        >副标题<input v-model="copy.subtitle" maxlength="200" placeholder="英雄称号等，可留空"
      /></label>
      <label>标签<input v-model="copy.tags" maxlength="500" placeholder="英雄 · 艾欧尼亚" /></label>
      <button
        v-if="document.language === 'en'"
        type="button"
        class="mf-text-button"
        @click="translate"
      >
        从中文填入已知标签
      </button>
      <p v-if="translationNote && document.language === 'en'" class="mf-hint">
        {{ translationNote }}
      </p>
      <label>卡牌效果</label>
      <div class="mf-format" aria-label="文字格式">
        <button type="button" aria-label="加粗选中文字" @click="insert('**', '**')"><b>B</b></button
        ><button type="button" aria-label="斜体选中文字" @click="insert('_', '_')"><i>I</i></button
        ><select
          aria-label="插入关键词"
          @change="
            (e) => {
              const s = e.target as HTMLSelectElement;
              if (s.value)
                insert(`{{${document.language === 'zh' ? s.value : KEYWORDS[s.value]}}}`);
              s.value = '';
            }
          "
        >
          <option value="">＋关键词</option>
          <option v-for="(en, zh) in KEYWORDS" :key="zh" :value="zh">
            {{ zh }} / {{ en }}
          </option></select
        ><select
          aria-label="插入图标"
          @change="
            (e) => {
              const s = e.target as HTMLSelectElement;
              if (s.value) insert(`{{${s.value}}}`);
              s.value = '';
            }
          "
        >
          <option value="">＋图标</option>
          <option v-for="(d, key) in DOMAINS" :key="key" :value="key">{{ d.label }}符能</option>
          <option v-for="i in icons.filter((i) => !i.isWhite)" :key="i.name" :value="i.name">
            {{ i.name }}
          </option>
        </select>
      </div>
      <textarea
        ref="effect"
        v-model="copy.effect"
        aria-label="卡牌效果"
        rows="7"
        maxlength="10000"
        placeholder="输入效果文字，支持换行。"
      />
      <p class="mf-hint">**加粗**　_斜体_　{{ '{' + '{关键词或图标}' + '}' }}</p>
      <label
        >背景故事<textarea v-model="copy.flavor" rows="2" maxlength="2000" placeholder="可留空" />
      </label>
      <div class="mf-grid">
        <label
          >字号<input
            v-model.number="document.fontSize"
            type="number"
            min="16"
            max="60"
            step="1" /></label
        ><label
          >行距<input
            v-model.number="document.lineHeight"
            type="number"
            min="1"
            max="2"
            step="0.05"
        /></label>
      </div>
      <label class="mf-check"
        ><input v-model="document.autoFit" type="checkbox" />自动缩小效果文字以适应卡框</label
      >
    </template>
    <template v-else-if="tab === 'stats'">
      <div class="mf-heading">
        <h2>模板与数值</h2>
        <span>ORIGINS</span>
      </div>
      <label
        >卡牌类型<select v-model="document.type">
          <option v-for="(label, type) in TYPES" :key="type" :value="type">
            {{ label }}{{ type === 'battlefield' ? '（横版）' : '' }}
          </option>
        </select></label
      >
      <label v-if="document.type === 'unit'"
        >单位分类<select v-model="document.subtype">
          <option value="">普通单位</option>
          <option value="champion">英雄单位</option>
          <option value="signature">专属单位</option>
        </select></label
      >
      <label
        >稀有度<select v-model="document.rarity">
          <option v-for="(label, key) in RARITIES" :key="key" :value="key">{{ label }}</option>
        </select></label
      >
      <div class="mf-grid">
        <label
          >主符能<select
            :value="document.domains[0]"
            @change="(e) => domain((e.target as HTMLSelectElement).value, 0)"
          >
            <option v-for="(d, key) in DOMAINS" :key="key" :value="key">
              {{ d.label }} · {{ d.en }}
            </option>
          </select></label
        ><label
          >第二符能<select
            :value="document.domains[1] ?? ''"
            @change="(e) => domain((e.target as HTMLSelectElement).value, 1)"
          >
            <option value="">无</option>
            <option v-for="(d, key) in DOMAINS" :key="key" :value="key">
              {{ d.label }} · {{ d.en }}
            </option>
          </select></label
        >
      </div>
      <div v-if="['unit', 'spell', 'gear'].includes(document.type)" class="mf-grid">
        <label
          >能量费用<input v-model.number="document.energy" type="number" min="0" max="999" /></label
        ><label
          >符能费用<input v-model.number="document.recycle" type="number" min="0" max="20"
        /></label>
      </div>
      <label v-if="document.type === 'unit'"
        >战力<input v-model.number="document.might" type="number" min="0" max="999"
      /></label>
      <label
        >系列与编号<input v-model="document.setInfo" maxlength="200" placeholder="自制 · 001"
      /></label>
      <label>画师<input v-model="document.artist" maxlength="200" placeholder="可留空" /></label>
      <label>底色<input v-model="document.background" type="color" /></label>
      <p class="mf-hint">切换卡框保留文字和图层，可在「图片」中重新适配配图区。</p>
    </template>
  </div>
</template>
<style scoped>
.maker-fields {
  display: grid;
  gap: 14px;
}
.mf-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mf-heading h2 {
  font-size: 17px;
  font-weight: 700;
}
.mf-heading > span {
  font: 11px monospace;
  letter-spacing: 0.12em;
  color: var(--color-text-muted);
}
.mf-language {
  display: flex;
  border: 1px solid var(--color-panel-border);
}
.mf-language button {
  padding: 8px 10px;
  min-height: 40px;
  font-size: 12px;
}
.mf-language .active {
  background: var(--color-text-primary);
  color: var(--color-page-bg);
}
label {
  display: grid;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
}
input,
textarea,
select {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
  padding: 10px;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 400;
  border-radius: 2px;
  min-height: 44px;
}
textarea {
  resize: vertical;
  line-height: 1.6;
}
input[type='color'] {
  padding: 5px;
}
.mf-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.mf-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-muted);
  line-height: 1.65;
}
.mf-format {
  display: flex;
  gap: 4px;
  margin-bottom: -9px;
}
.mf-format button {
  min-width: 36px;
  border: 1px solid var(--color-panel-border);
}
.mf-format select {
  padding: 5px;
  font-size: 12px;
}
.mf-check {
  display: flex;
  align-items: center;
  font-weight: 400;
}
.mf-check input {
  width: 18px;
  min-height: 18px;
  accent-color: var(--color-brand);
}
.mf-text-button {
  text-align: left;
  font-size: 12px;
  color: var(--color-brand);
  min-height: 32px;
}
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
@media (max-width: 700px) {
  input,
  textarea,
  select {
    font-size: 16px;
  }
}
</style>
