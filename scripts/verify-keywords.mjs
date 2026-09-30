/* ================================================================
 * scripts/verify-keywords.mjs
 *
 * 纯函数验收:关键词提取规则引擎(src/tools/admin/keywords.ts)。
 *
 * 为什么单独验:这套规则是从库里 556 张卡的人工填写结果**反向工程**出来的,
 * 是「一键添加关键词」唯一的正确性来源。它一旦漂移,体检清单就会开始
 * 自动往库里写错词 —— 而这种错会静默扩散到全表。
 *
 * 用例分两段:
 *   A. 规则单测       —— 黑名单 / 归一化 / 英文映射 / 差异
 *   B. 线上真实卡面   —— 从 Supabase 抄下来的原文,含两个已知陷阱:
 *                        RAD-001 的「其具有{{部署}}」(描述指示物,不是这张牌的词)
 *                        ARC-002 的「后排」(文本推不出,是人工看提示语填的)
 *
 *   node --experimental-strip-types --import ./scripts/register-hooks.mjs \
 *        scripts/verify-keywords.mjs
 * ================================================================ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/tools/admin/keywords.ts');

const runner = `
import {
  normalizeMark, extractCnHits, extractEnHits, suggestKeywords, diffKeywords, RULE_SUMMARY
} from ${JSON.stringify(target)};

const results = [];

function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  results.push({ label, ok, actual, wanted });
}
function expectTrue(label, cond, detail) {
  results.push({ label, ok: !!cond, actual: detail, wanted: 'truthy' });
}
/** 只关心关键词列表时,把命中压成字符串数组 */
const kws = (card) => suggestKeywords(card).map((h) => h.keyword);

/* ══════════════ A. 规则单测 ══════════════ */

/* ── ① 黑名单:符号与费用数字 ── */
expect('大写符号 S 被丢弃', normalizeMark('S'), null);
expect('小写 s 被丢弃(现有 SYMBOL_RE 抓不到的那个)', normalizeMark('s'), null);
expect('字母 T 被丢弃', normalizeMark('T'), null);
expect('字母 C 被丢弃', normalizeMark('C'), null);
expect('纯数字 1 被丢弃', normalizeMark('1'), null);
expect('二位数 11 被丢弃', normalizeMark('11'), null);
expect('零 0 被丢弃', normalizeMark('0'), null);

/* ── ① 黑名单:颜色与状态 ── */
expect('纯颜色词 红色 被丢弃', normalizeMark('红色'), null);
expect('纯颜色词 紫色 被丢弃', normalizeMark('紫色'), null);
expect('横置 被丢弃(动作不是关键词)', normalizeMark('横置'), null);
expect('已强化 被丢弃(状态不是关键词)', normalizeMark('已强化'), null);
expect('已强化> 被丢弃(状态条件前缀)', normalizeMark('已强化>'), null);
expect('版面噪音 >> 被丢弃', normalizeMark('>>'), null);

/* ── ② 归一化:费用型去数字 ── */
expect('强化1黄色黄色 → 强化', normalizeMark('强化1黄色黄色'), '强化');
expect('强化AA → 强化', normalizeMark('强化AA'), '强化');
expect('强化12 → 强化', normalizeMark('强化12'), '强化');
expect('强化6紫色紫色 → 强化', normalizeMark('强化6紫色紫色'), '强化');
expect('强化橙色橙色 → 强化', normalizeMark('强化橙色橙色'), '强化');
expect('回响2 → 回响', normalizeMark('回响2'), '回响');
expect('回响4蓝色 → 回响', normalizeMark('回响4蓝色'), '回响');
expect('流转3A → 流转', normalizeMark('流转3A'), '流转');
expect('流转4黄色黄色 → 流转', normalizeMark('流转4黄色黄色'), '流转');
expect('装配橙色 → 装配', normalizeMark('装配橙色'), '装配');
expect('装配1蓝色 → 装配', normalizeMark('装配1蓝色'), '装配');
expect('装配A → 装配', normalizeMark('装配A'), '装配');

/* ── ② 归一化:效果型保留数字 ── */
expect('强攻2 保留数字', normalizeMark('强攻2'), '强攻2');
expect('强攻 无数字原样', normalizeMark('强攻'), '强攻');
expect('坚守3 保留数字', normalizeMark('坚守3'), '坚守3');
expect('法盾2 保留数字', normalizeMark('法盾2'), '法盾2');
expect('燃烧1 保留数字', normalizeMark('燃烧1'), '燃烧1');
expect('洞察5 保留数字', normalizeMark('洞察5'), '洞察5');
expect('狩猎2 保留数字', normalizeMark('狩猎2'), '狩猎2');
expect('缴械2 保留数字', normalizeMark('缴械2'), '缴械2');

/* ── ② 归一化:条件前缀去 > ── */
expect('等级6> → 等级6', normalizeMark('等级6>'), '等级6');
expect('级数两位数 等级11> → 等级11', normalizeMark('等级11>'), '等级11');
expect('迅捷> → 迅捷', normalizeMark('迅捷>'), '迅捷');
expect('反应> → 反应', normalizeMark('反应>'), '反应');
expect('鼓舞> → 鼓舞', normalizeMark('鼓舞>'), '鼓舞');
expect('>绝念> → 绝念(去首尾)', normalizeMark('>绝念>'), '绝念');

/* ── 保留:你确认过不进黑名单的三个词 ── */
expect('亮出 保留', normalizeMark('亮出'), '亮出');
expect('部署 保留', normalizeMark('部署'), '部署');
expect('后排 保留', normalizeMark('后排'), '后排');

/* ── ③ 英文映射 ── */
expect('英文方括号提取:唯一与动作',
  kws({ effect_en: '[Unique] (Your deck can have only 1 card with this name.)[Equip] :rb_rune_rainbow:' }),
  ['唯我', '装配']);
expect('英文参数按空格切分:[Assault 2] → 强攻2',
  kws({ effect_en: 'I have [Assault 2] while attacking.' }), ['强攻2']);
expect('英文 [Shield 3] → 坚守3(实测纠正:坚守是 Shield 不是 Tank)',
  kws({ effect_en: 'I have [Shield 3] while defending.' }), ['坚守3']);
expect('英文 [Tank] → 壁垒',
  kws({ effect_en: '[Tank] (I must be assigned combat damage first.)' }), ['壁垒']);
expect('[Level 6] → 等级6',
  kws({ effect_en: '[Level 6] [Reaction] — [Add] :rb_energy_1:.' }), ['等级6', '反应', '获得']);
expect('[Quick-Draw] → 灵便', normalizeMark('灵便'), '灵便');
expect('英文 [Empowered] 被丢弃(状态)',
  kws({ effect_en: '[Empowered] I get +1 :rb_might:.' }), []);
expect('英文 [&gt;] 被丢弃(条件前缀)',
  kws({ effect_en: '[Deathknell][&gt;] Channel 1 rune.' }), ['绝念']);
expect('英文 HTML 标签不影响提取',
  kws({ effect_en: '<p>[Hidden] (Hide now.)<br />Draw 1.</p>' }), ['待命']);
expect('未知英文方括号不产出(如 [NO TEXT])',
  kws({ effect_en: '[NO TEXT]' }), []);

/* ── 中文与英文合并去重:中文优先 ── */
const merged = suggestKeywords({ effect_cn: '{{反应}}', effect_en: '[Reaction]' });
expect('中英同词只留一条', merged.length, 1);
expect('中英同词取中文来源', merged[0].from, 'cn');

/* ── 中文独有的词(英文没有对应方括号) ── */
expect('缴械 中文独有', kws({ effect_cn: '{{缴械}}一名单位。' }), ['缴械']);
expect('部署 中文独有', kws({ effect_cn: '{{部署}}（仅能将此牌打出到战场上。）' }), ['部署']);

/* ── 边界 ── */
expect('null 卡牌安全', suggestKeywords(null), []);
expect('undefined 卡牌安全', suggestKeywords(undefined), []);
expect('双空文本返回空数组', kws({ effect_cn: null, effect_en: null }), []);
expect('无标记文本返回空数组', kws({ effect_cn: '抽一张牌。' }), []);
expect('只有符号的文本返回空数组',
  kws({ effect_cn: '获得{{S}}+1，支付{{1}}和{{红色}}。' }), []);
expect('重复标记去重', kws({ effect_cn: '{{反应}}…{{反应}}' }), ['反应']);
expect('保序:按出现顺序而非字典序',
  kws({ effect_cn: '{{迅捷}}{{待命}}{{反应}}' }), ['迅捷', '待命', '反应']);
expect('中文命中带原文标记', extractCnHits('{{强化1黄色黄色}}')[0].mark, '强化1黄色黄色');

/* ── diffKeywords:只加不删 ── */
const d1 = diffKeywords(['反应'], suggestKeywords({ effect_cn: '{{反应}}{{迅捷}}' }));
expect('diff 新增缺失的词', d1.add.map((h) => h.keyword), ['迅捷']);
expect('diff 保留已有的词', d1.kept, ['反应']);
expect('diff 无孤儿', d1.orphan, []);
const d2 = diffKeywords(['后排'], suggestKeywords({ effect_cn: '抽一张牌。' }));
expect('diff 推不出的词进 orphan 而不是被删', d2.orphan, ['后排']);
expect('diff orphan 不计入新增', d2.add, []);
const d3 = diffKeywords(null, suggestKeywords({ effect_cn: '{{反应}}' }));
expect('diff 对 null 当前值安全', d3.add.map((h) => h.keyword), ['反应']);

/* ── 规则清单与实现同源 ── */
expectTrue('RULE_SUMMARY 有内容', RULE_SUMMARY.length >= 6, RULE_SUMMARY.length);
expectTrue('RULE_SUMMARY 含黑名单说明',
  RULE_SUMMARY.some((r) => r.label.includes('黑名单')), RULE_SUMMARY.map((r) => r.label).join(' / '));

/* ══════════════ B. 线上真实卡面 ══════════════ */

/* RAD-001 业余爆破狂 —— 已知陷阱:{{部署}} 是在描述「炸弹」指示物,不是这张牌自己 */
const rad001 = suggestKeywords({
  effect_cn: '当你打出我时，将一个“炸弹”装备指示物打出到一处战场。（其具有{{部署}}。当其被摧毁时，对该处的一名敌方单位造成2点伤害，并摧毁你在该处的其他“炸弹”。）',
  effect_en: ''
});
expect('RAD-001 提取到 部署', rad001.map((h) => h.keyword), ['部署']);
expectTrue('RAD-001 的上下文能看出这是描述指示物(「其具有」)',
  (rad001[0].before + rad001[0].after).includes('其具有'), rad001[0].before + '〖' + rad001[0].hit + '〗' + rad001[0].after);
expect('RAD-001 命中片段就是标记内容', rad001[0].hit, '部署');
expect('RAD-001 被标记为疑似描述他人', rad001[0].suspect, true);

/* RAD-155 德玛西亚皇子 —— 换主语的写法(「拥有{{部署}}的装备」)。
   已知漏报:预警只认「其…」。宁可漏报也不误报,见 keywords.ts 的注释。 */
const rad155 = suggestKeywords({
  effect_cn: '当你打出一件拥有{{部署}}的装备时，你可以选择让我变为休眠状态并支付{{A}}，以此将一名友方单位移动到该战场。'
});
expect('RAD-155 已知漏报:换主语时不打预警', rad155[0].suspect, false);

/* 假阳性守卫 —— 这几张都是本牌「赋予」己方关键词,编务要记,绝不能打预警,
   否则界面会怂恿人把正确的词删掉 */
const rad063 = suggestKeywords({
  effect_cn: '只要我处于法术对决中，你的法术便具有{{反应}}。（可在任意时机打出，甚至先于其他法术和技能的结算。）'
});
expect('RAD-063 卡莎:赋予己方法术「反应」不打预警', rad063[0].suspect, false);
const rad055 = suggestKeywords({ effect_cn: '你的“机械”具有{{缴械}}。（当每个此类单位进攻时，给予该处的一名敌方单位-1战力。）' });
expect('RAD-055 叮响巡警:赋予己方单位不打预警', rad055[0].suspect, false);
const rad147 = suggestKeywords({ effect_cn: '{{T}}：给予一名友方单位在本回合内“我具有等同于自身{{坚守}}的强攻。”' });
expect('RAD-147:主语是「我」不打预警', rad147.find((h) => h.keyword === '坚守').suspect, false);
const rad002 = suggestKeywords({ effect_cn: '{{部署}}（仅能将此牌打出到战场上。）\\n此处的友方单位具有{{强攻}}。' });
expect('RAD-002 征服之旗:「此处的友方单位具有」不打预警', rad002.find((h) => h.keyword === '强攻').suspect, false);
expect('RAD-002 自己的 部署 也不打预警', rad002.find((h) => h.keyword === '部署').suspect, false);

/* 反例:SFD-197 沙漠皇帝「你的黄沙士兵获得{{百炼}}」—— 编务确实会记本牌赋予他人的关键词,
   所以「获得」不能进预警句式,否则每次都要人工取消勾选 */
const sfd197 = suggestKeywords({ effect_cn: '你的“黄沙士兵”获得{{百炼}}。支付{{1}}，{{横置}}：打出一名2{{S}}的“黄沙士兵”到你的基地。' });
expect('SFD-197 赋予他人的关键词也被提取', sfd197.map((h) => h.keyword), ['百炼']);
expect('SFD-197 不误报为疑似(「获得」不算转述句式)', sfd197[0].suspect, false);

/* RAD-002 征服之旗 —— 真正的部署牌 + 强攻 */
expect('RAD-002 提取 部署 与 强攻',
  kws({
    effect_cn: '{{部署}}（仅能将此牌打出到战场上。当对手据守此处时，摧毁此牌。）\\n此处的友方单位具有{{强攻}}。（只要他们是进攻方，便{{S}}+1。）'
  }),
  ['部署', '强攻']);

/* ARC-002 凯特琳 —— 文本里没有标记,但人工填了 后排 */
const arc002 = suggestKeywords({
  effect_cn: '我在战斗中最后承担伤害。\\r\\n{{横置}}：对任意战场中的一个敌方单位造成等同于我战力的伤害。我必须位于战场中才能使用此技能。'
});
expect('ARC-002 文本推不出任何词(横置被黑名单挡住)', arc002.map((h) => h.keyword), []);
expect('ARC-002 的 后排 落入 orphan,不会因提取不到而被清掉',
  diffKeywords(['后排'], arc002).orphan, ['后排']);

/* VEN-136 安蓓萨 —— 费用粘连 + 效果参数同卡共存 */
expect('VEN-136 强化去费用、强攻2 留参数',
  kws({
    effect_cn: '{{强化1黄色黄色}}（支付{{1}}和{{黄色}}{{黄色}}：强化我。仅在未强化时可用。）\\r\\n {{已强化>}} 我获得{{强攻2}}。（如果我是进攻方，则{{S}}+2。）'
  }),
  ['强化', '强攻2']);

/* UNL-049 蜜糖果实 —— 条件前缀与嵌套噪音 */
/* 注意保序:第二行先出 反应/获得,第三行才出 等级6 */
expect('UNL-049 等级6 去条件符、>> 被丢弃、按出现顺序',
  kws({
    effect_cn: '此牌以休眠状态进场。\\n{{反应>}} {{横置}}：{{获得}}{{A}}。\\n{{等级6>}} {{>>}}{{反应>}} {{横置}}：{{获得}} {{1}}和{{A}}。'
  }),
  ['反应', '获得', '等级6']);

/* VEN-078 枯爪巴凯 —— {{>绝念>}} 这种双端条件写法 */
expect('VEN-078 >绝念> 归一为绝念',
  kws({ effect_cn: '{{已强化>}}{{>绝念>}} 召出两枚休眠的符文。' }), ['绝念']);

/* SFD-003 血性冲刺 —— 英文比中文干净:中文 {{回响1}} 英文 [Repeat] */
expect('SFD-003 英文侧提取',
  kws({
    effect_en: '[Action] (Play on your turn or in showdowns.)[Repeat] :rb_energy_1: (You may pay the additional cost to repeat the effect.) Give a unit [Assault 2] this turn.'
  }),
  ['迅捷', '回响', '强攻2']);

for (const r of results) {
  console.log(\`  \${r.ok ? '✓' : '✗'} \${r.label}\`);
  if (!r.ok) console.log(\`      got: \${JSON.stringify(r.actual)}\\n      want: \${JSON.stringify(r.wanted)}\`);
}
const failed = results.filter(r => !r.ok).length;
console.log(\`\\n──────── 结果:\${results.length - failed} 通过 / \${failed} 失败 ────────\`);
process.exit(failed === 0 ? 0 : 1);
`;

const out = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--input-type=module', '-e', runner],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
);

const stdout = (out.stdout || '').replace(/ExperimentalWarning[^\n]*\n?/g, '');
process.stdout.write(stdout);
if (out.status !== 0) {
  process.stderr.write((out.stderr || '').replace(/ExperimentalWarning[^\n]*\n?/g, ''));
}
process.exit(out.status ?? 1);
