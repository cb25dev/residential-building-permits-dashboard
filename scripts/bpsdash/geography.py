"""Census cartographic boundary files -> composite-inset GeoJSON for MapLibre.

The lower 48 + DC are projected to Albers Equal Area (EPSG:5070); Alaska to Alaska
Albers (EPSG:3338, scaled 0.35, the conventional U.S. inset scale); Hawaii to Hawaii
Albers (ESRI:102007, true scale). Insets are translated below the Southwest. The
composite planar coordinates are then passed through the inverse spherical-Mercator
transform, so MapLibre's Mercator rendering reproduces the equal-area layout exactly
(forward and inverse cancel). Coordinates are therefore display coordinates, not
geographic longitude/latitude; the map has no basemap that could disagree with them.
Projecting Alaska in its own Albers also keeps the Aleutians, which cross the
antimeridian, in one piece.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import shapefile  # pyshp
from pyproj import Transformer

from . import config

R = 6378137.0
PRECISION = 4  # decimal places in display degrees (~11 m)

_TO_CONUS = Transformer.from_crs("EPSG:4269", "EPSG:5070", always_xy=True)
_TO_AK = Transformer.from_crs("EPSG:4269", "EPSG:3338", always_xy=True)
_TO_HI = Transformer.from_crs("EPSG:4269", "ESRI:102007", always_xy=True)
AK_SCALE = 0.35
HI_SCALE = 1.0


@dataclass
class Feature:
    props: dict
    rings: list[np.ndarray]  # each (n, 2) planar, closed


def _read(path) -> list[tuple[dict, list[np.ndarray]]]:
    out = []
    with shapefile.Reader(str(path)) as r:
        fields = [f[0] for f in r.fields[1:]]
        for sr in r.iterShapeRecords():
            rec = dict(zip(fields, sr.record))
            pts = np.asarray(sr.shape.points, dtype=float)
            parts = list(sr.shape.parts) + [len(pts)]
            rings = [pts[parts[i]:parts[i + 1]] for i in range(len(parts) - 1)]
            out.append((rec, rings))
    return out


def _project(statefp: str, ring: np.ndarray) -> np.ndarray:
    t = _TO_AK if statefp == "02" else _TO_HI if statefp == "15" else _TO_CONUS
    x, y = t.transform(ring[:, 0], ring[:, 1])
    return np.column_stack([x, y])


def _bbox(rings: list[np.ndarray]) -> tuple[float, float, float, float]:
    allp = np.vstack(rings)
    return float(allp[:, 0].min()), float(allp[:, 1].min()), float(allp[:, 0].max()), float(allp[:, 1].max())


def _signed_area(r: np.ndarray) -> float:
    x, y = r[:, 0], r[:, 1]
    return 0.5 * float(np.dot(x[:-1], y[1:]) - np.dot(x[1:], y[:-1]))


def _inside(pt, ring: np.ndarray) -> bool:
    x, y = pt
    xs, ys = ring[:, 0], ring[:, 1]
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        if (ys[i] > y) != (ys[j] > y) and x < (xs[j] - xs[i]) * (y - ys[i]) / (ys[j] - ys[i] + 1e-30) + xs[i]:
            inside = not inside
        j = i
    return inside


def _to_display(ring: np.ndarray) -> list[list[float]]:
    lon = np.degrees(ring[:, 0] / R)
    lat = np.degrees(2 * np.arctan(np.exp(ring[:, 1] / R)) - math.pi / 2)
    pts = np.round(np.column_stack([lon, lat]), PRECISION)
    keep = np.ones(len(pts), dtype=bool)
    keep[1:] = np.any(pts[1:] != pts[:-1], axis=1)
    pts = pts[keep]
    if len(pts) and np.any(pts[0] != pts[-1]):
        pts = np.vstack([pts, pts[:1]])
    return pts.tolist()


def _geometry(rings: list[np.ndarray]) -> dict | None:
    """Group rings into polygons (outer rings + holes) with RFC 7946 winding."""
    shells, holes = [], []
    for r in rings:
        if len(r) < 4:
            continue
        (shells if _signed_area(r) < 0 else holes).append(r)  # shapefile: outer rings clockwise
    if not shells:
        shells, holes = holes, []
    polys = [[s] for s in shells]
    for h in holes:
        owner = next((p for p in polys if _inside(h[0], p[0])), polys[0])
        owner.append(h)
    coords = []
    for p in polys:
        outer = _to_display(p[0][::-1])           # clockwise -> counterclockwise
        inner = [_to_display(h[::-1]) for h in p[1:]]
        if len(outer) >= 4:
            coords.append([outer] + [i for i in inner if len(i) >= 4])
    if not coords:
        return None
    return {"type": "Polygon", "coordinates": coords[0]} if len(coords) == 1 else \
        {"type": "MultiPolygon", "coordinates": coords}


def build(county_zip, state_zip) -> dict:
    counties = [(rec, rings) for rec, rings in _read(county_zip) if rec["STATEFP"] not in config.EXCLUDED_STATE_FIPS]
    states = [(rec, rings) for rec, rings in _read(state_zip) if rec["STATEFP"] not in config.EXCLUDED_STATE_FIPS]

    proj_c = [(rec, [_project(rec["STATEFP"], r) for r in rings]) for rec, rings in counties]
    proj_s = [(rec, [_project(rec["STATEFP"], r) for r in rings]) for rec, rings in states]

    # Inset placement from the projected extents.
    conus = _bbox([r for rec, rs in proj_s if rec["STATEFP"] not in ("02", "15") for r in rs])
    ak = _bbox([r for rec, rs in proj_s if rec["STATEFP"] == "02" for r in rs])
    hi = _bbox([r for rec, rs in proj_s if rec["STATEFP"] == "15" for r in rs])
    cw = conus[2] - conus[0]
    ak_dx = conus[0] + 0.02 * cw - ak[0] * AK_SCALE
    ak_dy = conus[1] - 0.06 * cw - ak[1] * AK_SCALE
    ak_box = (ak[0] * AK_SCALE + ak_dx, ak[1] * AK_SCALE + ak_dy, ak[2] * AK_SCALE + ak_dx, ak[3] * AK_SCALE + ak_dy)
    hi_dx = ak_box[2] + 0.05 * cw - hi[0] * HI_SCALE
    hi_dy = ak_box[1] + 0.02 * cw - hi[1] * HI_SCALE
    hi_box = (hi[0] + hi_dx, hi[1] + hi_dy, hi[2] + hi_dx, hi[3] + hi_dy)

    def place(statefp: str, r: np.ndarray) -> np.ndarray:
        if statefp == "02":
            return r * AK_SCALE + [ak_dx, ak_dy]
        if statefp == "15":
            return r * HI_SCALE + [hi_dx, hi_dy]
        return r

    allbox = _bbox([np.array([[ak_box[0], ak_box[1]], [conus[2], conus[3]]])])
    cx, cy = (allbox[0] + allbox[2]) / 2, (allbox[1] + allbox[3]) / 2

    def finalize(statefp: str, rings: list[np.ndarray]) -> list[np.ndarray]:
        return [place(statefp, r) - [cx, cy] for r in rings]

    def disp_bbox(rings: list[np.ndarray]) -> list[float]:
        b = _bbox(rings)
        (x0, y0), (x1, y1) = _to_display(np.array([[b[0], b[1]], [b[2], b[3]], [b[0], b[1]]]))[:2]
        return [x0, y0, x1, y1]

    county_feats, county_index = [], {}
    for rec, rings in sorted(proj_c, key=lambda t: t[0]["GEOID"]):
        rings = finalize(rec["STATEFP"], rings)
        geom = _geometry(rings)
        if geom is None:
            raise ValueError(f"County {rec['GEOID']} has no valid geometry")
        props = {"GEOID": rec["GEOID"], "NAME": rec["NAMELSAD"], "ST": rec["STUSPS"], "STATEFP": rec["STATEFP"]}
        county_feats.append({"type": "Feature", "properties": props, "geometry": geom})
        county_index[rec["GEOID"]] = {"name": rec["NAMELSAD"], "short": rec["NAME"], "st": rec["STUSPS"],
                                      "state": rec["STATE_NAME"], "statefp": rec["STATEFP"],
                                      "lsad": rec["LSAD"], "bbox": disp_bbox(rings)}
    state_feats, state_index = [], {}
    for rec, rings in sorted(proj_s, key=lambda t: t[0]["STATEFP"]):
        rings = finalize(rec["STATEFP"], rings)
        geom = _geometry(rings)
        state_feats.append({"type": "Feature", "properties": {"STATEFP": rec["STATEFP"], "ST": rec["STUSPS"],
                                                               "NAME": rec["NAME"]}, "geometry": geom})
        state_index[rec["STATEFP"]] = {"name": rec["NAME"], "st": rec["STUSPS"], "bbox": disp_bbox(rings)}

    def frame(box) -> dict:
        x0, y0, x1, y1 = box
        pad = 0.012 * cw
        ring = np.array([[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x1 + pad, y1 + pad],
                         [x0 - pad, y1 + pad], [x0 - pad, y0 - pad]]) - [cx, cy]
        return {"type": "LineString", "coordinates": _to_display(ring)}

    insets = [{"type": "Feature", "properties": {"name": n}, "geometry": frame(b)}
              for n, b in (("Alaska", ak_box), ("Hawaii", hi_box))]
    full = disp_bbox([np.array([[allbox[0], allbox[1]], [allbox[2], allbox[3]]]) - [cx, cy]])
    return {
        "counties": {"type": "FeatureCollection", "features": county_feats},
        "states": {"type": "FeatureCollection", "features": state_feats},
        "insets": {"type": "FeatureCollection", "features": insets},
        "index": {"vintage": config.GEO_VINTAGE, "bbox": full, "counties": county_index, "states": state_index,
                  "projection": "Composite equal-area: EPSG:5070 (lower 48+DC), EPSG:3338 x0.35 (AK), "
                                "ESRI:102007 (HI); display coordinates via inverse spherical Mercator"},
    }
