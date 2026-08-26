/* ================================================================
 * src/utils/reportMarkdown.ts
 *
 * 趋势对比 → Markdown(v3 新增,创作者一键复制发布)
 * 纯函数:输入 WeeklyReport,输出可直接粘贴到社媒/文档的趋势报告文本。
 * ============================================================== */

import type { WeeklyReport, DeltaItem } from '@/core';

const fmt1 = (v: number | null | undefined): string => (v == null ? '—' : `${v.toFixed(1)}%`);
const fmt0 = (v: number | null | undefined): string => (v == null ? '—' : `${v.toFixed(0)}`);
const pp = (it: DeltaItem<string>): string => `${it.delta! > 0 ? '+' : ''}${it.delta!.toFixed(1)}pp`;

function moversLines(title: string, items: DeltaItem<string>[]): string {
  if (items.length === 0) return '';
  const lines = items.map((it) => {
    const rank = it.prevRank != null && it.currRank != null ? ` · 名次 ${it.prevRank}→${it.currRank}` : '';
    return `- ${it.key}:${fmt1(it.prev)} → ${fmt1(it.curr)}(${pp(it)})${rank}`;
  });
  return `## ${title}\n${lines.join('\n')}\n`;
}

/** 趋势报告 → Markdown 文本 */
export function reportToMarkdown(r: WeeklyReport): string {
  const head = [
    `# 符文战场 Meta 报告 · ${r.currLabel}`,
    '',
    `> 对比 ${r.prevLabel}(${r.prevSample} 套) → ${r.currLabel}(${r.currSample} 套)`,
    `> 环境胜率 ${fmt1(r.envCurr ? r.envCurr * 100 : null)}${
      r.envDelta != null ? `(${r.envDelta > 0 ? '↑' : '↓'}${Math.abs(r.envDelta).toFixed(1)}pp)` : ''
    } · Meta 集中度 HHI ${fmt0(r.hhiCurr)}(${r.hhiCurr - r.hhiPrev >= 0 ? '↑' : '↓'}${Math.abs(r.hhiCurr - r.hhiPrev).toFixed(0)})`,
    ''
  ];

  const timeline =
    r.heroTimeline.length > 0
      ? [
          '## 📈 周际热度(出场率)',
          ...r.heroTimeline.map(
            (h) =>
              `- ${h.hero}:${h.pickRates.map((v) => fmt1(v)).join(' → ')}(${r.weeks.map((w) => w.label).join(' / ')})`
          ),
          ''
        ].join('\n')
      : '';

  const body = [
    moversLines('🔥 热度上升', r.popUp),
    moversLines('🧊 热度下降', r.popDown),
    moversLines('📊 胜率变化', r.winMovers),
    moversLines('⚔️ 传奇热度', r.legMovers),
    moversLines('🎨 域对热度', r.domainMovers)
  ].join('\n');

  const foot = `> 数据仅供竞技参考 · Riot Games 与本工具无关`;
  return [head.join('\n'), timeline, body, foot].filter(Boolean).join('\n');
}
