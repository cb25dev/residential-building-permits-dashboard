import { useMemo, useRef, useState } from 'react';
import { searchIndex, type SearchItem } from '../lib/search';
import type { County, GeoIndex } from '../lib/types';

interface Props {
  counties: County[];
  geo: GeoIndex;
  onPick: (item: SearchItem) => void;
}

export function SearchBox({ counties, geo, onPick }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const index = useMemo(() => searchIndex(counties, geo), [counties, geo]);
  const results = useMemo(() => index.search(q, 8), [index, q]);
  const box = useRef<HTMLInputElement>(null);

  const pick = (it: SearchItem) => {
    onPick(it);
    setQ('');
    setOpen(false);
    box.current?.blur();
  };

  return (
    <div className="search" role="combobox" aria-expanded={open && results.length > 0} aria-haspopup="listbox">
      <input
        ref={box}
        type="search"
        placeholder="Search a county or state…"
        aria-label="Search counties and states"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, results.length - 1)); e.preventDefault(); }
          if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault(); }
          if (e.key === 'Enter' && results[active]) pick(results[active]);
          if (e.key === 'Escape') { setOpen(false); box.current?.blur(); }
        }}
      />
      {open && results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((r, i) => (
            <li key={r.kind + r.id} role="option" aria-selected={i === active}
                className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
              <span className="kind">{r.kind === 'state' ? 'State' : 'County'}</span>
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
