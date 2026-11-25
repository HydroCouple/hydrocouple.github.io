/**
 * Water depth styling (interaction phase V4a), as the desktop's 2D results style panel: how the
 * depth layer is classified, colored and contoured. `DepthStyle` is the model (remembered in this
 * browser); the rest are pure functions the map view (view.mjs) uses: class breaks, color ramps,
 * cell values at mesh vertices, filled contour bands and contour lines on the mesh triangles.
 *
 * Band and line geometry is kept as points along mesh edges, `[a, b, t]` = vertex a + t × (b − a),
 * so a redraw only interpolates the projected vertices; nothing is clipped again while panning.
 */

/** Color ramps, light to dark or as published (sRGB stops, interpolated). */
export const ramps = {
  blues: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  viridis: ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"],
  cividis: ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#e4cf5b", "#fee838"],
  magma: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
  inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
  plasma: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
};
export const rampNames = { blues: "Blues", viridis: "Viridis", cividis: "Cividis", magma: "Magma", inferno: "Inferno", plasma: "Plasma" };
export const methodNames = { continuous: "Continuous", equal: "Equal interval", quantile: "Quantile", jenks: "Natural breaks", manual: "Manual" };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** The ramp's color at f in [0, 1] (inverted when asked), as "rgb(r,g,b)". */
export function rampColor(name, f, invert = false) {
  const stops = ramps[name] || ramps.blues;
  const x = Math.min(1, Math.max(0, invert ? 1 - f : f)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)),
    u = x - i;
  const a = hex(stops[i]),
    b = hex(stops[i + 1]);
  return "rgb(" + a.map((v, k) => Math.round(v + u * (b[k] - v))).join(",") + ")";
}

/**
 * Class breaks `[b0, b1, …, bn]` (n classes) over [lo, hi]: equal intervals, quantiles or natural
 * breaks (Fisher–Jenks on a sample) of the wet values, or the manual list kept inside the range.
 */
export function classBreaks(values, method, n, lo, hi, manual = []) {
  n = Math.max(2, Math.min(12, Math.round(n) || 5));
  if (!(hi > lo)) hi = lo + 1;
  if (method === "manual") {
    const inner = [...new Set(manual.map(Number).filter((v) => v > lo && v < hi))].sort((a, b) => a - b);
    return [lo, ...inner, hi];
  }
  const wet = values.filter((v) => Number.isFinite(v) && v >= lo && v <= hi).sort((a, b) => a - b);
  if (method === "quantile" && wet.length > n) {
    const inner = Array.from({ length: n - 1 }, (_, i) => wet[Math.floor(((i + 1) * wet.length) / n)]);
    return [lo, ...[...new Set(inner)].filter((v) => v > lo && v < hi), hi];
  }
  if (method === "jenks" && wet.length > n) return [lo, ...jenksInner(sample(wet, 600), n).filter((v) => v > lo && v < hi), hi];
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}
function sample(sorted, max) {
  if (sorted.length <= max) return sorted;
  return Array.from({ length: max }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / (max - 1))]);
}
/** Fisher–Jenks natural breaks of sorted values: the n − 1 inner breaks (class upper bounds). */
function jenksInner(data, n) {
  const m = data.length;
  const lower = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  const variance = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  for (let j = 1; j <= n; j++) {
    lower[1][j] = 1;
    variance[1][j] = 0;
  }
  for (let l = 2; l <= m; l++) {
    let s = 0,
      s2 = 0,
      w = 0,
      v = 0;
    for (let k = 1; k <= l; k++) {
      const i = l - k + 1,
        x = data[i - 1];
      s += x;
      s2 += x * x;
      w++;
      v = s2 - (s * s) / w;
      if (i > 1)
        for (let j = 2; j <= n; j++)
          if (variance[l][j] >= v + variance[i - 1][j - 1]) {
            lower[l][j] = i;
            variance[l][j] = v + variance[i - 1][j - 1];
          }
    }
    lower[l][1] = 1;
    variance[l][1] = v;
  }
  const inner = [];
  let k = m;
  for (let j = n; j >= 2; j--) {
    const id = lower[k][j] - 1;
    inner.unshift(data[id - 1]);
    k = id;
  }
  return [...new Set(inner)];
}

/** Contour levels inside (lo, hi): `count` evenly spaced, or every `interval` from `base`. */
export function contourLevels(lo, hi, { mode = "count", count = 6, interval = 0.1, base = 0 } = {}) {
  if (!(hi > lo)) return [];
  if (mode === "interval" && interval > 0) {
    const out = [];
    const first = base + Math.ceil((lo - base) / interval + 1e-9) * interval;
    for (let v = first, k = 0; v < hi - 1e-12 && k < 200; v += interval, k++) out.push(+v.toPrecision(12));
    return out.filter((v) => v > lo);
  }
  const n = Math.max(1, Math.min(50, Math.round(count)));
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * (i + 1)) / (n + 1));
}

/** The mesh as triangles (a quad is split along its first diagonal): Int32Array of vertex triples. */
export function triangles(cells) {
  const out = [];
  for (const c of cells) {
    out.push(c[0], c[1], c[2]);
    if (c.length === 4) out.push(c[0], c[2], c[3]);
  }
  return Int32Array.from(out);
}
/** Each vertex's value: the mean of the cells around it. */
export function vertexValues(cells, cellValues, vertexCount) {
  const sum = new Float64Array(vertexCount),
    count = new Uint16Array(vertexCount);
  cells.forEach((c, i) => {
    const v = Number.isFinite(cellValues[i]) ? cellValues[i] : 0;
    for (const k of c) {
      sum[k] += v;
      count[k]++;
    }
  });
  for (let k = 0; k < vertexCount; k++) if (count[k]) sum[k] /= count[k];
  return sum;
}

/** A point where the field crosses `level` on edge (a, b), as [a, b, t]. */
const cross = (a, b, va, vb, level) => [a, b, (level - va) / (vb - va)];
/**
 * Filled contour bands: for band k (between breaks[k] and breaks[k + 1]) the polygons where the
 * linear field on each triangle lies in it, each a list of [a, b, t] points (a vertex is [a, a, 0]).
 * The last band takes everything from its lower break up (values above the range keep the top
 * color); values below breaks[0] are not drawn.
 */
export function contourBands(tris, values, breaks) {
  const bands = breaks.slice(1).map(() => []);
  for (let i = 0; i < tris.length; i += 3) {
    const vs = [tris[i], tris[i + 1], tris[i + 2]],
      fv = vs.map((k) => values[k]);
    const lo = Math.min(...fv),
      hi = Math.max(...fv);
    if (hi < breaks[0]) continue;
    for (let b = 0; b < bands.length; b++) {
      const from = breaks[b],
        to = breaks[b + 1],
        last = b === bands.length - 1;
      if (hi < from || (!last && lo >= to)) continue;
      if (lo >= from && (last || hi < to)) {
        bands[b].push(vs.map((k) => [k, k, 0]));
        continue;
      }
      // Clip the triangle to from ≤ v < to (the last band: from ≤ v), Sutherland–Hodgman on the field.
      let poly = vs.map((k, j) => ({ p: [k, k, 0], v: fv[j] }));
      poly = clip(poly, (v) => v >= from, from);
      if (!last && poly.length >= 3) poly = clip(poly, (v) => v < to, to);
      if (poly.length >= 3) bands[b].push(poly.map((q) => q.p));
    }
  }
  return bands;
}
/** Clip a polygon of field points against inside(v), cutting edges at `level`. */
function clip(poly, inside, level) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i],
      prev = poly[(i + poly.length - 1) % poly.length];
    const cin = inside(cur.v),
      pin = inside(prev.v);
    if (cin !== pin) out.push(edgePoint(prev, cur, level));
    if (cin) out.push(cur);
  }
  return out;
}
/**
 * The point at `level` between two consecutive polygon points. On a linear field they always lie on
 * one mesh edge (a cut never crosses the previous cut's segment, where the field is constant), so
 * the new point is expressed on that edge.
 */
function edgePoint(p, q, level) {
  const u = (level - p.v) / (q.v - p.v);
  const [pa, pb, pt] = p.p,
    [qa, qb, qt] = q.p;
  const a = pa,
    b = pa !== pb ? pb : qa !== pa ? qa : qb;
  const along = (x, y, t) => (x === y ? (x === a ? 0 : 1) : x === a ? t : 1 - t); // position from a toward b
  const sp = along(pa, pb, pt),
    sq = along(qa, qb, qt);
  return { p: [a, b, sp + u * (sq - sp)], v: level };
}

/**
 * Contour lines: for each level, the segments where the field crosses it on each triangle, each
 * segment two [a, b, t] points on triangle edges.
 */
export function isolines(tris, values, levels) {
  return levels.map((level) => {
    const segs = [];
    for (let i = 0; i < tris.length; i += 3) {
      const vs = [tris[i], tris[i + 1], tris[i + 2]],
        fv = vs.map((k) => values[k]);
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const a = vs[e],
          b = vs[(e + 1) % 3],
          va = fv[e],
          vb = fv[(e + 1) % 3];
        if ((va < level && vb >= level) || (vb < level && va >= level)) pts.push(cross(a, b, va, vb, level));
      }
      if (pts.length === 2) segs.push(pts);
    }
    return segs;
  });
}

/**
 * Contour segments joined into polylines (for labels along a line): two segments join where they
 * cross the same mesh edge. Each polyline is a list of [a, b, t] points; a closed one ends on the
 * edge it starts on.
 */
export function chainSegments(segs) {
  const key = ([a, b]) => (a < b ? a + "," + b : b + "," + a);
  const at = new Map();
  segs.forEach(([p, q], i) => {
    for (const k of [key(p), key(q)]) {
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length),
    chains = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const ahead = [segs[i][1]],
      behind = [segs[i][0]];
    for (const side of [ahead, behind])
      for (;;) {
        const end = side[side.length - 1],
          next = at.get(key(end)).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const [p, q] = segs[next];
        side.push(key(p) === key(end) ? q : p);
      }
    chains.push([...behind.reverse(), ...ahead]);
  }
  return chains;
}

/** The default style (owner 2026-11-25: filled contours, water no deeper than 0.05 m hidden). */
export const depthStyleDefaults = {
  display: "bands", // "cells" (flat cell colors) or "bands" (filled contours)
  method: "continuous", // continuous, equal, quantile, jenks, manual
  classes: 6,
  manual: [],
  ramp: "blues",
  invert: false,
  range: "frame", // frame, run, fixed
  min: 0,
  max: 1,
  lines: false,
  levelMode: "count", // count, interval
  levelCount: 6,
  interval: 0.1,
  base: 0,
  indexEvery: 5,
  labels: false,
  hideBelow: 0.05, // hide water no deeper than this (m); null: the model's DRY_DEPTH
};
const defaults = depthStyleDefaults;
export class DepthStyle extends EventTarget {
  /** @param {{storage?: Storage, key?: string}} [o] where the style is remembered */
  // A new key when the defaults change, so every browser starts from them once.
  constructor({ storage, key = "openswmm.depthStyle2" } = {}) {
    super();
    this.key = key;
    try {
      this.storage = storage ?? globalThis.localStorage;
    } catch {
      this.storage = null;
    }
    this.state = { ...defaults };
    try {
      this.state = check({ ...defaults, ...JSON.parse(this.storage?.getItem(key) || "{}") });
    } catch {}
  }
  get(name) {
    return this.state[name];
  }
  /** Change some settings; values out of range are brought into it. */
  set(changes) {
    const next = check({ ...this.state, ...changes });
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    try {
      this.storage?.setItem(this.key, JSON.stringify(next));
    } catch {}
    this.dispatchEvent(new CustomEvent("change", { detail: { ...changes } }));
  }
  reset() {
    this.set({ ...defaults });
  }
}
function check(s) {
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const num = (v, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const out = {
    display: pick(s.display, ["cells", "bands"], defaults.display),
    method: pick(s.method, Object.keys(methodNames), defaults.method),
    classes: Math.round(num(s.classes, defaults.classes, 2, 12)),
    manual: (Array.isArray(s.manual) ? s.manual : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    ramp: pick(s.ramp, Object.keys(ramps), defaults.ramp),
    invert: !!s.invert,
    range: pick(s.range, ["frame", "run", "fixed"], defaults.range),
    min: num(s.min, defaults.min),
    max: num(s.max, defaults.max),
    lines: !!s.lines,
    levelMode: pick(s.levelMode, ["count", "interval"], defaults.levelMode),
    levelCount: Math.round(num(s.levelCount, defaults.levelCount, 1, 50)),
    interval: num(s.interval, defaults.interval, 1e-6),
    base: num(s.base, defaults.base),
    indexEvery: Math.round(num(s.indexEvery, defaults.indexEvery, 0, 50)),
    labels: !!s.labels,
    hideBelow: s.hideBelow == null || s.hideBelow === "" || !(Number.isFinite(+s.hideBelow) && +s.hideBelow >= 0) ? null : +s.hideBelow,
  };
  if (!(out.max > out.min)) out.max = out.min + 1;
  return out;
}
