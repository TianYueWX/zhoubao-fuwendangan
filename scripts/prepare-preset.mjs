/* ================================================================
 * scripts/prepare-preset.mjs
 *
 * 把本地全量数据包整理进 public/data/ 并生成 manifest.json:
 *   node scripts/prepare-preset.mjs [--src <数据包目录>] [--id s4-w3] [--label "第四赛季·第三周"]
 *
 * - 复制 5 个必需/推荐文件到 public/data/<id>/ 下(按文件名关键词匹配槽位)
 * - 生成 public/data/manifest.json(供前端 PresetLoader fetch)
 * - 默认 src 为仓库根目录下的「城市赛第四赛季第三周_全量数据包」
 * ============================================================== */
import { readdirSync, readFileSync, statSync, copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
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

/** 槽位 → 文件名关键词(与前端 detectSlotFromFilename 一致) */
const SLOT_PATTERNS = [
  { slot: 'deck', re: /decks_data.*\.csv$/i },
  { slot: 'base', re: /cards_base.*\.csv$/i },
  { slot: 'prints', re: /card_prints.*\.csv$/i },
  { slot: 'rank', re: /rank_data.*\.json$/i },
  { slot: 'shop', re: /shop_data.*\.json$/i }
];

if (!existsSync(SRC)) {
  console.error(`✗ 数据包目录不存在: ${SRC}`);
  process.exit(1);
}

const files = readdirSync(SRC).filter((f) => statSync(join(SRC, f)).isFile());
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

if (entries.length < 3) {
  console.error('✗ 必需槽位不足(deck/base/prints),终止');
  process.exit(1);
}

// 复制文件
const pkgDir = join(OUT_DIR, ID);
mkdirSync(pkgDir, { recursive: true });
for (const e of entries) {
  copyFileSync(join(SRC, basename(e.path)), join(OUT_DIR, e.path));
}

// 读取并合并 manifest
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
console.log(`✓ 完成:${entries.length} 个文件 (${totalMB} MB) → public/data/${ID}/`);
console.log(`✓ manifest.json 已更新:共 ${manifest.packages.length} 个预设包`);
