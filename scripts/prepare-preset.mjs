/* ================================================================
 * scripts/prepare-preset.mjs
 *
 * 把本地全量数据包整理进 public/data/ 并生成 manifest.json:
 *   node scripts/prepare-preset.mjs [--src <数据包目录>] [--id s4-w3] [--label "第四赛季·第三周"]
 *
 * - 静态卡表(cards_base / card_prints)复制到 public/data/ 顶层,随站点预加载,
 *   每包不再重复携带
 * - 每包复制 3 个赛事文件(deck/rank/shop)到 public/data/<id>/ 下
 * - 生成 public/data/manifest.json(供前端 PresetLoader fetch)
 * - 默认 src 为仓库根目录下的「城市赛第四赛季第三周_全量数据包」
 * ============================================================== */
import {
  readdirSync,
  readFileSync,
  statSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync
} from 'node:fs';
import { resolve, join, basename } from 'node:path';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const ROOT = resolve(process.cwd());
const SRC = resolve(arg('--src', join(ROOT, '城市赛第四赛季第三周_全量数据包')));
const ID = arg('--id', 's4-w3');
const LABEL = arg('--label', '第四赛季 · 第三周(2026-08-23)');
const OUT_DIR = resolve(ROOT, 'public/data');

/** 每包槽位 → 文件名关键词(与前端 detectSlotFromFilename 一致) */
const SLOT_PATTERNS = [
  { slot: 'deck', re: /decks_data.*\.csv$/i },
  { slot: 'rank', re: /rank_data.*\.json$/i },
  { slot: 'shop', re: /shop_data.*\.json$/i }
];

/** 静态卡表:只发一份到 public/data/ 顶层(前端启动时预加载) */
const STATIC_PATTERNS = [
  { slot: 'base', re: /cards_base.*\.csv$/i },
  { slot: 'prints', re: /card_prints.*\.csv$/i }
];

if (!existsSync(SRC)) {
  console.error(`✗ 数据包目录不存在: ${SRC}`);
  process.exit(1);
}

const files = readdirSync(SRC).filter((f) => statSync(join(SRC, f)).isFile());

// 1) 静态卡表 → 顶层(随站点预加载)
for (const { slot, re } of STATIC_PATTERNS) {
  const match = files.find((f) => re.test(f));
  if (!match) {
    console.warn(`⚠ 未找到静态卡表 ${slot} 的匹配文件`);
    continue;
  }
  const size = statSync(join(SRC, match)).size;
  copyFileSync(join(SRC, match), join(OUT_DIR, match));
  console.log(`  [静态] ${slot.padEnd(6)} → data/${match} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

// 2) 每包 3 个赛事文件
const entries = [];
for (const { slot, re } of SLOT_PATTERNS) {
  const match = files.find((f) => re.test(f));
  if (!match) {
    console.warn(`⚠ 未找到槽位 ${slot} 的匹配文件`);
    continue;
  }
  const size = statSync(join(SRC, match)).size;
  entries.push({ slot, path: `${ID}/${match}`, size });
  console.log(`  ${slot.padEnd(6)} ← ${match} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

if (entries.length < 1) {
  console.error('✗ 未找到任何赛事文件,终止');
  process.exit(1);
}

// 复制文件 + 清理包目录内不再需要的旧文件(如旧清单的 base/prints)
const pkgDir = join(OUT_DIR, ID);
mkdirSync(pkgDir, { recursive: true });
const keep = new Set(entries.map((e) => basename(e.path)));
for (const f of readdirSync(pkgDir)) {
  const full = join(pkgDir, f);
  if (statSync(full).isFile() && !keep.has(f)) {
    unlinkSync(full);
    console.log(`  清理旧文件 ${ID}/${f}`);
  }
}
for (const e of entries) {
  copyFileSync(join(SRC, basename(e.path)), join(OUT_DIR, e.path));
}

// 3) 读取并合并 manifest
const manifestPath = join(OUT_DIR, 'manifest.json');
let manifest = { version: 1, generatedAt: new Date().toISOString(), packages: [] };
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.warn('⚠ manifest.json 解析失败,重建');
  }
}
manifest.packages = manifest.packages.filter((p) => p.id !== ID);
manifest.packages.push({ id: ID, label: LABEL, fileCount: entries.length, files: entries });
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

const totalMB = (entries.reduce((s, e) => s + e.size, 0) / 1024 / 1024).toFixed(1);
console.log(`✓ 完成:${entries.length} 个赛事文件 (${totalMB} MB) → public/data/${ID}/`);
console.log(`✓ manifest.json 已更新:共 ${manifest.packages.length} 个预设包`);
