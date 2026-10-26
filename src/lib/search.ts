import type { County, GeoIndex } from './types';

export interface SearchItem {
  kind: 'state' | 'county';
  id: string; // state FIPS or county GEOID
  label: string;
  key: string;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function searchIndex(counties: County[], geo: GeoIndex) {
  const items: SearchItem[] = [
    ...Object.entries(geo.states).map(([fp, s]) => ({ kind: 'state' as const, id: fp, label: s.name, key: norm(`${s.name} ${s.st}`) })),
    ...counties.map((c) => ({ kind: 'county' as const, id: c.geoid, label: `${c.name}, ${c.st}`, key: norm(`${c.name} ${c.st} ${c.state} ${c.geoid}`) })),
  ];
  return {
    search(q: string, limit = 8): SearchItem[] {
      const n = norm(q);
      if (!n) return [];
      const words = n.split(' ');
      const scored: [number, SearchItem][] = [];
      for (const it of items) {
        if (!words.every((w) => it.key.includes(w))) continue;
        let score = it.key.startsWith(n) ? 0 : it.key.split(' ').some((t) => t.startsWith(words[0])) ? 1 : 2;
        if (it.kind === 'state' && score < 2) score -= 0.5; // states first on equal match
        if (/^\d{2,5}$/.test(n) && it.id.startsWith(n)) score = -1; // FIPS lookup
        scored.push([score, it]);
      }
      scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label));
      return scored.slice(0, limit).map((s) => s[1]);
    },
  };
}
