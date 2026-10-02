# 卡牌查询(carddex)滚动契约

> 依据**真实浏览器实测**(无头 Chromium 1680×1050 / 390×844 + 线上真实卡表 1775 张基础卡 / 2545 个印本)。
> 改动前 carddex 是全站唯一自建高度链的视图,滚动行为与其余 12 个视图不一致,这里把它固定下来。

---

## 0. 一句话结论

**carddex 和其他视图一样由 window 滚动**;搜索栏与筛选栏各自 `position: sticky` 吸附在报头下沿,筛选栏保留自身内滚动。

---

## 1. 改造前后

| | 改造前 | 改造后 |
|---|---|---|
| 谁在滚 | `.results-scroll` 内层容器 | window(文档流) |
| 文档高度 | 恒等于一屏(`h-screen overflow-hidden`) | 等于内容高度(实测可达 11850px) |
| 滚动条 | 2 条并列:卡片列 + 筛选栏 | 1 条窗口滚动条 + 筛选栏的局部滚动 |
| 滚动条落点 | 卡片列右缘(1920 屏距窗口右缘约 574px) | 浏览器最右侧 |
| 无限滚动 root | `resultsScroll` 元素 | `null`(视口) |
| 回到顶部 | 页内 `.inside-top` | 全局 FAB(`App.vue`) |
| 移动端 | 地址栏不收、无原生回弹 | 原生地址栏收起 / 回弹 / 前进后退恢复位置 |

---

## 2. 三条容易踩空的规则

### 2.1 祖先不能有 `overflow`

`overflow: hidden` 会变成 sticky 的包含块,**后代的 `position: sticky` 直接失效**。
所以 `App.vue` 的根节点与 `main` 都不再加 `overflow-hidden`(`isCarddex` 分支已删)。新增包裹层时同理。

### 2.2 吸顶基准必须实测,不能写死

报头是 sticky 的 56px 主条 + 48px 栏目条,但**栏目条按栏目与权限显隐**——
实测 `#/carddex` 下栏目条不渲染,报头只有 **57px**;写死 104px 会露出 47px 的缝。

因此 `CarddexView.vue` 用 `ResizeObserver` 量 `header.masthead-solid` 的真实高度,
注入 CSS 变量 `--carddex-top`,`.search-tools` 与 `.desktop-filter` 都用它做 `top`。
CSS 里的 `--carddex-top: 104px` 只是 JS 就位前的兜底值。

### 2.3 吸顶元素必须自带不透明底

搜索栏用 `--color-header-bg` + `backdrop-filter: blur(10px)`(与报头同款),
并把 12px 底边留白一并纳入 padding,**否则卡片会从吸顶栏与内容之间的缝隙里露出来**。

---

## 3. 实测数据(1680×1050)

| 指标 | 值 |
|---|---|
| 报头高度 | 57px |
| 卡片列 | 7 列(`minmax(138px, 1fr)`,≥1500px 断点) |
| 行距 | 约 264px |
| 渲染 315 张时的文档高度 | 11850px ≈ 11 屏 |
| 全量 1040 张的推算高度 | 约 3.9 万 px ≈ 2.4 倍 Chrome 整页截图上限(16384px) |

**长截图含义**:整页截图(`captureBeyondViewport` /「捕获完整尺寸屏幕截图」)只认
`document.scrollingElement.scrollHeight`,不认内层滚动容器。改造前文档恒为一屏,
长截图退化成普通截图;改造后能拍到底,但全量结果仍超 16384px 上限,需要分片渲染。

---

## 4. 验收

```powershell
# 卡表走 PostgREST,dist/ 必须是带 Supabase 配置的构建
$env:VITE_SUPABASE_URL="https://<ref>.supabase.co"
$env:VITE_SUPABASE_ANON_KEY="<anon key>"
npm run build:fast
npm run verify:carddex-scroll
```

`scripts/verify-carddex-scroll.mjs` 自带静态服务与 CDP 驱动,覆盖 22 项:
架构(文档可滚 / 无内层裁剪)、吸顶(搜索栏与筛选栏贴报头下沿 / 卡片从下面滚过)、
单滚动条、视口增量加载、全局 FAB 唯一、弹层冻结滚动且位置不丢、
长图上限、移动端无横向溢出。截图落在 `shots/carddex-scroll/`(已忽略)。

未配置 Supabase 时脚本会如实报「卡牌未载入」并失败,不会假过。
