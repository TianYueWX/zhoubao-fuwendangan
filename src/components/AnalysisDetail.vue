<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import { heroDetails, cardDetails, regionDetails, regionHeroDetails, comparisonWeeks, heroTrends, buildDetails } from '@/core/extendedAnalysis';
import type { Deck, TableColumn } from '@/types';
import DataTable from './DataTable.vue';
import SectionHeading from './SectionHeading.vue';
import ChartCard from './ChartCard.vue';
import { CITY_COORDS } from '@/utils/chinaMap';
const props = defineProps<{ kind: 'environment' | 'cards' | 'builds' | 'region'; decks?: readonly Deck[]; title?: string }>();
const limit = ref(20), search = ref(''), hero = ref(''), currentWeek = ref(''), referenceWeek = ref('');
const currentPackage = computed(() => store.packages.find((p) => p.id === store.activePackageId));
const scoped = computed(() => props.decks ?? applyGlobalFilters(store.result?.allDecks ?? []));
const selected = computed(() => hero.value ? scoped.value.filter((d) => d.hero === hero.value) : scoped.value);
const all = computed(() => store.result?.allDecks ?? []);
const comparisons = computed(() => comparisonWeeks(all.value, currentWeek.value || store.filterWeek));
const nowWeek = computed(() => currentWeek.value || comparisons.value.current);
const beforeWeek = computed(() => referenceWeek.value || comparisons.value.previous);
const cardSamples = computed(() => all.value.filter((d) => d.week.label === nowWeek.value && (!hero.value || d.hero === hero.value)));
const heroOptions = computed(() => [...new Set((props.kind === 'cards' ? all.value.filter((d) => d.week.label === nowWeek.value) : scoped.value).map((d) => d.hero))].sort());
watch(() => store.activePackageId, () => { hero.value = ''; currentWeek.value = ''; referenceWeek.value = ''; });
watch(() => store.filterWeek, () => { currentWeek.value = ''; referenceWeek.value = ''; });
watch(heroOptions, (options) => { if (hero.value && !options.includes(hero.value)) hero.value = ''; });
const environments = computed(() => heroDetails(selected.value));
const headShare = computed(() => environments.value.slice(0, 3).reduce((n, r) => n + r.share, 0));
const trends = computed(() => heroTrends(all.value, nowWeek.value, beforeWeek.value));
const cardRows = computed(() => {
  if (!store.result) return [];
  const before = beforeWeek.value ? all.value.filter((d) => d.week.label === beforeWeek.value && (!hero.value || d.hero === hero.value)) : undefined;
  const decks = props.kind === 'cards' ? cardSamples.value : selected.value;
  return cardDetails(decks, store.result.catalog, before);
});
const cityRows = computed(() => regionDetails(selected.value).map((r) => ({ ...r, mapStatus: CITY_COORDS[r.city] ? '可定位' : '无地图坐标（仍计入）' })));
const cityHeroRows = computed(() => regionHeroDetails(selected.value));
const builds = computed(() => store.result ? buildDetails(selected.value, store.result.catalog) : null);
const take = <T extends Record<string, unknown>>(rows: T[]): T[] => {
  const query = search.value.trim().toLocaleLowerCase();
  const matching = query ? rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLocaleLowerCase().includes(query))) : rows;
  return limit.value ? matching.slice(0, limit.value) : matching;
};
const displayPercent = (key: string, suffix = '%') => (row: Record<string, unknown>): string => row[key] == null ? '—' : `${Number(row[key]).toFixed(1)}${suffix}`;
const column = (key: string, label: string, percent = false): TableColumn => ({ key, label, sortable: true, type: percent ? 'number' : ['name','city','leader','mapStatus','trend','role','category','example'].includes(key) ? 'text' : 'number', ...(percent ? { render: displayPercent(key) } : {}) });
const environmentColumns = [column('name','英雄'),column('total','样本'),column('share','出场占比',true),column('ranked','有名次'),column('top8','前八套数'),column('top8Rate','前八率',true),column('top4','前四套数'),column('top4Rate','前四率',true),column('champions','冠军'),column('winSamples','胜场样本'),column('winRate','平均瑞士轮胜率',true)];
const trendColumns = [column('name','英雄'),column('count','本周套数'),column('previousCount','对照周套数'),column('share','本周占比',true),column('previousShare','对照占比',true),{...column('change','变化（百分点）'),render:displayPercent('change','')},column('trend','变化类型')];
const cardColumns = [column('name','单卡'),column('category','类型'),column('energy','费用'),column('count','使用套数'),column('rate','携带率',true),{...column('avgCopies','使用者平均张数'),render:displayPercent('avgCopies','')},column('highRate','前八携带率',true),{...column('advantage','前八与全部差（百分点）'),render:displayPercent('advantage','')},column('previousRate','对照周携带率',true),{...column('change','周际变化（百分点）'),render:displayPercent('change','')},column('role','使用频率'),column('trend','变化类型')];
const regionColumns = [column('city','城市'),column('total','样本'),column('events','赛事数'),column('heroes','英雄种数'),column('leader','最多英雄'),column('leaderShare','该英雄占比',true),column('ranked','有名次'),column('top8','前八'),column('top8Rate','前八率',true),column('top4','前四'),column('top4Rate','前四率',true),column('champions','冠军'),column('mapStatus','地图状态')];
const curveColumns = [column('name','费用'),column('copies','总张数'),{...column('average','每套平均张数'),render:displayPercent('average','')},column('share','张数占比',true)];
const variantColumns = [column('name','牌表分组'),column('count','使用套数'),column('share','占比',true),column('top8','前八套数'),column('example','代表玩家')];
const curveOption = computed(() => ({ grid:{left:50,right:20,top:24,bottom:40},tooltip:{trigger:'axis'},xAxis:{type:'category',data:builds.value?.curve.map((r)=>r.name)},yAxis:{type:'value',name:'每套平均张数'},series:[{type:'bar',data:builds.value?.curve.map((r)=>+r.average.toFixed(2)),itemStyle:{color:'#bd4e27'}}] }));
</script>
<template>
  <section v-if="store.result" class="analysis-detail">
    <SectionHeading :title="title ?? ({environment:'环境与周际变化',cards:'单卡深度分析',builds:'构筑整体分析',region:'全部城市明细'}[kind])" small />
    <div class="analysis-controls">
      <label>展示数量 <select v-model.number="limit"><option :value="10">前10项</option><option :value="20">前20项</option><option :value="50">前50项</option><option :value="0">全部</option></select></label>
      <label class="analysis-search">搜索明细 <input v-model="search" type="search" placeholder="搜索所有城市 / 英雄 / 卡名" /></label>
      <label v-if="kind === 'cards' || kind === 'builds'">英雄 <select v-model="hero"><option value="">全部英雄</option><option v-for="name in heroOptions" :key="name">{{ name }}</option></select></label>
      <span>{{ currentPackage?.label ?? '当前数据包' }} · {{ kind === 'cards' ? nowWeek : store.filterWeek || '全部周次' }} · {{ kind === 'cards' ? cardSamples.length : selected.length }} 套样本</span>
    </div>
    <p class="analysis-note">搜索会查找完整明细，展示数量只控制行数，不影响统计；点击表头可排序。前八/前四率仅以有名次的样本计算，缺少胜场数据时显示“—”。小样本用于观察，不代表稳定结论。</p>
    <template v-if="kind === 'environment'">
      <p class="analysis-summary">共有 {{ environments.length }} 种英雄，出场最多的三种占 {{ headShare.toFixed(1) }}%。</p>
      <DataTable :searchable="false" :rows="take(environments)" :columns="environmentColumns" search-placeholder="搜索所有已展示英雄" />
      <h3>英雄周际变化</h3>
      <div class="analysis-controls"><label>本周 <select v-model="currentWeek"><option value="">{{ comparisons.current }}（跟随范围）</option><option v-for="week in comparisons.weeks" :key="week.label">{{ week.label }}</option></select></label><label>对照周 <select v-model="referenceWeek"><option value="">{{ comparisons.previous || '无上一周' }}（自动）</option><option v-for="week in comparisons.weeks" :key="week.label">{{ week.label }}</option></select></label></div>
      <p class="analysis-note">{{ nowWeek }} 与 {{ beforeWeek || '无对照周' }} 比较，使用这两周的完整样本。</p>
      <DataTable :searchable="false" :rows="take(trends)" :columns="trendColumns" />
    </template>
    <template v-else-if="kind === 'cards'">
      <div class="analysis-controls"><label>分析周 <select v-model="currentWeek"><option value="">{{ comparisons.current }}（跟随范围；汇总时取最新周）</option><option v-for="week in comparisons.weeks" :key="week.label">{{ week.label }}</option></select></label><label>对照周 <select v-model="referenceWeek"><option value="">{{ comparisons.previous || '无上一周' }}（自动）</option><option v-for="week in comparisons.weeks" :key="week.label">{{ week.label }}</option></select></label></div>
      <p class="analysis-note">{{ nowWeek }} 对比 {{ beforeWeek || '无对照周' }}。携带率以有牌表的卡组为分母；同名印刷合并。前八携带率表示前八卡组使用该卡的比例。核心/可替换是使用频率分类，选择单个英雄后更有参考意义。</p>
      <DataTable :searchable="false" :rows="take(cardRows)" :columns="cardColumns" />
    </template>
    <template v-else-if="kind === 'region'">
      <DataTable :searchable="false" :rows="take(cityRows)" :columns="regionColumns" search-placeholder="搜索城市或英雄" />
      <h3>城市 × 英雄详细对照</h3><p class="analysis-note">所有有样本的组合都可查看；出场占比以该城市的样本为分母。</p>
      <DataTable :searchable="false" :rows="take(cityHeroRows)" :columns="[column('city','城市'),...environmentColumns.slice(0,9)]" search-placeholder="搜索城市或英雄组合" />
    </template>
    <template v-else-if="builds && builds.samples">
      <p class="analysis-note">{{ builds.samples }} 套有牌表的卡组；费用曲线统计单位、英雄单位、法术和装备，包括牌表中的备牌。相同牌表按这些卡的名字和张数合并；传奇、符文、战场另由原构筑对比查看。{{ builds.unknown ? `${builds.unknown} 张未知卡未计入曲线。` : '' }}</p>
      <ChartCard :option="curveOption" height="260px" />
      <DataTable :rows="builds.curve" :columns="curveColumns" :searchable="false" />
      <h3>类型比例</h3><DataTable :rows="builds.types" :columns="curveColumns.map((c,i)=>i === 0 ? {...c,label:'类型'} : c)" :searchable="false" />
      <h3>常见相同牌表</h3><DataTable :searchable="false" :rows="take(builds.variants)" :columns="variantColumns" />
      <p class="analysis-note">与最常见牌表的平均相似度：{{ builds.similarity == null ? '—' : `${builds.similarity.toFixed(1)}%` }}。按相同卡牌的张数重合计算；100% 表示这些卡和张数相同。</p>
      <h3>核心与可替换卡</h3><DataTable :searchable="false" :rows="take(cardRows.filter((r)=>!['传奇','符文','战场'].includes(r.category)))" :columns="cardColumns.slice(0,8).concat([column('role','使用频率')])" />
      <h3>常一起使用的两张卡</h3><p class="analysis-note">两张卡各自在至少20%的有牌表样本中出现；同带率表示同时携带的卡组占比。关联倍数超过1表示比独立搭配更常一起出现，不直接证明卡牌配合效果。</p>
      <DataTable :searchable="false" :rows="take(builds.pairs)" :columns="[column('name','组合'),column('count','同带套数'),column('share','同带率',true),{...column('lift','关联倍数'),render:displayPercent('lift','×')}]" />
    </template>
  </section>
</template>
<style scoped>
.analysis-detail{margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--color-panel-border);min-width:0}.analysis-controls{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin:.75rem 0;font-size:.875rem}.analysis-controls label{display:flex;align-items:center;gap:.5rem}.analysis-controls select,.analysis-controls input{max-width:100%;border:1px solid var(--color-panel-border);border-radius:.375rem;padding:.375rem;background:var(--color-card-bg)}.analysis-controls>span{color:var(--color-text-muted);overflow-wrap:anywhere}.analysis-note{font-size:.875rem;color:var(--color-text-muted);line-height:1.8;margin:.75rem 0}.analysis-summary{font-size:1rem;margin:1rem 0}.analysis-detail h3{font-size:1.125rem;font-weight:700;margin:1.5rem 0 .75rem}
.analysis-search{flex:1;min-width:min(100%,18rem)}.analysis-search input{flex:1;min-width:0}
</style>
