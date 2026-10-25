# 「我的卡池」方案与实现说明

给管理员一个**云端持有卡台账**:把真实拥有的卡按「印本 + 语言」逐张记账,并让构筑页知道自己缺什么。
对应路由 `#/collection`(报头「参考资料」栏目,`carddex` 之后),表 `public.web_collection`。

---

## 1. 需求确认

| 问题 | 结论 |
|---|---|
| 用途 | 台账 + 构筑联动(不是交易/估价/统计看板) |
| 粒度 | **按印版**:同一张卡的平卡、异画、超编、签名超编分开记;简中与英文分开记 |
| 录入 | 逐张点选加减;**不做**粘贴/CSV/扫码批量导入 |
| 展示 | 参考卡牌查询页(`#/cards`)的做法:搜索、分面筛选、卡图墙、弹层详情 |
| 联动 | 四项全要:卡池显示「持有 N」、`只看我有的` 开关、缺卡清单、卡组完成度 |
| 页首统计 | 不要。工具条只报「N 项」,不出现总额、估值、收集率 |
| 默认视图 | 「我有的」,并记住用户切换过的视图与排序 |
| 数量上限 | 999;减到 0 = 删除行,不留 0 值行 |

---

## 2. 云端表

[`supabase/web-collection.sql`](../supabase/web-collection.sql) 在 Supabase SQL Editor 执行一次即可(可重复执行)。
一行 = 一个账号的一张印本:

| 列 | 说明 |
|---|---|
| `owner_id` | `auth.users(id)` 外键,`on delete cascade` |
| `card_no` | **印本号**(`card_prints.card_no_extend`),如 `VEN-188`、`UNL-233*`、`OGN-089a` |
| `language` | `SC` / `EN`(表里目前只有这两种) |
| `quantity` | 1–999,`check` 约束 |
| `created_at` / `updated_at` | 时间戳;**表上没有触发器**,由前端写入时带上 |

- 唯一索引 `(owner_id, card_no, language)`:同格只可能有一行
- 排序列 `(owner_id, updated_at desc, id)`,分页读用 `card_no.asc,language.asc,id.asc` 保证唯一
- RLS 四条策略与 `web_decks` 同款:`owner_id = (select auth.uid())` 且 `app_metadata.role = 'admin'`

---

## 3. 页面

### 桌面

```
┌ 报头(刊名/栏目菜单) ────────────────────────── 卡池工具 ─┐
│                                         云端已同步 04:21  ⟳  ⤓ 导出 CSV │
├──────────────────────────────────────────────────────────┤
│ 🔍 搜索卡名 / 副标题 / 印本号 / 系列     12,438 项        │
│ [ 我有的 | 全部卡 ]        [排序 ▾] [筛选 ③]              │
│ 语言:简中 ×   系列:OGN ×                      清空        │
├──────────────────────────────────┬───────────────────────┤
│  ▢▢▢ ▢▢▢ ▢▢▢ ▢▢▢ ▢▢▢ ▢▢▢        │ 语言  简中 英文        │
│  ▢▢▢ ▢▢▢ ▢▢▢ ▢▢▢ ▢▢▢ ▢▢▢        │ 版本  平卡 异画 …      │
│  (卡图 + 名称 + 印本号·语言·版本   │ 系列  类别  颜色       │
│   + −  N  + 步进条)              │ 稀有度 地区 标签 关键词 │
│  ⋯ 已经到底                       │ (吸顶,内滚动)          │
└──────────────────────────────────┴───────────────────────┘
```

- 工具条吸顶,背景是半透明纸色 + `blur(10px)`,底边一道发丝行线;控件高 38px
- 分段按钮选中态是朱砂实底 + 米白字;筛选按钮右上角 17px 朱砂圆点显示启用条数
- 卡格:1px 边、圆角 10px、卡面底色;悬停上移 2px。卡图下方两行字 —— 名称 12px、`印本号 · 简中 · 异画` 10px
- 步进条 28px 高,`−` / 数字 / `＋` 三栏;持有数 > 0 时数字为朱砂 600,未持有为弱字 400
- 未持有的卡图降饱和(`grayscale(.6) opacity(.55)`),不做额外徽章
- 网格 `repeat(auto-fill, minmax(118px,1fr))`,间距 22×14;≥1500px 放宽到 138px;≤600px 两列
- 无限滚动每次 48 张,距底 500px 开始加载;点卡图开详情弹层(不显示「标记」按钮),点 `−/＋` 不冒泡

### 手机(≤1023px)

单列;工具条两行(搜索一行、分段 + 排序 + 筛选一行);筛选变全屏抽屉,底部主按钮「查看 N 项」;网格两列、步进条 32px;无横向滚动。

### 状态

| 状态 | 呈现 |
|---|---|
| 读取中 | 居中转圈 +「正在读取卡池…」 |
| 空 | 「卡池还是空的。」+[切到全部卡] |
| 筛空 | 「没有符合条件的印本。」+[清空筛选] |
| 出错 | 朱砂边框 + 原因 + [重试] |
| 缺表 | 「云端表还没建。请先在 Supabase SQL Editor 执行 `supabase/web-collection.sql`。」 |
| 未登录 | 「卡池门禁」:沿用编务门禁表单,换标题与说明 |

---

## 4. 记账与同步

1. 点 `＋/−` 先改本机(map 与界面立即变),同一格 300ms 内连点合并
2. 合并后串行上送:`quantity ≥ 1` 用 upsert(`on_conflict=owner_id,card_no,language`),减到 0 用 `DELETE`,两者都带 `owner_id`
3. 成功 → 工具条右侧「云端已同步 HH:mm」;失败 → 该格描朱砂细边、工具条下弹 32px 提示条「N 项未保存 · 重试」
4. 未保存项连同整份卡池写入 `rune.collection.v1`;下次打开先画本机缓存,再拉云端全表,未保存项覆盖云端值并继续重试
5. 有未保存项时关闭页面会弹浏览器确认
6. 云端写失败会按错误码翻译:权限、缺表、约束冲突各有中文说明

---

## 5. 构筑联动

只在管理员登录后出现;其他账号看到的行为与改动前完全一致。

| 位置 | 内容 |
|---|---|
| 构筑页卡池卡 | 左上角「持 N」小徽章;持有 0 的卡图降饱和 |
| 构筑页筛选条 | 多一个勾选「只看我有的」 |
| 构筑页侧栏底部 | 「缺卡清单 · N 张」折叠块:`需 3 · 持 1 · 缺 2`,同卡同语言别的印版有货时补一句「另有 N 张」;点行跳到对应分区条目;可一键复制清单 |
| 构筑工具条 | `save-status` 旁「持有 32 / 40」 |
| 卡组库卡片 | 底部元信息多一段「持有 32 / 40」 |
| 卡组详情页 | 左栏「共 40 张」旁同款完成度 |

缺卡**按印版精确算**:构筑里指定 `VEN-188 / SC`,只认这一格的存量;`VEN-188*` 的存量不算,但会作为「另有 N 张」提示。

---

## 6. 代码落点

新增:

| 文件 | 职责 |
|---|---|
| `supabase/web-collection.sql` | 建表、索引、RLS |
| `src/tools/collection/model.ts` | 集合 key、数量夹取、持有索引、版本词、缺卡计算 |
| `src/tools/collection/api.ts` | 云端读写、身份校验、错误翻译、upsert 回退 |
| `src/tools/collection/storage.ts` | 本机缓存 + UI 偏好 |
| `src/tools/collection/query.ts` | 印本成格、语言/版本/持有过滤、四种排序、分面 |
| `src/tools/collection/useCollection.ts` | 乐观记账、合并、串行同步、重试 |
| `src/tools/collection/useHeld.ts` | 只读持有量(构筑页/详情页) |
| `src/components/collection/CollectionTile.vue` | 卡格 + 步进条 |
| `src/components/collection/CollectionFilters.vue` | 筛选面板 |
| `src/components/view/CollectionView.vue` | 页面 |
| `scripts/verify-collection.mjs` | 纯逻辑回归 |
| `scripts/verify-collection-ui.mjs` | 浏览器验收(REST 夹具) |

改动:

- `src/components/carddex/query.ts`:新增 `buildPrintCards`(每个印本单独一格,不合并语言)
- `src/components/carddex/CardDetailModal.vue`:新增 `showPin`(默认 `true`),卡池页传 `false`
- `src/components/admin/EditorialGate.vue`:标题/说明/按钮文案可配置,默认值不变
- `src/tools/catalog.ts`:登记 `collection`;栏目菜单的登录过滤改为「只隐藏需登录的项,整组都需登录时才收敛到栏目首页」
- `src/components/view/index.ts`、`src/App.vue`:路由映射与整宽布局分支
- `src/components/view/DeckBuilderView.vue`、`DeckDetailView.vue`:四项联动
- `scripts/verify-section-menu.mjs`、`package.json`、`README.md`

---

## 7. 验证

```bash
npm run verify:collection      # 逻辑:key、夹取、快照、索引、缺卡、真实卡表通路
npm run verify:section-menu    # 栏目菜单:访客 7 项、管理员 8 项、返回目标
npm run build                  # 类型检查 + 构建
npm run verify:collection-ui   # 浏览器:门禁/记账/同步/记忆/手机/联动,截图 shots/collection/
```

浏览器验收要能启动无头 Chrome 并允许它导航到本地 http 页面;禁止联网导航的沙箱里只看逻辑与构建结果。

## 8. 取舍

- **不做批量导入**:用户明确要逐张点选;`card_no` 校验依赖卡表,批量输入容易造出脏行
- **不做统计**:页首只报条目数,避免把台账变成收集率看板
- **印本号大小写统一**:`collectionKey` 对卡号 `trim().toUpperCase()`,因为 PostgREST 的唯一索引区分大小写,而云端行可能来自不同入口
- **不建 updated_at 触发器**:与 `web_decks` 的差异是有意保留的(表由用户建,前端写时间戳);读取只依赖数量,冲突用最后一次写入覆盖
- **导出 CSV 纯前端**:报头一个按钮,六列(卡号/语言/版本/名称/系列/持有数),BOM + 引号转义,不经过服务器
