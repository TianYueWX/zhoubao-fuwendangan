# 符文档案 · 周报 — 风格规范(compact)

> 一页可移植的样式契约。依据**当前代码实测**(`src/style.css` / `tailwind.config.js` / `src/components/**` + 无头浏览器渲染结果),
> 覆盖报头、栏目、全部视图与通用组件。用于新页面/新组件快速对齐,不必重读 360 行 `design-v3.md`。
> 实测环境:1680×1050 桌面 + 390×844 移动端,预设数据包 2732 套卡组 / 24 场赛事。

---

## 0. 一句话风格定义

**宣纸上的档案周报**:暖白纸底 + 徽墨正文 + 朱砂导航与强调 + 藤黄点缀,全站唯一装饰是**发丝分隔线**与**衬线刊名**;
去卡片、去图标、去投影,层级只靠排版、留白和 1px 细线承载。数据是主角,任何视觉元素不能比数字更响。

反面清单(违反即破坏风格):彩色渐变、玻璃拟态、圆角大胶囊、emoji 图标、多重阴影、深色霓虹、渐变标题字。

---

## 1. 色彩 tokens

单一来源 = `src/style.css` 的 `:root` CSS 变量;Tailwind 只做 var 映射(`tailwind.config.js`),禁止硬编码新色。

### 1.1 基础五色(全部语义色都由它们派生)

| 语义 | 变量 | 值 | 用法 |
|---|---|---|---|
| 宣纸白 | `--color-page-bg` | `#F4F1EA` | 页面底、地图/热力色带起点 |
| 徽墨黑 | `--color-text-primary` | `#2C2C2C` | 正文、标题、大数字 |
| 远山黛 | `--color-text-muted` | `#3B4A5A` | 次要文字、边框、分割线、未激活项 |
| 朱砂红 | `--color-brand` | `#B23A27` | 导航激活、眉题、Tier-S、CTA、焦点环 |
| 藤黄 | `--color-accent` | `#C59B46` | 徽章、Tier-A、图表点缀 |

派生层(次级变量,勿绕过):

```
--color-page-glow      rgba(178,58,39,.05)    顶部朱砂微光
--color-header-bg      rgba(244,241,234,.92)  报头毛玻璃底
--color-card-bg        #FBF9F3                卡片/输入框底
--color-panel-bg       rgba(250,248,243,.9)   内嵌块底
--color-thead-bg       #F7F4EC                sticky 表头底
--color-text-subtle    #8A8478                三级文字
--color-hairline       rgba(59,74,90,.28)     发丝线
--color-panel-border   rgba(59,74,90,.18)     栏间竖线/控件边框
--color-card-border    rgba(59,74,90,.16)     卡片边框
--color-brand-soft     rgba(178,58,39,.09)    hover 底 / Tier-S 底
--color-brand-faint    rgba(178,58,39,.28)    卡片 hover 边框
```

### 1.2 六色域(语义固定,与 `utils/palette.ts` 的 `CARD_COLOR_HEX` 一致,不可当装饰色用)

红 `#E2372B` · 绿 `#3FA650` · 蓝 `#2F7DD1` · 黄 `#D9A514` · 紫 `#8B48C9` · 橙 `#E2762B` · 无色 `#94A3B8`

### 1.3 语义状态色

| 语义 | 值 | 说明 |
|---|---|---|
| Δ 上升 | `#3D8F66` | 独立于六色域,仅用于环比 |
| Δ 下降 | `#C04437` | |
| Δ 持平 | `#8A8478` | 阈值 ±0.05,内为持平 |
| Tier S / A / B / C | 朱砂 `#B23A27` / 藤黄 `#C59B46` / 黛 `#3B4A5A` / 灰 `#94A3B8` | 徽章底为同色 10–12% 淡化 + 同色描边 |
| 解析成功 | `#3D8F66` | 槽位已加载:实线边框 + 8% 绿底 |

### 1.4 图表色带(不单独设色,ECharts 经 `utils/theme.ts` 读同名变量)

```
series 调色板 CHART_PALETTE = 朱砂 → 远山黛 → 藤黄 → 黛绿 → 藕紫 → 青碧 → 赭石 → 黛蓝 → 灰褐 → 深朱
省份热度 --color-map-ramp-1..3   #ECE9E0 → #8E9AA8 → #3B4A5A
城市热力 --color-heat-ramp-1..4  #F4F1EA → #D9C49A → #C59B46 → #B23A27
轴/网格  rgba(59,74,90,.28) / rgba(59,74,90,.12)   tooltip 底 rgba(251,249,243,.98)
```

### 1.5 主题

当前实现为**宣纸单主题**,无深色模式、无主题切换入口(`design-v3.md` §6.2 的「墨夜·古籍」为未落地规划)。
若要加深色主题:只改 `:root` 变量覆盖,组件与图表零改动;`html.dark` 类名已被历史验证脚本占用,勿复用。

---

## 2. 字体与数字

| 层级 | 族 | 字号 / 字重 | 用途 |
|---|---|---|---|
| 刊名 | `font-display` 衬线 | 20px(mobile)→ 22px(lg) / **900** | 报头「符文档案·周报」,`.` 用朱砂 |
| 拉丁铭文 | `font-latin` Cinzel | 9px / `tracking .32em` / 大写 | 报头副标,xl 以上才显示 |
| 卷目标题 | `font-display` | 20px / 700,行高 snug | `SectionHeading` 主标题;small 变体 16px |
| 眉题 eyebrow | 无衬线 | 11px / 600 / `tracking .22em` / 朱砂 | 「投稿箱 · Submissions」式栏目名 |
| 报眼数字 | 无衬线 | **26–28px / 700 / tabular-nums** | KPI 大数字 |
| 正文 | 无衬线系统栈 | 16px,`line-height 1.7` | 古籍留白 |
| 表格 | 无衬线 | th 12px / td 14px | 行高紧凑 |
| 微注 | 无衬线 | 10–11px / `text-ink-faint` | 口径说明、卡号、注脚 |

字体栈(离线必须可降级):

```
display: "Noto Serif SC", "Songti SC", STSong, SimSun, serif
latin  : Cinzel, Georgia, "Times New Roman", serif
sans   : system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
         "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif
```

- 字体经 Google Fonts 引入,`display=swap`;离线自动回退系统衬线,**不得因字体失败而破坏布局**。
- **全站数字强制 `tabular-nums`**(`table` / `.tabular-nums` / `.font-display` 已在全局声明),榜单、表格、KPI 必须对齐。
- 不新增斜体;强调只用颜色、字重、字号。

---

## 3. 间距、圆角、边框、线

- **基准 4pt**;视图纵向节奏:`space-y-10`(40px,总览等重排版面)/ `space-y-5`(20px,筛选+表格式视图)。
- 主区容器:`max-w-[1720px] mx-auto px-4 lg:px-8 py-8`(报头/页脚同宽)。栏内边距 24–32px(`gap-8` + `xl:pr-8/xl:pl-8`)。
- 圆角:容器与卡片 **12px(`rounded-xl`)**,控件/徽章 **8px(`rounded-lg`)**,缩略图 6px。全站不用胶囊圆角做容器。
- 边框一律 **1px**;禁用 2px+ 描边(焦点环除外)。

三种线,不得混用:

| 线 | 形式 | 位置 |
|---|---|---|
| 发丝线 `.hairline` | 1px 高,横向渐变:透明 → 远山黛 28% 从 12% 到 88% → 透明 | 报头底、版面分节之间 |
| 栏间竖线 | 1px `--color-panel-border`,多栏时列间(`xl:divide-x` 或 `xl:border-l xl:pl-8`) | 总览「Tier 榜 │ 传奇对分布」、报眼左栏 |
| 行分隔 | 1px `rgba(59,74,90,.08)`(`border-b`,末行 `last:border-0`) | 表格行、榜单条目 |

落款线 `.rune-rule`:朱砂渐变 1px、`opacity .65`,仅页脚使用一次。

---

## 4. 页面骨架

站点是**三层结构**:栏目(分组)→ 工具 → 工具页面。事实来源只有一个 ——
`src/tools/catalog.ts` 的工具注册表;导航、首页工具台、路由、状态徽章全部由它派生。

```
栏目(报头一级导航,可扩展)
├─ 工具台  #/                        所有工具的入口(不属于任何栏目)
├─ 周报期刊 #/journal   ← 栏目,含 7 个工具
│    ├─ #/journal 本期周报   #/archive 往期   #/issue/{pkgId} 期号正文
│    └─ #/import 数据管理 · #/overview · #/cards · #/legendary · #/region · #/decks
├─ 云端内容 #/blog · #/qa            (Supabase,未配置时标「未配置」)
├─ 参考资料 #/rules · #/carddex      (随站点发布的静态资料)
└─ 编辑部   #/editorial              (隐藏栏目,见 §10)
     └─ #/editorial/{cards|batch|rules|resources|sync}
```

```
┌───────────────────────────────────────────────────────────────┐
│ 报头 sticky h-14:刊名·拉丁铭文 │ 栏目导航(工具台 + 各栏目)│ 期号状态 │
│ ── 栏目条(仅栏目内页面 h-12):本期/往期 + 该栏目下工具 tab ── │
│ ── hairline ──                                                │
├───────────────────────────────────────────────────────────────┤
│ main:max-w-1720 居中,px-4/lg:px-8,py-8(当前工具视图)         │
├───────────────────────────────────────────────────────────────┤
│ 页脚:.rune-rule + 两行 11px 居中注脚                          │
└───────────────────────────────────────────────────────────────┘
```

### 4.0 扩展一个工具(两步,零改动导航/路由/首页)

1. `src/tools/catalog.ts` 登记:`{ code, label, desc, group, source, needsData?, badge? }`
   —— `code` 即路由(`#/{code}`),`inNav` 决定是否进栏目条,`short` 是栏目条短标签。
2. `src/components/view/index.ts` 映射到组件;内容未接入时用 `ToolPlaceholder`。

**数据源抽象**(`src/tools/state.ts` + `src/tools/sources/`):
`source` 声明取数来源(`local` 本机内存 / `supabase` 云端 / `static` 站点资源);
状态机 `idle → loading → ready / empty / error / unconfigured` 由数据源健康状态广播给其下工具。
**未配置不是错误**:云端工具在缺少 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 时显示「未配置」。

### 4.0.1 工具台(#/,首页)

**按栏目分区**的卡片栅格:每区 = 朱砂短线 + 衬线栏目名 + 一句说明 + 拉丁铭文;
卡片 = 全局编号(01–NN)+ 名称 + 一句说明 + 来源徽章(数据/云端/资料/入口)+ 状态徽章。
状态徽章是**用户可读结论**,不是内部枚举:期刊「已刊行 N 期 / 暂无期刊」、
数据管理「第一步 / 可继续载入」、分析工具「需先载入 / 就绪」、云端「未配置 / 就绪 / 加载失败」。
栅格用 `gap-3` + 每卡自带细边框(不用 `gap-px` 底色栅格:工具数不填满整行时会露出灰底)。

### 4.1 期刊页(#/journal)

信息架构借自 Astro blog 的「首页 → 列表 → 详情」,内容仍是《符文档案》的刊头语言:

| 区块 | 内容 | 数据来源 |
|---|---|---|
| 刊头 | 拉丁眉题 + 衬线刊名 + 站点定位一句 + 「已刊行 N 期 · 日期跨度」 | 全部包的聚合 |
| 本期头条 | 期号 · 日期区间 · 发布日期 → 28–40px 衬线头条 → 导语(standfirst)→ 环比一行 → 「阅读本期周报」 | 最新包:metaScore 榜首传奇 |
| 本期数据行 | 卡组样本 / 赛事 / 城市 / 英雄 / 传奇种类,`border-y` + `divide-x` 竖线分隔,26–28px 数字 | `quickHeroRows` / `legendaryRows` |
| 往期期刊 | 卡片墙 `md:2 / xl:3` 列,最多 3 张 + 「查看全部往期」;卡片 = 期号 + Vol. 铭文 + 衬线标题 + 日期/样本 + ≤3 条要点(▲/▼/· 行线分隔)+ 「阅读本期 →」 | 每个包一期,按期号从新到旧 |
| (无工具区) | 工具入口统一在首页工具台;期刊页只呈现内容 | — |

**空态(未载入任何数据包)**:刊头与工具箱照常展示,期刊区替换为「从一份赛事数据包开始」引导 + 主行动按钮进「数据」;5 个分析工具标「需先载入」并降到 55% 不透明度。不自动加载任何内置数据。

### 4.2 期号正文(博客 post 版式)

期号行 → 30–42px 衬线大标题 → 导语 → `hairline` → **820px 窄栏正文**(阅读宽度,对应 Astro 的 720px prose 栏)→ 数据工具 CTA → 上下期导航 → 口径注脚。

正文分节由 `core/issue.ts` 生成,四种形态:段落 / 榜单(list + DeltaBadge)/ 表格(转化变化榜)/ 图表(周际时间线,仅在 ≥2 周次时出现)。数字全部来自现有引擎,口径注脚固定收尾。

### 4.3 数据页(工具层入口 + 多包管理)

三段:上传暂存区(3 槽位 + 刊名输入 + 「分析并入档为『期』」)→ **数据包库**(每包一张卡:期号/活动标记/刊名/日期区间/样本/赛事/城市/周数/是否含胜场 + 设为活动包/改刊名/载回暂存区/移出)→ 数据质量报告 + 城市映射修正。每次分析生成一期,可继续载入下一期做周际对比。

---

## 5. 版面语法(视图通用)

1. **一版一问**:每个视图由若干 `SectionHeading` 分节,每节回答一个问题,注脚写口径(如「综合分 = Top8率35% + …」),口径必须出现在注脚而非 tooltip 里。
2. **多栏靠竖线,不靠卡片**:`grid xl:grid-cols-5` 等分栏 + `xl:divide-x xl:divide-panel-border`;窄屏退化为单列并去掉竖线(`<1280px`)。
3. **标题承载层级,底色不承载**:`.panel` = 完全扁平(无底色/边框/圆角/投影);`.card` = 细边框 + `--color-card-bg`,仅在需要"可点击块"(往期卡片、期号 CTA、数据包卡)时使用。
   **唯一例外**:首页「数据工具箱」用 `grid gap-px` + 容器底色画出 1px 网格线,不额外描边每张卡。
4. **KPI 用报刊数据行**:26px 大数字 + 11px 标签 + 11px 副注,竖线分隔(`divide-x`),**不做卡片、不做图标**。
5. **下钻优先于新页**:散点/环图/榜单行点击 → 设置 `store.focusHero` 并切栏目;表格行 `cursor-pointer` + 悬停 `rgba(59,74,90,.05)` 底。
6. **空态/缺失**:居中 12–16px 灰字一句话(如「暂无英雄数据」),给可执行动作;绝不整页报错。

---

## 6. 组件契约

| 组件 | 视觉规格 | 关键约束 |
|---|---|---|
| `SectionHeading` | 眉题(朱砂 11px)或 `.sec-kicker`(28×3px 朱砂短线)+ 衬线标题 + 12px 注脚;`small` 变体 16px 标题、`mb-3`;右上 actions 插槽 | 每节首选眉题式(「第二版 · 综合表现」);注脚用于口径声明 |
| `StatCard` | 报刊数据行:竖线左分隔、`first:border-l-0`、26px `tabular-nums` 大数 + Δ 徽章 + 11px 副注 | 无底色无圆角;tone 仅改数字颜色 |
| `TierBadge` | 24×24(sm)/32×32(md),8px 圆角,同色 10% 底 + 同色描边 + 同色字 | 无分级显示「–」灰框 |
| `DeltaBadge` | 10px 半粗,8%/30% 同色底/描边,文本 `▲ 3.2%` / `▼` / `＝` / `—` | 阈值 ±0.05;`title` 写全「环比 +3.2%」 |
| `ChartCard` | 纯 ECharts 容器(无外壳、无标题),高度显式传入(320/380/440px) | 主题经 `utils/theme.ts` 注入;默认 toolbox = 缩放/还原/**另存 PNG**;点击回调下钻 |
| `DataTable` | 搜索框 `.filter-select` + sticky 表头 + 分页按钮 | 分页按钮样式为组件内 scoped(与全局控件同规格:细边框、激活朱砂) |
| `CardThumb` | 缩略图 36×50 / 44×61 / 74×103 / 112×156,6px 圆角、细边框 | 卡图 CDN 失败 → 六色域文字色块降级;禁卡角标 = 朱砂「禁」 |
| `Drawer` | 右侧滑出,全高,遮罩 `bg-ink/35 + backdrop-blur-sm`,`z-90` | Escape 关闭;打开时锁 `body` 滚动 |
| `RuneSeal` | 内联六色符文 SVG(与 `public/runes/*.svg` 同源) | **仅限数据语境**(域对图例、双色域标记),禁止当装饰 |
| `FileDrop` | `.dropzone` 1.5px 朱砂虚线 + 卡片底;已加载 = 实线绿框 + 8% 绿底 | 三态文案:未上传 / 解析中… / 文件名(行数);失败给「重试」按钮 |
| `ImportView` 版面 | `max-w-5xl` 居中,必需/可选两组槽位,质量报告为双列细边框块 | 空态首屏 = 投稿箱式引导,不做插画大图 |
| `PackagePanel` | 数据包库:每包一张细边框卡,活动包用 `border-brand-faint` + `bg-brand-soft/40` 标记 | 多包管理的唯一入口;分析一次 = 入档一期 |
| `HomeView`(工具台) | 按栏目分区,每区一个 `grid gap-3` 卡片栅格;**每张卡自带细边框**,不使用 `gap-px` 底色栅格(工具数不填满整行时会露出灰底) | 卡片顺序与徽章全部来自注册表,新增工具无需改本页 |
| `ToolPlaceholder` | 架构位视图:徽章「架构位」+ 工具 code / 数据源 / 分组 / 状态四项 dl | 云端与资料类工具在内容接入前用它,保证导航与路由先可用 |

---

## 7. 交互状态与动效

| 状态 | 规格 |
|---|---|
| Hover | 表格行 `rgba(59,74,90,.05)` 底;卡片 边框 → `--color-brand-faint`;按钮 幽灵态转朱砂字/边/9% 底;链接与可点标题转朱砂 |
| Focus | `:focus-visible` 2px 朱砂 outline,`offset 2px`,`border-radius 3px`(键盘可达,不可移除) |
| Active | 栏目 = 朱砂下划线;Tabs = 朱砂实底 + `--color-brand-ink` 文字 |
| Disabled | `opacity .4` + `cursor: not-allowed`,不改色相 |
| Loading | 骨架/`animate-pulse`;解析阶段用文案进度(解析中…),不使用旋转器 |
| Error | 就地红字(`#C04437` / `--color-delta-down`)+ 可重试按钮,不整页失败 |
| 过渡 | 统一 200ms(背景/边框/颜色);入场 `.fade-in` = 400ms `opacity 0→1 + translateY(10→0)` |
| 动效可达 | 必须尊重 `prefers-reduced-motion`(全局已降为 0.01ms) |
| 无障碍 | 对比度 ≥AA(正文 13.5:1);栏目条 `aria-label="卷宗导航"`、Tabs `role="tab"`、周次 `aria-label`、图标按钮给 `title` |

---

## 8. 落地检查清单(新页面/新组件)

- [ ] 颜色全部走 CSS 变量或 Tailwind 语义色(`paper/ink/ink-muted/ink-faint/brand/accent/panel-border/card-border/delta-*`),无新十六进制。
- [ ] 没有引入第二装饰元素:无图标、无投影、无渐变块;分隔只用 hairline / 竖线 / 行线三种。
- [ ] 数字 `tabular-nums`;标题用 `font-display`;眉题用 `.eyebrow`。
- [ ] 容器 12px 圆角、控件 8px、边框 1px;主区在 1720px 内居中。
- [ ] 多栏在 <1280px 变单栏且竖线消失;移动端 390px 无横向溢出(表格自身可滚)。
- [ ] 焦点环保留;prefers-reduced-motion 未被覆盖。
- [ ] 口径写进注脚,不藏进 tooltip。

---

## 9. 编辑部(后台栏目)

内容校勘与发布台。**默认不存在**于导航中,也不是公开内容的一部分。

### 9.1 入口:彩蛋 + 门禁(两层,互不替代)

| 层 | 规则 | 实现 |
|---|---|---|
| ① 可见性 | **连点报头刊名 5 次**(相邻两次间隔 ≤ 3 秒)解锁「编辑部」栏目 | `src/tools/editorialAccess.ts` |
| ② 授权 | 登录且 `app_metadata.role === 'admin'` | `src/tools/sources/auth.ts` + 服务端 RLS |

- 未解锁时,栏目在**报头、栏目条、工具台正文**三处均不存在;深链 `#/editorial/*` 只渲染门禁页。
- 解锁只代表「看得见入口」,**不代表有权限** —— 未登录时栏目条只留「编辑部」一项,不列出 5 个工具(避免列出点了就撞门禁的死链)。
- 进度反馈:第 2 次敲击起,刊名下方长出一条朱砂细线(复用栏目激活下划线的语言);未解锁时行为与普通返回工具台完全一致,不留痕迹。
- 解锁状态持久化(`localStorage`),刷新不丢。

### 9.2 全站唯一的持久化

站点其余部分**全是内存态**(刷新即丢)。编辑部引入两个 localStorage key,除此以外不得再新增:

| key | 内容 | 理由 |
|---|---|---|
| `riftbound-editorial-unlocked` | 彩蛋是否已解锁 | 否则每次刷新都要重敲暗门 |
| `riftbound-editorial-session` | 管理员会话(access/refresh token) | 否则每次 F5 都要重登 |

> 会话刷新必须**单飞**(所有调用共享同一个 in-flight Promise)。Supabase 的 refresh_token
> 只能用一次且启用重用检测 —— 并发刷新会让整个会话连同全部刷新令牌被吊销。

### 9.3 无组件库的取舍

编辑部**不引入 Element Plus**(全站依赖仅 vue / echarts / papaparse / oboe)。
下表是后台原界面的等价物,新写后台界面时照此选型,不要新增装饰元素:

| 后台原控件 | 编辑部的等价物 | 位置 |
|---|---|---|
| `el-dialog` | 右侧滑出 `Drawer`,或**表格上方的内联面板** | 优先内联 |
| `el-message` toast | 内容区顶部的 notice 细线(左 2px 竖线定调) | `AdminNotices.vue` |
| `el-messagebox` 确认 | 就地二次确认按钮(点一下变「确认删除/取消」,4 秒复位) | `AdminConfirmButton.vue` |
| `el-pagination` | 服务端分页控件(28px 方形 / 8px 圆角 / 激活朱砂) | `AdminPager.vue` |
| `el-select multiple allow-create` | 原生 datalist 驱动的标签输入器 | `AdminTagInput.vue` |
| `el-input-number` | 原生 `type="number"` + `.filter-select` 样式 | — |
| `el-switch` | 「启用 │ 禁用」文字分段控件(`.tab-active`) | — |
| `el-tree` | **扁平化渲染** + 每层一条 1px 缩进导线 | `AdminRulesEditor.vue` |
| `el-table` 脏行黄底 | 藤黄 8% 底 + **左侧 2px 藤黄竖线** | `AdminBatchOps.vue` |

**两条硬约定:**

1. **不用模态框打断流程。** 批量操作配置、编辑表单、脏行拦截确认一律做成内联条或就地确认。
2. **层级靠细线,不靠色块。** 树用缩进导线,脏行用左侧竖线,提示用左侧竖线。

### 9.4 编辑部的口径注脚(必须随页展示)

- 库中**没有触发器** → 所有写操作显式带 `updated_at`。
- **「发布」= 触碰 `version.updated_at`** → 客户端据此判断缓存失效。没有其它含义。
- 保存**只提交变更字段**,不整行覆盖。
- 人工维护列(`keyword` / `advanced_tag` / `deck_limit` / `*_en` / `tts_cdn` / `print_order` / `is_default`)
  永不被数据同步覆盖;**`is_banned` 默认也不写**,需在同步页显式勾选才纳入。
- 规则检索用**子串匹配**而非库里的 `search_vector`:该列用 `simple` 配置生成,不切分中文,
  实测召回仅为子串的 3–7%(法术 11 vs 288、伤害 2 vs 148)。
- 卡表快照导出前必须自检格式(**数组列 JSON 编码 · 无 BOM · LF**),不符则拒绝下载 ——
  这类错误在站点侧是静默失效(颜色丢失、卡图关联落空),不会报错。

### 9.5 验证

```bash
npm run verify:all          # 全部套件
npm run verify:editorial    # 浏览器端到端(需先 build:fast + preview)
```

| 套件 | 覆盖 |
|---|---|
| `verify:editorial` | 隐藏性、深链拦截、暗门、解锁≠授权、5 条工具路由、风格合规(计算样式)、未授权写入被拒、既有视图回归 |
| `verify:admin-sync` | 同步导出层:`is_banned` 默认排除、列值不错位、人工维护列不出现、转义 |
| `verify:admin-logic` | ±N 分组、变更字段计算、deck_limit 三态、输入校验 |
| `verify:admin-snapshot` | 快照格式:表头与仓库文件逐字一致、JSON 数组、换行归一、格数错位可检出 |
| `verify:admin-rules` | 规则树:成环免疫、防环、排序、检索 |
| `verify:sanitizer` | 效果文本标签白名单(XSS 防护) |

**与既有验证脚本的关系**(不是另起炉灶,是并列新增):

| 既有 | 用途 | 与本套件的关系 |
|---|---|---|
| `npm run smoke`(`smoke.ts`) | 分析引擎正确性(需根目录赛事数据包) | 未被改动;改动后实测 10 项仍全过 |
| `scripts/verify-ui.mjs` | 站点视觉/交互的 CDP 走查,产出截图 | 编辑部套件复用**同一套** CDP + headless chromium 设施与写法 |
| `scripts/capture-style.mjs` 等 | 样式与表格的专项核对 | 未受影响 |

编辑部的断言刻意独立成文件而非塞进 `verify-ui.mjs`:后者依赖已载入的赛事数据包、
且会把截图写到工作区外,耦合进来会让两边都变脆。需要一次跑完时用
`npm run verify:all`(类型检查 + 6 套断言)。

---

## 10. 与文档的差异(以本文为准)

| 项 | `design-v3.md` | 当前代码 |
|---|---|---|
| 主题 | 宣纸 +「墨夜·古籍」深色 | **仅宣纸单主题**,无切换入口 |
| 信息架构 | 7 视图平级导航 | **两段式**:内容层(首页/往期/期号正文)+ 工具层(6 个数据工具,从首页工具箱进) |
| 多数据包 | 规划中(Pinia + Dexie 持久化) | **已实现多包并存**(响应式单例 `store.packages`,每包一「期」);赛事数据**仍无持久化**——刷新丢内存态,回到首页空态(例外:编辑部会话与暗门状态,见 §9.2) |
| 预设包加载 | `PresetLoader` + `manifest.json` 一键加载 | **未接入 UI**(不自动加载);数据靠三槽位上传,`public/data/manifest.json` 仅供脚本 |
| 路由 | 无 | **hash 路由**(`#/` · `#/archive` · `#/issue/{id}` · `#/tool/{id}` · `#/editorial/{tool}`),支持深链与前进后退 |
| 组件名 | `AppShell` / `KpiRow` / `TierList` / `MegaTimeline` 等 | 实际见 §6 与 `src/components/view/*`;内容层为 `HomeView` / `ArchiveView` / `IssueView` |
| 后台 | 未规划 | **编辑部**(§9):隐藏栏目 + 门禁,5 个校勘工具,零组件库 |

> 数据仅供竞技参考 · Riot Games 与本工具无关
