/* ================================================================
 * src/tools/admin/rulesTree.ts
 *
 * 规则树的**纯逻辑** —— 零 I/O、零框架依赖,可在 Node 里直接单测
 * (见 scripts/verify-admin-rules.mjs)。
 *
 * 树由 parent_number 自关联构建;库里没有触发器保证一致性,
 * 因此这里必须对两种脏数据免疫:
 *   ① 父节点不在当前集合里(如父属于另一本规则书)→ 当作根节点
 *   ② 数据里已存在环(改父时手滑造成)→ 必须拆环,否则渲染会栈溢出
 * ============================================================== */

import type { Rule } from './types';

export interface RuleNode {
  rule: Rule;
  children: RuleNode[];
}

/** 只按规则书过滤;'' = 全部 */
export function filterByBook(rules: Rule[], book: string): Rule[] {
  return book === '' ? rules : rules.filter((r) => (r.rules_book ?? '') === book);
}

/** 各规则书及条目数(选择页用) */
export function bookCounts(rules: Rule[]): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of rules) {
    const k = r.rules_book || '（未分类）';
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/**
 * 构建树。
 *
 * 环的处理:挂到父节点之前,沿父链上溯 —— 若途中遇到自己,说明成环,
 * 该节点降级为根节点。这样即使库里已有环,渲染也不会栈溢出。
 */
export function buildRuleTree(rules: Rule[]): RuleNode[] {
  const nodes = new Map<string, RuleNode>();
  for (const r of rules) {
    if (!nodes.has(r.rule_number)) nodes.set(r.rule_number, { rule: r, children: [] });
  }

  const byNumber = new Map(rules.map((r) => [r.rule_number, r]));

  /** 从 start 沿父链上溯,是否回到 target */
  function reachesTarget(start: string, target: string): boolean {
    let cur: string | null = start;
    let hops = 0;
    while (cur && hops <= rules.length) {
      if (cur === target) return true;
      cur = byNumber.get(cur)?.parent_number ?? null;
      hops += 1;
    }
    return false;
  }

  const roots: RuleNode[] = [];
  for (const r of rules) {
    const node = nodes.get(r.rule_number);
    if (!node) continue;
    const parentNumber = r.parent_number;
    const parent = parentNumber ? nodes.get(parentNumber) : undefined;

    // 父不存在 → 根;父链能绕回自己 → 成环,也降为根
    if (!parent || parentNumber === r.rule_number || reachesTarget(parentNumber!, r.rule_number)) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  const sortRec = (list: RuleNode[], depth: number): void => {
    list.sort((a, b) => {
      const d = (a.rule.sort_order ?? 0) - (b.rule.sort_order ?? 0);
      return d !== 0 ? d : a.rule.rule_number.localeCompare(b.rule.rule_number, 'zh');
    });
    // 深度上限兜底:即使上面漏判,也不会无限递归
    if (depth > rules.length) return;
    for (const n of list) sortRec(n.children, depth + 1);
  };
  sortRec(roots, 0);
  return roots;
}

export function hasChildren(rules: Rule[], ruleNumber: string): boolean {
  return rules.some((r) => r.parent_number === ruleNumber);
}

/** 新增子规则时的默认排序号 = 兄弟最大值 + 1 */
export function nextSortOrder(rules: Rule[], parentNumber: string | null): number {
  const siblings = rules
    .filter((r) => (r.parent_number ?? null) === (parentNumber ?? null))
    .map((r) => r.sort_order ?? 0);
  return (siblings.length ? Math.max(...siblings) : 0) + 1;
}

/** 某节点的全部后代编号(改父时用来防环) */
export function collectDescendants(rules: Rule[], ruleNumber: string): string[] {
  const out: string[] = [];
  const stack = [ruleNumber];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    for (const r of rules) {
      if (r.parent_number === cur && !seen.has(r.rule_number)) {
        seen.add(r.rule_number);
        out.push(r.rule_number);
        stack.push(r.rule_number);
      }
    }
  }
  return out;
}

/**
 * 把 ruleNumber 的父改成 newParent 是否会成环。
 * 自己、自己的后代都不能当父。
 */
export function wouldCreateCycle(
  rules: Rule[],
  ruleNumber: string,
  newParent: string | null
): boolean {
  if (!newParent) return false;
  if (newParent === ruleNumber) return true;
  return collectDescendants(rules, ruleNumber).includes(newParent);
}

/** 从根到该节点的祖先路径(不含自身),用于定位时逐级展开 */
export function ancestorPath(rules: Rule[], ruleNumber: string): string[] {
  const byNumber = new Map(rules.map((r) => [r.rule_number, r]));
  const path: string[] = [];
  let cur = byNumber.get(ruleNumber)?.parent_number ?? null;
  let hops = 0;
  while (cur && hops <= rules.length) {
    path.unshift(cur);
    cur = byNumber.get(cur)?.parent_number ?? null;
    hops += 1;
  }
  return path;
}

/**
 * 本地子串匹配(编号 / 中英文本)。
 *
 * 为什么不用库里的 search_vector:
 * 实测(scripts 里记录)该列用 `simple` 配置生成,而 simple **不切分中文** ——
 * 「黄金与白银法则」整句被当成一个 token,因此 FTS 对中文的召回极低:
 *   法术 → FTS 11 条 vs 子串 288 条
 *   伤害 → FTS  2 条 vs 子串 148 条
 *   107  → FTS  1 条 vs 子串  27 条
 * 2381 条量级下子串扫描毫无压力,故改用子串。
 */
export function matchRules(rules: Rule[], query: string): Rule[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return rules.filter((r) => {
    return (
      r.rule_number.toLowerCase().includes(q) ||
      (r.text_zh ?? '').toLowerCase().includes(q) ||
      (r.text_en ?? '').toLowerCase().includes(q)
    );
  });
}

/** 树里展开哪些节点:默认展开前 maxDepth 层 */
export function defaultExpanded(rules: Rule[], maxDepth = 1): string[] {
  return rules
    .filter((r) => (r.level ?? 0) < maxDepth && hasChildren(rules, r.rule_number))
    .map((r) => r.rule_number);
}
