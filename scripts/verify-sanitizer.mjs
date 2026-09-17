/* ================================================================
 * scripts/verify-sanitizer.mjs
 *
 * 纯函数验收:档案文本的标签白名单过滤。
 *
 * 为什么单独验:编辑部要把库里的 effect_en 渲染成预览,而库里存着真实 HTML。
 * 直接 v-html 等于给自己开一个存储型 XSS 口子。src/tools/admin/text.ts 的
 * 白名单是这条链路上唯一的安全控制,必须证明它真的拦得住,而不是靠注释声明。
 *
 *   node --experimental-strip-types scripts/verify-sanitizer.mjs
 * ================================================================ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 直接用 node 的类型剥离跑 TS 源码(项目已有同款做法,见 package.json 的 smoke)
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/tools/admin/text.ts');

const runner = `
import { sanitizeCardText, renderEffectPreview, extractMarks } from ${JSON.stringify(target)};

const results = [];

function expect(label, actual, wanted) {
  const ok = actual === wanted;
  results.push({ label, ok, actual, wanted });
}

/* ── 必须被剥掉 ── */
expect('script 标签及其内容被整体移除',
  sanitizeCardText('<script>alert(1)</script>安全文本'), '安全文本');
expect('img 标签(含 onerror)被移除',
  sanitizeCardText('<img src=x onerror="alert(1)">'), '');
expect('白名单标签保留,事件属性丢弃',
  sanitizeCardText('<p onclick="steal()">段落</p>'), '<p>段落</p>');
expect('a 标签被移除(连带 javascript: 协议)',
  sanitizeCardText('<a href="javascript:alert(1)">点</a>'), '点');
expect('iframe 被移除',
  sanitizeCardText('<iframe src="//evil"></iframe>'), '');
expect('style 标签及其内容被整体移除',
  sanitizeCardText('<style>body{display:none}</style>正文'), '正文');
expect('标记内部的标签被剥离',
  sanitizeCardText('{{<svg onload=alert(1)>}}'), '{{}}');
expect('标记内部文本被转义',
  renderEffectPreview('{{a<b}}'), '<span class="effect-mark">a&lt;b</span>');
expect('renderEffectPreview 不产出可执行标签',
  renderEffectPreview('{{<img onerror=alert(1)>}}').includes('<img'), false);

/* ── 必须保留 ── */
expect('合法段落原样保留', sanitizeCardText('<p>合法</p>'), '<p>合法</p>');
expect('换行标签保留', sanitizeCardText('a<br>b'), 'a<br>b');
expect('纯文本不受影响', sanitizeCardText('如果你打出过法术'), '如果你打出过法术');
expect('空值安全', sanitizeCardText(null), '');
expect('undefined 安全', sanitizeCardText(undefined), '');

/* ── 功能:标记渲染与提取 ── */
expect('标记渲染成高亮 span',
  renderEffectPreview('支付{{紫色}}费用'),
  '支付<span class="effect-mark">紫色</span>费用');
expect('标记提取去重保序',
  JSON.stringify(extractMarks('{{A}} x {{A}} {{B}}')), JSON.stringify(['A', 'B']));
expect('无标记时返回空数组', JSON.stringify(extractMarks('无标记')), '[]');

for (const r of results) {
  console.log(\`  \${r.ok ? '✓' : '✗'} \${r.label}\`);
  if (!r.ok) console.log(\`      got: \${JSON.stringify(r.actual)}\\n      want: \${JSON.stringify(r.wanted)}\`);
}
const failed = results.filter(r => !r.ok).length;
console.log(\`\\n──────── 结果:\${results.length - failed} 通过 / \${failed} 失败 ────────\`);
process.exit(failed === 0 ? 0 : 1);
`;

const out = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', runner], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

const stdout = (out.stdout || '').replace(/ExperimentalWarning[^\n]*\n?/g, '');
process.stdout.write(stdout);
if (out.status !== 0) {
  process.stderr.write((out.stderr || '').replace(/ExperimentalWarning[^\n]*\n?/g, ''));
}
process.exit(out.status ?? 1);
