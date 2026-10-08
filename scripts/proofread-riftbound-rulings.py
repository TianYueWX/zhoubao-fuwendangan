#!/usr/bin/env python3
"""从原始 CSV 与人工原图校订清单生成独立核对稿；不连接数据库。"""
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED
import csv
import hashlib
import math
import os
import re
import runpy
import uuid

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / '赛后判例_图片'
INPUT = SRC / '_标注/qa导入'
EDIT_DATA = runpy.run_path(str(ROOT / 'scripts/ruling-proofread-edits.py'))
EDITS, ADDITIONS = EDIT_DATA['EDITS'], EDIT_DATA['ADDITIONS']
USER_REMOVALS = EDIT_DATA.get('USER_REMOVALS', set())
USER_REVIEW_NOTES = EDIT_DATA.get('USER_REVIEW_NOTES', {})
OUT = SRC / ('_校订/2026-10-05_筛选后' if USER_REMOVALS else '_校订/2026-10-05')
ENTRY_FIELDS = ['id', 'source', 'source_id', 'question', 'answer', 'question_en', 'answer_en', 'created_at', 'updated_at']
LINK_FIELDS = ['qa_id', 'card_no', 'position']
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
ET.register_namespace('', NS)
ET.register_namespace('r', REL)


def read_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def write_csv(path, fields, rows, bom=False):
    with path.open('w', encoding='utf-8-sig' if bom else 'utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n', extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(text, kind):
    """只做排版及无歧义的字词校正；规则内容来自人工 edits。"""
    s = str(text).strip()
    s = re.sub(r'^[QAＱＡ]\s*[0-9①-⑳]*\s*[:：]\s*', '', s)
    notes = []
    # 此尾句是图末致谢的残片，不是判例内容。
    closing = '赛事的热情和期待致以最诚挚的感谢。'
    if closing in s:
        s = s.replace(closing, '').strip()
        notes.append('删除串入答案的图片末尾致谢残片。')
    for old, new in [('自已', '自己'), ('自标', '目标'), ('已方', '己方'), ('给与', '给予')]:
        if old in s:
            s = s.replace(old, new)
            notes.append(f'“{old}”→“{new}”。')
    before = s
    s = s.translate(str.maketrans({',': '，', ';': '；', '?': '？', ':': '：', '(': '（', ')': '）'}))
    s = re.sub(r'<([^<>]+)>', r'〈\1〉', s)
    s = re.sub(r'([，。；：！？])\1+', r'\1', s)
    # 人工补标注时与既有括号重叠的情况。
    while '【【' in s or '】】' in s:
        s = s.replace('【【', '【').replace('】】', '】')
    s = re.sub(r'(?<=\d)\s+(?=[\u4e00-\u9fff])', '', s)
    s = re.sub(r'(?<=[\u4e00-\u9fff])\s+(?=[A-Za-z0-9])', '', s)
    s = re.sub(r'(?<=[A-Za-z])\s+(?=[\u4e00-\u9fff])', '', s)
    if s != before:
        notes.append('统一全角标点、括号、重复标点及数字／单位间空格。')
    before = s
    lines = [x.strip() for x in s.splitlines() if x.strip()]
    s = ''
    for line in lines:
        keep_break = kind == 'a' and s and (s[-1] in '。！？；：' or re.match(r'^\d+[.、]', line))
        s += ('\n' if keep_break else '') + line
    if s != before:
        notes.append('拼接OCR断行，保留答案段落与步骤分行。')
    if kind == 'a' and s and s[-1] not in '。！？；：' and not re.search(r'[。！？]）$', s):
        s += '。'
        notes.append('补齐答案末尾句号。')
    return ('Q：' if kind == 'q' else 'A：') + s, notes


def source_image(meta, spec, index):
    folder = SRC / index[meta['opus_id']]['本地文件夹']
    filename = spec.get('image')
    if not filename:
        annotated = next((SRC / '_标注/分篇').glob('*_' + meta['opus_id'] + '_判例文字_标注.txt'))
        upto = int(meta['起止行'].split('-')[0])
        for line in annotated.read_text().splitlines()[:upto]:
            m = re.match(r'^===== 图片\s+\d+[：:]([^=]+)=====', line)
            if m:
                filename = m[1].strip()
    if not filename:
        images = [p for p in folder.iterdir() if p.suffix.lower() in ('.jpg', '.png', '.jpeg')]
        if len(images) == 1:
            filename = images[0].name
    assert filename, meta
    path = folder / filename
    assert path.is_file(), path
    return os.path.relpath(path, OUT), path


def node(parent, tag, attrs=None, text=None):
    e = ET.SubElement(parent, '{' + NS + '}' + tag, attrs or {})
    if text is not None:
        e.text = str(text)
    return e


def xml(e):
    return ET.tostring(e, encoding='utf-8', xml_declaration=True)


def col_name(n):
    result = ''
    while n:
        n, r = divmod(n - 1, 26)
        result = chr(65 + r) + result
    return result


def styles_xml():
    e = ET.Element('{' + NS + '}styleSheet')
    fonts = node(e, 'fonts', {'count': '2'})
    for bold in [False, True]:
        f = node(fonts, 'font')
        node(f, 'sz', {'val': '11'})
        node(f, 'name', {'val': 'Arial'})
        node(f, 'color', {'rgb': 'FFFFFFFF' if bold else 'FF172B4D'})
        if bold:
            node(f, 'b')
    fills = node(e, 'fills', {'count': '7'})
    for pattern, color in [('none', None), ('gray125', None), ('solid', '243B53'), ('solid', 'F1F4F8'), ('solid', 'EAF6ED'), ('solid', 'FFF3CD'), ('solid', 'FDEDEC')]:
        p = node(node(fills, 'fill'), 'patternFill', {'patternType': pattern})
        if color:
            node(p, 'fgColor', {'rgb': 'FF' + color})
            node(p, 'bgColor', {'indexed': '64'})
    borders = node(e, 'borders', {'count': '1'})
    b = node(borders, 'border')
    for side in ['left', 'right', 'top', 'bottom', 'diagonal']:
        node(b, side)
    node(node(e, 'cellStyleXfs', {'count': '1'}), 'xf', {'numFmtId': '0', 'fontId': '0', 'fillId': '0', 'borderId': '0'})
    xfs = node(e, 'cellXfs', {'count': '7'})
    # 0 normal, 1 header, 2 original, 3 revised, 4 review, 5 excluded, 6 user input
    for i, (font, fill) in enumerate([(0, 0), (1, 2), (0, 3), (0, 4), (0, 5), (0, 6), (0, 5)]):
        xf = node(xfs, 'xf', {'numFmtId': '49', 'fontId': str(font), 'fillId': str(fill), 'borderId': '0', 'xfId': '0', 'applyAlignment': '1'})
        node(xf, 'alignment', {'vertical': 'top', 'wrapText': '1'})
    node(node(e, 'cellStyles', {'count': '1'}), 'cellStyle', {'name': 'Normal', 'xfId': '0', 'builtinId': '0'})
    return xml(e)


def write_xlsx(path, sheets):
    wb = ET.Element('{' + NS + '}workbook')
    node(node(wb, 'bookViews'), 'workbookView', {'activeTab': '0'})
    sl = node(wb, 'sheets')
    wb_rels = ET.Element('Relationships', {'xmlns': PKG})
    types = ET.Element('Types', {'xmlns': 'http://schemas.openxmlformats.org/package/2006/content-types'})
    for ext, typ in [('rels', 'application/vnd.openxmlformats-package.relationships+xml'), ('xml', 'application/xml')]:
        ET.SubElement(types, 'Default', {'Extension': ext, 'ContentType': typ})
    for part, typ in [('/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'), ('/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml')]:
        ET.SubElement(types, 'Override', {'PartName': part, 'ContentType': typ})
    root_rels = ET.Element('Relationships', {'xmlns': PKG})
    ET.SubElement(root_rels, 'Relationship', {'Id': 'rId1', 'Type': REL + '/officeDocument', 'Target': 'xl/workbook.xml'})
    with ZipFile(path, 'w', ZIP_DEFLATED) as z:
        z.writestr('_rels/.rels', xml(root_rels))
        z.writestr('xl/styles.xml', styles_xml())
        for sn, sheet in enumerate(sheets, 1):
            rid = 'rId' + str(sn)
            node(sl, 'sheet', {'name': sheet['name'], 'sheetId': str(sn), '{' + REL + '}id': rid})
            ET.SubElement(wb_rels, 'Relationship', {'Id': rid, 'Type': REL + '/worksheet', 'Target': f'worksheets/sheet{sn}.xml'})
            ET.SubElement(types, 'Override', {'PartName': f'/xl/worksheets/sheet{sn}.xml', 'ContentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'})
            ws = ET.Element('{' + NS + '}worksheet')
            rows, widths = sheet['rows'], sheet['widths']
            end = col_name(len(rows[0])) + str(len(rows))
            node(ws, 'dimension', {'ref': 'A1:' + end})
            v = node(node(ws, 'sheetViews'), 'sheetView', {'workbookViewId': '0', 'showGridLines': '0'})
            node(v, 'pane', {'xSplit': str(sheet.get('freeze', 0)), 'ySplit': '1', 'topLeftCell': col_name(sheet.get('freeze', 0)+1)+'2', 'activePane': 'bottomRight' if sheet.get('freeze', 0) else 'bottomLeft', 'state': 'frozen'})
            node(ws, 'sheetFormatPr', {'defaultRowHeight': '30'})
            cols = node(ws, 'cols')
            for cn, width in enumerate(widths, 1):
                node(cols, 'col', {'min': str(cn), 'max': str(cn), 'width': str(width), 'customWidth': '1'})
            data = node(ws, 'sheetData')
            for rn, row in enumerate(rows, 1):
                if rn == 1:
                    height = 30
                else:
                    height = min(409, max(38, 16 * max(sum(max(1, math.ceil(len(line)*1.7/max(8, widths[j]))) for line in str(value).split('\n')) for j, value in enumerate(row)) + 10))
                r = node(data, 'row', {'r': str(rn), 'ht': str(height), 'customHeight': '1'})
                for cn, value in enumerate(row, 1):
                    style = 1 if rn == 1 else sheet.get('styles', {}).get(cn, 0)
                    if rn > 1 and sheet.get('excluded_col') and row[sheet['excluded_col']-1] in ('排除／合并', '按要求移除'):
                        style = 5
                    c = node(r, 'c', {'r': col_name(cn)+str(rn), 't': 'inlineStr', 's': str(style)})
                    t = node(node(c, 'is'), 't', {'{http://www.w3.org/XML/1998/namespace}space': 'preserve'}, str(value))
            if sheet.get('filter', True):
                node(ws, 'autoFilter', {'ref': 'A1:' + end})
            links = sheet.get('links', {})
            if links:
                hs = node(ws, 'hyperlinks')
                rels = ET.Element('Relationships', {'xmlns': PKG})
                for ln, (cell, target) in enumerate(links.items(), 1):
                    lrid = 'rId' + str(ln)
                    node(hs, 'hyperlink', {'ref': cell, '{' + REL + '}id': lrid})
                    ET.SubElement(rels, 'Relationship', {'Id': lrid, 'Type': REL + '/hyperlink', 'Target': target, 'TargetMode': 'External'})
                z.writestr(f'xl/worksheets/_rels/sheet{sn}.xml.rels', xml(rels))
            node(ws, 'pageMargins', {'left': '0.3', 'right': '0.3', 'top': '0.4', 'bottom': '0.4', 'header': '0.2', 'footer': '0.2'})
            z.writestr(f'xl/worksheets/sheet{sn}.xml', xml(ws))
        ET.SubElement(wb_rels, 'Relationship', {'Id': 'rIdStyles', 'Type': REL + '/styles', 'Target': 'styles.xml'})
        z.writestr('[Content_Types].xml', xml(types))
        z.writestr('xl/workbook.xml', xml(wb))
        z.writestr('xl/_rels/workbook.xml.rels', xml(wb_rels))


def main():
    import json
    originals = [p for p in SRC.rglob('*') if p.is_file() and '_校订' not in p.parts]
    hashes = {str(p.relative_to(ROOT)): hash_file(p) for p in originals}
    entries = read_csv(INPUT / 'qa_entries.csv')
    metas = read_csv(INPUT / 'qa导入核对.csv')
    old_links = read_csv(INPUT / 'qa_entry_cards.csv')
    assert len(entries) == len(metas) == 171
    index = {r['Opus ID']: r for r in read_csv(SRC / '索引.csv')}
    cards = json.loads((SRC / '_标注/cards_dict.json').read_text())
    names, card_names = defaultdict(list), {}
    for c in cards:
        display = c['card_name_cn'] + ('（' + c['sub_title_cn'] + '）' if c.get('sub_title_cn') else '')
        names[display].append(c['card_no'])
        card_names[c['card_no']] = display
    valid_cards = {r['card_no'] for r in read_csv(ROOT / 'public/data/cards_base_rows.csv')}
    previous = defaultdict(list)
    for link in old_links:
        previous[link['qa_id']].append(link['card_no'])
    by_parent = defaultdict(list)
    for a in ADDITIONS:
        by_parent[a['parent']].append(a)
    output, audits, links, unknowns = [], [], [], []
    headers = ['原序号', '处理', '原问题', '校订问题', '原答案', '校订答案', '修改说明', '重点复核', '我的核对结果', '来源', '索引日期', '原图', '原卡号', '校订卡号', 'source_id', 'id', '章节', '原起止行', '关联变化']
    non_cards = {'待命', '瞬息', '燃尽', '警告', '单局判负', '禁赛', '取消资格', '取消比赛资格', '支付卡牌费用'}
    for n, (entry, meta) in enumerate(zip(entries, metas), 1):
        assert entry['source_id'] == meta['source_id']
        assert entry['question'] == meta['问题'] and entry['answer'] == meta['答案']
        specs = [(str(n), EDITS.get(n, {}), False)] + [(f'{n}-{a["suffix"]}', a, True) for a in by_parent[n]]
        for label, spec, new in specs:
            row = dict(entry)
            original_q, original_a = ('', '') if new else (entry['question'], entry['answer'])
            if new:
                row['source_id'] = entry['source_id'] + '-' + spec['suffix']
                row['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'riftbound-qa-ruling:' + row['source_id']))
            q, a = entry['question'], entry['answer']
            for old, replacement in spec.get('replace', []):
                assert old in q or old in a, (n, old)
                q, a = q.replace(old, replacement), a.replace(old, replacement)
            q = spec.get('q') if spec.get('q') is not None else q
            a = spec.get('a') if spec.get('a') is not None else a
            q, q_notes = normalize(q, 'q')
            a, a_notes = normalize(a, 'a')
            user_removed = label in USER_REMOVALS
            drop = spec.get('drop', False) or user_removed
            row.update(question=q, answer=a)
            nos = []
            if not drop:
                for match in re.finditer(r'【([^】]+)】', q + '\n' + a):
                    name = match[1]
                    if name not in names and name not in non_cards:
                        unknowns.append({'原序号': label, '名称': name})
                    for no in names.get(name, []):
                        if no not in nos:
                            nos.append(no)
                output.append(row)
                links.extend({'qa_id': row['id'], 'card_no': no, 'position': pos} for pos, no in enumerate(nos))
            old_nos = [] if new else previous[entry['id']]
            link_changes = []
            if set(old_nos) - set(nos):
                link_changes.append('移除：' + '、'.join(no + ' ' + card_names[no] for no in old_nos if no not in nos))
            if set(nos) - set(old_nos):
                link_changes.append('补充：' + '、'.join(no + ' ' + card_names[no] for no in nos if no not in old_nos))
            notes = list(dict.fromkeys(([spec['note']] if spec.get('note') else []) + ([] if drop else q_notes + a_notes)))
            if user_removed:
                notes.insert(0, '按用户指定的原序号移除；不导入问答及其卡牌关联。')
            if not notes:
                notes = ['已对照原图，正文无需修改。']
            image_ref, image_path = source_image(meta, spec, index)
            changed = original_q != q or original_a != a or bool(link_changes)
            status = '按要求移除' if user_removed else '排除／合并' if drop else '新增／拆出' if new else '已校订' if changed else '核对无改动'
            audit = dict(zip(headers, [label, status, original_q, q if user_removed or not drop else '', original_a, a if user_removed or not drop else '',
                '\n'.join(notes), USER_REVIEW_NOTES.get(label, spec.get('review', '')), '', row['source'], meta['日期'], image_ref,
                '、'.join(old_nos), '、'.join(nos), row['source_id'], row['id'], spec.get('section') or meta['章节'], meta['起止行'], '\n'.join(link_changes)]))
            audits.append(audit)
    assert not unknowns, unknowns
    assert len(output) == 172 - len(USER_REMOVALS) and len(audits) == 178
    assert {r['原序号'] for r in audits if r['处理'] == '按要求移除'} == USER_REMOVALS
    excluded = [r for r in audits if r['处理'] in ('排除／合并', '按要求移除')]
    removed = [r for r in audits if r['处理'] == '按要求移除']
    retained = [r for r in audits if r['处理'] not in ('排除／合并', '按要求移除')]
    assert len(retained) == len(output)
    if '62' in USER_REMOVALS and '62-b' not in USER_REMOVALS:
        assert any(r['原序号'] == '62-b' for r in retained)
    assert len({r['id'] for r in output}) == len(output)
    assert len({r['source_id'] for r in output}) == len(output)
    ids = {r['id'] for r in output}
    bracket_pairs = {'【': '】', '（': '）', '〈': '〉'}
    for r in output:
        uuid.UUID(r['id'])
        for field, prefix in [('question', 'Q：'), ('answer', 'A：')]:
            s = r[field]
            assert s.startswith(prefix) and len(s) > 2
            assert not re.search(r'[QA]\d*[:：]', s[2:]), (r['source_id'], '内嵌问答', s)
            stack = []
            for ch in s:
                if ch in bracket_pairs:
                    stack.append(bracket_pairs[ch])
                elif ch in bracket_pairs.values():
                    assert stack and stack.pop() == ch, (r['source_id'], '括号不匹配', s)
            assert not stack, (r['source_id'], '括号未闭合', s)
            assert not re.search(r'自已|自标|已方|给与|。。|，，|】】|【【|赛事的热情和期待致以最诚挚的感谢', s)
        for field in ['created_at', 'updated_at']:
            datetime.fromisoformat(r[field].replace('Z', '+00:00'))
    assert len({(r['qa_id'], r['card_no']) for r in links}) == len(links)
    assert all(r['qa_id'] in ids and r['card_no'] in valid_cards for r in links)
    for qa_id in ids:
        positions = [r['position'] for r in links if r['qa_id'] == qa_id]
        assert positions == list(range(len(positions)))
    OUT.mkdir(parents=True, exist_ok=True)
    write_csv(OUT / 'qa_entries.csv', ENTRY_FIELDS, output)
    write_csv(OUT / 'qa_entry_cards.csv', LINK_FIELDS, links)
    write_csv(OUT / '逐条校订核对.csv', headers, retained, bom=True)
    write_csv(OUT / '排除与合并.csv', headers, excluded, bom=True)
    write_csv(OUT / '本次移除.csv', headers, removed, bom=True)
    priority = [r for r in retained if r['重点复核'] or r['处理'] == '新增／拆出' or re.search(r'共用|共同前提|上一问|原表|混入|串入问题|将误放|从答案|原图本身|原图也|原图“中', r['修改说明'])]
    removed_labels = '、'.join(r['原序号'] for r in removed)
    summaries = [['项目', '内容'], ['输入与原图', '原CSV 171条；18篇来源；42张本地原图均已目视核对。'],
        ['输出', f'导入问答{len(output)}条；卡牌关联{len(links)}条；全量核对{len(retained)}行。'],
        ['本次筛选', f'按用户选择移除{len(removed)}条：{removed_labels}。保留62-b；未指定的63-b等条目继续保留。'],
        ['条目调整', '首版补回／拆出7条；排除页眉噪声1条；把5条内部步骤合并回第104条。本版进一步按用户选择筛选。保留原id与source_id，原序号不重编号。'],
        ['先看哪里', '先看“重点复核”，再看“全量核对”。黄底“我的核对结果”可填写通过／修改／暂缓。灰底是原文，绿底是校订文，红底为排除或合并行。'],
        ['如何对照', '全量表只列保留条目，原序号沿用首版标签；排除行放入“排除与合并”，本次指定移除另列“本次移除”。点击“原图”可打开对应本地原图。'],
        ['历史答案', '按你的选择移除52/81，保留84/85。104条仍有当期适用范围说明；已移除的91/92、120、136条疑点不再列入保留条目。'],
        ['字段说明', 'source与时间戳沿用原CSV；created_at/updated_at为原B站pub_ts（UTC）。索引日期是本地目录日期，可能与pub_ts不同。英文列沿用原空值。'],
        ['CSV导入顺序', '先qa_entries.csv，再qa_entry_cards.csv。两文件只有数据库列，无核对说明。对应卡号已核对本地cards_base，线上是否已有相同id或卡号未查询。'],
        ['已有数据时', '本CSV适用于该批判例首次导入。若已导入旧版，同id/source_id不可直接重复插入，还需要更新旧行及处理被合并的旧条目。'],
        ['核对后的修改', 'Excel仅供核对。修改Excel不会自动同步CSV；需同步修改两份CSV后再导入。不要直接把“全量核对”工作表导入数据库。'],
        ['完成导入后', '网站已有客户端QA缓存；在管理后台执行QA发布动作，让客户端刷新。'],
        ['生成方式', f'python scripts/proofread-riftbound-rulings.py；仅写入{OUT.relative_to(SRC)}，不改原CSV、不连接Supabase。']]
    widths = [10, 14, 46, 46, 68, 68, 55, 48, 18, 44, 14, 24, 32, 32, 34, 40, 20, 12, 48]
    def audit_sheet(name, data):
        return {'name': name, 'rows': [headers] + [[r[c] for c in headers] for r in data], 'widths': widths,
                'freeze': 2, 'styles': {3: 2, 4: 3, 5: 2, 6: 3, 8: 4, 9: 6}, 'excluded_col': 2,
                'links': {f'L{n}': r['原图'] for n, r in enumerate(data, 2)}}
    sheets = [{'name': '说明', 'rows': summaries, 'widths': [24, 120], 'filter': False},
              audit_sheet('重点复核', priority), audit_sheet('全量核对', retained),
              {'name': '问答导入稿', 'rows': [ENTRY_FIELDS] + [[r[c] for c in ENTRY_FIELDS] for r in output],
               'widths': [40, 48, 34, 72, 95, 20, 20, 29, 29], 'freeze': 3},
              {'name': '卡牌关联', 'rows': [LINK_FIELDS + ['卡名']] + [[r[c] for c in LINK_FIELDS] + [card_names[r['card_no']]] for r in links],
               'widths': [40, 18, 12, 40], 'freeze': 1}, audit_sheet('本次移除', removed), audit_sheet('排除与合并', excluded)]
    workbook = OUT / '赛后判例校订核对.xlsx'
    write_xlsx(workbook, sheets)
    # 独立回读序列化产物：检查 CSV 换行转义和 XLSX 单元格没有截断。
    assert read_csv(OUT / 'qa_entries.csv') == output
    assert read_csv(OUT / 'qa_entry_cards.csv') == [{k: str(v) for k, v in r.items()} for r in links]
    with ZipFile(workbook) as z:
        assert z.testzip() is None
        for name in z.namelist():
            if name.endswith('.xml') or name.endswith('.rels'):
                ET.fromstring(z.read(name))
        for sn, sheet in enumerate(sheets, 1):
            e = ET.fromstring(z.read(f'xl/worksheets/sheet{sn}.xml'))
            recovered = [[c.find('{' + NS + '}is/{' + NS + '}t').text or '' for c in r] for r in e.find('{' + NS + '}sheetData')]
            assert recovered == [[str(v) for v in r] for r in sheet['rows']], sheet['name']
    assert all(hash_file(ROOT / name) == value for name, value in hashes.items())
    report = {'校订日期': '2026-10-05', '原条目': 171, '来源篇数': len(index), '已目视核对原图': 42,
              '问答导入行': len(output), '卡牌关联行': len(links), '核对行': len(retained), '重点复核行': len(priority),
              '首版新增拆出': len(ADDITIONS), '本次移除': len(removed), '本次移除原序号': [r['原序号'] for r in removed],
              '全部排除合并': len(excluded), '处理统计': dict(Counter(r['处理'] for r in retained)),
              '检查': {'id及source_id唯一': True, '所有问答非空': True, '问答标记与括号': True,
                       '卡号在本地cards_base存在': True, '所有关联主键及外键': True, 'position从0连续': True,
                       'CSV序列化回读': True, 'XLSX压缩包与XML与全量单元格回读': True, '原始文件SHA256不变': True,
                       '按指定原序号精确移除': True, '保留62-b': any(r['原序号'] == '62-b' for r in retained)},
              '范围限制': '未连接Supabase；未验证线上数据、未核验历史判例是否仍适用于最新规则。',
              '原文件SHA256': hashes}
    (OUT / '校验报告.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    counts = Counter(r['source'] for r in output)
    readme = f'''# 赛后判例校订筛选稿（2026-10-05）

已逐页目视核对18篇、42张本地原图，处理原CSV的171条记录，得到{len(output)}条问答与{len(links)}条卡牌关联。原始CSV、OCR和图片均未改动。没有向Supabase写入数据。

## 先核对

打开 `赛后判例校订核对.xlsx`：先看“重点复核”，再看“全量核对”。每行都有原文、校订文、修改说明、原卡号／新卡号、来源和原图链接；“我的核对结果”留空供填写。原序号是旧CSV不含表头的行号，`40-b`等是新增／拆出的行。

- 本次按首版“全量核对”的原序号移除{len(removed)}条：{removed_labels}；保留62-b。未指定的63-b等条目继续保留，不因父条目移除而连带删除。
- “全量核对”仅保留{len(retained)}条，原序号不重编号；“本次移除”列出此次移除条目，“排除与合并”列出全部{len(excluded)}条排除记录。
- 首版172条问答经本次筛选后为{len(output)}条，卡牌关联也同步移除。原有171条CSV及首版校订目录均保留。
- 第52/81条已移除，保留84/85的上海后续裁定。第91/92、120、136条疑点随条目移除；第104条的当期适用范围说明仍保留。本次未核验最新规则。
- Excel和两份CSV是独立文件。你修改Excel后，需要把确认的改动同步到CSV；更改卡名时还需同步关联表。

## 导入Supabase

以下用于本批判例首次导入到已有表。先确认相关卡牌已在 `public.cards_base` 中；关联的卡号已和本地 `public/data/cards_base_rows.csv` 核对，但没有查询线上表。

1. 在Table Editor选择 `public.qa_entries`，使用CSV导入 `qa_entries.csv`（{len(output)}行）。保留文件自带id与source_id。
2. 导入成功后，选择 `public.qa_entry_cards`，导入 `qa_entry_cards.csv`（{len(links)}行）。不要反转顺序。
3. 核对行数与卡牌关联，并在网站管理后台执行QA发布动作，以更新客户端缓存。

`逐条校订核对.csv`、`本次移除.csv`、`排除与合并.csv`和Excel核对工作表只供阅读，不是数据库导入文件。

如果旧版判例（原171条或首版172条）已经入库，相同id/source_id会冲突，本文件不能作为追加导入重复插入；更新旧行、移除合并旧条目和同步关联需要另行处理。不要为解决冲突清空整个QA表。

两份导入CSV使用UTF-8无BOM、标准逗号分隔与引号转义；英文列沿用原空值。原有条目保持id/source_id/source/created_at/updated_at，新条目用父条目source_id加-b后缀及原规则UUIDv5。原时间戳取B站pub_ts（UTC），与本地索引日期可能不同。

导入方式参考：[Supabase官方CSV导入文档](https://supabase.com/docs/guides/database/import-data)。

## 检查与重建

详见 `校验报告.json`：唯一键、问答内容、括号、卡牌关联、position、CSV回读、XLSX压缩包／XML／全部单元格回读、原文件SHA256均通过。未连接线上数据库。

在项目目录执行 `python scripts/proofread-riftbound-rulings.py` 可重建本目录。人工校订依据在 `scripts/ruling-proofread-edits.py`，重建会覆盖本目录的生成稿，请先保留你手工修改的副本。

## 各来源导入行数

| 来源 | 条数 |
|---|---:|
'''
    readme += ''.join(f'| {name} | {count} |\n' for name, count in counts.items())
    (OUT / '导入与核对说明.md').write_text(readme)
    print(json.dumps({k: v for k, v in report.items() if k != '原文件SHA256'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
