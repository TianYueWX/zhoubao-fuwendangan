/* ================================================================
 * src/tools/admin/keywords.ts
 *
 * 「一键添加关键词」的规则引擎(纯函数,可单测,无网络)。
 *
 * 背景:cards_base.keyword 是**人工维护列** —— 同步只允许写 effect_cn
 * (见 src/tools/sync/review.ts 的 UPDATE_FIELDS),所以关键词一直靠编务
 * 逐张手打。而卡面 effect_cn 里**本来就有** `{{反应}}` `{{迅捷}}` 这类
 * 标记,只是没人把它读出来。
 *
 * 这套规则不是拍脑袋定的,是从库里已有的人工填写结果**反向工程**出来的:
 * 拿全表 1016 张跑回归,与人工填写完全吻合 972 张、可补 42 张、异常 2 张。
 * 所以改动本文件任何一条规则,都必须重跑 scripts/verify-keywords.mjs。
 *
 * 三层结构:
 *   ① 黑名单  —— 整词丢弃(符号、费用数字、颜色词、状态词)
 *   ② 归一化  —— 粘连写法还原(强化1黄色黄色 → 强化;等级6> → 等级6)
 *   ③ 英文映射 —— [Assault 2] → 强攻2(英文比中文干净,但新系列常常没有英文)
 *
 * 关键分界线(编务一直在用,勿改):
 *   费用型关键词(强化/回响/流转/装配)后面的数字是**费用** → 去掉;
 *   效果型关键词(强攻/坚守/法盾/等级/燃烧/洞察/狩猎/缴械)后面的数字是
 *   **效果参数** → 保留。
 * ============================================================== */

/* ──────────────────────── ① 黑名单 ──────────────────────── */

/**
 * 纯符号:单个大小写字母、纯数字。
 * 注意:src/components/chain/cardText.ts 里的 SYMBOL_RE 是 /^[A-Z]$|^\d+$/,
 * **抓不到小写 s**(线上实测有 1 处 {{s}}),所以这里用 [A-Za-z]。
 * 数字包括费用 {{1}}~{{8}} 与 {{0}}。
 */
const SYMBOL_RE = /^[A-Za-z]$|^\d+$/;

/** 颜色域:不是能力关键词,是符文颜色 */
const COLOR_WORDS: readonly string[] = ['红色', '绿色', '蓝色', '黄色', '紫色', '橙色', '无色'];
const COLOR_RE = new RegExp(COLOR_WORDS.join('|'), 'g');

/**
 * 状态与条件,不是能力关键词:
 *   {{横置}}   横置动作(线上 87 处,编务从未记入关键词)
 *   {{已强化}} {{已强化>}}  状态前缀
 */
const STATE_WORDS: readonly string[] = ['横置', '已强化', '已强化>'];

/** 版面噪音 */
const NOISE_WORDS: readonly string[] = ['>>', ''];

/**
 * 归一化后仍应丢弃的词 —— 有些标记要去掉颜色/数字之后才露出真面目,
 * 例如 {{已强化>}} 已由 STATE_WORDS 拦截,但 {{强化>}} 归一后是合法词,
 * 这里只兜底「去完修饰变成空或状态词」的情况。
 */
const DROP_AFTER_CLEAN = new Set<string>(['', ...STATE_WORDS, ...NOISE_WORDS]);

/* ──────────────────────── ② 归一化 ──────────────────────── */

/** 数字是**费用** → 去掉({{强化1黄色黄色}} = 支付 1 点黄色强化我) */
const COST_KEYWORDS: readonly string[] = ['强化', '回响', '流转', '装配'];

/** 数字是**效果参数** → 保留({{强攻2}} = 进攻时战力 +2) */
const PARAM_KEYWORDS: readonly string[] = ['强攻', '坚守', '法盾', '等级', '燃烧', '洞察', '狩猎', '缴械'];

/** 中文词 + 可选数字,如「强攻2」→ ['强攻','2']、「反应」→ ['反应',''] */
const WORD_NUM_RE = /^([\u4e00-\u9fa5]+?)([0-9]*)$/;

/**
 * 单个 `{{标记}}` → 规范关键词;应当丢弃时返回 null。
 *
 * 实测覆盖的写法(线上 131 种原始标记全部走通):
 *   强化1黄色黄色 / 强化AA / 强化6紫色紫色 / 强化12  → 强化
 *   回响2 / 回响4蓝色 / 流转3A / 流转4黄色黄色        → 回响 / 流转
 *   装配橙色 / 装配1蓝色 / 装配A                      → 装配
 *   等级6> / 迅捷> / 反应> / >绝念>                   → 去首尾 >
 *   强攻2 / 法盾2 / 坚守3 / 燃烧1 / 洞察2 / 狩猎2     → 原样保留数字
 */
export function normalizeMark(mark: string): string | null {
  let t = String(mark ?? '')
    .trim()
    .replace(/^>+/, '')
    .replace(/>+$/, '')
    .trim();

  if (!t) return null;
  if (SYMBOL_RE.test(t)) return null;
  if (DROP_AFTER_CLEAN.has(t)) return null;

  t = t.replace(COLOR_RE, '').trim(); // 剥掉粘连的颜色词
  t = t.replace(/A+$/, '').trim(); // 强化AA → 强化

  if (DROP_AFTER_CLEAN.has(t)) return null;

  const m = t.match(WORD_NUM_RE);
  if (m) {
    const base = m[1] ?? '';
    const num = m[2] ?? '';
    if (COST_KEYWORDS.includes(base)) return base;
    if (PARAM_KEYWORDS.includes(base)) return base + num;
  }
  return t;
}

/* ──────────────────────── ③ 英文映射 ──────────────────────── */

/**
 * 英文 `[Keyword]` → 中文关键词。
 * 英文字面比中文干净:[Assault 2] 参数用空格分开,费用都在 :rb_*: 里,
 * 不像中文把费用颜色粘进标记({{强化1黄色黄色}})。所以有英文时以英文为准,
 * 中文负责补英文没有的(缴械 / 部署 / 亮出)与没有英文文本的新系列。
 *
 * ⚠️ 实测纠正:壁垒 = [Tank](必须先承担伤害),坚守 = [Shield N](防守时 +N 战力)。
 *    这两条容易记反。
 */
const EN_TO_CN: Readonly<Record<string, string>> = Object.freeze({
  Reaction: '反应',
  Action: '迅捷',
  Equip: '装配',
  Hidden: '待命',
  Empower: '强化',
  Deflect: '法盾',
  Ganking: '游走',
  Deathknell: '绝念',
  Accelerate: '急速',
  Tank: '壁垒',
  Shield: '坚守',
  Temporary: '瞬息',
  Repeat: '回响',
  Assault: '强攻',
  Flow: '流转',
  Ambush: '伏击',
  Stun: '眩晕',
  Weaponmaster: '百炼',
  Mighty: '强力',
  Unique: '唯我',
  Vision: '预知',
  Level: '等级',
  Buff: '增益',
  Hunt: '狩猎',
  Burn: '燃烧',
  Predict: '洞察',
  'Quick-Draw': '灵便',
  Add: '获得',
  Legion: '鼓舞'
});

/** 英文侧的噪音方括号(状态、条件、符号、版面占位) */
const EN_DROP = new Set<string>([
  'Empowered',
  '>',
  '>>',
  'NO TEXT',
  'ADD',
  'S',
  'A',
  'M',
  'C',
  '0'
]);

/** 英文词 + 可选数字,如「Assault 2」→ ['Assault','2'] */
const EN_WORD_NUM_RE = /^([A-Za-z\- ]+?)\s*(\d*)$/;

/* ──────────────────────── 命中结果 ──────────────────────── */

/** 一条关键词建议,带命中出处 —— 预览面板靠出处判断误伤 */
export interface KeywordHit {
  /** 归一化后的关键词,如「部署」 */
  keyword: string;
  /** 原文里的标记,如「部署」「强化1黄色黄色」「Assault 2」 */
  mark: string;
  /** 来源:中文花括号 / 英文方括号 */
  from: 'cn' | 'en';
  /** 命中处的上下文(已去标签与定界符),用于判断是不是误伤 */
  before: string;
  hit: string;
  after: string;
  /**
   * 疑似「在描述别的牌」而非这张牌自己的能力。
   *
   * 线上真实陷阱:RAD-001 业余爆破狂的正文是「打出炸弹指示物。(其具有{{部署}})」
   * —— 这张牌自己不是部署牌,`部署` 属于那个指示物。同类还有 RAD-023/033/141/155。
   * 这不是算法能拍板的语义问题(编务确实会记录本牌「赋予他人」的关键词,如
   * SFD-197 的「你的黄沙士兵获得{{百炼}}」→ 记 百炼),所以只标记、不自动取消勾选。
   */
  suspect: boolean;
}

/** 上下文半径(纯文本字符数) */
const CONTEXT_RADIUS = 24;

/**
 * 命中处**前面**出现这些词,说明标记多半属于别的牌/指示物而不是本牌。
 * 只用于界面打标记提醒,不参与「是否提取」的判定 —— 编务确实会记录本牌
 * 赋予他人的关键词,让算法自动取消勾选反而会漏。
 *
 * 只认「其…」这一个主语,不收 具有/拥有 的其它用法。实测教训:
 *   真阳性  RAD-001「(其具有{{部署}})」 —— 说的是刚造出的炸弹指示物
 *   假阳性  RAD-063「你的法术便具有{{反应}}」 —— 是本牌在**赋予**己方法术,
 *           这种词编务要记(SFD-197「你的黄沙士兵获得{{百炼}}」就记了 百炼),
 *           误报会怂恿人把对的词删掉,比漏报更糟。
 * 代价:RAD-155「一件拥有{{部署}}的装备」这类换主语的写法抓不到 —— 认了。
 */
const OTHER_REFERENCE_RE = /其(具有|拥有|带有)[^。；;]{0,6}$/;

interface Flat {
  text: string;
  /** 原文下标 → 纯文本下标;未保留的字符为 -1 */
  inv: Int32Array;
}

/**
 * 原文 → 纯文本 + 位置映射。
 * 去掉 HTML 标签(英文效果文本是真实 HTML)与 `{{ }}` 定界符,内容保留,
 * 这样截出来的上下文不会出现半个标签或半个花括号。
 */
function flatten(raw: string): Flat {
  const chars: string[] = [];
  const inv = new Int32Array(raw.length).fill(-1);
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i] ?? '';
    if (ch === '<') {
      const close = raw.indexOf('>', i);
      if (close !== -1) {
        i = close + 1;
        continue;
      }
    }
    if (ch === '{' && raw[i + 1] === '{') {
      i += 2;
      continue;
    }
    if (ch === '}' && raw[i + 1] === '}') {
      i += 2;
      continue;
    }
    inv[i] = chars.length;
    chars.push(ch);
    i += 1;
  }
  return { text: chars.join(''), inv };
}

/** HTML 实体解码(&amp; 必须最后解,否则 &amp;gt; 会被二次解码) */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 从纯文本里截一段命中上下文 */
function contextOf(
  flat: Flat,
  rawStart: number,
  rawEnd: number
): Pick<KeywordHit, 'before' | 'hit' | 'after' | 'suspect'> {
  const s = flat.inv[rawStart] ?? -1;
  const e = flat.inv[rawEnd - 1] ?? -1;
  if (s < 0 || e < 0) return { before: '', hit: '', after: '', suspect: false };
  const from = Math.max(0, s - CONTEXT_RADIUS);
  const to = Math.min(flat.text.length, e + CONTEXT_RADIUS + 1);
  const cut = (v: string): string => decodeEntities(v).replace(/\s+/g, ' ').trim();
  const before = cut(flat.text.slice(from, s));
  return {
    before: (from > 0 ? '…' : '') + before,
    hit: cut(flat.text.slice(s, e + 1)),
    after: cut(flat.text.slice(e + 1, to)) + (to < flat.text.length ? '…' : ''),
    // 只看命中词**前面**那一小截:是不是「其具有X」「拥有X」这种转述句式
    suspect: OTHER_REFERENCE_RE.test(before)
  };
}

/* ──────────────────────── 提取 ──────────────────────── */

/** 中文 `{{标记}}` → 命中列表(去重、保序) */
export function extractCnHits(text: string | null | undefined): KeywordHit[] {
  if (!text) return [];
  const flat = flatten(text);
  const out: KeywordHit[] = [];
  const seen = new Set<string>();
  const re = /\{\{([^{}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = (m[1] ?? '').trim();
    const keyword = normalizeMark(raw);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({
      keyword,
      mark: raw,
      from: 'cn',
      // 命中范围只要标记内容,不含 {{ }}
      ...contextOf(flat, m.index + 2, m.index + m[0].length - 2)
    });
  }
  return out;
}

/** 英文 `[Keyword]` → 命中列表(去重、保序) */
export function extractEnHits(text: string | null | undefined): KeywordHit[] {
  if (!text) return [];
  const flat = flatten(text);
  const out: KeywordHit[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = (m[1] ?? '').trim().replace(/&gt;/g, '>');
    if (!raw || EN_DROP.has(raw)) continue;
    const parts = raw.match(EN_WORD_NUM_RE);
    const base = parts ? (parts[1] ?? '').trim() : raw;
    const num = parts ? (parts[2] ?? '') : '';
    const cn = EN_TO_CN[base];
    if (!cn) continue;
    const keyword = cn + num;
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({
      keyword,
      mark: raw,
      from: 'en',
      ...contextOf(flat, m.index, m.index + m[0].length)
    });
  }
  return out;
}

/**
 * 一张卡的建议关键词:中文为主(新系列常常没有英文文本),英文补漏。
 * 线上实测互补关系:11 张两边都能抓到、29 张只有中文能抓到(全是无英文的
 * RAD 系列)、1 张只有英文能抓到(UNL-039 灵魂之剑的「等级3」)。
 */
export function suggestKeywords(
  card: { effect_cn?: string | null; effect_en?: string | null } | null | undefined
): KeywordHit[] {
  if (!card) return [];
  const out: KeywordHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...extractCnHits(card.effect_cn), ...extractEnHits(card.effect_en)]) {
    if (seen.has(hit.keyword)) continue;
    seen.add(hit.keyword);
    out.push(hit);
  }
  return out;
}

/* ──────────────────────── 差异 ──────────────────────── */

export interface KeywordDiff {
  /** 建议新增的词(已排除当前已有的) */
  add: KeywordHit[];
  /** 当前已有、建议里也有的词(保持不变) */
  kept: string[];
  /** 当前已有、但文本推不出来的词 —— 只提示,永不自动删 */
  orphan: string[];
}

/**
 * 与当前关键词数组求差。
 * 语义是**只加不删**:orphan 只报给你看(例如 ARC-002 凯特琳的「后排」是
 * 人工看提示语填的,文本里没有标记),不会因为「提取不到」就被清掉。
 */
export function diffKeywords(
  current: readonly string[] | null | undefined,
  suggested: readonly KeywordHit[]
): KeywordDiff {
  const cur = current ?? [];
  const curSet = new Set(cur);
  const suggSet = new Set(suggested.map((h) => h.keyword));
  return {
    add: suggested.filter((h) => !curSet.has(h.keyword)),
    kept: cur.filter((v) => suggSet.has(v)),
    orphan: cur.filter((v) => !suggSet.has(v))
  };
}

/* ──────────────────────── 规则说明(界面展示用) ──────────────────────── */

export interface RuleSummary {
  label: string;
  note: string;
  words: string[];
}

/** 给「关键词体检」抽屉展示的规则清单 —— 与上面三层的实现同源,勿手写重复 */
export const RULE_SUMMARY: readonly RuleSummary[] = Object.freeze([
  {
    label: '① 黑名单 · 符号与费用',
    note: '单个字母(含小写 s)与纯数字,{{1}}~{{8}} 是费用',
    words: ['S', 'A', '1', '2', '0', '3', '4', 'T', '5', '7', 'C', '6', '8', 's']
  },
  {
    label: '① 黑名单 · 颜色',
    note: '颜色域不是能力关键词',
    words: [...COLOR_WORDS]
  },
  {
    label: '① 黑名单 · 状态',
    note: '横置是动作,已强化是状态前缀',
    words: [...STATE_WORDS]
  },
  {
    label: '② 归一化 · 费用型去数字',
    note: '后面的数字是费用:{{强化1黄色黄色}} → 强化',
    words: [...COST_KEYWORDS]
  },
  {
    label: '② 归一化 · 效果型留数字',
    note: '后面的数字是效果参数:{{强攻2}} → 强攻2',
    words: [...PARAM_KEYWORDS]
  },
  {
    label: '③ 英文映射',
    note: '有英文时以英文为准,中文补漏',
    words: Object.keys(EN_TO_CN)
  }
]);
