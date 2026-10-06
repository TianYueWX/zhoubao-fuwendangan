<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import type { ChainArrow } from '@/tools/chain/types';
import { arrowGeometry, type CardRect } from '@/tools/chain/arrowGeometry';
const props = defineProps<{ arrows: readonly ChainArrow[]; readOnly?: boolean; selected?: string }>();
const emit = defineEmits<{ select: [id: string] }>();
const host = ref<SVGSVGElement | null>(null);
const marker = `arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
const paths = ref<Array<ChainArrow & ReturnType<typeof arrowGeometry>>>([]);
const size = ref({ width: 1, height: 1 });
let observer: ResizeObserver | undefined, mutations: MutationObserver | undefined, raf = 0;
function measure(): void {
  raf = 0;
  const parent = host.value?.parentElement;
  if (!parent) return;
  const r = parent.getBoundingClientRect();
  size.value = { width: parent.scrollWidth, height: parent.scrollHeight };
  const sx = parent.offsetWidth / (r.width || 1), sy = parent.offsetHeight / (r.height || 1);
  const cards = new Map<string, CardRect>();
  parent.querySelectorAll<HTMLElement>('.chain-card[data-uid]').forEach((el) => {
    const b = el.getBoundingClientRect();
    cards.set(el.dataset.uid!, { x: (b.left - r.left) * sx + parent.scrollLeft, y: (b.top - r.top) * sy + parent.scrollTop, width: b.width * sx, height: b.height * sy });
  });
  paths.value = props.arrows.flatMap((a) => {
    const from = cards.get(a.from), to = cards.get(a.to);
    return from && to ? [{ ...a, ...arrowGeometry(from, to) }] : [];
  });
}
function schedule(): void { if (!raf) raf = requestAnimationFrame(measure); }
watch(() => props.arrows, schedule, { deep: true });
onMounted(() => {
  const parent = host.value!.parentElement!;
  observer = new ResizeObserver(schedule); observer.observe(parent);
  mutations = new MutationObserver((items) => { if (items.some((m) => !(m.target instanceof Element && m.target.closest('[data-chain-arrows]')))) schedule(); });
  mutations.observe(parent, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  window.addEventListener('resize', schedule); schedule();
});
onBeforeUnmount(() => { observer?.disconnect(); mutations?.disconnect(); cancelAnimationFrame(raf); window.removeEventListener('resize', schedule); });
</script>
<template>
  <svg ref="host" data-chain-arrows class="arrow-layer" :width="size.width" :height="size.height" aria-label="卡牌连线">
    <defs><marker :id="marker" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
    <g v-for="a in paths" :key="a.id" :class="{ selected: selected === a.id }">
      <path :d="`M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`" class="arrow-line" :marker-end="`url(#${marker})`" />
      <path v-if="!readOnly" :d="`M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`" class="arrow-hit" role="button" tabindex="0" :aria-label="`编辑连线${a.label ? '：' + a.label : ''}`" @click.stop="emit('select', a.id)" @keydown.enter.prevent="emit('select', a.id)" @keydown.space.prevent="emit('select', a.id)" />
      <text v-if="a.label" :x="a.labelX" :y="a.labelY" text-anchor="middle">{{ a.label }}</text>
    </g>
  </svg>
</template>
<style scoped>
.arrow-layer{position:absolute;inset:0;z-index:8;pointer-events:none;overflow:visible;color:var(--color-brand)}.arrow-line{fill:none;stroke:currentColor;stroke-width:2.5;filter:drop-shadow(0 1px 1px #fff)}.arrow-hit{stroke:transparent;stroke-width:18;fill:none;pointer-events:stroke;cursor:pointer}.selected .arrow-line{stroke-width:4}.arrow-layer text{font:600 .875rem sans-serif;paint-order:stroke;stroke:var(--color-page-bg);stroke-width:5;stroke-linejoin:round;fill:currentColor}.arrow-hit:focus-visible{stroke:var(--color-brand-soft);outline:none}
</style>
