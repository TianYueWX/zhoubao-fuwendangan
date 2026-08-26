/* ================================================================
 * src/utils/workerParse.ts
 *
 * Worker 解析的 Promise 封装(v3):
 *   parseInWorker(text, kind, onProgress) → Promise<unknown>
 *   - 自动创建/复用单个 Worker,完成后 terminate
 *   - 失败时抛错,进度经 onProgress 回调
 * ============================================================== */

import ParseWorker from '@/workers/parse.worker?worker';
import type {
  ParseErrorMsg,
  ParseProgressMsg,
  ParseRequest,
  ParseResultMsg
} from '@/workers/parse.worker';

export interface ParseProgress {
  stage: string;
  pct: number;
}

let worker: InstanceType<typeof ParseWorker> | null = null;
let seq = 0;

function getWorker(): InstanceType<typeof ParseWorker> {
  if (!worker) worker = new ParseWorker();
  return worker;
}

/**
 * 在后台解析文本。
 * @param text 原始文本(CSV 或 JSON)
 * @param kind 解析类型
 * @param onProgress 进度回调(阶段名 + 0-100)
 */
export function parseInWorker(
  text: string,
  kind: 'csv' | 'json',
  onProgress?: (p: ParseProgress) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const w = getWorker();

    function cleanup(): void {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      w.terminate();
      worker = null;
    }

    function onMsg(ev: MessageEvent<ParseProgressMsg | ParseResultMsg | ParseErrorMsg>): void {
      const m = ev.data;
      if (!m || m.id !== id) return;
      if (m.type === 'progress') {
        onProgress?.({ stage: m.stage, pct: m.pct });
        return;
      }
      cleanup();
      if (m.type === 'result') resolve(m.data);
      else reject(new Error(m.message));
    }

    function onErr(ev: ErrorEvent): void {
      cleanup();
      reject(new Error(ev.message || 'Worker 解析失败'));
    }

    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ id, type: kind, text } satisfies ParseRequest);
  });
}
