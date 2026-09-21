/* ================================================================
 * src/main.ts · Vue 应用入口
 * ============================================================== */

import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { store } from './store/analysis';
import { chainStore } from './tools/chain/store';

const app = createApp(App);
app.mount('#app');

// 调试出口:无头验收脚本(scripts/capture-style.mjs)读取运行期状态用
(window as unknown as { __runeStore?: typeof store }).__runeStore = store;
// 结算链推演的盘位状态(同样供无头验收脚本读取;是只读视图,改不动真状态)
(window as unknown as { __chainStore?: typeof chainStore }).__chainStore = chainStore;
