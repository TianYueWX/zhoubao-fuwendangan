// Confirmed against matching Chinese/English effect fields in the shipped card catalog.
// Unknown names remain editable; never guess champion or faction translations.
export const KEYWORDS: Record<string, string> = {
  迅捷: 'Action',
  反应: 'Reaction',
  游走: 'Ganking',
  瞬息: 'Temporary',
  伏击: 'Ambush',
  壁垒: 'Tank',
  强力: 'Mighty',
  绝念: 'Deathknell',
  预知: 'Vision',
  狩猎: 'Hunt',
  待命: 'Hidden',
  已强化: 'Empowered',
  眩晕: 'Stun',
  鼓舞: 'Legion',
  法盾: 'Deflect',
  强化: 'Empower',
  强攻: 'Assault',
  后排: 'Backline',
};
export const TAGS: Record<string, string> = {
  英雄: 'Champion',
  专属: 'Signature',
  装备: 'Equipment',
  ...KEYWORDS,
};
export function translateTags(text: string): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const tags = text
    .split(/[·,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const match = /^(.*?)(\s*\d+)?$/.exec(s),
        term = match?.[1] ?? s,
        suffix = match?.[2]?.trim() ?? '';
      const en = TAGS[term];
      if (!en) {
        unknown.push(s);
        return s;
      }
      return en + (suffix ? ` ${suffix}` : '');
    });
  return { text: tags.join(' · '), unknown };
}
