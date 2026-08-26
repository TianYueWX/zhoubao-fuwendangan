# 符文战场 · Meta 情报台 — v3 重新设计方案

> 状态:**已获用户认可(4 决策点全部确认)· 骨架实现进行中** | 基于:README + 城市赛第四赛季第三周_全量数据包 + v2.0.0 现有代码
> 关键决策(已获用户确认):双受众(玩家/创作者)兼顾 | 多包并存+周环比 | 允许重设计统计口径 | 不处理隐私脱敏 | 预设数据置于项目 data/ 目录 | Pages 为主(file:// 降级)| Combo 并入单卡 Tab | public/data/ + manifest.json | 总览内双叙事切换
> 追加需求(2026-08-26):**最佳传奇排行横向对比**(详见 §3.4,已实现)

## 0. 实现进度日志

| 轮次 | 交付 | 验证 |
|---|---|---|
| R1 | §3.4 传奇排行引擎 + LegendaryCompare 组件 + 总览集成;smoke 全链路修复 | 2732/2732 覆盖、域对口径 15/15 一致、构建通过、已提交 e2445ae |
| R2 | **P1 贝叶斯收缩**(stats.ts:shrinkWinRate/envPrior;quickStats 与 legendaryStats 默认启用);**P2 设计 tokens**(tailwind 域色/Tier/Δ + DeltaBadge + StatCard Δ 支持);**P0 预设管线**(prepare-preset.mjs + manifest.json + PresetLoader 一键加载 + preset.ts)+ **Worker 解析**(parse.worker + workerParse,FileDrop 大 JSON 走 Worker) | 收缩公式校验 ✓、影流之主小样本降位 ✓、预设脚本真实产出 4.6MB/5 文件 ✓、worker 独立 chunk ✓、构建通过 |
| R3 | **delta 周环比引擎**(delta.ts:buildDeltas/deltasFromRows/movers/HHI);**总览双叙事切换**(本周聚焦/趋势周报:周报模式 = 包内周次分组真实环比,含 KPI Δ、热度升降榜、胜率变化榜);**移动端**(<lg 隐藏侧边栏,头部横向导航条,主区窄边距) | 真实数据周环比 ✓(卡莎 -3.5pp、菲奥娜 +2.3pp、HHI 578→632);构建通过 |
| R4 | **周报引擎化**(core/report.ts:buildWeeklyReport 纯函数,含周际时间线/传奇 movers/域对 movers);**MetaTimeline 线图**(Top6 英雄周际出场率);**复制周报 Markdown**(utils/reportMarkdown.ts,创作者一键发布);总览周报模式补齐 | 周报 6/6 Markdown 断言 ✓(标题/上升榜/胜率榜/传奇/域对/免责);时间线叙事 ✓(易 10.1→12.9 走强、卡莎 10.6→7.5 退潮、域对 blue+red -2.9pp 自洽);构建通过 |
| R5 | **英雄拆解 v3 化**:指标卡周环比 Δ(胜率/Top8 率,StatCard 支持 deltaSuffix)、周际趋势线图(出场率/收缩胜率/Top8 率);**全视图设计规格审计**(单卡 Δpp 对照列 ✓、地域双模式 ✓、Combo Lift 滑块 ✓、卡组抽屉+TTS ✓、PNG 导出 = ChartCard toolbox saveAsImage ✓) | 构建通过;视图内容层全部符合 §3 规格 |
| R6 | **卡牌规范键归并(领域修正)**:所有卡级聚合按 同名+副标题 归并多稀有度卡号——`cardKey.ts` + CardCatalog 增加 `canonicalById/canonicalId`(代表编号优先有卡图);countCards / heroStats 核心卡 / combo / legendaryStats / 万金油 / 卡组抽屉全部归并;传奇对比显示"×N 版本" | 真实数据:传奇种类 93→48、虚空之女 OGN-247+OGN-299→n=269(出场率 #2)、域对一致性仍 15/15、覆盖 100%、构建通过 |
| R7 | **全站 UI 换肤为《符文档案·周报》**(视觉层,引擎零改动):详见 §6 | 构建通过;CDP 无头浏览器端到端验证 ✓(预设加载→总览→周报叙事→深色主题;六符文印 6/6 渲染) |
| R8 | **传奇卡组对比独立页**(§6.5):同一传奇的卡组横向对比——名次优先排序、向下取前 N 名(1/2/3/5/10)+ 表格勾选自由组合(≤10 套)、周次过滤、卡牌矩阵着色(共通/部分/独有);总览旧「最佳传奇·横向对比」面板移除(口径误导) | 真实数据:48 传奇 / 2732 卡组全覆盖、传奇键匹配 0 误差;CDP 验证:默认 2 列矩阵 ✓、前5 变 5 列 ✓、周过滤后保留 N ✓、矩阵 49 行卡牌着色 ✓、构建通过 |
| ⏳ 待依赖放开 | 多包 Pinia store + IndexedDB(见 §3.5 契约) | — |

> ⚠️ 环境限制:R2 尝试安装 pinia/dexie 被沙箱只读拦截(ERR_PNPM_EROFS)。store 暂用 v2 响应式单例(API 面按 Pinia 习惯组织),依赖放开后可平滑迁移。

---

## 1. 🎯 核心设计目标与理念

### 1.1 产品定位一句话
> 把 150MB 的赛事数据包，变成玩家 10 秒能做完的决策、创作者 30 秒能发出的周报。

### 1.2 三大设计理念

**理念一:从"功能清单"到"问题答案"**
v2 是 7 个平级视图的功能清单;v3 让每个视图回答一个具体问题:
- 总览 → "这周什么强?meta 怎么变的?"
- 英雄 → "我该练谁?他带什么卡?"
- 单卡 → "哪些卡闭眼带都赚?哪两张卡是绝配?"
- 地域 → "我所在城市流行什么?"
- 卡组 → "冠军抄哪套?怎么抄?"
信息组织遵循 **3 层漏斗:概览(是什么)→ 拆解(为什么)→ 行动(怎么办)**,支持逐步下钻,层级递进而非平行平铺。

**理念二:时间维度是第一公民**
多包并存后,每个数字都有"上周对比"。Δ 徽章、趋势线、排名升降箭头成为统一视觉语言,直接支撑"趋势周报"叙事。

**理念三:数据分层,引擎与展示解耦**
核心分析引擎为**纯 TS 函数库**(框架无关、可单测),UI 层只消费派生结果。v2 的 `src/core/*` 引擎可大幅复用,重设计聚焦数据层(多包/持久化/Worker)与展示层(IA/组件/视觉)。

### 1.3 双受众落地方式(不翻倍复杂度)
不做两套模式,而是在总览页提供 **「本周聚焦 | 趋势周报」双叙事切换**:
- **本周聚焦**(玩家):Tier 榜、万金油、热门构筑 — 决策路径短
- **趋势周报**(创作者):环比升降榜、周际时间线、Meta 集中度叙事 + 「复制周报 Markdown」「导出图表 PNG」按钮

### 1.4 基于数据事实的关键修正(README 不一定全对)

| # | 发现(实测) | 设计决策 |
|---|---|---|
| D1 | 每副卡组 = 1 张主英雄(isMainHero) + 恰好 1 张传奇卡 + ~30 张其他;英雄色域 ⊂ 传奇色域(100%) | **「传奇域对」定义为:英雄单色域 ∪ 传奇双色域 = 卡组双色身份**,6 色 → 15 种组合(实测 Top:绿×橙 344、蓝×红 299、绿×紫 281、紫×黄 263) |
| D2 | `decks_cache.json` 与 `decks_data.json` 的 deckList **完全重复**(42MB 冗余) | **砍掉 cache 槽位**,导入 6 槽 → 5 槽 |
| D3 | `rank_data.json` 无 hero/卡组,靠 `cardGroupId` join;轮次 = 每场 winCount 最大值 | join 失败或无 rank 的包 → 胜率/Tier 显示"未评级 NR"并说明原因 |
| D4 | `decks_data_highlight.json`(932 条,名次 1–82)README 未提及 | 默认忽略;预留为"高光局"数据源,不占导入槽位 |
| D5 | 卡组平均 32.3 张(14–52),CSV `hero` 字段="英雄名 传奇名" | 卡组抽屉按 `cardCategoryName` 类型分组展示;hero 解析用 deckList 而非 CSV 字段 |
| D6 | 971 张卡,10 张禁卡;6 域色(红绿橙紫蓝黄);15 地区;费用 0–12 | 配色系统以 6 域色为基底;禁卡角标为全局组件能力 |
| D7 | **同名多卡号是常态**:同一张卡因稀有度/印刷版本不同有多个卡号(cards_base 20 组同名多号;传奇 48 行中 44 行含多版本),如 虚空之女 = OGN-247 + OGN-299 | **所有卡级聚合按「同名+副标题(如有)」规范键归并**(`utils/cardKey.ts` + catalog 的 `canonicalById/canonicalId` 索引),传奇种类 93 → 48,虚空之女合并为 n=269 升至出场率 #2 |

---

## 2. 🗺️ 页面信息架构与布局规划

### 2.1 全局布局(桌面)

```
┌──────────────────────────────────────────────────────────┐
│ Header: Logo+赛季周 · 数据包选择器(多包chip) · 周对比开关 · 导出 · 主题 │  ← 56px sticky
├────────┬─────────────────────────────────────────────────┤
│ Sidebar│ GlobalFilterBar: 包 | 英雄 | 城市 | 日期 | 样本数 │  ← 48px sticky
│ 总览    ├─────────────────────────────────────────────────┤
│ 英雄    │                                                 │
│ 单卡    │                 Main 内容区                      │
│ 地域    │      (卡片栅格 + 图表 + 表格 + 抽屉)              │
│ 卡组    │                                                 │
│ 数据    ├─────────────────────────────────────────────────┤
│ 220px  │ Footer: 数据声明 · Riot 免责 · 版本信息            │
└────────┴─────────────────────────────────────────────────┘
```

- **Header**:Logo + 赛季周标识(自动取活动包最新周);中:数据包多选 chips(核心!);右:主题切换、导出菜单
- **GlobalFilterBar**:全局过滤(作用于所有视图,联动 v2 语义)+ 实时样本数 badge(aria-live)
- **Sidebar**(桌面 220px 可折叠;移动端收为底部 TabBar 5 项 + "数据"入口进设置)

### 2.2 一级导航(6 项,由 7 视图归并)

| 导航 | 回答问题 | 内容区块(自上而下) |
|---|---|---|
| 📊 总览 | 本周 meta 全貌?变化? | 叙事切换(聚焦/周报)→ KPI 行(含 Δ)→ 英雄 Tier 榜 → 热度×强度象限 → 传奇域对分布环图 → (周报模式)升降榜 + 周际时间线 |
| 🏆 英雄 | 练谁?带什么? | 搜索选择器(不截断+缩略图)→ 指标卡(真实胜率/Top8率/出场/Δ)→ Jaccard 流派聚类卡片 → 核心卡 Top20 携带率表 → 多周趋势 |
| 🌟 单卡 | 哪些卡无脑赚?绝配? | **Tab1 万金油 Top60**(类型/域/费用筛选+Δpp)→ **Tab2 Combo 羁绊**(Lift+携带率滑块,行点击解读抽屉) |
| 🗺️ 地域 | 本地流行什么? | 城市×英雄热力(双模式)→ 省级地图(点击下钻)→ 城市气泡 → 赛事一览表 |
| 🃏 卡组 | 冠军抄哪套? | 筛选+胜场排序表 → 行点击抽屉(按类型分组的完整构筑+卡图+复制 TTS 码+相似卡组) |
| 📥 数据 | 数据从哪来? | 5 槽位上传(关键词自动识别)、内置预设包加载、数据质量报告、城市映射修正、已加载包管理 |

> **Combo 羁绊并入「单卡」Tab**——同为卡级分析,避免 v2 的 7 个平级入口(层级过浅)。

### 2.3 关键交互流

1. **首启流程**:无数据 → 全屏引导(「加载内置示例数据(本周包)」|「上传数据包」)→ 加载中(Worker 解析进度条)→ 自动跳转总览
2. **下钻链路**(全局联动,沿用并强化 v2):象限点英雄 → 英雄视图并过滤;地图省份 → 城市过滤;柱/环图段 → 全局过滤;卡组行 → 抽屉
3. **周对比**:激活 ≥2 个数据包 → 顶部出现"对比视图"开关,所有聚合指标自动附加 Δ 徽章与排名箭头
4. **周报输出**:「复制周报 Markdown」(模板生成:本周 T0 英雄、域对变化、万金油、Combo 新星,含数据)+ 单图 PNG 导出(ECharts 原生)
5. **移动端**:过滤条收为底部抽屉 Sheet;表格横向滚动;KPI 双列;抽屉全屏

---

## 3. 🧩 核心组件与数据绑定映射

### 3.1 数据层(先行设计,多包核心)

**数据包模型**
```ts
interface DataPackage {
  id: string; season: string; weekKey: string; label: string; // 如 "S4-W3"
  source: 'upload' | 'preset';
  meta: { eventCount: number; sampleCount: number; dateRange: [string, string]; cityCount: number };
  // 归一化后行数据(join 完成):
  decks: DeckRow[];       // { cardGroupId, playerName, heroId, legendaryId, domainPair,
                          //   winCount?, rounds?, rank, eventId, deckCards: CardRef[] }
  events: EventRow[];     // { id, name, date, province, city, area, shop, playerMax, rounds }
  cards: CardRow[];       // cards_base + card_prints 合并(含 imgCdn)
}
```

**管线**:文件 → 槽位识别(关键词正则)→ PapaParse/JSON 解析(**Web Worker**,77MB 不卡主线程,进度回调)→ join(cardGroupId / card_no)→ 派生预计算(每卡组 hero/传奇/域对/轮次;每英雄聚合)→ **IndexedDB 持久化(Dexie)** + Pinia 内存态

**指标引擎(纯函数,可单测)**:`tier.ts`(收缩胜率+Tier 分位)、`combo.ts`(Lift)、`archetype.ts`(Jaccard 聚类)、`region.ts`、`delta.ts`(周环比,新)、`colorStats.ts`(域对统计,新)、`quickStats.ts`(KPI/HHI)

### 3.2 组件树与数据绑定

| 层级 | 组件 | 功能 | 消费的数据字段 |
|---|---|---|---|
| Shell | `AppShell` | 布局/视图路由/首启状态机 | packages, activeIds, view |
| Shell | `GlobalFilterBar` | 全局过滤+样本数 | filters → 全部分析 selector 的输入 |
| Shell | `PackageSwitcher` | 多包 chips + 周对比开关 | packages[].meta, activePackageIds |
| 通用 | `StatCard` | KPI 卡(Δ徽章+迷你趋势) | 派生 KPI:{value,delta,spark[]} |
| 通用 | `DeltaBadge` | ↑/↓/— 环比徽章 | delta, significance(样本门槛) |
| 通用 | `TierBadge` | S/A/B/C/NR 徽章 | tier, sampleSize(<15→NR) |
| 通用 | `ChartCard` | 图表容器+导出+下钻回调 | option builder + onDrill |
| 通用 | `DataTable` | 排序/筛选/虚拟滚动/导出CSV | columns, rows |
| 通用 | `CardThumb` | 卡图(离线降级色块)+禁卡角标 | card.imgCdn, is_banned, cardColorList |
| 通用 | `Drawer` | 详情抽屉(卡组/卡牌/Combo) | 由触发行数据注入 |
| 通用 | `EmptyState/Loading/Error` | 状态机三件套 | phase, error |
| 总览 | `OverviewView` | 双叙事容器 | 全部聚合 |
| 总览 | `KpiRow` | 5 个 KPI:样本/场次/冠军英雄/Meta集中度HHI/最强英雄 | Σdecks, Σevents, hero.winRate, HHI=Σpick², tier |
| 总览 | `TierList` | 分级英雄榜 | hero→{tier,winRate,pickRate,top8Rate,delta} |
| 总览 | `HeatQuadrant` | 热度×强度象限散点 | hero.x=pickRate, y=winRate, size=sample, color=tier |
| 总览 | `DomainRing` | 传奇域对分布环图 | domainPair→{count,pct,delta} (15 组合) |
| 总览 | `MoversList` / `MetaTimeline` | 升降榜/周际趋势(周报模式) | delta.ts 输出, 各周聚合 |
| 英雄 | `HeroSelect` | 搜索+缩略图+出场排序(不截断) | heroes[].sample, img |
| 英雄 | `ArchetypeCluster` | Jaccard 流派卡片 | cluster:{signatureCards[],sample,heroIds} |
| 英雄 | `CoreCardTable` | 核心卡 Top20 携带率 | card→{carryRate,Δpp,sample} |
| 单卡 | `FlexTable` | 万金油 Top60+筛选 | card→{carryRate,Δpp,types,colors,energy,banned} |
| 单卡 | `ComboPanel` | Lift 表+双滑块门槛 | pair→{lift,support,counts} |
| 地域 | `CityHeroHeatmap` | 城市×英雄热力(双模式切换) | city×hero→{pickRate,totalRate,winRate} |
| 地域 | `ChinaMap` | 省级热度地图+下钻 | province→{decks,pct} (china-geo.js) |
| 地域 | `EventTable` | 赛事一览 | event:{shop,city,playerMax,rounds,winner} |
| 卡组 | `DeckTable` | 筛选+胜场排序表 | deck:{rank,hero,legendary,winCount,event} |
| 卡组 | `DeckDrawer` | 构筑分组+卡图+TTS复制+相似卡组 | deck.deckCards 按 cardCategoryName 分组, TTS_code |
| 数据 | `SlotDropZone`/`QualityReport`/`CityMappingPanel`/`PackageList`/`PresetLoader` | 5 槽导入/质量报告/映射修正/包管理/内置包 | parse 状态机, join 匹配率, packages |

### 3.3 状态管理(Pinia)

```
analysis store:
  packages: Record<id, DataPackage>      // IndexedDB 镜像(懒加载)
  activePackageIds: string[]             // 多包对比核心
  filters: { hero?, city?, dateRange?, tier? }
  theme: 'dark' | 'light' | 'system'
  selectors: tierList / domainPairs / movers / deltas / quadrant / heatmap ...
```

### 3.5 多包 store 契约(待依赖放开后实现)

> 沙箱只读(ERR_PNPM_EROFS)无法安装 pinia/dexie,暂以 v2 响应式单例承载单包。以下为既定契约,依赖放开后按此实现,引擎层(delta/report)已就绪无需改动。

```ts
// src/store/packages.ts(目标实现)
export const usePackages = defineStore('packages', () => {
  const packages = ref<PackageRecord[]>([]);        // IndexedDB 镜像(Dexie 持久化,刷新不丢)
  const activeIds = ref<string[]>([]);              // 多选激活(≥2 触发周环比对比)
  const filters = reactive<GlobalFilters>({});      // 全局过滤(沿用 v2 applyGlobalFilters 语义)
  const loadPreset = (id: string) => ...;           // manifest → fetchPresetFiles → runAnalysis
  const loadUpload = (files: File[]) => ...;        // FileDrop 复用(Worker 解析)
  const removePackage = (id: string) => ...;
  const compare = computed(() =>                    // 跨包周报:复用 buildWeeklyReport 的 deltasFromRows 骨架
    activeIds.length >= 2 ? buildPackageCompare(activeIds) : null);
  return { packages, activeIds, filters, loadPreset, loadUpload, removePackage, compare };
});
// 跨包对比 = deltasFromRows(包A 聚合行, 包B 聚合行),与包内周次对比同构,仅数据源不同
```

**周报优先级**:有 ≥2 个激活包 → 跨包周环比;否则退化为包内周次对比(当前已实现)。

### 3.4 追加需求:最佳传奇排行横向对比(已实现首版)

**问题**:每套卡组由 1 张传奇卡定义双色域(域身份),玩家最关心"哪个传奇最强、该带哪张"。v2 只有域对分布环图,缺传奇卡维度的排行与对比。

**方案**:总览页新增「⚔️ 最佳传奇 · 横向对比」面板(`LegendaryCompare.vue`):
- **引擎** `src/core/legendaryStats.ts`(纯函数,已通过真实数据验证):
  - `legendaryRows(decks, catalog, grandTotal)` → 每张传奇聚合:{样本, Top8率, 出场率, 加权真实胜率 Σwins/Σrounds, 最常见搭配英雄及占比, 双色域, 卡图URL, 禁卡}
  - `sortLegendaryRows(rows, metric, minSample=5)` → 按 真实胜率/出场率/Top8率 降序(胜率缺失降级 Top8 率,并列按样本)
- **交互**:指标切换(真实胜率/出场率/Top8 率,无胜场数据时强制出场率)+ Top N 选取(2/3/5/10,**默认前 2 名**)+ 卡片横向并排,每卡:名次徽章🥇🥈🥉、卡图(离线降级色块)、双色域色块、常用英雄、三指标相对条形(固定色,跨卡可比)
- **数据绑定**:`AnalysisResult.allDecks × catalog` → `legendaryRows()` → `LegendaryCompare`(纯展示组件,父级注入)
- **已实测**(第三周全量):93 种传奇、2732/2732 卡组全覆盖、每套恰 1 张;出场率 Top1 = 无极剑圣(n=315, 胜率 48.2%),胜率 Top1 = 影流之主(n=9, 53.2%);**发现小样本霸榜问题** → 胜率排行时样本<15 显示"样本少"警示,后续 P1 用贝叶斯收缩彻底解决;发现同名传奇多版本(虚空之女 OGN-247/OGN-299)以 cardNo 区分展示
- **口径一致性**:按颜色域归并后与 colorStats 域对 **15/15 全部一致**(Top 样本 565 套)

---

## 4. 🎨 UI/UX 设计规范建议

### 4.1 配色(符文美学,深色为主)

| Token | 值 | 用途 |
|---|---|---|
| 背景/面板 | `#0B0E14` / `#131826`(边框 8% 白) | 深色主基调(电竞数据台) |
| 浅色 | `#F7F8FB` / `#FFFFFF` | 浅色主题 |
| 品牌主色·符文金 | `#E8B54A` | CTA、Tier-S、高亮、焦点环 |
| 域色(6+1) | 红`#E05D5D` 绿`#6FBF73` 橙`#E8A13D` 紫`#A975F0` 蓝`#5B8DEF` 黄`#E8D44D` 无色`#8A93A6` | 卡图/域对环图/颜色域筛选(与实测数据一致) |
| Tier | S金 A红 B蓝 C灰 NR半透明 | TierBadge 语义 |
| Δ 正/负 | `#4CC38A` / `#E05D5D` | 环比语义(独立于域色上下文) |
| 文字 | 主`#E8ECF4` 次`#9AA3B5` 弱`#5C667A` | 层级 |

### 4.2 排版与留白

- 字体:中文系统栈 + "Noto Sans SC";**数字强制 `font-variant-numeric: tabular-nums`**(表格/榜单对齐);KPI 大数字 700 字重
- 栅格:4pt 基准(16/24 间距),卡片圆角 12–16px,1px 细边框 + 弱投影
- 信息密度:榜单/表格紧凑(行高 40px),图表区留白充足;移动端 <768px KPI 双列、TabBar 5 项

### 4.3 交互状态

| 状态 | 规范 |
|---|---|
| Hover | 卡片/行:边框亮度提升 + `translateY(-1px)`,200ms ease |
| Focus | 2px 符文金 focus-ring(键盘可达) |
| Loading | 骨架屏 shimmer(表格行/卡片);数据解析:确定性进度条(Worker 阶段%:解析→join→聚合) |
| Empty | 插画 + 单句引导 + 主行动按钮(加载预设包/上传) |
| Error | 槽位级错误定位(哪个文件哪个字段),可重试,不整页失败 |
| 动效 | 200ms 过渡;图表 500ms 动画;尊重 `prefers-reduced-motion` |
| 无障碍 | 对比度 AA;样本数/加载状态 aria-live;图表配文字摘要 |

---

## 5. 🛠️ 推荐技术栈与实现路径

### 5.1 技术栈(保留 v2 栈 + 定向增强)

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | **Vite + Vue 3 + TS** | 与 v2 同栈,`src/core` 纯 TS 引擎直接复用;script setup 开发效率高 |
| 状态 | **Pinia** | 多包/全局过滤的规范状态层,devtools 可调试(v2 自建 store 升级) |
| 图表 | **ECharts 5 按需引入** | 象限散点/环图/热力/地图(已有 china-geo.js)/时间线全覆盖,原生 PNG 导出 |
| 样式 | **Tailwind CSS** | 设计 token 化(域色/间距/圆角),深浅主题变量 |
| 持久化 | **Dexie(IndexedDB)** | 多包 150MB+ 级数据持久化,刷新不丢;设置用 idb-keyval |
| 解析 | **Web Worker + PapaParse** | 77MB JSON/CSV 主线程零卡顿,进度回调 |
| 测试 | **Vitest** | tier/combo/delta 引擎纯函数单测(v2 已有 smoke 冒烟可升级) |
| 部署 | **Cloudflare Pages** | `npm run build` → dist;`base:'./'` 保留兼容子路径 |

**关于 file:// 双击即用**:按你的回答(预设数据放项目 data/ 目录),预设包走 `fetch('data/...')` 需要 HTTP 环境,故**默认部署形态为 Cloudflare Pages**;构建产物在 file:// 下仍可打开壳与"已上传会话数据",预设包加载会自动检测失败并提示改用上传(降级不报错)。

### 5.2 实现路径(每阶段含验收标准)

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 数据层** | types / 5 槽解析器(Worker)/ join / Dexie 持久化 / 预设包脚本(public/data/ 打包+manifest) | 导入本周包:2732 条 decks + 24 场赛事全量入库,刷新后仍在;解析不阻塞 UI |
| **P1 指标引擎** | tier(贝叶斯收缩)/ combo / archetype / region / delta / colorStats + Vitest | 单测覆盖;与 v2 口径对照差异有解释;15 域对分布与实测一致 |
| **P2 设计系统** | Tailwind tokens(域色/Tier/Δ)/ StatCard/TierBadge/DeltaBadge/ChartCard/DataTable/CardThumb/Drawer/三态 | 深浅主题切换即时生效;组件无业务耦合 |
| **P3 视图开发** | 总览(双叙事)→ 英雄 → 单卡(含 Combo)→ 地域 → 卡组 → 数据管理 | 每视图完成下钻链路;移动端可用 |
| **P4 体验增强** | 全局过滤联动 / 周对比 Δ / 复制周报 Markdown / PNG 导出 / 骨架屏 / 无障碍 | 双包对比:所有 Δ 徽章正确;周报文本含真实数字 |
| **P5 部署** | 构建体积优化 / CF Pages 发布 / 冒烟回归 | dist 部署后可访问;预设数据加载成功 |

### 5.3 与 v2 的复用/重写边界(已逐文件实测验证)

| 类别 | 文件 | 验证结论 |
|---|---|---|
| ✅ 直接复用 | `types/index.ts` | 已有 `DomainPair`、`CardColor`(6 域)、`Deck`、`HeroStats`、`ComboResult` 类型 — **与"传奇域对"设计定义一致** |
| ✅ 直接复用 | `utils/dataParser.ts` | `detectSlotFromFilename`(槽位自动识别)、`precomputeWeeks`(周聚合)、`normalizeDeck`、CSV/JSON 解析 |
| ✅ 直接复用 | `core/join.ts` | `attachWinData` 已实现"每场轮次=max(winCount)"口径(与实测一致) |
| ✅ 直接复用 | `core/heroStats.ts` / `quickStats.ts` / `colorStats.ts` | 加权胜率 Σwins/Σrounds、KPI、域对统计 |
| ✅ 直接复用 | `core/analyzer.ts` / `archetype.ts` / `combo.ts` / `parseTTS.ts` / `china-geo` | 分析管线、Jaccard、Lift、TTS 码解析、地图数据 |
| 🔧 重写 | `core/tier.ts` | 保留公式骨架,加贝叶斯收缩与置信度提示(112 行,小) |
| 🔧 重写 | `store/analysis.ts` | 单包 6 槽 → **多包 5 槽** Pinia store,删 cache 槽 |
| 🔧 重写 | 全部视图组件 + 布局 + 设计系统 | 新 IA 与视觉规范 |
| 🗑️ 删除 | cache 槽位、7 视图平级导航、城市正则猜城主路径(shop_data 优先) | 冗余/层级过浅/不准 |

> v2 引擎质量高于 README 描述,重设计重心确认落在**数据层(多包/持久化/Worker)与展示层(IA/组件/视觉)**,引擎仅做口径增强。

---

## 6. 🎨 视觉换肤落地:《符文档案·周报》(R7)

> 用户需求:整体 UI 重新设计,贴合「符文档案 · 周报」这一产品名。视觉层全量重做,引擎/数据层零改动。

### 6.1 设计理念:极简报刊 + 杂志式留白

界面框架 = 现代报刊版式,去除装饰性元素,信息层级靠排版与留白承载:

- **报头(单块 sticky,含两行)**:第一行 = 衬线刊名「符文档案 · 周报」+ 拉丁铭文副标 + **刊号行**(真实数据驱动:预设包刊名「第四赛季 · 第三周」或数据包内最新 ISO 周 + 赛事日期区间)+ 状态/启动/主题;第二行 = **纯文字栏目条**(数据/总览/英雄/单卡/Combo/地域/卡组),激活项 = 金色下划线;两行以发丝线分隔
- **检索条**:金色「范围」眉题 + 细控件,桌面吸附于报头之下(90px),发丝线收尾
- **卷目标题(SectionHeading)**:金色 kicker 短线 + 大号衬线标题 + 注脚,无图标无卡片
- **内容区块(杂志式)**:`.panel` 扁平化(无底色/无边框/无投影),区块间以留白与标题分隔;KPI 改为**报刊数据行**(26px 大数字 + 竖线分隔,无卡片);`.card` 仅保留发丝边框
- **六符文印**仅保留在数据语境:总览域对图例、最佳传奇双色域标记(用户美术,非装饰)
- **周刊正文**:全宽内容区(上限 1720px 居中),页脚符文金细线落款

### 6.2 设计 tokens(古典卷宗调色板)

> 依据用户提供的专属配色方案落地:宣纸白 / 徽墨黑 / 朱砂红 / 远山黛 / 藤黄。

| Token | 宣纸·卷宗(默认) | 墨夜·古籍(深色) | 用途 |
|---|---|---|---|
| 宣纸白 page | `#F4F1EA` | `#171410`(暖墨夜) | 主背景 + 宣纸噪点纹理(4%)+ 朱砂微光 |
| 徽墨黑 text-primary | `#2C2C2C`(≈13.5:1 AAA) | `#EDE7DA` | 正文/标题 |
| 远山黛 text-muted | `#3B4A5A`(≈6.5:1 AA) | `#A89F8F` | 次要文字/边框/分割线/未激活项 |
| 朱砂红 brand | `#B23A27` | `#D0553F`(夜版提亮) | 导航激活下划线、CTA、kicker、Tier-S、焦点环、hover 反馈 |
| 藤黄 accent | `#C59B46` | `#C59B46` | 标签/徽章/Tier-A/图表点缀/符文发光 |
| 地图/热力色带 | 宣纸→远山黛 / 宣纸→藤黄→朱砂 | 墨夜→黛 / 墨夜→赭→朱 | `--color-map-ramp-*` / `--color-heat-ramp-*`(ECharts 随主题重绘) |

排版:展示字体 **Noto Serif SC + Cinzel**(Google Fonts,离线回退 Songti SC/SimSun/Georgia);正文系统无衬线;正文行距 1.7(古籍留白);数字全局 `tabular-nums`。分割线为渐变发丝线(笔触感),悬停反馈 = 远山黛 → 朱砂红 平滑过渡。交互:朱砂 focus-ring、`prefers-reduced-motion` 尊重。

### 6.3 组件清单

| 文件 | 说明 |
|---|---|
| `RuneSeal.vue` | 六色符文印:内联用户 SVG 路径(与 `public/runes/*.svg` 同源,离线可用),支持单枚渲染(`only`);仅数据语境使用 |
| `SectionHeading.vue` | 卷目标题(金色 kicker + 衬线标题 + 注脚 + actions 插槽),`small` 变体 |
| `style.css` | 全部设计 tokens + `.masthead-solid/.hairline/.sec-kicker/.btn-gold/.btn-ghost/.rune-rule/.tab-active/.filter-select` 等;`.panel` 扁平化、`.card` 发丝边框 |
| 壳层 | `App.vue`(报头+栏目条+页脚)、`FilterBar.vue`(检索条) |
| 视图 | 7 视图标题统一 SectionHeading;KPI 报刊数据行(竖线分隔);sticky 表头/按钮/滑块/色带统一换肤 |

### 6.5 传奇卡组对比页(R8,独立页面)

用户澄清后的需求:**同一张传奇的卡组在每周的横向对比**,展示每套卡组的构筑差异;**「最佳」= 短时间窗口内拿到最好成绩的卡组(名次优先)**;支持**向下取前 N 名**对比更多卡组;独立页面。

- **导航**:新增第 8 栏目「传奇」(短标签),总览旧面板移除(口径误导,防止误读)
- **选择**:48 张传奇下拉(按出场率排序,默认最高),右侧卡图/双色域/常用英雄
- **候选表**:名次升序 → 胜场 → 胜率;周次过滤 chips(ISO 周);点击行或勾选加入对比(≤10 套)
- **向下取**:前 1/2/3/5/10 一键选取;切换传奇/周次后保留所选 N
- **卡牌矩阵**:列 = 卡组(名次/选手/周次/城市/胜场/总张数),行 = 卡(按类型分组,规范键归并);着色:共通(全部携带)/ 部分(淡藤黄)/ 独有(朱砂高亮);sticky 首列 + 表头,横向滚动
- 引擎复用 `legendaryRows` 口径;匹配键 = `canonicalById`(同名+副标题归并),实测 2732/2732 全覆盖、0 误差

### 6.4 验证

`npm run build` ✓;`scripts/verify-ui.mjs`(CDP 无头浏览器,依赖系统 playwright 缓存浏览器):预设加载→总览(KPI/Tier/传奇/域对)→周报叙事(胜率变化榜/复制周报)→深色主题(`html.dark`、页面底 #0B0E17、金 #E8B54A、六符文印 6/6)全链路通过;截图输出至 `shots/`(已 gitignore)。

---

## 7. 💡 下一步行动

方案已完整。请确认以下 4 个决策点,确认后我将立即生成 **P0+P2 代码骨架**(types/解析器/store/设计系统 tokens + 总览页首个可用版本):

1. **file:// 解读**:按"预设数据需 HTTP、Pages 为默认部署"执行,file:// 降级为"壳+已上传数据" — 是否认可?
2. **Combo 并入单卡 Tab**:6 导航归并 — 是否认可?
3. **预设数据位置**:`public/data/`(构建产物内,CF Pages 直接托管)+ manifest.json 清单 — 是否认可?
4. **双叙事**:总览页内「本周聚焦/趋势周报」切换实现双受众,而非两套独立模式 — 是否认可?

> 数据仅供竞技参考 · Riot Games 与本工具无关
