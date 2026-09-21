<script setup lang="ts">
/**
 * ChainCardText.vue · 卡牌效果文本渲染
 *
 * 把 {{横置}} {{S}} {{已强化>}} 这类标记渲染成高亮小片。
 * 直接显示原始标记在牌桌上很难读,拆成片段后既保留信息又可读。
 */
import { computed } from 'vue';
import { CARD_COLOR_HEX } from '@/utils/palette';
import { parseCardText, type CardTextSegment } from './cardText';

const props = withDefaults(
  defineProps<{
    text: string;
    /** 紧凑模式:小字号 + 单行截断(卡池列表用) */
    compact?: boolean;
    /** 最多显示行数;0 = 不限制 */
    clamp?: number;
  }>(),
  { compact: false, clamp: 0 }
);

const segments = computed<CardTextSegment[]>(() => parseCardText(props.text));

/** 片段 → 行内样式(颜色域片段按域着色) */
function styleOf(seg: CardTextSegment): Record<string, string> {
  if (seg.kind === 'domain' && seg.color) {
    return { color: CARD_COLOR_HEX[seg.color] };
  }
  return {};
}

/**
 * 多行截断样式。
 * 返回类型显式标注为 Record<string, string>:空对象分支若走推断会得到
 * 「可选属性全 undefined」的字面量类型,与索引签名冲突(TS2769)。
 * 写成 CSS 属性名(kebab-case)而不是 WebkitLineClamp,可读性也更好。
 */
const clampStyle = computed((): Record<string, string> => {
  if (props.clamp <= 0) return {};
  return {
    display: '-webkit-box',
    '-webkit-line-clamp': String(props.clamp),
    '-webkit-box-orient': 'vertical',
    overflow: 'hidden'
  };
});
</script>

<template>
  <p class="chain-card-text" :class="{ 'is-compact': compact }" :style="clampStyle">
    <template v-for="(seg, i) in segments" :key="i">
      <br v-if="seg.text === '\n'" />
      <span v-else-if="seg.kind === 'keyword'" class="ct-keyword">{{ seg.text }}</span>
      <span v-else-if="seg.kind === 'symbol'" class="ct-symbol">{{ seg.text }}</span>
      <span v-else-if="seg.kind === 'condition'" class="ct-condition">{{ seg.text }}</span>
      <span v-else-if="seg.kind === 'domain'" class="ct-domain" :style="styleOf(seg)">{{ seg.text }}</span>
      <span v-else>{{ seg.text }}</span>
    </template>
  </p>
</template>

<style scoped>
.chain-card-text {
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.chain-card-text.is-compact {
  font-size: 10.5px;
  line-height: 1.5;
}
/* 能力关键字:藤黄底柔光小片,与站点的徽章语言一致 */
.ct-keyword {
  display: inline-block;
  padding: 0 4px;
  margin: 0 1px;
  border-radius: 3px;
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-weight: 600;
  font-size: 0.94em;
}
/* 符文/费用符号:等宽 + 描边,像卡面上的符文圈 */
.ct-symbol {
  display: inline-block;
  min-width: 15px;
  padding: 0 3px;
  margin: 0 1px;
  border: 1px solid var(--color-panel-border);
  border-radius: 999px;
  background: var(--color-card-bg);
  color: var(--color-text-primary);
  font-size: 0.86em;
  font-weight: 700;
  text-align: center;
  line-height: 1.5;
}
/* 条件前缀:斜体 + 下划线,表示「满足条件时」 */
.ct-condition {
  font-style: italic;
  font-weight: 600;
  color: var(--color-accent);
  border-bottom: 1px dashed var(--color-accent);
}
.ct-domain {
  font-weight: 700;
}
</style>
