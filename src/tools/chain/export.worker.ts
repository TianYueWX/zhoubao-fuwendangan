import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { Output, BufferTarget, Mp4OutputFormat, CanvasSource, canEncodeVideo } from 'mediabunny';
import { AREA_ORDER, type ChainSnapshot } from './types';
import { renderFrame } from './renderFrame';
export interface ExportJob { snapshots: ChainSnapshot[]; name: string; format: 'gif' | 'mp4'; width: number; images: Record<string, string> }
self.onmessage = async (event: MessageEvent<ExportJob>) => {
  const job = event.data, canvas = new OffscreenCanvas(job.width, job.width * 9 / 16);
  const ctx = canvas.getContext('2d', { willReadFrequently: job.format === 'gif' })!;
  const images = new Map<string, ImageBitmap>(); let missing = 0;
  try {
    const ids = [...new Set(job.snapshots.flatMap((s) => AREA_ORDER.flatMap((a) => s.board.areas[a].cards.map((c) => c.cardId))))].filter((id) => job.images[id]);
    for (let i = 0; i < ids.length; i += 6) {
      await Promise.all(ids.slice(i, i + 6).map(async (id) => {
        try { const response = await fetch(job.images[id]!, { signal: AbortSignal.timeout(10000) }); if (!response.ok) throw Error(); images.set(id, await createImageBitmap(await response.blob())); } catch { missing++; }
      }));
      self.postMessage({ progress: .1 * Math.min(1, (i + 6) / Math.max(1, ids.length)), label: '正在准备卡图…' });
    }
    const fps = 12, frames = job.snapshots.map((s) => Math.round((s.duration ?? 2) * fps));
    const total = frames.reduce((a, b) => a + b, 0); let done = 0;
    let output: Output | undefined, source: CanvasSource | undefined, target: BufferTarget | undefined;
    let fallback: import('h264-mp4-encoder').H264MP4Encoder | undefined;
    const gif = job.format === 'gif' ? GIFEncoder() : undefined;
    if (!gif) {
      if (await canEncodeVideo('avc', { width: canvas.width, height: canvas.height, bitrate: 6_000_000, frameRate: fps })) {
        target = new BufferTarget(); output = new Output({ format: new Mp4OutputFormat(), target });
        source = new CanvasSource(canvas, { codec: 'avc', bitrate: 6_000_000 }); output.addVideoTrack(source, { frameRate: fps }); await output.start();
      } else {
        const h264 = await import('h264-mp4-encoder'); fallback = await h264.createH264MP4Encoder();
        fallback.width = canvas.width; fallback.height = canvas.height; fallback.frameRate = fps; fallback.kbps = 6000; fallback.speed = 10; fallback.initialize();
      }
    }
    for (let i = 0; i < job.snapshots.length; i++) {
      const snap = job.snapshots[i]!, length = frames[i]!;
      for (let f = 0; f < length; f++) {
        const transition = i === 0 ? 1 : Math.min(1, (f + 1) / 4);
        // GIF holds a finished frame with a duration instead of writing identical copies.
        if (gif && f > 3) { done += length - f; break; }
        renderFrame(ctx, snap, job.name, i, job.snapshots.length, images, job.snapshots[i - 1], transition);
        if (gif) { const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data; const palette = quantize(rgba, 256); gif.writeFrame(applyPalette(rgba, palette), canvas.width, canvas.height, { palette, delay: (Math.round((f === 3 ? length : f + 1) * 100 / fps) - Math.round(f * 100 / fps)) * 10, repeat: 0 }); }
        else if (source) await source.add(done / fps, 1 / fps);
        else fallback!.addFrameRgba(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        done++; self.postMessage({ progress: .1 + .85 * done / total, label: `正在生成步骤 ${i + 1} / ${job.snapshots.length}` });
      }
    }
    self.postMessage({ progress: .97, label: '正在封装文件…' });
    let bytes: Uint8Array;
    if (gif) { gif.finish(); bytes = gif.bytes(); }
    else if (output) { await output.finalize(); bytes = new Uint8Array(target!.buffer!); }
    else { fallback!.finalize(); bytes = fallback!.FS.readFile(fallback!.outputFilename); fallback!.delete(); }
    const buffer = bytes.slice().buffer; self.postMessage({ complete: buffer, missing }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '导出失败' });
  } finally { images.forEach((image) => image.close()); }
};
