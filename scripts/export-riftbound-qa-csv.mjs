#!/usr/bin/env node
/* ================================================================
 * scripts/export-riftbound-qa-csv.mjs
 *
 * 把《赛后判例》标注文本切成 qa_entries / qa_entry_cards 可导入的 CSV。
 *
 *   输入：赛后判例_图片/_标注/分篇/*_标注.txt
 *         赛后判例_图片/_标注/cards_dict.json
 *         赛后判例_图片/索引.csv
 *         赛后判例_图片/_details/{opus}.json    （取 pub_ts）
 *   输出：赛后判例_图片/_标注/qa导入/
 *         qa_entries.csv        id,source,source_id,question,answer,question_en,answer_en,created_at,updated_at
 *         qa_entry_cards.csv    qa_id,card_no,position
 *         qa导入核对.csv         source_id,source,opus_id,日期,章节,问题,答案,卡号,起止行
 *         qa导入说明.md
 *
 *   node scripts/export-riftbound-qa-csv.mjs
 * ================================================================ */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..')
const SRC = join(ROOT, '赛后判例_图片')
const ANNO = join(SRC, '_标注')
const PART = join(ANNO, '分篇')
const OUT = join(ANNO, 'qa导入')
mkdirSync(OUT, { recursive: true })

const UUID_NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

/* ---------- data ---------- */
const cards = JSON.parse(readFileSync(join(ANNO, 'cards_dict.json'), 'utf8'))
const displayToNos = new Map()
for (const c of cards) {
  const sub = (c.sub_title_cn ?? '').trim()
  const disp = sub ? `${c.card_name_cn}（${sub}）` : String(c.card_name_cn)
  if (!displayToNos.has(disp)) displayToNos.set(disp, [])
  displayToNos.get(disp).push(c.card_no)
}
const indexRows = readFileSync(join(SRC, '索引.csv'), 'utf8').trim().split(/\r?\n/).slice(1)
const byOpus = new Map()
for (const line of indexRows) {
  const c = line.split(',')
  byOpus.set(c[5].trim(), { date: c[0].trim(), title: c[1].trim(), opus: c[5].trim() })
}

/* ---------- helpers ---------- */
function uuidv5(name, nsHex) {
  const ns = Buffer.from(nsHex.replace(/-/g, ''), 'hex')
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}
function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function toCsv(columns, rows) {
  const lines = [columns.join(',')]
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','))
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}
function appendLine(buf, line) {
  if (!buf) return line
  const last = buf.slice(-1)
  return /[。！？；：]/.test(last) ? buf + '\n' + line : buf + line
}
function stripPrefixNoise(title) { return title.replace(/^符文战场/, '').replace(/^关于/, '').trim() }

/* ---------- noise / section / markers ---------- */
const NOISE = [
  /^={3,}/, /^标题[:：]/, /^日期[:：]/, /^原帖[:：]/,
  /^符文战场$/, /^第[一二三四]赛季$/, /^[（(]?第[一二三四]赛季[）)]?$/, /^《第[一二三四]赛季》$/,
  /^区域公开赛$/, /^全国公开赛$/, /^百炼铸新章$/, /^铸炼$/, /^破限$/,
  /^关于《/, /^关[干于]《/, /^赛后判例$/, /^.*赛后判例$/, /^.*直播桌问题说明$/, /^.*问题说明$/,
  /^英雄联盟对战卡牌[」」]?$/, /^英雄联盟对战卡牌/, /^英雄联盟战卡牌/, /^英雄联.*对战卡牌/, /^九英雄/, /^凡英雄/, /^《符文战场/,
  /^《符文战场.*裁判组/, /^以上，谨向/, /^亲爱的召唤师/, /^一《符文战场/, /^《符文战场：英雄联盟对战卡牌》游戏总监/,
  /^第[一二三四]赛季.*(赛区|公开赛).*(查阅|发布)/, /查阅！?$/, /发布了多条Q&A/,
  /^(北京|上海|广州|重庆|杭州|成都|大连|南京|福州|苏州|西安|天津|长沙|武汉|沈阳)$/,
  /闪魂|SHINING SOUL|NINGBOU|BAMEs|BIAMEs|MBIAMES/, /RIOT|Riot|GAMES|RGI|rvice marks|registered trademarks|and\/or|and any|ice marks|nes\.Inc|nes\.|Games\.Inc/,
  /^@\s?20/, /^[?？]20/, /^·$/, /^[·•.。，,、；;：:—\-]+$/, /^[a-zA-Z0-9 ,.'&/()-]*[a-zA-Z][a-zA-Z0-9 ,.'&/()-]*$/
]
function isNoise(l) {
  const s = l.trim()
  if (!s) return false
  return NOISE.some((re) => re.test(s))
}
const SECTION_RE = /^(?:[一二三四五六七八九十]+[、.．，,]?|[、◆]|\d+[、.．])?\s*(赛事处罚|卡组检查|判罚相关|常见问题与解答|赛事组温馨提示|赛事规则|赛事组提醒)\s*[:：]?\s*$/
function sectionOf(l) { const m = l.trim().match(SECTION_RE); return m ? m[1] : null }
const Q_PREFIX = /^[QＱOo0]\s*[①-⑳0-9]{0,2}\s*[:：.·,，、]?\s*/
const A_PREFIX = /^(?:AD|A[lI1]?|Ａ)\s*(?:[①-⑳0-9]{1,2}\s*)?[:：.·,，、]?\s*/
function isQ(l) {
  const m = l.trim().match(/^([QＱOo0])\s*([①-⑳0-9]{1,2})?\s*([:：.·,，、])?/)
  if (!m) return false
  if ('Oo0'.includes(m[1])) return !!m[2]
  return !!(m[2] || m[3])
}
function isA(l) {
  const s = l.trim()
  const m = s.match(/^(AD|A[lI1]?|Ａ)\s*([①-⑳0-9]{1,2})?\s*([:：.·,，、])?/)
  if (!m) return false
  if (m[2] || m[3]) return true
  return /^(?:AD|A[lI1]?|Ａ)\s+\S/.test(s)
}
const HEAD_RE = /^【[^】]+】\s*(?:[、和与]?\s*【[^】]+】\s*)*[？?。]?$/
function isHead(l) { const s = l.trim(); return s.length <= 34 && HEAD_RE.test(s) }
function cleanMarker(l, kind) {
  const s = l.trim()
  return s.replace(kind === 'q' ? Q_PREFIX : A_PREFIX, '').trim()
}
function extractCardNos(text) {
  const seen = new Set()
  const out = []
  for (const m of String(text ?? '').matchAll(/【([^】]+)】/g)) {
    for (const part of m[1].split('、')) {
      const nos = displayToNos.get(part.trim())
      if (nos) for (const no of nos) if (!seen.has(no)) { seen.add(no); out.push(no) }
    }
  }
  return out
}

/* ---------- parse one file ---------- */
function parseFile(text) {
  const lines = text.split(/\r?\n/)
  const items = []
  let section = '', sawSection = false
  let sec = { expected: 1, style: null }
  let cur = null
  let pending = []
  let sectionHadItem = false

  const flushSection = () => {
    if (cur) { items.push(cur); cur = null; sectionHadItem = true }
    if (!sectionHadItem && pending.length) {
      items.push({ section, no: '', title: pending[0], lines: [...pending], l0: 0, l1: 0 })
    }
    pending = []
    sectionHadItem = false
  }

  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    if (/^=====/.test(line)) return
    if (isNoise(line)) return
    const secName = sectionOf(line)
    if (secName) {
      flushSection()
      if (secName !== section) sec = { expected: 1, style: null }
      section = secName; sawSection = true
      return
    }
    // item start?
    let m = line.match(/^([①-⑳]|\d{1,2}|[iIl])\s*[.．，,、]?\s*(.*)$/)
    if (m) {
      let marker = m[1]
      if (/[iIl]/.test(marker) && marker !== '1') marker = '1'
      const rest = m[2].trim()
      let accept = false
      if (/[①-⑳]/.test(marker)) {
        accept = sec.style === null || sec.style === 'circle'
        if (accept) sec.style = 'circle'
      } else {
        const n = Number(marker)
        const strong = /^[【QＱ（(]/.test(rest)
        const empty = rest === ''
        const headingLike = rest.length > 0 && rest.length <= 24 && !/[。；;]$/.test(rest) && !/[，,]/.test(rest)
        accept = strong || empty || headingLike || (sec.style === null && n === 1) || (sec.style === 'number' && n === sec.expected) || (sec.style === 'number' && n > sec.expected && n <= sec.expected + 2)
        if (accept && sec.style !== 'number') sec.style = 'number'
        if (accept) sec.expected = n + 1
      }
      if (accept) {
        if (cur) { items.push(cur); sectionHadItem = true }
        let restClean = rest.replace(/[）)]+$/, '').trim()
        if ((rest.match(/【/g) || []).length !== (rest.match(/】/g) || []).length) restClean = restClean.replace(/】+$/, '').trim()
        cur = { section, no: marker, title: restClean, lines: [...pending, restClean], l0: i + 1, l1: i + 1 }
        pending = []; sectionHadItem = true
        return
      }
    }
    if (cur) { cur.lines.push(line); cur.l1 = i + 1 }
    else pending.push(line)
  })
  flushSection()
  return { items, sawSection }
}

function itemToRows(item) {
  const lines = item.lines.filter((l) => l !== '•')
  const title = item.title
  const titleIsHead = isHead(title)
  const hasQ = lines.some(isQ)
  const rows = []

  if (hasQ) {
    let cur = null
    const pre = []
    for (const l of lines) {
      if (isQ(l)) { if (cur) rows.push(cur); cur = { q: cleanMarker(l, 'q'), a: '', answered: false } }
      else if (isA(l)) {
        if (cur) { cur.a = appendLine(cur.a, cleanMarker(l, 'a')); cur.answered = true }
        else rows.push({ q: '', a: cleanMarker(l, 'a'), answered: true })
      } else if (cur) {
        if (cur.answered) cur.a = appendLine(cur.a, l)
        else cur.q = appendLine(cur.q, l)
      } else pre.push(l)
    }
    if (cur) rows.push(cur)
    if (!rows.length && pre.length) rows.push({ q: pre[0], a: pre.slice(1).join('\n'), answered: true })
    if (rows.length && pre.length) { const lead = pre.filter((x) => x !== title).join(' '); for (const r of rows) if (!r.q) r.q = lead || title }
    return rows.map((r) => ({ ...r, q: r.q || title }))
  }

  const heads = lines.filter(isHead)
  if (heads.length) {
    let cur = null
    for (const l of lines) {
      if (isHead(l)) { if (cur) rows.push(cur); cur = { q: l, a: '', lead: '' } }
      else if (cur) cur.a = appendLine(cur.a, l)
      else { /* pre-head, usually title */ }
    }
    if (cur) rows.push(cur)
    if (title && !titleIsHead) for (const r of rows) r.q = `${title} ${r.q}`
    return rows
  }

  const first = lines[0] || title
  const headingLike = first.length > 0 && first.length <= 24 && !/[。；;，,]$/.test(first) && !/[，,]/.test(first)
  if (headingLike && lines.length > 1) return [{ q: first, a: lines.slice(1).join('\n'), lead: '' }]
  const synth = `（${item.section}${item.no ? `第${item.no}条` : ''}）`
  return [{ q: synth, a: lines.join('\n'), lead: '' }]
}

/* ---------- build all rows ---------- */
const files = readdirSync(PART).filter((f) => f.endsWith('_判例文字_标注.txt')).sort()
const records = []
const skipped = []

for (const file of files) {
  const m = file.match(/^(\d{4}-\d\d-\d\d)_(.+?)_(\d+)_判例文字_标注\.txt$/)
  if (!m) { skipped.push({ file, reason: '文件名无法解析' }); continue }
  const opus = m[3]
  const meta = byOpus.get(opus)
  if (!meta) { skipped.push({ file, reason: '索引.csv 无对应 opus' }); continue }
  const source = stripPrefixNoise(meta.title)
  const pubTs = (() => {
    const p = join(SRC, '_details', `${opus}.json`)
    if (!existsSync(p)) return null
    const d = JSON.parse(readFileSync(p, 'utf8'))
    const a = d?.data?.item?.modules?.find((x) => x.module_type === 'MODULE_TYPE_AUTHOR')?.module_author
    return a?.pub_ts ? new Date(Number(a.pub_ts) * 1000).toISOString() : null
  })()

  const text = readFileSync(join(PART, file), 'utf8')
  const parsed = parseFile(text)
  let items = parsed.items
  if (!parsed.sawSection) {
    const body = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^=====/.test(l) && !isNoise(l) && !/^(标题|日期|原帖)[:：]/.test(l) && l !== meta.title).join('\n')
    items = [{ section: '', no: '', title: meta.title, lines: [meta.title], l0: 1, l1: 9999, _whole: true }]
    items[0]._body = body
  }

  let seq = 0
  for (const item of items) {
    let rows
    if (item._whole) rows = [{ q: item.title, a: item._body, lead: '' }]
    else rows = itemToRows(item)
    for (const r of rows) {
      const q = (r.q || '').trim()
      const a = (r.a || '').trim()
      if (!q && !a) { skipped.push({ file, reason: `item#${item.no} 空` }); continue }
      seq++
      const sourceId = `${opus}-${String(seq).padStart(2, '0')}`
      const cards = extractCardNos(`${q}\n${a}`)
      records.push({
        id: uuidv5(`riftbound-qa-ruling:${sourceId}`, UUID_NAMESPACE_URL),
        source, source_id: sourceId,
        question: 'Q：' + q.replace(/^[QＱ]\s*[:：]?\s*/, ''),
        answer: 'A：' + (a.replace(/^[AＡ]D?\s*[:：]?\s*/, '') || '（见判例原文）'),
        created_at: pubTs ?? '', updated_at: pubTs ?? '',
        section: item.section, opus, date: meta.date, cards,
        l0: item.l0, l1: item.l1
      })
    }
  }
}

/* ---------- write ---------- */
writeFileSync(join(OUT, 'qa_entries.csv'), toCsv(
  ['id', 'source', 'source_id', 'question', 'answer', 'question_en', 'answer_en', 'created_at', 'updated_at'],
  records.map((r) => ({ ...r, question_en: '', answer_en: '' }))
))
const links = []
for (const r of records) r.cards.forEach((card_no, i) => links.push({ qa_id: r.id, card_no, position: i }))
writeFileSync(join(OUT, 'qa_entry_cards.csv'), toCsv(['qa_id', 'card_no', 'position'], links))
writeFileSync(join(OUT, 'qa导入核对.csv'), toCsv(
  ['source_id', 'source', 'opus_id', '日期', '章节', '问题', '答案', '卡号', '起止行'],
  records.map((r) => ({ source_id: r.source_id, source: r.source, opus_id: r.opus, 日期: r.date, 章节: r.section, 问题: r.question, 答案: r.answer, 卡号: r.cards.join('、'), 起止行: `${r.l0}-${r.l1}` }))
))

/* ---------- report ---------- */
const perSource = new Map()
for (const r of records) perSource.set(r.source, (perSource.get(r.source) || 0) + 1)
const withCards = records.filter((r) => r.cards.length).length
const report = [
  '# 判例 → qa_entries 导入说明', '',
  `生成时间：${new Date().toISOString()}`, '',
  `- 条目总数（qa_entries 行）：${records.length}`,
  `- 卡牌关联（qa_entry_cards 行）：${links.length}`,
  `- 带卡牌的条目：${withCards} / ${records.length}`,
  `- 跳过：${skipped.length}`, '',
  '## 导入顺序（Supabase Table Editor → Import data from CSV）', '',
  '1. 先导入 `qa_entries.csv`（含 id / created_at / updated_at）',
  '2. 再导入 `qa_entry_cards.csv`（外键 qa_id → qa_entries.id、card_no → cards_base.card_no）', '',
  '## 各来源条目数', '', '| source | 条数 |', '|---|---:|',
  ...[...perSource.entries()].sort().map(([s, n]) => `| ${s} | ${n} |`), '',
  '## 说明 / 已知粗糙点', '',
  '- 文本取自已标注 OCR（卡名归一到 `【名字（副标题）】`），未做语句润色；OCR 换行、错字、重复括号均保留。',
  '- 判例正文中**编号列表**（如"1.将要打出… 2.做出必要的选择…"）可能被识别为独立条目，导入前可在核对表按行号甄别。',
  '- 无显式问句的判例条文，`question` 用 `（章节第N条）` 合成；小标题型条目用标题作为 `question`。',
  '- `source` 为该篇判例来源标题；`created_at`/`updated_at` 取 B 站 `pub_ts`（UTC）。', '',
  '## 待人工确认（跳过项）', '',
  ...(skipped.length ? skipped.map((s) => `- ${s.file}：${s.reason}`) : ['（无）'])
]
writeFileSync(join(OUT, 'qa导入说明.md'), report.join('\n') + '\n')

console.log(`files=${files.length} rows=${records.length} links=${links.length} skipped=${skipped.length}`)
console.log('per-source:'); for (const [s, n] of [...perSource.entries()].sort()) console.log(`  ${n}\t${s}`)
if (skipped.length) console.log('skipped:', skipped.map((s) => `${s.file}(${s.reason})`).join(' | '))