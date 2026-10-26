import maplibregl, { type FilterSpecification, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { geoUrl } from '../lib/data';
import type { Paint } from '../lib/model';
import { SPECIAL } from '../lib/scales';

export interface MapHandle {
  fitBounds: (b: [number, number, number, number], maxZoom?: number) => void;
  reset: () => void;
}

interface Props {
  fullBounds: [number, number, number, number];
  paints: Map<string, Paint>;
  selected: string | null;
  compare: string[];
  onHover: (geoid: string | null, point: { x: number; y: number } | null) => void;
  onSelect: (geoid: string | null, additive: boolean) => void;
  ariaLabel: string;
}

function patternImage(bg: string, ink: string, kind: 'diag' | 'anti' | 'dots'): ImageData {
  const n = kind === 'dots' ? 6 : 8;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, n, n);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = 1.2;
  if (kind === 'dots') {
    g.beginPath();
    g.arc(n / 2, n / 2, 0.9, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    const d = kind === 'diag' ? 1 : -1;
    for (let o = -n; o <= n * 2; o += n) {
      g.moveTo(o, d > 0 ? n : 0);
      g.lineTo(o + n, d > 0 ? 0 : n);
    }
    g.stroke();
  }
  return g.getImageData(0, 0, n, n);
}

const idFilter = (ids: string[]): FilterSpecification => ['in', ['get', 'GEOID'], ['literal', ids]];

export const MapView = forwardRef<MapHandle, Props>(function MapView(
  { fullBounds, paints, selected, compare, onHover, onSelect, ariaLabel }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const hovered = useRef<string | null>(null);
  const cb = useRef({ onHover, onSelect });
  cb.current = { onHover, onSelect };

  useImperativeHandle(ref, () => ({
    fitBounds: (b, maxZoom = 7.5) => map.current?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom, duration: 700 }),
    reset: () => map.current?.fitBounds([[fullBounds[0], fullBounds[1]], [fullBounds[2], fullBounds[3]]], { padding: 24, duration: 600 }),
  }), [fullBounds]);

  useEffect(() => {
    if (!el.current) return;
    const pad = 6;
    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f4f4f1' } }],
      },
      bounds: [[fullBounds[0], fullBounds[1]], [fullBounds[2], fullBounds[3]]],
      fitBoundsOptions: { padding: 24 },
      maxBounds: [[fullBounds[0] - pad, fullBounds[1] - pad], [fullBounds[2] + pad, fullBounds[3] + pad]],
      minZoom: 2,
      maxZoom: 11,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      renderWorldCopies: false,
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: 'Boundaries: U.S. Census Bureau cartographic boundary files · Alaska and Hawaii shown as insets (Alaska at 35% scale)',
    }), 'bottom-right');
    map.current = m;

    m.on('load', () => {
      m.addImage('pat-nodata', patternImage(SPECIAL.nodata.fill, '#bdbcb5', 'diag'));
      m.addImage('pat-na', patternImage(SPECIAL.na.fill, '#9d9c95', 'anti'));
      m.addImage('pat-low', patternImage(SPECIAL.low.fill, '#bcbbb4', 'dots'));
      m.addSource('counties', { type: 'geojson', data: geoUrl('counties'), promoteId: 'GEOID', tolerance: 0.25 });
      m.addSource('states', { type: 'geojson', data: geoUrl('states'), tolerance: 0.25 });
      m.addSource('insets', { type: 'geojson', data: geoUrl('insets') });
      const dimmed = ['case', ['boolean', ['feature-state', 'dim'], false], 0.22, 1] as const;
      m.addLayer({
        id: 'county-fill', type: 'fill', source: 'counties',
        paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], '#e7e6e1'], 'fill-opacity': dimmed as never },
      });
      for (const p of ['nodata', 'na', 'low'] as const) {
        m.addLayer({
          id: `county-pat-${p}`, type: 'fill', source: 'counties',
          paint: {
            'fill-pattern': `pat-${p}`,
            'fill-opacity': ['case', ['==', ['feature-state', 'pattern'], p], dimmed, 0] as never,
          },
        });
      }
      m.addLayer({
        id: 'county-line', type: 'line', source: 'counties',
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.15, 5, 0.45, 8, 1.1],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.45, 5, 0.85],
        },
      });
      m.addLayer({
        id: 'state-line', type: 'line', source: 'states',
        paint: {
          'line-color': '#2f2f2c',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 6, 1.4, 9, 2.2],
          'line-opacity': 0.85,
        },
      });
      m.addLayer({
        id: 'inset-frame', type: 'line', source: 'insets',
        paint: { 'line-color': '#9d9c95', 'line-width': 1, 'line-dasharray': [3, 2] },
      });
      m.addLayer({
        id: 'compare-line', type: 'line', source: 'counties', filter: idFilter([]),
        paint: { 'line-color': '#6250d6', 'line-width': 2.2, 'line-dasharray': [2, 1] },
      });
      m.addLayer({
        id: 'hover-line', type: 'line', source: 'counties', filter: idFilter([]),
        paint: { 'line-color': '#0b0b0b', 'line-width': 1.6 },
      });
      m.addLayer({
        id: 'selected-line', type: 'line', source: 'counties', filter: idFilter([]),
        paint: { 'line-color': '#0b0b0b', 'line-width': 3 },
      });
      setReady(true);
    });

    let raf = 0;
    m.on('mousemove', 'county-fill', (e) => {
      const f = e.features?.[0];
      const id = (f?.properties?.GEOID as string | undefined) ?? null;
      m.getCanvas().style.cursor = id ? 'pointer' : '';
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (hovered.current !== id) {
          hovered.current = id;
          m.setFilter('hover-line', idFilter(id ? [id] : []));
        }
        cb.current.onHover(id, { x: e.point.x, y: e.point.y });
      });
    });
    m.on('mouseleave', 'county-fill', () => {
      cancelAnimationFrame(raf);
      hovered.current = null;
      m.getCanvas().style.cursor = '';
      m.setFilter('hover-line', idFilter([]));
      cb.current.onHover(null, null);
    });
    m.on('click', (e) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ['county-fill'] })[0];
      const oe = e.originalEvent as MouseEvent;
      cb.current.onSelect((f?.properties?.GEOID as string) ?? null, oe.shiftKey || oe.metaKey || oe.ctrlKey);
    });

    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, [fullBounds]);

  // Recolor: push each county's paint into feature-state (no geometry reload).
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    for (const [id, p] of paints) {
      m.setFeatureState({ source: 'counties', id }, { color: p.color, pattern: p.pattern, dim: p.dim });
    }
  }, [paints, ready]);

  useEffect(() => {
    if (ready) map.current?.setFilter('selected-line', idFilter(selected ? [selected] : []));
  }, [selected, ready]);
  useEffect(() => {
    if (ready) map.current?.setFilter('compare-line', idFilter(compare));
  }, [compare, ready]);

  return <div ref={el} className="map" role="region" aria-label={ariaLabel} data-ready={ready ? 'true' : 'false'} />;
});
