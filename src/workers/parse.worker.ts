/* ================================================================
 * src/workers/parse.worker.ts
 *
 * 后台解析 Worker(v3):
 *   - 大文件(数十 MB CSV / JSON)在主线程外解析,UI 不卡顿
 *   - CSV 用 PapaParse chunk 回调报告真实进度;JSON 按阶段报告
 * 协议:
 *   in : { id, type:'csv'|'json', text }
 *   out: { id, type:'progress', stage, pct } … { id, type:'result', data } | { id, type:'error', message }
 * ============================================================== */

/// <reference lib="webworker" />
import Papa from 'papaparse';

export type ParseRequest =
  | { id: number; type: 'csv'; text: string }
  | { id: number; type: 'json'; text: string };

export type ParseProgressMsg = { id: number; type: 'progress'; stage: string; pct: number };
export type ParseResultMsg = { id: number; type: 'result'; data: unknown };
export type ParseErrorMsg = { id: number; type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** 报告进度(节流:至少 50ms 一次) */
function makeReporter(id: number) {
  let last = 0;
  return (stage: string, pct: number, force = false): void => {
    const now = Date.now();
    if (!force && now - last < 50) return;
    last = now;
    ctx.postMessage({ id, type: 'progress', stage, pct } satisfies ParseProgressMsg);
  };
}

function parseCsv(id: number, text: string): void {
  const report = makeReporter(id);
  const rows: Record<string, string | null>[] = [];
  Papa.parse<Record<string, string | null>>(text, {
    header: true,
    skipEmptyLines: true,
    chunk: (results: Papa.ParseResult<Record<string, string | null>>) => {
      rows.push(...(results.data as Record<string, string | null>[]));
      report('解析 CSV', Math.min(99, (rows.length / 200_000) * 100));
    },
    complete: () => {
      report('完成', 100, true);
      ctx.postMessage({ id, type: 'result', data: rows } satisfies ParseResultMsg);
    },
    error: (err: Error) => {
      ctx.postMessage({ id, type: 'error', message: err.message } satisfies ParseErrorMsg);
    }
  });
}

function parseJson(id: number, text: string): void {
  const report = makeReporter(id);
  report('读取文本', 25);
  // 交给宏任务让 progress 有机会先送达
  setTimeout(() => {
    try {
      report('解析 JSON', 60);
      const data = JSON.parse(text);
      report('完成', 100, true);
      ctx.postMessage({ id, type: 'result', data } satisfies ParseResultMsg);
    } catch (e) {
      ctx.postMessage({
        id,
        type: 'error',
        message: e instanceof Error ? e.message : String(e)
      } satisfies ParseErrorMsg);
    }
  }, 0);
}

ctx.onmessage = (ev: MessageEvent<ParseRequest>) => {
  const req = ev.data;
  if (!req || typeof req.id !== 'number') return;
  try {
    if (req.type === 'csv') parseCsv(req.id, req.text);
    else parseJson(req.id, req.text);
  } catch (e) {
    ctx.postMessage({
      id: req.id,
      type: 'error',
      message: e instanceof Error ? e.message : String(e)
    } satisfies ParseErrorMsg);
  }
};
