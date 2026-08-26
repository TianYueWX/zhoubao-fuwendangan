// scripts/wrap-china-map.mjs
//
// 把 vendor/china-geo.raw.json(DataV GeoAtlas 原始数据)
// 打包成 public/china-geo.js,内容形如 `window.chinaGeoJson = {...};`。
//
// 这样部署产物能通过 <script src="./china-geo.js"> 在 file:// 协议下同步加载,
// 绕开 fetch + CORS 问题。Vite 构建时会把 public/ 原样拷贝到 dist/。
//
// 用法:    pnpm run wrap:china-map
//              或 手动 node scripts/wrap-china-map.mjs

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

const rawPath = join(root, 'vendor', 'china-geo.raw.json');
const outPath = join(root, 'public', 'china-geo.js');

const raw = readFileSync(rawPath, 'utf8');
const parsed = JSON.parse(raw);
const featuresCount = Array.isArray(parsed?.features) ? parsed.features.length : 0;

writeFileSync(outPath, 'window.chinaGeoJson = ' + JSON.stringify(parsed) + ';\n', 'utf8');

const outSize = statSync(outPath).size;
console.log(
  `✔ Wrapped ${featuresCount} features → public/china-geo.js (${(outSize / 1024).toFixed(1)} KB)`
);
