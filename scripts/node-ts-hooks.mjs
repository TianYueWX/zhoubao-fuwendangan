/* 仅为本地运行 smoke.ts 提供 Node 原生 TS 支持:
 * 1) '@/' 路径别名 → src/
 * 2) 无扩展名的相对导入 → 自动补 .ts / /index.ts
 * 不参与构建(tsconfig 已排除 scripts)。
 * 用法:node --experimental-strip-types --import ./scripts/register-hooks.mjs smoke.ts
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.cwd();

function tryResolve(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}/index.ts`,
    `${base}/index.mts`,
    `${base}/index.cts`
  ];
  for (const c of candidates) {
    if (existsSync(c) && !statSync(c).isDirectory()) return c;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  let target = null;
  if (specifier.startsWith('@/')) {
    target = tryResolve(pathResolve(ROOT, 'src', specifier.slice(2)));
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentDir = context.parentURL
      ? dirname(fileURLToPath(context.parentURL))
      : ROOT;
    target = tryResolve(pathResolve(parentDir, specifier));
  }
  if (target) {
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  return next(specifier, context);
}
