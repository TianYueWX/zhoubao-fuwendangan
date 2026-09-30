/* ================================================================
 * src/tools/admin/printDefaults.ts
 *
 * 「重设默认印刷」的规划器(纯函数,可单测,无网络)。
 *
 * 规则:每张基础卡的印刷版本里,取 language='SC' 且 extend_rarity_name='平卡'
 * 的那一行,置 is_default=true。
 *
 * 为什么需要它:卡牌图鉴取图走 chooseDefaultPrint(),排序是
 * 「SC+默认 > SC > 默认 > 其他」,SC 之间再按卡号长度比。线上真实例子 ——
 * SFD-082 有 SFD-082b/异画、SFD-082/平卡、SFD-082a/异画、RAD-180/超编,
 * 没设默认时 SFD-082 与 RAD-180 长度打平,字典序 RAD-180 < SFD-082,
 * 图鉴就给这张卡显示超编版的图,而不是平卡。
 *
 * 语义:**只补缺失**。defs.length === 0 才写,绝不修改任何已有的 is_default。
 * 卡牌详情页有手动勾选 is_default 的入口,「以规则为准强制对齐」会把人工
 * 选择静默改回去 —— 与关键词那边定的「只加不删」是同一条原则。
 * ============================================================== */

/** 判定所需的印刷版本字段(card_prints 的子集) */
export interface PrintRow {
  id: string;
  card_id: string;
  card_no_extend: string | null;
  extend_rarity_name: string | null;
  language: string | null;
  is_default: boolean;
  print_order: number | null;
}

/** 判定所需的基础卡字段 */
export interface BaseCardRef {
  id: string;
  card_no: string | null;
}

/** 默认印刷版本必须同时满足这两个条件 */
export const DEFAULT_PRINT_LANGUAGE = 'SC';
export const DEFAULT_PRINT_RARITY = '平卡';

export type DefaultPlanKind =
  /** 这张卡一个默认都没有 → 要写入 */
  | 'set'
  /** 已经是正确的默认 → 不动 */
  | 'already'
  /** 没有 SC+平卡 候选 → 跳过,列出原因 */
  | 'no-candidate'
  /** 已有默认但不是(唯一的)SC+平卡 → 跳过。「只补缺失」不碰它,只报告 */
  | 'conflict';

export interface DefaultPlanItem<P extends PrintRow = PrintRow> {
  cardId: string;
  cardNo: string;
  kind: DefaultPlanKind;
  /** kind === 'set' 时要写入的那一行;其余情形为 null */
  target: P | null;
  /** 全部 SC+平卡 候选 */
  candidates: P[];
  /** 这张卡上已有的默认(可能是别的印刷版本) */
  existingDefaults: P[];
  /** 候选多于一个,已按「卡号与基础卡一致」取舍 */
  pickedFromMany: boolean;
  /** 一句话说明,直接显示给编务 */
  note: string;
}

export interface DefaultPlan<P extends PrintRow = PrintRow> {
  items: DefaultPlanItem<P>[];
  /** 需要写入的 */
  toWrite: DefaultPlanItem<P>[];
  /** 已正确,不动 */
  already: DefaultPlanItem<P>[];
  /** 跳过(无候选 / 冲突) */
  skipped: DefaultPlanItem<P>[];
  /** 参与判定的印刷版本行数(诊断用) */
  printCount: number;
}

function isCandidate(p: PrintRow): boolean {
  return p.language === DEFAULT_PRINT_LANGUAGE && p.extend_rarity_name === DEFAULT_PRINT_RARITY;
}

/**
 * 多个候选时的取舍。
 *
 *   ① 卡号与基础卡号**一致**的最优先 —— 线上真实例子:RAD-155 德玛西亚皇子
 *      有 RAD-155 与 RAD-176 两个 SC 平卡(不同画师),基础卡号是 RAD-155,
 *      取 RAD-155。旁证:RAD-141/RAD-147 的重印是 RAD-169/RAD-172 且被标成
 *      「超编」,而 RAD-176 被标成「平卡」,所以不能只靠「超编」二字分辨。
 *   ② 都不一致时,沿用图鉴 chooseDefaultPrint 的排序(卡号短的优先 → print_order
 *      大的优先 → 字典序)。这样「我们选的」与「图鉴本来会显示的」一致,
 *      设默认只改变是否强制,不引入新的偏好。
 */
function pickTarget<P extends PrintRow>(candidates: readonly P[], baseCardNo: string | null): P {
  const exact = candidates.find((p) => p.card_no_extend === baseCardNo);
  if (exact) return exact;
  const sorted = [...candidates].sort((a, b) => {
    const an = a.card_no_extend ?? '';
    const bn = b.card_no_extend ?? '';
    return (
      an.length - bn.length ||
      (b.print_order ?? 0) - (a.print_order ?? 0) ||
      an.localeCompare(bn, undefined, { numeric: true })
    );
  });
  // candidates 非空是调用前提;?? 只为满足类型收窄
  return sorted[0] ?? candidates[0]!;
}

/** 「语言/稀有度」组合的紧凑描述,用于说明为什么没有候选 */
function describeCombo(prints: readonly PrintRow[]): string {
  const seen = new Set<string>();
  for (const p of prints) seen.add(`${p.language ?? '∅'}/${p.extend_rarity_name ?? '∅'}`);
  return [...seen].join('、');
}

/**
 * 规划。传进来的 cards 就是「范围内」的卡(由调用方按列表筛选取好),
 * prints 传全表即可 —— 本函数按 card_id 自行分组。
 */
export function planPrintDefaults<P extends PrintRow>(
  cards: readonly BaseCardRef[],
  prints: readonly P[]
): DefaultPlan<P> {
  const byCard = new Map<string, P[]>();
  for (const p of prints) {
    const list = byCard.get(p.card_id);
    if (list) list.push(p);
    else byCard.set(p.card_id, [p]);
  }

  const items: DefaultPlanItem<P>[] = cards.map((card) => {
    const all = byCard.get(card.id) ?? [];
    const candidates = all.filter(isCandidate);
    const existingDefaults = all.filter((p) => p.is_default);
    const base: Omit<DefaultPlanItem<P>, 'kind' | 'target' | 'pickedFromMany' | 'note'> = {
      cardId: card.id,
      cardNo: card.card_no ?? '(无卡号)',
      candidates,
      existingDefaults
    };

    if (!candidates.length) {
      return {
        ...base,
        kind: 'no-candidate',
        target: null,
        pickedFromMany: false,
        note: all.length
          ? `没有 SC 平卡(该卡印刷版本:${describeCombo(all)})`
          : '这张卡没有任何印刷版本'
      };
    }

    const target = pickTarget(candidates, card.card_no);
    const pickedFromMany = candidates.length > 1;

    // 已有默认 → 一律不动,只区分「目标已在其中」与「目标不是默认」
    if (existingDefaults.length) {
      const targetIsDefault = existingDefaults.some((p) => p.id === target.id);
      if (targetIsDefault) {
        const extras = existingDefaults.filter((p) => p.id !== target.id);
        return {
          ...base,
          kind: 'already',
          target: null,
          pickedFromMany,
          note: extras.length
            ? `已是 SC 平卡,但同一张卡还有 ${extras.length} 个默认(${extras
                .map((p) => p.card_no_extend ?? '?')
                .join('、')}),未清理`
            : '已是 SC 平卡'
        };
      }
      return {
        ...base,
        kind: 'conflict',
        target: null,
        pickedFromMany,
        note: `已有默认 ${existingDefaults
          .map((p) => p.card_no_extend ?? '?')
          .join('、')},但不是 SC 平卡(${target.card_no_extend ?? '?'}),未改动`
      };
    }

    return {
      ...base,
      kind: 'set',
      target,
      pickedFromMany,
      note: pickedFromMany
        ? `${candidates.length} 个 SC 平卡候选,取卡号一致的 ${target.card_no_extend ?? '?'}`
        : `置 ${target.card_no_extend ?? '?'} 为默认`
    };
  });

  return {
    items,
    toWrite: items.filter((i) => i.kind === 'set'),
    already: items.filter((i) => i.kind === 'already'),
    skipped: items.filter((i) => i.kind === 'no-candidate' || i.kind === 'conflict'),
    printCount: prints.length
  };
}
