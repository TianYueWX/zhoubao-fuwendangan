# 同步审核

同步入口保留快速／深度拉取、批量操作和导出，并支持逐条编辑。

## 身份与字段

- 印刷版本按规范化编号＋语言匹配：`ARC·001a·SC` → `ARC-001a` / `SC`。保留字母版本后缀，不按前七位截断。
- 基础卡按中文名字＋副标题匹配，去掉首尾空白；空字符串和空副标题视为同一身份。
- 多个基础卡匹配时必须手选；同名多印刷只生成一个新基础卡草稿。
- 已有基础卡仅允许 API `errata` 非空时更新 `effect_cn`，详情中的装配效果保留；不同勘误来源须手选。
- `back_image` 不展示、不比较、不写入。新增使用数据库默认值。
- `is_banned`、英文列、keyword、advanced_tag、deck_limit、tts_cdn、print_order、is_default 不自动同步。

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

## 提交和导出

1. 打开任意记录，查看库内值、API 映射值和可编辑的待提交值。
2. 更新字段默认全部不勾选；单条提交、批量提交、SQL 和 CSV 都只使用勾选后的补丁。
3. 缺少基础卡时，先点击创建基础卡，再返回印刷版本单独提交。缺少系列时先提交系列阶段。
4. 批量只处理当前阶段已包含且可提交的记录；筛选不隐式改变批量范围，可以清空选择并包含当前筛选结果。
5. 提交失败保留编辑和字段选择。批量遇到失败停止，已成功的记录保留，重试不会重交成功记录。
6. 重读数据库保留编辑值，但清空更新字段勾选，要求重新审核最新值。
7. SQL 按阶段导出，并按发布勾选状态触碰该阶段的版本标记；新基础卡尚未落库时，不导出依赖它的印刷版本。基础卡 SQL 执行后重读，再导出印刷阶段。
8. CSV 分为新增文件和 `update-patches` 文件；后者按 `table,id,attribute,value_json` 保存补丁，不能当整行 CSV 导入。
9. 站点快照仍是独立的全库原始数据导出，保留站点需要的全部字段。

写入使用 INSERT 或按 ID 的 PATCH，不使用整行 upsert；提交前检查重复身份和所选字段的新值，PATCH 在可用时携带时间戳条件。失败/零行返回不会报成功。没有数据库结构改动。

## 验证

```sh
npm run verify:sync-review
npm run verify:admin-sync
npm run build
# 另一个终端启动 npm run dev -- --host 127.0.0.1
node scripts/verify-sync-review-ui.mjs
```

浏览器检查使用模拟外部 API，不写入真实数据库。覆盖逐字段提交、歧义关联、分步新增、超过 200 条的分页、导出和失败后保留编辑。
