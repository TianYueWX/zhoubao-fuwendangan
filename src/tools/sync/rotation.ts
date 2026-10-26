/**
 * 卡图展示角度的唯一计算入口（同步落库用）。
 *
 * 战场（含 `战场指示物` / `指示物战场`）的官方卡图和普通卡同画布：都是
 * 竖版 744×1040，横图是画在竖版画布里的。因此印刷版本落库时直接把展示
 * 角度写成 -90，前端（CarddexImage）按 |deg| % 180 === 90 切成横框。
 *
 * 为什么不按语言分支：官网各语言用的是同一批原图，竖版画布一致；
 * 若只给 SC 写 -90，EN/TC/KR 的战场印刷版本会因为库里是 0 而显示成正立，
 * 比现在的行为更差。确认某语言的原图已是横版时，把它从
 * ROTATED_LANGUAGES 里移除即可（其余逻辑不动）。
 */
export const BATTLEFIELD_DEG = -90

export const ROTATED_LANGUAGES: ReadonlySet<string> = new Set([
  'SC',
  'TC',
  'EN',
  'KR'
])

/** 类目里是否含战场语义（容忍 `战场指示物` / `指示物战场` 两种写法）。 */
export function isBattlefieldCategory(
  categories: readonly string[] | null | undefined
): boolean {
  return (categories ?? []).some((c) => c.includes('战场'))
}

/**
 * 新建印刷版本时的默认展示角度。
 * 已存在的行不会被同步覆盖：策展人在后台改成 0/90/180 的取值优先。
 */
export function rotationFor(
  language: string | null | undefined,
  categories: readonly string[] | null | undefined
): number {
  if (!isBattlefieldCategory(categories)) return 0
  return ROTATED_LANGUAGES.has(String(language ?? '').toUpperCase())
    ? BATTLEFIELD_DEG
    : 0
}
