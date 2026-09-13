/* ================================================================
 * src/main.ts · Vue 应用入口
 * ============================================================== */

import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { store } from './store/analysis';

const app = createApp(App);
app.mount('#app');

// 调试出口:无头验收脚本(scripts/capture-style.mjs)读取运行期状态用
(window as unknown as { __runeStore?: typeof store }).__runeStore = store;
