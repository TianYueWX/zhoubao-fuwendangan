/* ================================================================
 * src/utils/chinaMap.ts
 * 把 window.chinaGeoJson 注册到 ECharts;返回是否已注册成功
 * 在 RegionTab.vue / 任何用到 map 的 Tab 都先调用一次
 * ============================================================== */

import * as echarts from 'echarts';

let registered = false;

export function ensureChinaMap(): boolean {
  if (registered) return true;
  const geo = (window as unknown as { chinaGeoJson?: object }).chinaGeoJson;
  if (!geo) return false;
  // registerMap 的第二个参数类型在 echarts 5.x 里把 GeoJSON 收纳进了内部 utils.
  // runtime 接受我们的纯 JSON literal(ECharts.registerMap 只读 type=FeatureCollection 的属性),
  // 这里用双重断言跳过深度递归类型校验,因为运行时不存在分歧。
  const rawDef = geo as Parameters<typeof echarts.registerMap>[1];
  echarts.registerMap('china', rawDef);
  registered = true;
  return true;
}

/** 主要城市坐标(供气泡图定位) */
export const CITY_COORDS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  北京: [116.4, 39.9],
  上海: [121.47, 31.23],
  广州: [113.26, 23.13],
  深圳: [114.06, 22.55],
  成都: [104.07, 30.57],
  杭州: [120.15, 30.28],
  重庆: [106.55, 29.56],
  西安: [108.94, 34.34],
  苏州: [120.58, 31.3],
  南京: [118.8, 32.06],
  武汉: [114.3, 30.6],
  天津: [117.2, 39.13],
  长沙: [112.94, 28.23],
  郑州: [113.63, 34.75],
  青岛: [120.38, 36.07],
  济南: [117.12, 36.65],
  沈阳: [123.43, 41.8],
  大连: [121.62, 38.91],
  哈尔滨: [126.53, 45.8],
  长春: [125.32, 43.9],
  福州: [119.3, 26.08],
  厦门: [118.09, 24.48],
  昆明: [102.83, 24.88],
  合肥: [117.28, 31.86],
  宁波: [121.55, 29.87],
  无锡: [120.31, 31.49],
  佛山: [113.12, 23.02],
  东莞: [113.75, 23.05],
  珠海: [113.58, 22.27],
  南宁: [108.37, 22.82],
  贵阳: [106.63, 26.65],
  太原: [112.55, 37.87],
  石家庄: [114.51, 38.04],
  南昌: [115.89, 28.68],
  兰州: [103.83, 36.06],
  海口: [110.35, 20.02],
  呼和浩特: [111.75, 40.84],
  乌鲁木齐: [87.62, 43.79],
  西宁: [101.78, 36.62],
  银川: [106.23, 38.49],
  温州: [120.7, 28.0],
  绍兴: [120.59, 30.0],
  常州: [119.97, 31.81],
  南通: [120.86, 32.01],
  烟台: [121.39, 37.52],
  泉州: [118.59, 24.91]
});
