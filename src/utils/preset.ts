/* ================================================================
 * src/utils/preset.ts
 *
 * 预设数据包加载(v3):
 *   - loadPresetManifest():fetch public/data/manifest.json
 *   - fetchPresetFiles(entry, onProgress):按槽位拉取 5 个文件,
 *     返回 { slot, fileName, text }[](喂给现有槽位解析流程)
 * 依赖 HTTP 环境(Cloudflare Pages / vite dev);file:// 下 fetch 失败,
 * 由调用方降级提示改用上传。
 * ============================================================== */

import type { PresetFileEntry, PresetManifest, PresetPackageMeta } from '@/types';

/** manifest 相对 public/ 的路径 */
const MANIFEST_URL = `${import.meta.env.BASE_URL}data/manifest.json`;

export interface PresetFileContent {
  slot: PresetFileEntry['slot'];
  fileName: string;
  text: string;
}

export interface PresetProgress {
  /** 已完成的文件数 */
  done: number;
  /** 总文件数 */
  total: number;
  /** 0-1 */
  ratio: number;
  /** 当前文件名 */
  fileName: string;
}

/** 读取预设清单;不存在或解析失败返回 null(调用方提示用上传) */
export async function loadPresetManifest(base = MANIFEST_URL): Promise<PresetManifest | null> {
  try {
    const res = await fetch(base, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as PresetManifest;
  } catch {
    return null;
  }
}

/** 拉取一个预设包的全部文件(文本形式,喂给现有 CSV/JSON 解析) */
export async function fetchPresetFiles(
  pkg: PresetPackageMeta,
  onProgress?: (p: PresetProgress) => void
): Promise<PresetFileContent[]> {
  const results: PresetFileContent[] = [];
  let done = 0;
  const total = pkg.files.length;
  for (const f of pkg.files) {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${f.path}`, { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`预设文件加载失败: ${f.path} (HTTP ${res.status})`);
    }
    const text = await res.text();
    results.push({ slot: f.slot, fileName: f.path.split('/').pop() ?? f.path, text });
    done += 1;
    onProgress?.({ done, total, ratio: done / Math.max(total, 1), fileName: f.path });
  }
  return results;
}

/** 预设包是否可用(manifest 存在且含该包) */
export function findPreset(manifest: PresetManifest | null, id: string): PresetPackageMeta | null {
  return manifest?.packages.find((p) => p.id === id) ?? null;
}
