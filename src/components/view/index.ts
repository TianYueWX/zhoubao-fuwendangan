/* ================================================================
 * src/components/view/index.ts
 * 让 App.vue 一行 import 完成
 * 英雄与传奇已融合为 HeroLegendView(构筑视角):
 *   'heroes' 保留为兼容值(总览页下钻),导航栏仅展示「传奇构筑」;
 *   Combo 已并入传奇构筑页,无独立栏目。
 * ================================================================ */

import ImportView from './ImportView.vue';
import OverviewView from './OverviewView.vue';
import HeroLegendView from './HeroLegendView.vue';
import CardsView from './CardsView.vue';
import RegionView from './RegionView.vue';
import DecksView from './DecksView.vue';

export const ViewComponents = {
  import: ImportView,
  overview: OverviewView,
  heroes: HeroLegendView,
  cards: CardsView,
  legendary: HeroLegendView,
  region: RegionView,
  decks: DecksView
} as const;

export {
  ImportView,
  OverviewView,
  HeroLegendView,
  CardsView,
  RegionView,
  DecksView
};
