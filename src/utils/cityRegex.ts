/* ================================================================
 * src/utils/cityRegex.ts
 *
 * 城市提取容错链:
 *  1) 主正则【xxx】yy站-8.23 → yy
 *  2) 次正则任意 '<2-8 字>站' / '分站' / '赛区'
 *  3) Province fallback: '广东省' / '上海市' / '新疆维吾尔自治区' 等去掉后缀
 *  4) 全部失败 → '未知'
 * ============================================================== */

/** 城市提取结果兜底字符串 */
export const UNKNOWN_CITY = '未知';

/* ============================================================
 * 正则分层(由具体到宽松)
 * ============================================================ */

/**
 * 主匹配:【xxx】yy站-8.23 或 【xxx】yy分站 / 赛区
 *   - 捕获组 1 是站名前的"城市 + 站"
 *   - 容许"站"后跟随 '-数字日期'、'·'、' ' 等终止符
 */
const PRIMARY = /【[^】]*】\s*(.+?)(?:站|分站|赛区)(?:[-·\s]|$)/;

/**
 * 次匹配:任意位置出现的 "<2-8 字>站" / "...分站" / "...赛区"
 */
const SECONDARY = /([一-龥·A-Za-z\d]{2,8})(?:站\b|分站\b|赛区\b)/;

/* ============================================================
 * Province 后缀剥离
 * ============================================================ */

/** 省级行政区后缀 */
const PROVINCE_SUFFIX_PATTERN =
  /(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/;

/** 直辖市也用相同的"市"剥离;最终清洗 */
const CITY_SUFFIX_PATTERN = /市$/;

/* ============================================================
 * 工具函数
 * ============================================================ */

function trimEndDigits(s: string): string {
  return s.replace(/\d+$/u, '').trim();
}

function looksLikeCity(s: string): boolean {
  // 2-8 个中文字符或含 '·' 的复合名(如 '锡林郭勒'),容许英文地名
  return /^[一-龥·A-Za-z]{2,8}$/u.test(s);
}

/**
 * 从赛事名称中提取城市名;识别失败返回 null。
 *
 * 例:
 *   '【城市挑战赛】深圳站-8.23' → '深圳'
 *   '石家庄站公开赛 8-9 月' → '石家庄'
 *   '武汉分站赛' → '武汉'
 *   '西部赛区' → '西部'           ← 可疑匹配,业务场景由上层再用 MappingPanel 修正
 *   '【xx】 上海 站' → '上海'
 */
export function extractCityFromActivityName(
  name: string | null | undefined
): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  // 主匹配
  const m1 = trimmed.match(PRIMARY);
  if (m1 && m1[1]) {
    const cleaned = cleanCandidate(m1[1]);
    if (cleaned) return cleaned;
  }

  // 次匹配
  const m2 = trimmed.match(SECONDARY);
  if (m2 && m2[1]) {
    const cleaned = cleanCandidate(m2[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

/**
 * 从 shopProvince 原值回退提取城市。
 *
 * 例:
 *   '广东省' → '广东'
 *   '上海市' → '上海'
 *   '新疆维吾尔自治区' → '新疆'
 *   '北京市' → '北京'
 *   '内蒙古自治区' → '内蒙古'
 *   'China' → null
 */
export function extractCityFromProvince(
  province: string | null | undefined
): string | null {
  if (!province) return null;
  const trimmed = province.trim();
  if (!trimmed) return null;

  let s = trimmed.replace(PROVINCE_SUFFIX_PATTERN, '').trim();
  s = s.replace(CITY_SUFFIX_PATTERN, '').trim();
  s = trimEndDigits(s);

  if (!looksLikeCity(s)) return null;
  return s;
}

/**
 * 把"深圳站" / "深圳分站" / "深圳市" 等候选字段规整为标准城市名。
 */
function cleanCandidate(raw: string): string | null {
  let s = raw.trim();
  // 去掉尾部"市"
  s = s.replace(CITY_SUFFIX_PATTERN, '').trim();
  // 去掉尾部"分站/赛区"误吞
  s = s.replace(/(分站|赛区|站)$/u, '').trim();
  // 去掉尾部纯数字
  s = trimEndDigits(s);

  if (!looksLikeCity(s)) return null;
  return s;
}

/**
 * 一站式"提取或兜底"接口:返回标准城市名或 '未知'。
 * 优先级:override > shopCity(shop_data 精确城市)> 赛事名正则 > 省份回退。
 */
export function resolveCity(args: {
  activityName?: string | null;
  province?: string | null;
  override?: string | null;
  shopCity?: string | null;
}): string {
  if (args.override && args.override.trim()) return args.override.trim();
  if (args.shopCity && args.shopCity.trim()) {
    const cleaned = cleanCandidate(args.shopCity);
    if (cleaned) return cleaned;
    return args.shopCity.trim();
  }
  return (
    extractCityFromActivityName(args.activityName) ??
    extractCityFromProvince(args.province) ??
    UNKNOWN_CITY
  );
}

/** 中文常见大城市列表(用于 MappingPanel 下拉候选,可被业务调整) */
export const SUGGESTED_CITIES: readonly string[] = [
  '北京', '上海', '广州', '深圳', '成都', '杭州', '重庆', '西安',
  '苏州', '南京', '武汉', '天津', '长沙', '郑州', '青岛', '济南',
  '沈阳', '大连', '哈尔滨', '长春', '福州', '厦门', '昆明', '合肥',
  '宁波', '无锡', '佛山', '东莞', '珠海', '南宁', '贵阳', '太原',
  '石家庄', '南昌', '兰州', '海口', '呼和浩特', '乌鲁木齐', '西宁',
  '银川', '温州', '绍兴', '常州', '南通', '烟台', '泉州', '徐州',
  '潍坊', '唐山', '保定', '邯郸', '临沂', '盐城', '扬州'
];
