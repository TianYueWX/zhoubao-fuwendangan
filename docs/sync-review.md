# 同步审核

同步入口保留快速／深度拉取、批量操作和导出，并支持逐条编辑。

## 身份与字段

- 印刷版本按规范化编号＋语言匹配：`ARC·001a·SC` → `ARC-001a` / `SC`。保留字母版本后缀，不按前七位截断。
- 基础卡按中文名字＋副标题匹配，去掉首尾空白；空字符串和空副标题视为同一身份。
- 多个基础卡匹配时必须手选；同名多印刷只生成一个新基础卡草稿。
- 已有基础卡仅允许 API `errata` 非空时更新 `effect_cn`，详情中的装配效果保留；不同勘误来源须手选。
- `back_image` 不展示、不比较、不写入。新增使用数据库默认值。
- `is_banned`、英文列、keyword、advanced_tag、deck_limit、tts_cdn、print_order、is_default 不自动同步。
  （英文列可通过下方「官网卡表」面板单独同步，见后文。）

| API | cards_base（仅新增；effect_cn 可勘误更新） |
| --- | --- |
| cardName / subTitle | card_name_cn / sub_title_cn |
| cardNo 基础编号候选 | card_no |
| errata 优先，否则 cardEffect；附加 attachEffect | effect_cn |
| cardColorList / region / tag | card_color_list / region / tag |
| hero | champion_tag |
| energy / returnEnergy / power | energy / return_energy / power |
| rarityName / cardSeries / cardCategoryNameList | rarity_name / series_name / card_category |
| flavorText | flavor_text_cn |

| API / 匹配结果 | card_prints |
| --- | --- |
| cardNo 编号与语言 | card_no_extend / language |
| 名字＋副标题所匹配或手选的基础卡 | card_id |
| rarityName / extendRarityName | rarity_name / extend_rarity_name |
| 对应列表版本的 frontImage | img_cdn |
| artist / cardSeries / flavorText | artist / series / flavor_text_cn |
| 编号促销标记 | is_promo |

列表每行是一种印刷版本，不能用详情的 `craftList[0]` 替代该版本的图片。快速模式对新增基础卡和勘误卡补拉详情，避免丢失装配效果。勘误详情不使用旧缓存。

## 官网卡表（playriftbound.com）

同步页另有独立面板，直接读取 Riot 官网卡表接口：

- 上游：`content.publishing.riotgames.com/.../list/riftbound_gallery_{sets,cards}`，公开可访问，但 CORS 只放行 playriftbound.com，浏览器一律经同源函数 `/api/riftbound/gallery/*` 转发（Cloudflare Pages Function + Vite dev 代理）。
- 语言选择器列出官网全部 9 个语区，实测只有 4 个有卡牌级本地化：

| 语区 | 文本 | 卡图 | 写库目标 |
| --- | --- | --- | --- |
| en-us | 全部英文 | 英文卡图 | `card_name_en` / `sub_title_en` / `effect_en` + `card_prints` language=EN |
| zh-cn | 全部中文（约 15% 未翻译） | 中文卡图 | `card_name_cn` / `sub_title_cn` / `effect_cn`（`{{标记}}`）+ language=SC |
| ko-kr | 仅 OGN+OGS 共 376 张 | 375 张独立韩版图 | `card_name_kr` / `sub_title_kr` / `effect_kr` + language=KR |
| zh-tw | 仅 OGN+OGS 共 376 张 | 352 张独立繁中图 | `card_name_tw` / `sub_title_tw` / `effect_tw` + language=TC |
| fr/es/de/it/ja | 无（英文回退） | 同英文 | 只读预览，禁止提交/导出 |

- 系列选择：列表来自官网 sets 接口（打开面板 / 切换语言时自动刷新，另有「刷新系列」按钮），新系列会自动出现，「全部」默认包含；列表没更新或拉取失败时可直接手输代码（如 `VEN、SFD`），手输优先于勾选。列表接口忽略 set 过滤参数，先拉全量再本地筛选。
- 副标题：优先官方 `subtitle` 字段；为空且名字含 `,`/`，` 时按逗号拆分（如 `Heisho, Shell of the World`、`艾蕾，头号拥趸`）。
- 效果文本：英文保留原始 HTML；中文/韩文/繁中转成 `纯文本 + {{标记}}`（`:rb_might:`→`{{S}}`、`:rb_energy_8:`→`{{8}}`、`:rb_rune_rainbow:`→`{{A}}`、`[急速]`→`{{急速}}` 等）；未识别标记会在审核行标注，不静默写入。
- 未翻译条目：文本置空、标记「未翻译」，绝不把英文回退写进译文列；卡图印刷仍可同步。
- 稀有度：common/uncommon/rare/epic/showcase → 普通/不凡/稀有/史诗/异画；编号超过系列上限 → 超编，带 `*` → 签名超编。
- 基础卡按 `card_no` 唯一匹配；`*`/SP/超编号印刷（如 `SFD-227*` → `OGN-119`）用 accessibilityText 里的英文名＋副标题回找原作基础卡，多个候选必须手选。
- 允许新建只带目标语言文本的基础卡（英文卡可仅有 `card_name_en`）；库内已有卡只更新目标语言列，不覆盖其他语言。
- 韩/繁中列迁移：先执行 `supabase/migrations/20260926_add_kr_tw_columns.sql`；未执行时面板自动降级——韩/繁中文本不可提交，卡图印刷照常。
- 已知限制：新增「仅韩文/仅英文」基础卡后，小程序源按中文名匹配不到它，可能提示编号被占用，需要人工在卡牌编辑器补中文列；官网无 flavor text、无背面图、无印刷顺序。

## 提交和导出

1. 打开任意记录，查看库内值、API 映射值和可编辑的待提交值。
2. 更新字段默认全部不勾选；单条提交、批量提交、SQL 和 CSV 都只使用勾选后的补丁。
3. 缺少基础卡时，先点击创建基础卡，再返回印刷版本单独提交。缺少系列时先提交系列阶段。
4. 批量只处理当前阶段已包含且可提交的记录；筛选不隐式改变批量范围，可以清空选择并包含当前筛选结果。
5. 提交失败保留编辑和字段选择。批量遇到失败停止，已成功的记录保留，重试不会重交成功记录。
6. 重读数据库保留编辑值，但清空更新字段勾选，要求重新审核最新值。
7. SQL 按阶段导出，并按发布勾选状态触碰该阶段的版本标记；新基础卡尚未落库时，不导出依赖它的印刷版本。基础卡 SQL 执行后重读，再导出印刷阶段。
8. CSV 分为新增文件和 `update-patches` 文件；后者按 `table,id,attribute,value_json` 保存补丁，不能当整行 CSV 导入。
9. 站点快照仍是独立的全库原始数据导出，保留站点需要的全部字段。官网面板与小程序面板共用同一套字段白名单与导出校验。

写入使用 INSERT 或按 ID 的 PATCH，不使用整行 upsert；提交前检查重复身份和所选字段的新值，PATCH 在可用时携带时间戳条件。失败/零行返回不会报成功。小程序流程没有数据库结构改动；官网面板的韩/繁中列是可选迁移（`supabase/migrations/20260926_add_kr_tw_columns.sql`），未执行时自动降级为仅同步卡图。

## 性能

审核状态最初按「每条记录 × 全库」匹配，整库规模下每次点击都会重算全部差异，导致界面卡顿（1500 个印刷版本时打开编辑面板约 16 秒、勾选字段约 35 秒）。现在：

- `reviewIndex.ts` 在快照或身份字段变化时建立查找表，`reviewState`／`buildOperation` 的每个匹配都变成 O(1)。不传索引仍走原来的全量扫描，便于对照。
- 草稿冲突改用 `baseCounts`／`printCounts` 计数，去掉了逐行 `rows.some`。
- 阶段角标与「缺失系列」提示改为 computed，不再在模板里对全表反复求值。
- `createReview` 的印刷→基础卡回退查找改为按编号索引，去掉了 1500 × 900 次比较。
- 索引键必须与匹配规则一致：库内印刷按规范化编号，草稿印刷按**原始**编号。测试同时断言「索引与扫描结果完全一致」和「索引被清空后结论必须变化」，避免索引被绕过却仍然通过。

## 验证

```sh
npm run verify:sync-review
npm run verify:gallery-sync
npm run verify:admin-sync
npm run build
# 另一个终端启动 npm run dev
SYNC_REVIEW_URL=http://localhost:5173 node scripts/verify-sync-review-ui.mjs
# 整库规模性能门槛（1500 个印刷版本，单次交互必须 < 500 ms）
SYNC_REVIEW_URL=http://localhost:5173 npm run verify:sync-review-perf
```

浏览器检查使用模拟外部 API，不写入真实数据库。覆盖逐字段提交、歧义关联、分步新增、超过 200 条的分页、导出和失败后保留编辑。

注：`verify-editorial.mjs` 需要 `npm run build` 后另开 `npx vite preview --port 4173`。其中访客态／刊名按钮等 8 项失败在本次同步功能改动之前就已存在（与 src 下的公开外壳无关），不计入本功能回归。
