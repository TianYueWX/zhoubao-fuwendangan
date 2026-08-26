/* ================================================================
 * src/components/view/index.ts
 * 让 App.vue 一行 import 完成
 * ================================================================ */

import ImportView from './ImportView.vue';
import OverviewView from './OverviewView.vue';
import HeroesView from './HeroesView.vue';
import CardsView from './CardsView.vue';
import ComboView from './ComboView.vue';
import LegendaryCompareView from './LegendaryCompareView.vue';
import RegionView from './RegionView.vue';
import DecksView from './DecksView.vue';

export const ViewComponents = {
  import: ImportView,
  overview: OverviewView,
  heroes: HeroesView,
  cards: CardsView,
  combo: ComboView,
  legendary: LegendaryCompareView,
  region: RegionView,
  decks: DecksView
} as const;

export {
  ImportView,
  OverviewView,
  HeroesView,
  CardsView,
  ComboView,
  LegendaryCompareView,
  RegionView,
  DecksView
};
