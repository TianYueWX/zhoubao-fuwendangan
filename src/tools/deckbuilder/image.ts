import { ZONES, LABELS, countZone, resolveEntry, kind, type BuilderDeck, type CardIndex, type DeckEntry, type Zone } from './model';

export async function buildDeckImage(deck: BuilderDeck, index: CardIndex, problems: number): Promise<{ blob: Blob; missing: number }> {
  const width = 1500, padding = 48, columns = 6, gap = 18, cardWidth = (width - 2 * padding - (columns - 1) * gap) / columns, cellHeight = cardWidth * 1040 / 744 + 64;
  const groups: { label: string; entries: DeckEntry[]; zone: Zone }[] = [];
  for (const zone of ZONES) {
    if (!deck.zones[zone].length) continue;
    if (zone === 'main') {
      for (const type of ['单位', '法术', '装备', '其他']) {
        const entries = deck.zones.main.filter(e => { const r = resolveEntry(e, index).record; return (r ? kind(r) : '其他') === type; });
        if (entries.length) groups.push({ label: `主牌堆 · ${type}`, entries, zone });
      }
    } else groups.push({ label: LABELS[zone], entries: deck.zones[zone], zone });
  }
  const height = Math.ceil(180 + groups.reduce((h, g) => h + 76 + Math.ceil(g.entries.length / columns) * cellHeight, 0) + 64);
  if (height > 30000) throw new Error('卡组图片过长，请使用文字清单分享');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法生成卡组图片');
  ctx.fillStyle = '#F4F1EA'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#B23A27'; ctx.fillRect(padding, 36, width - 2 * padding, 3);
  ctx.fillStyle = '#2C2C2C'; ctx.font = 'bold 44px "Noto Serif SC", serif'; ctx.fillText(deck.name, padding, 102, width - 2 * padding);
  ctx.fillStyle = '#3B4A5A'; ctx.font = '22px system-ui'; ctx.fillText(`符文档案 · 卡组构筑   主牌 ${countZone(deck, 'main')} + 英雄 ${countZone(deck, 'champion')}   ${problems ? `构筑问题 ${problems} 项` : '构筑清单'}`, padding, 144);
  const images = new Map<string, ImageBitmap | null>();
  const urls = [...new Set(groups.flatMap(g => g.entries.map(e => resolveEntry(e, index).print?.imageUrl || resolveEntry(e, index).print?.ttsUrl || '').filter(Boolean)))];
  for (let i = 0; i < urls.length; i += 6) await Promise.all(urls.slice(i, i + 6).map(async url => {
    try { const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error(); images.set(url, await createImageBitmap(await response.blob())); }
    catch { images.set(url, null); }
  }));
  let missing = 0, y = 180;
  for (const group of groups) {
    ctx.fillStyle = '#2C2C2C'; ctx.font = 'bold 27px system-ui'; ctx.fillText(`${group.label}  ·  ${group.entries.reduce((n, e) => n + e.quantity, 0)} 张`, padding, y + 32);
    ctx.strokeStyle = '#3b4a5a40'; ctx.beginPath(); ctx.moveTo(padding, y + 48); ctx.lineTo(width - padding, y + 48); ctx.stroke(); y += 68;
    group.entries.forEach((entry, i) => {
      const x = padding + (i % columns) * (cardWidth + gap), top = y + Math.floor(i / columns) * cellHeight, imageHeight = cardWidth * 1040 / 744;
      const { record, print, name } = resolveEntry(entry, index);
      const image = images.get(print?.imageUrl || print?.ttsUrl || '');
      ctx.fillStyle = '#FBF9F3'; ctx.fillRect(x, top, cardWidth, imageHeight);
      if (image) {
        if (record?.base.categories.includes('战场')) { ctx.save(); ctx.translate(x + cardWidth / 2, top + imageHeight / 2); ctx.rotate(-Math.PI / 2); const fieldHeight = cardWidth * 744 / 1040; ctx.drawImage(image, -fieldHeight / 2, -cardWidth / 2, fieldHeight, cardWidth); ctx.restore(); }
        else ctx.drawImage(image, x, top, cardWidth, imageHeight);
      } else { missing++; ctx.fillStyle = '#3B4A5A'; ctx.font = '20px system-ui'; ctx.fillText(name, x + 12, top + 44, cardWidth - 24); ctx.font = '16px system-ui'; ctx.fillText(entry.printNo, x + 12, top + 74, cardWidth - 24); }
      ctx.fillStyle = '#B23A27'; ctx.fillRect(x + cardWidth - 64, top, 64, 38); ctx.fillStyle = '#FFF8F0'; ctx.font = 'bold 23px system-ui'; ctx.fillText(`×${entry.quantity}`, x + cardWidth - 59, top + 28, 55);
      ctx.fillStyle = '#2C2C2C'; ctx.font = 'bold 18px system-ui'; ctx.fillText(name, x, top + imageHeight + 25, cardWidth); ctx.fillStyle = '#3B4A5A'; ctx.font = '16px system-ui'; ctx.fillText(`${entry.printNo} · ${entry.language}`, x, top + imageHeight + 48, cardWidth);
    });
    y += Math.ceil(group.entries.length / columns) * cellHeight;
  }
  for (const bitmap of images.values()) bitmap?.close();
  ctx.fillStyle = '#8A8478'; ctx.font = '18px system-ui'; ctx.fillText('符文档案 · 分享时的构筑快照', padding, height - 28);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片生成失败')), 'image/png'));
  return { blob, missing };
}
