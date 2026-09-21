<script setup lang="ts">
/**
 * ChainPlayList.vue · 盘位列表(多盘位的入口)
 *
 * 「显式保存」的关键一环:切换盘位前必须先经过未保存拦截,
 * 因此组件不自己调 switchPlay,而是 emit('switch', id) 交给宿主,
 * 由宿主统一走 confirmUnsaved() 流程。
 */
import { computed, ref } from 'vue';
import type { ChainPlay } from '@/tools/chain/types';
import { countCards } from '@/tools/chain/board';

const props = defineProps<{
  plays: readonly ChainPlay[];
  currentId: string;
  dirty: boolean;
}>();

const emit = defineEmits<{
  (e: 'switch', id: string): void;
  (e: 'create'): void;
  (e: 'rename', id: string, name: string): void;
  (e: 'duplicate'): void;
  (e: 'delete', id: string): void;
}>();

/**
 * 受未保存拦截保护的动作(新建 / 复制)不在这里关闭面板:
 * 宿主可能弹出确认框,面板若已收起,用户处理完对话框后会发现
 * 按钮"消失"了 —— 实测踩过:再点一次触发器反而把面板收起来,
 * 动作彻底落空。由用户自己收起面板即可。
 */

const open = ref(false);
const editingId = ref('');

const current = computed(() => props.plays.find((p) => p.id === props.currentId) ?? null);

function toggle(): void {
  open.value = !open.value;
}

function pick(id: string): void {
  open.value = false;
  if (id === props.currentId) return;
  emit('switch', id);
}

function startRename(play: ChainPlay): void {
  editingId.value = play.id;
}

function commitRename(play: ChainPlay, value: string): void {
  editingId.value = '';
  const trimmed = value.trim();
  if (trimmed && trimmed !== play.name) emit('rename', play.id, trimmed);
}

/** 从输入框事件取值提交(模板内不做类型断言,保持模板纯净) */
function commitRenameFromEvent(play: ChainPlay, e: Event): void {
  const target = e.target;
  if (target instanceof HTMLInputElement) commitRename(play, target.value);
}

function onDelete(id: string): void {
  open.value = false;
  emit('delete', id);
}

function cardCount(play: ChainPlay): number {
  return countCards(play.board);
}

function timeLabel(ts: number | null): string {
  if (!ts) return '未保存';
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<template>
  <div class="play-list">
    <button
      type="button"
      class="play-current"
      :title="open ? '收起盘位列表' : '展开盘位列表'"
      @click="toggle"
    >
      <span class="play-name">{{ current?.name ?? '未命名推演' }}</span>
      <span v-if="dirty" class="dirty-dot" title="有未保存的改动">未保存</span>
      <span class="play-caret" aria-hidden="true">{{ open ? '▴' : '▾' }}</span>
    </button>

    <div v-if="open" class="play-panel">
      <div class="panel-head">
        <span>推演盘位({{ plays.length }})</span>
        <div class="panel-actions">
          <button type="button" title="把当前棋盘另存为新盘位" @click="emit('duplicate')">复制当前</button>
          <button
            type="button"
            class="primary"
            data-action="create-play"
            title="新建一个空盘位"
            @click="emit('create')"
          >
            新建
          </button>
        </div>
      </div>

      <ul class="play-items">
        <li
          v-for="play in plays"
          :key="play.id"
          class="play-item"
          :class="{ active: play.id === currentId }"
        >
          <template v-if="editingId === play.id">
            <input
              class="rename-input"
              :value="play.name"
              autofocus
              @keydown.enter="commitRenameFromEvent(play, $event)"
              @keydown.esc="editingId = ''"
              @blur="commitRenameFromEvent(play, $event)"
            />
          </template>
          <template v-else>
            <button type="button" class="play-open" @click="pick(play.id)">
              <span class="play-open-name">{{ play.name }}</span>
              <span class="play-meta tabular-nums">
                {{ cardCount(play) }} 张 · {{ timeLabel(play.savedAt) }}
              </span>
            </button>
            <div class="play-row-actions">
              <button type="button" title="重命名" @click.stop="startRename(play)">改名</button>
              <button
                type="button"
                title="删除该盘位"
                :disabled="plays.length <= 1"
                @click.stop="onDelete(play.id)"
              >
                删除
              </button>
            </div>
          </template>
        </li>
      </ul>

      <p class="panel-foot">
        盘位存在本机浏览器,不跨设备。要给别人看请用「分享链接」或「导出 JSON」。
      </p>
    </div>
  </div>
</template>

<style scoped>
.play-list { position: relative; min-width: 0; }
.play-current {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 260px;
  padding: 4px 9px;
  border: 1px solid var(--color-panel-border);
  border-radius: 8px;
  background: var(--color-card-bg);
  color: var(--color-text-primary);
}
.play-current:hover { border-color: var(--color-brand-faint); }
.play-name {
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dirty-dot {
  flex: 0 0 auto;
  font-size: 9.5px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--color-brand);
  color: var(--color-brand-ink);
}
.play-caret { font-size: 11px; color: var(--color-text-subtle); }

.play-panel {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  width: min(360px, 86vw);
  padding: 10px;
  border: 1px solid var(--color-panel-border);
  border-radius: 10px;
  background: var(--color-card-bg);
  box-shadow: 0 16px 34px -20px var(--color-shadow);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-subtle);
  padding-bottom: 7px;
  border-bottom: 1px solid var(--color-panel-border);
}
.panel-actions { display: flex; gap: 5px; }
.panel-actions button {
  font-size: 10.5px;
  padding: 2px 7px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-muted);
}
.panel-actions button:hover { border-color: var(--color-brand); color: var(--color-brand); }
.panel-actions button.primary {
  border-color: var(--color-brand-faint);
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.play-items {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 46vh;
  overflow-y: auto;
}
.play-item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 7px;
  padding: 2px;
}
.play-item.active { background: var(--color-brand-soft); }
.play-item:hover { background: var(--color-dropzone-hover-bg); }
.play-open {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 5px 7px;
  text-align: left;
}
.play-open-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.play-item.active .play-open-name { color: var(--color-brand); }
.play-meta { font-size: 9.5px; color: var(--color-text-subtle); }
.play-row-actions {
  display: flex;
  gap: 3px;
  opacity: 0;
  transition: opacity 140ms;
}
.play-item:hover .play-row-actions { opacity: 1; }
.play-row-actions button {
  font-size: 9.5px;
  padding: 1px 5px;
  border: 1px solid var(--color-panel-border);
  border-radius: 5px;
  color: var(--color-text-subtle);
}
.play-row-actions button:hover { border-color: var(--color-brand); color: var(--color-brand); }
.play-row-actions button:disabled { opacity: .4; cursor: not-allowed; }
.rename-input {
  flex: 1 1 auto;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid var(--color-brand);
  border-radius: 6px;
  background: var(--color-card-bg);
  color: var(--color-text-primary);
}
.panel-foot {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid var(--color-panel-border);
  font-size: 9.5px;
  line-height: 1.5;
  color: var(--color-text-subtle);
}
</style>
