#!/usr/bin/env node
/* ================================================================
 * scripts/mark-riftbound-qa.mjs
 *
 * 赛后判例 OCR 文本 → 卡名归一 + QA 覆盖检查（纯本地、无网络、不改源文件）
 *
 *   ① 扫描每个 判例文字.txt 里的 【…】（含 OCR 断括号 / 跨行续接修复）
 *   ② 用 cards_base(_标注/cards_dict.json) 归一成 【名字（副标题）】
 *   ③ 反查 qa_entry_cards → qa_entries，给出 QA 覆盖
 *   ④ 输出：标注文本(合并+分篇)、卡名映射.csv、汇总报告.md、
 *           非卡牌词条.txt、待复核清单.txt
 *
 *   node scripts/mark-riftbound-qa.mjs
 * ================================================================ */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, basename, dirname, relative } from 'node:path'

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..')
const SRC_DIR = join(ROOT, '赛后判例_图片')
const OUT_DIR = join(SRC_DIR, '_标注')
const PART_DIR = join(OUT_DIR, '分篇')
mkdirSync(PART_DIR, { recursive: true })

const seps = ['－', '-', '—', '–', '，', ',']
const badCloser = new Set(['}', ')', ']', '）', '］', '｝'])
const MECH = new Set([
  '瞬息', '燃尽', '待命', '强攻', '法术对决', '伤害分配', '支付卡牌费用', '取消资格',
  '禁赛', '警告', '单局判负', '单轮判负', '迟到', '作弊', '焦点', '法盾', '回响',
  '绝念', '急速', '迅捷', '清理', '结算链', '开环', '普通开环', '战斗待结算', '得分',
  '征服', '据守', '回合', '召出', '抽牌', '唤醒', '法术', '指示物'
])

/* ---------- data ---------- */
const cards = JSON.parse(readFileSync(join(OUT_DIR, 'cards_dict.json'), 'utf8'))
const qaEntries = JSON.parse(readFileSync(join(OUT_DIR, 'qa_entries.json'), 'utf8'))
const qaLinks = JSON.parse(readFileSync(join(OUT_DIR, 'qa_entry_cards.json'), 'utf8'))
const qaById = new Map(qaEntries.map((e) => [e.id, e]))
const qaByCard = new Map()
for (const l of qaLinks) { if (!qaByCard.has(l.card_no)) qaByCard.set(l.card_no, []); qaByCard.get(l.card_no).push(l.qa_id) }

/* ---------- indexes ---------- */
const byName = new Map()
const byKey = new Map()
const foldedName = new Map()
const foldedKey = new Map()
const foldedDisplay = new Map()
function fold(s) {
  return String(s ?? '')
    .replace(/[！!“”"'‘’·・\-－—–_()（）[\]【】\s,，、。.：:；;？?]/g, '')
    .toLowerCase()
}
function push(map, k, v) { if (!map.has(k)) map.set(k, []); map.get(k).push(v) }
for (const c of cards) {
  const name = (c.card_name_cn ?? '').trim()
  if (!name) continue
  const sub = (c.sub_title_cn ?? '').trim()
  push(byName, name, c)
  push(byKey, `${name}\u0000${sub}`, c)
  push(foldedName, fold(name), c)
  push(foldedKey, `${fold(name)}\u0000${fold(sub)}`, c)
  push(foldedDisplay, fold(name + sub), c)
}
function displays(list) {
  return new Set((list ?? []).map((c) => `${c.card_name_cn ?? ''}\u0000${(c.sub_title_cn ?? '').trim()}`))
}
function canonical(card) {
  const sub = (card.sub_title_cn ?? '').trim()
  return sub ? `${card.card_name_cn}（${sub}）` : String(card.card_name_cn)
}
function lev(a, b) {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}
const fuzzThreshold = (len) => Math.min(3, Math.max(1, Math.round(len * 0.34)))

/* ---------- token scanner: repairs OCR bracket damage ---------- */
function scanTokens(text) {
  const out = []
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch !== '【') { i++; continue }
    const start = i
    let j = i + 1
    let buf = ''
    let paren = 0
    let closedBy = null
    while (j < n) {
      const c = text[j]
      if (c === '（' || c === '(') { paren++; buf += c; j++; continue }
      if (c === '）' || c === ')') {
        if (paren > 0) { paren--; buf += c; j++; continue }
        closedBy = 'bad'; break
      }
      if (c === '】') { closedBy = '】'; break }
      if (badCloser.has(c)) { closedBy = 'bad'; break }
      if (c === '【') { // previous closer was missed → keep the earlier fragment
        let cut = -1
        for (let k = buf.length - 1; k >= 0; k--) if (badCloser.has(buf[k])) { cut = k; break }
        if (cut >= 0) out.push({ start, end: start + 1 + cut + 1, raw: buf.slice(0, cut), open: true })
        else out.push({ start, end: start + 1 + buf.length, raw: buf, open: true })
        i = j
        closedBy = null
        j = -1
        break
      }
      if (c === '\n') { closedBy = 'nl'; break }
      buf += c
      j++
    }
    if (j >= 0 && j >= n && !closedBy) { out.push({ start, end: n, raw: buf, open: true }); i = n; continue }
    if (j === -1) continue
    const end = (closedBy === '】' || closedBy === 'bad') ? j + 1 : j
    out.push({ start, end, raw: buf, open: closedBy !== '】' && closedBy !== 'bad' })
    i = end
  }
  return out
}

/* ---------- core matcher ---------- */
function splitCandidates(part) {
  const cands = []
  for (const s of seps) {
    let idx = part.indexOf(s)
    while (idx > 0 && idx < part.length - 1) { cands.push([part.slice(0, idx), part.slice(idx + s.length)]); idx = part.indexOf(s, idx + 1) }
  }
  for (let k = 1; k < part.length - 1; k++) if (part[k] === '一') cands.push([part.slice(0, k), part.slice(k + 1)])
  return cands
}
function core(s) {
  s = s.trim()
  const f = fold(s)
  if (!f) return null
  const mk = (list, method) => ({ cards: list, method, ambiguous: displays(list).size > 1 })

  if (foldedName.has(f)) return mk(foldedName.get(f), '精确(名)')

  for (const [n, sub] of splitCandidates(s)) {
    if (!n || !sub) continue
    if (byKey.has(`${n}\u0000${sub}`)) return mk(byKey.get(`${n}\u0000${sub}`), '精确(名+副标题)')
    const fk = `${fold(n)}\u0000${fold(sub)}`
    if (foldedKey.has(fk)) return mk(foldedKey.get(fk), '精确(名+副标题·折叠)')
    const base = byName.get(n) || foldedName.get(fold(n))
    if (base) { const hit = base.filter((c) => (c.sub_title_cn ?? '').trim().startsWith(sub)); if (hit.length) return mk(hit, '前缀匹配(副标题)') }
  }
  for (let k = 2; k < s.length - 1; k++) {
    const n = s.slice(0, k), sub = s.slice(k)
    if (byKey.has(`${n}\u0000${sub}`)) return mk(byKey.get(`${n}\u0000${sub}`), '精确(名+副标题·黏连)')
    if (byName.has(sub)) return mk(byName.get(sub), '拆解(后缀成卡·黏连)')
  }
  for (const [n, sub] of splitCandidates(s)) {
    if (!sub) continue
    if (byName.has(sub)) return mk(byName.get(sub), '拆解(后缀成卡)')
    if (foldedName.has(fold(sub))) return mk(foldedName.get(fold(sub)), '拆解(后缀成卡·折叠)')
  }
  const pre = []
  if (f.length >= 2) for (const c of cards) {
    const dn = fold(c.card_name_cn)
    if (dn.startsWith(f) || (dn + fold(c.sub_title_cn)).startsWith(f)) pre.push(c)
  }
  if (pre.length && displays(pre).size === 1) return mk(pre, '精确(名字前缀)')

  if (f.length === 1) {
    const hit = []
    for (const c of cards) if ((fold(c.card_name_cn) + fold(c.sub_title_cn)).includes(f)) hit.push(c)
    if (hit.length && displays(hit).size === 1) return mk(hit, '精确(单字包含)')
  }

  const thr = fuzzThreshold(f.length)
  let best = null, bestD = Infinity, tie = false
  const consider = (k, list) => {
    const d = lev(f, k)
    if (d < bestD) { best = list; bestD = d; tie = false }
    else if (d === bestD && best && [...displays(list)].some((x) => !displays(best).has(x))) tie = true
  }
  for (const [k, list] of foldedName) consider(k, list)
  for (const [k, list] of foldedDisplay) consider(k, list)
  if (best && bestD <= thr && !tie) return mk(best, `模糊(距${bestD})`)
  return null
}
/** full-name resolutions that fully consume their input (not partial name prefixes) */
function isSolid(method) {
  return method === '精确(名)' ||
    method.startsWith('精确(名+副标题') ||
    method.startsWith('精确(名·上下文') ||
    method.startsWith('拆解') ||
    method === '前缀匹配(副标题)'
}
function resolveOne(part) {
  const p = part.trim()
  if (!p) return null
  const full = core(p)
  if (full) return { ...full, rest: '' }
  for (let k = Math.min(p.length, 12); k >= 2; k--) {
    const q = p.slice(0, k)
    const r = core(q)
    if (!r || r.ambiguous) continue
    const fuzzyOk = r.method.startsWith('模糊') && /距1/.test(r.method) && q.length <= 3
    if (isSolid(r.method) || fuzzyOk) return { ...r, method: `前缀截取[${q}]·${r.method}`, rest: p.slice(k) }
  }
  return null
}
function resolveToken(raw) {
  const parts = raw.split('、').map((x) => x.trim()).filter(Boolean)
  if (!parts.length) return { kind: 'unresolved' }
  const cardsHit = []
  const methods = []
  let rest = ''
  for (const p of parts) {
    const r = resolveOne(p)
    if (!r) return { kind: 'unresolved' }
    if (r.ambiguous) return { kind: 'ambiguous', cards: r.cards, method: r.method }
    if (r.rest) { if (parts.length > 1) return { kind: 'unresolved' }; rest = r.rest }
    cardsHit.push(...r.cards)
    methods.push(r.method)
  }
  return { kind: 'card', cards: cardsHit, methods, rest }
}
function tryContinuation(text, from, base) {
  let i = from
  while (i < text.length && /[\s　]/.test(text[i])) i++
  const runStart = i
  let run = ''
  while (i < text.length && run.length < 10) {
    const ch = text[i]
    if (ch === '】' || ch === '【' || /[，,。；;：:、\n]/.test(ch)) break
    run += ch
    i++
  }
  if (!run) return null
  const bases = base ? [base] : ['']
  for (const b of bases) {
    for (let k = 1; k <= run.length; k++) {
      const cand = (b + run.slice(0, k)).trim()
      if (!cand) continue
      const r = core(cand)
      if (!r || r.ambiguous) continue
      // skip partial-name hits (名字前缀/单字包含) so we consume the whole name
      if (r.method === '精确(名字前缀)' || r.method === '精确(单字包含)') continue
      let end = runStart + k
      if (text[end] === '】' || text[end] === ']' || text[end] === ')' || text[end] === '}') end++
      return { cards: r.cards, method: `跨行续接·${r.method}`, consumedEnd: end }
    }
  }
  return null
}

/* ---------- also catch OCR that used （…）/( ) as card brackets ---------- */
function scanParens(text, bracketTokens) {
  const spans = bracketTokens.map((t) => [t.start, t.end])
  const overlaps = (a, b) => spans.some(([s, e]) => a < e && b > s)
  const out = []
  for (const m of text.matchAll(/[（(]([^（()）【】\n]{1,14})[）)]/g)) {
    const start = m.index
    const end = start + m[0].length
    if (overlaps(start, end)) continue
    out.push({ start, end, raw: m[1], open: false, type: 'paren' })
  }
  return out
}

/* ---------- document resolution ---------- */
function resolveDocument(text) {
  const brackets = scanTokens(text).map((t) => ({ ...t, type: 'bracket' }))
  const tokens = [...brackets, ...scanParens(text, brackets)].sort((a, b) => a.start - b.start)
  const prelim = tokens.map((t) => resolveToken(t.raw))
  const ctx = new Map()
  for (const r of prelim) {
    if (r.kind === 'card' && r.methods.some((m) => /精确\(名\+副标题/.test(m))) {
      for (const c of r.cards) { if (!ctx.has(c.card_name_cn)) ctx.set(c.card_name_cn, new Set()); ctx.get(c.card_name_cn).add((c.sub_title_cn ?? '').trim()) }
    }
  }
  const occ = []
  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]
    let r = prelim[idx]
    if (r.kind === 'ambiguous') {
      const known = ctx.get(r.cards[0].card_name_cn)
      if (known && known.size === 1) {
        const hit = r.cards.filter((c) => known.has((c.sub_title_cn ?? '').trim()))
        if (displays(hit).size === 1) r = { kind: 'card', cards: hit, methods: ['精确(名·上下文定副标题)'], rest: '' }
      }
    }
    if (t.open && (r.kind === 'unresolved' || r.kind === 'ambiguous')) {
      const c = tryContinuation(text, t.end, t.raw.trim())
      if (c) r = { kind: 'card', cards: c.cards, methods: [c.method], rest: '', consumedEnd: c.consumedEnd }
    }
    if (t.type === 'paren') {
      const solidCard = r.kind === 'card' && r.methods.every(isSolid)
      if (!solidCard) continue // not a card wrapped in parentheses → leave untouched
    }
    occ.push({ token: t, result: r })
  }
  return occ
}
function render(text, occ) {
  let out = ''
  let cursor = 0
  for (const o of occ) {
    const end = o.result.consumedEnd ?? o.token.end
    out += text.slice(cursor, o.token.start)
    if (o.result.kind === 'card') {
      out += `【${[...new Set(o.result.cards.map(canonical))].join('、')}】${o.result.rest ?? ''}`
    } else {
      out += text.slice(o.token.start, end)
    }
    cursor = end
  }
  return out + text.slice(cursor)
}

/* ---------- discover + process ---------- */
const files = []
for (const ent of readdirSync(SRC_DIR, { withFileTypes: true })) {
  if (ent.isDirectory() && ent.name !== '_标注') {
    const p = join(SRC_DIR, ent.name, '判例文字.txt')
    if (existsSync(p)) files.push(p)
  }
}
files.sort()

const byRaw = new Map()
const nonCard = new Map()
const review = new Map()
const fileOutputs = []
let allTokens = 0, matchedOcc = 0, nonCardOcc = 0, reviewOcc = 0

for (const path of files) {
  const text = readFileSync(path, 'utf8')
  const occ = resolveDocument(text)
  const rel = relative(SRC_DIR, path)
  for (const o of occ) {
    allTokens++
    const raw = o.token.raw.trim() || '（空·跨行续接）'
    if (o.result.kind === 'card') {
      matchedOcc++
      const agg = byRaw.get(raw) ?? { raw, cards: new Set(), cardNos: new Set(), methods: new Set(), count: 0, files: new Set() }
      agg.count++
      for (const c of o.result.cards) { agg.cards.add(canonical(c)); agg.cardNos.add(c.card_no) }
      for (const m of o.result.methods) agg.methods.add(m)
      agg.files.add(rel)
      byRaw.set(raw, agg)
    } else if (o.result.kind === 'ambiguous' || o.result.kind === 'unresolved') {
      const isMech = MECH.has(raw) || raw === ''
      if (isMech) {
        nonCardOcc++
        const agg = nonCard.get(raw) ?? { raw, count: 0, files: new Set() }
        agg.count++; agg.files.add(rel); nonCard.set(raw, agg)
      } else {
        reviewOcc++
        const agg = review.get(raw) ?? { raw, candidates: new Set(), methods: new Set(), count: 0, files: new Set() }
        agg.count++
        if (o.result.cards) for (const c of o.result.cards) agg.candidates.add(canonical(c))
        if (o.result.method) agg.methods.add(o.result.method)
        if (o.result.methods) for (const m of o.result.methods) agg.methods.add(m)
        agg.files.add(rel); review.set(raw, agg)
      }
    } else {
      nonCardOcc++
      const agg = nonCard.get(raw) ?? { raw, count: 0, files: new Set() }
      agg.count++; agg.files.add(rel); nonCard.set(raw, agg)
    }
  }
  const outPath = join(PART_DIR, basename(dirname(path)) + '_' + basename(path).replace(/\.txt$/, '_标注.txt'))
  writeFileSync(outPath, render(text, occ))
  fileOutputs.push({ rel, out: relative(OUT_DIR, outPath) })
}

const mergedIn = join(SRC_DIR, '全部判例文字.txt')
if (existsSync(mergedIn)) {
  const text = readFileSync(mergedIn, 'utf8')
  // 按帖子分隔线分段解析，避免跨帖上下文串扰（同名不同副标题的传奇卡）
  const merged = text.split(/(\n={20,}\n)/)
    .map((p) => (/^\n={20,}\n$/.test(p) ? p : render(p, resolveDocument(p))))
    .join('')
  writeFileSync(join(OUT_DIR, '全部判例文字_标注.txt'), merged)
}

/* ---------- csv ---------- */
function qaForCardNos(nos) { const ids = new Set(); for (const no of nos) for (const id of qaByCard.get(no) ?? []) ids.add(id); return [...ids] }
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const rows = [['原文', '归一化标注', 'card_no', 'card_name_cn', 'sub_title_cn', '匹配方式', 'QA覆盖', 'QA条数', 'QA_source_id', '出现次数', '出现文件'].join(',')]
for (const agg of [...byRaw.values()].sort((a, b) => a.raw.localeCompare(b.raw))) {
  const nos = [...agg.cardNos].sort()
  const qids = qaForCardNos(nos)
  const srcs = qids.map((id) => qaById.get(id)?.source_id).filter(Boolean).sort((a, b) => Number(a) - Number(b))
  const recs = cards.filter((c) => nos.includes(c.card_no))
  const cn = [...new Set(recs.map((c) => c.card_name_cn ?? ''))].join('、')
  const subt = [...new Set(recs.map((c) => (c.sub_title_cn ?? '').trim()))].filter(Boolean).join('、')
  rows.push([agg.raw, [...agg.cards].join('、'), nos.join('、'), cn, subt, [...agg.methods].join('、'), qids.length ? '有' : '无', qids.length, srcs.join('、'), agg.count, [...agg.files].join('、')].map(csvCell).join(','))
}
writeFileSync(join(OUT_DIR, '卡名映射.csv'), '\uFEFF' + rows.join('\n') + '\n')

/* ---------- lists ---------- */
const nonCardRows = [...nonCard.values()].sort((a, b) => b.count - a.count)
writeFileSync(join(OUT_DIR, '非卡牌词条.txt'), nonCardRows.map((n) => `${n.raw || '(空)'}\t×${n.count}\t${[...n.files].join(' ; ')}`).join('\n') + '\n')
const reviewRows = [...review.values()].sort((a, b) => b.count - a.count)
writeFileSync(join(OUT_DIR, '待复核清单.txt'), reviewRows.map((n) => `${n.raw}\t候选:${[...n.candidates].join(' / ') || '（无）'}\t${[...n.methods].join('、')}\t×${n.count}`).join('\n') + '\n')

/* ---------- report ---------- */
const qaCovered = [...byRaw.values()].filter((a) => qaForCardNos([...a.cardNos]).length > 0)
const qaNotCovered = [...byRaw.values()].filter((a) => qaForCardNos([...a.cardNos]).length === 0)
const fuzzy = [...byRaw.values()].filter((a) => [...a.methods].some((m) => m.startsWith('模糊')))
const repaired = [...byRaw.values()].filter((a) => [...a.methods].some((m) => /前缀|跨行续接|黏连|拆解|上下文/.test(m)))
const report = []
report.push('# 赛后判例卡名归一 · 汇总报告', '', `生成时间：${new Date().toISOString()}`, '')
report.push('## 总览', '')
report.push(`- 处理文件：${fileOutputs.length} 个分篇 + 合并版`)
report.push(`- 词条出现总数：${allTokens}`)
report.push(`- 命中卡牌：${matchedOcc}（${byRaw.size} 个不同词条）`)
report.push(`- 待复核：${reviewOcc}（${reviewRows.length} 个不同词条）`)
report.push(`- 非卡牌：${nonCardOcc}（${nonCardRows.length} 个不同词条）`, '')
report.push('## 卡牌 QA 覆盖', '')
report.push(`- 已有 QA 关联的卡名词条：${qaCovered.length}`)
report.push(`- 暂无 QA 关联的卡名词条：${qaNotCovered.length}`, '')
report.push('### 已有 QA 关联（按出现次数）', '', '| 原文 | 归一化 | QA条数 | QA_source_id | 次数 |', '|---|---|---:|---|---:|')
for (const a of qaCovered.sort((x, y) => y.count - x.count)) {
  const qids = qaForCardNos([...a.cardNos])
  const srcs = qids.map((id) => qaById.get(id)?.source_id).filter(Boolean).sort((x, y) => Number(x) - Number(y))
  report.push(`| ${a.raw} | ${[...a.cards].join('、')} | ${qids.length} | ${srcs.join('、')} | ${a.count} |`)
}
report.push('', '### 暂无 QA 关联（按出现次数）', '', '| 原文 | 归一化 | card_no | 次数 |', '|---|---|---|---:|')
for (const a of qaNotCovered.sort((x, y) => y.count - x.count)) report.push(`| ${a.raw} | ${[...a.cards].join('、')} | ${[...a.cardNos].sort().join('、')} | ${a.count} |`)
report.push('', '## 模糊匹配 / 修复（建议抽查）', '', '| 原文 | 归一化 | 方式 |', '|---|---|---|')
for (const a of [...new Set([...fuzzy, ...repaired])].sort((x, y) => y.count - x.count)) report.push(`| ${a.raw} | ${[...a.cards].join('、')} | ${[...a.methods].join('、')} |`)
report.push('', '## 待复核（未命中/歧义）', '', '| 原文 | 候选 | 方式 | 次数 |', '|---|---|---|---:|')
for (const n of reviewRows) report.push(`| ${n.raw} | ${[...n.candidates].join(' / ') || '（无）'} | ${[...n.methods].join('、')} | ${n.count} |`)
report.push('', '## 未纳入标记的非卡牌词条', '', '| 词条 | 次数 |', '|---|---:|')
for (const n of nonCardRows) report.push(`| ${n.raw || '(空)'} | ${n.count} |`)
report.push('', '## 说明 / 已知残留', '')
report.push('- 判定顺序：`cards_base` 精确(名) → 精确(名+副标题) → 副标题前缀 → 黏连拆分 → 后缀成卡 → 名字前缀/单字包含 → 模糊(编辑距离)。')
report.push('- `（…）`/`( )` 若整体恰好是一张卡名也会被标注（如 `（娜美-移海之志）`、`（阿克尚，放浪不羁）`、`（随从）`）。')
report.push('- 源 OCR 本身存在括号不配对（部分 `】` 没有对应 `【`，或 `（`/`(` 被当作卡牌括号且不闭合，如 `（长剑`、`(裂魂者喇煞】`、`（涌泉之恨、`）；这些残留片段保留原文，未自动标注。')
report.push('- 同名多印刷（如 奥术先驱 FND-265/OGN-265、精灵 OGN-274/UNL-T07）按卡片名合并展示；同副标题不同卡（如 所向披靡：奇亚娜 OGN-155 / 菲奥娜 OGN-232）以「名+副标题」联合键区分。')
report.push('', '## 输出文件', '')
for (const f of fileOutputs) report.push(`- \`${f.out}\``)
report.push('- `全部判例文字_标注.txt`', '- `卡名映射.csv`', '- `非卡牌词条.txt`', '- `待复核清单.txt`', '- `汇总报告.md`')
writeFileSync(join(OUT_DIR, '汇总报告.md'), report.join('\n') + '\n')

console.log(`files=${fileOutputs.length} tokens=${allTokens} matched=${matchedOcc} review=${reviewOcc} nonCard=${nonCardOcc}`)
console.log(`distinct: card=${byRaw.size} review=${reviewRows.length} nonCard=${nonCardRows.length}`)
console.log(`qa-covered=${qaCovered.length} not-covered=${qaNotCovered.length}`)
console.log(`review items: ${reviewRows.map((r) => r.raw).join(' | ')}`)
