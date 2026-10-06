<script setup lang="ts">
/**
 * ChainHistoryPanel.vue · 快照历史
 *
 * 语义与上游一致:列表里每一条都是「某个动作执行完之后」的完整棋盘,
 * 点一条即回到那一刻。游标(historyIndex)决定了撤销/重做能走到哪。
 *
 * 与「保存到本机」的区别要在界面上说清楚:
 *   快照 = 过程记录,只在本会话内有效,关页即散
 *   保存 = 把当前棋盘写进盘位,落 localStorage
 */
import { updateSnapshot } from '@/tools/chain/store';
import { Redo2, Undo2, X } from '@lucide/vue';
import type { ChainSnapshot } from '@/tools/chain/types';

defineProps<{
  history: readonly ChainSnapshot[];
  historyIndex: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'jump', index: number): void;
  (e: 'undo'): void;
  (e: 'redo'): void;
  (e: 'snapshot'): void;
  (e: 'clear'): void;
  (e: 'export-json'): void;
  (e: 'import-json'): void;
}>();

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
</script>

<template>
  <div class="history-panel" role="region" aria-label="快照历史" >
    <header class="hp-head">
      <h3>快照历史</h3>
      <span class="hp-count tabular-nums">{{ history.length }} 条</span>
      <button type="button" class="hp-close" aria-label="关闭快照历史" @click="emit('close')"><X :size="16" aria-hidden="true" /></button>
    </header>

    <div class="hp-actions">
      <button type="button" title="撤销(Ctrl+Z)" @click="emit('undo')"><Undo2 :size="14" aria-hidden="true" /> 撤销</button>
      <button type="button" title="重做(Ctrl+Y)" @click="emit('redo')"><Redo2 :size="14" aria-hidden="true" /> 重做</button>
      <button type="button" title="存一个快照(Ctrl+S)" @click="emit('snapshot')">保存快照</button>
      <button type="button" :disabled="history.length === 0" title="清空过程记录" @click="emit('clear')">
        清空
      </button>
    </div>

    <p v-if="history.length === 0" class="hp-empty">
      还没有快照。按 Ctrl+S 或点击“保存快照”记录当前棋盘。
    </p>

    <ol v-else class="hp-list">
      <li
        v-for="(snap, index) in history"
        :key="snap.id"
        class="hp-item"
        :class="{ current: index === historyIndex }"
      >
        <button type="button" :title="`回到「${snap.action}」`" @click="emit('jump', index)">
          <span class="hp-dot" :class="`p${snap.actor}`" aria-hidden="true"></span>
          <span class="hp-action">{{ snap.action }}</span>
          <span class="hp-time tabular-nums">{{ timeLabel(snap.ts) }}</span>
        </button>
        <div class="hp-edit"><label>说明<input :value="snap.action" maxlength="200" @change="updateSnapshot(snap.id, ($event.target as HTMLInputElement).value, snap.duration ?? 2)" /></label><label>停留秒数<input type="number" min=".5" max="30" step=".5" :value="snap.duration ?? 2" @change="updateSnapshot(snap.id, snap.action, Number(($event.target as HTMLInputElement).value))" /></label></div>
      </li>
    </ol>

    <footer class="hp-foot">
      <button type="button" @click="emit('export-json')">导出 JSON</button>
      <button type="button" @click="emit('import-json')">导入 JSON</button>
    </footer>
    <p class="hp-note">快照用于演示和动画导出。修改说明后，请点顶部“保存”保留到本机。</p>
  </div>
</template>

<style scoped>
.history-panel {
  position: relative;
  z-index: 60;
  width: 100%;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  box-shadow: 0 12px 36px -12px var(--color-shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 12px 12px;
  border: 1px solid var(--color-panel-border);
  border-radius: 10px;
  background: var(--color-panel-bg);
}
.hp-head {
  cursor: default;
  touch-action: none;
  user-select: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.hp-head h3 { font-size: 0.9375rem; font-weight: 700; color: var(--color-text-primary); }
.hp-close { display: grid; flex: 0 0 28px; place-items: center; width: 28px; height: 28px; cursor: pointer; padding: 0; color: var(--color-text-muted); }
.hp-count { margin-left: auto; font-size: 0.875rem; color: var(--color-text-subtle); }

.hp-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.hp-actions button {
  font-size: 0.875rem;
  padding: 2px 7px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
}
.hp-actions button:hover:not(:disabled) { border-color: var(--color-brand); color: var(--color-brand); }
.hp-actions button:disabled { opacity: .45; cursor: not-allowed; }

.hp-empty { font-size: 0.875rem; line-height: 1.6; color: var(--color-text-subtle); padding: 6px 0; }

.hp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 34vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hp-item button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  text-align: left;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}
.hp-item button:hover { background: var(--color-dropzone-hover-bg); }
.hp-item.current button {
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-weight: 600;
}
/* 撤销之后位于「未来」的条目:虚线显示,提示可重做 */
.hp-item.future button { opacity: .5; border-left: 2px dashed var(--color-panel-border); }
.hp-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-brand);
}
.hp-dot.p2 { background: var(--color-map-ramp-3); }
.hp-action { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hp-time { flex: 0 0 auto; font-size: 0.75rem; color: var(--color-text-subtle); }

.hp-foot {
  display: flex;
  gap: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--color-panel-border);
}
.hp-foot button {
  flex: 1 1 0;
  font-size: 0.875rem;
  padding: 3px 6px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
}
.hp-foot button:hover { border-color: var(--color-brand); color: var(--color-brand); }
.hp-note { font-size: 0.75rem; line-height: 1.5; color: var(--color-text-subtle); }
.hp-edit{display:flex;gap:.5rem;padding:.25rem .375rem .75rem}.hp-edit label{font-size:.75rem;flex:1;min-width:0}.hp-edit label:last-child{flex:0 0 6rem}.hp-edit input{display:block;width:100%;padding:.375rem;border:1px solid var(--color-panel-border);border-radius:.375rem;background:var(--color-card-bg);font-size:.875rem}.hp-list{max-height:24rem}
</style>
