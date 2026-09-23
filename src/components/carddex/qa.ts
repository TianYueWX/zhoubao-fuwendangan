import type { CardQa } from "./types";

type Row = Record<string, unknown>;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

function numberOrNull(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 由 qa_entries + qa_entry_cards 构建 card_no → 问答列表 的映射。
 * 纯函数，便于离线回归：孤立（未关联任何卡）的问答不会出现在结果里。
 * 排序：先按 position 升序，再按 source_id 数字序（无 source_id 的排在最后）。
 */
export function buildQaByCardNo(
  entryRows: readonly Row[],
  linkRows: readonly Row[],
): Map<string, CardQa[]> {
  const entryById = new Map<string, Omit<CardQa, "position">>();
  for (const r of entryRows) {
    const id = text(r.id);
    if (!id) continue;
    entryById.set(id, {
      id,
      sourceId:
        r.source_id == null || text(r.source_id) === "" ? null : text(r.source_id),
      question: text(r.question),
      answer: text(r.answer),
      questionEn: text(r.question_en),
      answerEn: text(r.answer_en),
    });
  }
  const out = new Map<string, CardQa[]>();
  for (const l of linkRows) {
    const qaId = text(l.qa_id);
    const cardNo = text(l.card_no);
    if (!qaId || !cardNo) continue;
    const entry = entryById.get(qaId);
    if (!entry) continue;
    const group = out.get(cardNo) ?? [];
    group.push({ ...entry, position: numberOrNull(l.position) ?? 0 });
    out.set(cardNo, group);
  }
  const bySource = (a: CardQa, b: CardQa): number => {
    const an = a.sourceId == null ? null : Number(a.sourceId);
    const bn = b.sourceId == null ? null : Number(b.sourceId);
    const aNum = an != null && Number.isFinite(an);
    const bNum = bn != null && Number.isFinite(bn);
    if (aNum && bNum && an !== bn) return an - bn;
    if (aNum !== bNum) return aNum ? -1 : 1;
    return (
      (a.sourceId ?? "").localeCompare(b.sourceId ?? "") ||
      a.id.localeCompare(b.id)
    );
  };
  for (const group of out.values()) {
    group.sort((a, b) => a.position - b.position || bySource(a, b));
  }
  return out;
}
