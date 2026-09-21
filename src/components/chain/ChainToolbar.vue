<script setup lang="ts">
/**
 * ChainToolbar.vue · 结算链推演顶栏
 *
 * 交互取向:工具界面不玩「藏起来让用户找」那一套 ——
 * 每个动作都有可见按钮,快捷键只作为加速手段写在 title 里。
 * (上游把「存快照/历史/全屏」做成纯图标,不熟的人根本发现不了。)
 */
import { ref } from 'vue';
import { DISPLAY_MODES, DISPLAY_MODE_LABELS, type CardDisplayMode } from '@/tools/chain/types';

defineProps<{
  playName: string;
  dirty: boolean;
  cardCount: number;
  canUndo: boolean;
  canRedo: boolean;
  defaultMode: CardDisplayMode;
  isFullscreen: boolean;
  historyOpen: boolean;
  /** 盘位列表插槽占位:盘位下拉由宿主渲染在左侧 */
}>();

const emit = defineEmits<{
  (e: 'save'): void;
  (e: 'toggle-history'): void;
  (e: 'rename', name: string): void;
  (e: 'snapshot'): void;
  (e: 'undo'): void;
  (e: 'redo'): void;
  (e: 'export-json'): void;
  (e: 'import-json'): void;
  (e: 'share'): void;
  (e: 'toggle-presentation'): void;
  (e: 'toggle-fullscreen'): void;
  (e: 'set-default-mode', mode: CardDisplayMode): void;
  (e: 'clear-board'): void;
  (e: 'reset-view'): void;
}>();

const showHelp = ref(false);

function onRenameInput(e: Event): void {
  const target = e.target;
  if (target instanceof HTMLInputElement) emit('rename', target.value);
}
</script>

<template>
  <div class="chain-toolbar">
    <div class="tb-left">
      <slot name="playlist"></slot>

      <label class="rename-wrap" title="重命名当前盘位">
        <span class="sr-only">盘位名称</span>
        <input
          class="rename-field"
          :value="playName"
          maxlength="40"
          @input="onRenameInput"
        />
      </label>

      <span class="tb-stat">
        <b v-if="dirty" class="dirty">● 未保存</b>
        <b v-else class="clean">已保存</b>
        <span class="tabular-nums">{{ cardCount }} 张卡</span>
      </span>
    </div>

    <div class="tb-right">
      <!-- 存储类 -->
      <div class="tb-group">
        <button type="button" class="tb-btn primary" title="保存到本机(Ctrl+S 存的是快照,不是这个)" @click="emit('save')">
          保存
        </button>
        <button type="button" class="tb-btn" title="导出为 JSON 文件" @click="emit('export-json')">导出</button>
        <button type="button" class="tb-btn" title="从 JSON 文件导入为新盘位" @click="emit('import-json')">导入</button>
        <button type="button" class="tb-btn" title="生成可发给他人的链接" @click="emit('share')">分享</button>
      </div>

      <!-- 过程类 -->
      <div class="tb-group">
        <button type="button" class="tb-btn" :disabled="!canUndo" title="撤销(Ctrl+Z)" @click="emit('undo')">↶</button>
        <button type="button" class="tb-btn" :disabled="!canRedo" title="重做(Ctrl+Y)" @click="emit('redo')">↷</button>
        <button type="button" class="tb-btn" title="存一个历史快照(Ctrl+S)" @click="emit('snapshot')">保存快照</button>
        <button type="button" class="tb-btn" :aria-expanded="historyOpen" @click="emit('toggle-history')">快照历史</button>
      </div>

      <!-- 展示类 -->
      <div class="tb-group">
        <span class="tb-mode" title="新区域的默认显示模式">
          <button
            v-for="m in DISPLAY_MODES"
            :key="m"
            type="button"
            :class="{ active: defaultMode === m }"
            @click="emit('set-default-mode', m)"
          >
            {{ DISPLAY_MODE_LABELS[m] }}
          </button>
        </span>
        <button type="button" class="tb-btn" title="演示模式(Ctrl+P)" @click="emit('toggle-presentation')">
          演示
        </button>
        <button type="button" class="tb-btn" title="全屏" @click="emit('toggle-fullscreen')">
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </button>
      </div>

      <!-- 危险类 -->
      <div class="tb-group">
        <button type="button" class="tb-btn danger" title="清空整盘(可撤销)" @click="emit('clear-board')">
          清盘
        </button>
        <button type="button" class="tb-btn" title="快捷键说明" @click="showHelp = !showHelp">?</button>
      </div>
    </div>

    <div v-if="showHelp" class="tb-help">
      <div>
        <b>快捷键</b>
        <span><kbd>Ctrl</kbd>+<kbd>S</kbd> 存快照</span>
        <span><kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销</span>
        <span><kbd>Ctrl</kbd>+<kbd>Y</kbd> 重做</span>
        <span><kbd>Ctrl</kbd>+<kbd>P</kbd> 演示模式</span>
        <span><kbd>Ctrl</kbd>+<kbd>E</kbd> 导出</span>
        <span><kbd>Ctrl</kbd>+<kbd>F</kbd> 全屏</span>
        <span><kbd>Esc</kbd> 退出全屏/浮层/演示</span>
      </div>
      <div>
        <b>看卡</b>
        <span>按住 Alt 并指向卡牌查看大图</span>
        <span>松开 Alt 或移开鼠标关闭</span>
        <span>按住 Ctrl 立即弹</span>
      </div>
      <button type="button" class="tb-help-close" @click="showHelp = false">收起</button>
    </div>
  </div>
</template>

<style scoped>
.chain-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 9px 12px;
  border: 1px solid var(--color-panel-border);
  border-radius: 10px;
  background: var(--color-panel-bg);
  position: relative;
}
.tb-left { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; min-width: 0; }
.tb-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.rename-field {
  width: 170px;
  padding: 3px 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
}
.rename-field:hover { border-color: var(--color-panel-border); }
.rename-field:focus {
  border-color: var(--color-brand-faint);
  background: var(--color-card-bg);
  outline: none;
}

.tb-stat { display: inline-flex; align-items: center; gap: 8px; font-size: 10.5px; color: var(--color-text-subtle); }
.tb-stat .dirty { color: var(--color-brand); }
.tb-stat .clean { color: var(--color-text-subtle); font-weight: 400; }

.tb-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-left: 10px;
  border-left: 1px solid var(--color-panel-border);
}
.tb-group:first-child { padding-left: 0; border-left: none; }

.tb-btn {
  font-size: 11.5px;
  padding: 3px 10px;
  border: 1px solid var(--color-panel-border);
  border-radius: 7px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
  white-space: nowrap;
}
.tb-btn:hover:not(:disabled) { border-color: var(--color-brand); color: var(--color-brand); }
.tb-btn:disabled { opacity: .42; cursor: not-allowed; }
.tb-btn.primary {
  border-color: var(--color-brand-faint);
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-weight: 600;
}
.tb-btn.danger:hover { border-color: var(--color-brand); background: var(--color-brand-soft); }

.tb-mode { display: inline-flex; border: 1px solid var(--color-panel-border); border-radius: 7px; overflow: hidden; }
.tb-mode button {
  font-size: 10.5px;
  padding: 3px 7px;
  color: var(--color-text-subtle);
  background: var(--color-card-bg);
  border-right: 1px solid var(--color-panel-border);
}
.tb-mode button:last-child { border-right: none; }
.tb-mode button.active { background: var(--color-brand); color: var(--color-brand-ink); font-weight: 600; }

.tb-help {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 9px 4px 2px;
  border-top: 1px solid var(--color-panel-border);
  font-size: 11px;
  color: var(--color-text-subtle);
}
.tb-help > div { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tb-help b { color: var(--color-text-muted); }
kbd {
  font-family: inherit;
  font-size: 10px;
  padding: 0 4px;
  border: 1px solid var(--color-panel-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--color-card-bg);
  color: var(--color-text-muted);
}
.tb-help-close {
  margin-left: auto;
  font-size: 10.5px;
  padding: 2px 8px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-subtle);
}
.tb-help-close:hover { border-color: var(--color-brand); color: var(--color-brand); }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
