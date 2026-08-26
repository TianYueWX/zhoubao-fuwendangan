/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

/**
 * window.chinaGeoJson 由 public/china-geo.js(script 标签)同步注入,
 * 必须在 ECharts.registerMap('china', ...) 之前存在。
 */
declare global {
  interface Window {
    chinaGeoJson?: Record<string, unknown>;
  }
}

export {};
