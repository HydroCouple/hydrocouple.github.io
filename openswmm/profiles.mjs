/**
 * Profiles (interaction phase V3), model and pure functions, no DOM. A pipe profile follows a routed
 * path of nodes and links (desktop: Plot Profile — inverts, crowns, ground, HGL and its maximum); a
 * terrain profile follows a line drawn across the 2D mesh (desktop: Plot 2D Profile — bed, water
 * surface, maximum depth). ProfileSet holds the open profiles (tabs of the bottom panel) and which tab
 * is shown; views (profile-view.mjs, view.mjs) listen for `change` events
 * (`detail: {kind, id}`, kind = profiles | active | data | time).
 */

/** INP sections: "[NAME]" → rows of tokens, comments and blank lines dropped. */
export function sectionsOf(text) {
  const out = {};
  let rows = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(";")[0].trim();
    if (!line) continue;
    if (line.startsWith("[")) {
      rows = out[line.toUpperCase()] ||= [];
      continue;
    }
    rows?.push(line.split(/\s+/));
  }
  return out;
}

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/**
 * The network a pipe profile needs: nodes (invert, full depth, coordinates) and links (ends, length,
 * offsets at each end, opening height), the deck's LINK_OFFSETS mode and its length unit.
 */
export function networkOf(text) {
  const s = sectionsOf(text);
  const opt = Object.fromEntries((s["[OPTIONS]"] || []).map((r) => [r[0].toUpperCase(), (r[1] || "").toUpperCase()]));
  const coords = new Map((s["[COORDINATES]"] || []).map(([id, x, y]) => [id, [+x, +y]]));
  const nodes = new Map();
  const node = (id, kind, invert, maxDepth) => nodes.set(id, { id, kind, invert: num(invert), maxDepth: Math.max(0, num(maxDepth)), xy: coords.get(id) || null });
  for (const r of s["[JUNCTIONS]"] || []) node(r[0], "junction", r[1], r[2]);
  for (const r of s["[OUTFALLS]"] || []) node(r[0], "outfall", r[1], 0);
  for (const r of s["[STORAGE]"] || []) node(r[0], "storage", r[1], r[2]);
  // Dividers: Name Elev DivLink Type <type's parameters> Ymax …
  for (const r of s["[DIVIDERS]"] || []) node(r[0], "divider", r[1], r[{ CUTOFF: 5, TABULAR: 5, WEIR: 7 }[(r[3] || "").toUpperCase()] ?? 4]);
  const heights = new Map((s["[XSECTIONS]"] || []).map((r) => [r[0], num(r[2])]));
  const vertices = new Map();
  for (const [id, x, y] of s["[VERTICES]"] || []) (vertices.get(id) || vertices.set(id, []).get(id)).push([+x, +y]);
  const links = [];
  const link = (id, kind, from, to, length, inOffset, outOffset) =>
    nodes.has(from) && nodes.has(to) && links.push({ id, kind, from, to, length: Math.max(0, num(length)), inOffset, outOffset, height: heights.get(id) || 0, vertices: vertices.get(id) || [] });
  for (const r of s["[CONDUITS]"] || []) link(r[0], "conduit", r[1], r[2], r[3], r[5], r[6]);
  for (const r of s["[PUMPS]"] || []) link(r[0], "pump", r[1], r[2], 0, "0", "0");
  for (const r of s["[ORIFICES]"] || []) link(r[0], "orifice", r[1], r[2], 0, r[4], r[4]);
  for (const r of s["[WEIRS]"] || []) link(r[0], "weir", r[1], r[2], 0, r[4], r[4]);
  for (const r of s["[OUTLETS]"] || []) link(r[0], "outlet", r[1], r[2], 0, r[3], r[3]);
  return {
    nodes,
    links,
    offsets: opt.LINK_OFFSETS === "ELEVATION" ? "ELEVATION" : "DEPTH",
    unit: ["CMS", "LPS", "MLD"].includes(opt.FLOW_UNITS || "CFS") ? "m" : "ft",
  };
}

/** A link's length along a profile: a conduit's own; for others the distance between its nodes (≥ 1). */
export function linkLength(net, l) {
  if (l.kind === "conduit" && l.length > 0) return l.length;
  const a = net.nodes.get(l.from).xy,
    b = net.nodes.get(l.to).xy;
  return a && b ? Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])) : 1;
}

/**
 * The shortest path by length (links taken either way) through the waypoints in order:
 * `{nodes: [id…], links: [{id, reversed}…]}`, or `{error}` when a leg has no path.
 */
export function route(net, waypoints) {
  const adj = new Map();
  const edge = (a, b, l, reversed) => (adj.get(a) || adj.set(a, []).get(a)).push({ to: b, link: l, w: linkLength(net, l), reversed });
  for (const l of net.links) {
    edge(l.from, l.to, l, false);
    edge(l.to, l.from, l, true);
  }
  const leg = (a, b) => {
    const dist = new Map([[a, 0]]),
      prev = new Map(),
      heap = [[0, a]];
    const pop = () => {
      const top = heap[0],
        last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1,
            r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top;
    };
    const push = (item) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0; ) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[i], heap[p]] = [heap[p], heap[i]];
        i = p;
      }
    };
    while (heap.length) {
      const [d, n] = pop();
      if (n === b) break;
      if (d > dist.get(n)) continue;
      for (const e of adj.get(n) || []) {
        const nd = d + e.w;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: n, link: e.link, reversed: e.reversed });
          push([nd, e.to]);
        }
      }
    }
    if (!dist.has(b)) return null;
    const nodes = [b],
      links = [];
    for (let n = b; n !== a; ) {
      const p = prev.get(n);
      links.unshift({ id: p.link.id, reversed: p.reversed });
      nodes.unshift(p.from);
      n = p.from;
    }
    return { nodes, links };
  };
  const out = { nodes: [waypoints[0]], links: [] };
  for (let i = 1; i < waypoints.length; i++) {
    if (waypoints[i] === waypoints[i - 1]) continue;
    const p = leg(waypoints[i - 1], waypoints[i]);
    if (!p) return { error: "No connected path from " + waypoints[i - 1] + " to " + waypoints[i] + "." };
    out.nodes.push(...p.nodes.slice(1));
    out.links.push(...p.links);
  }
  return out.links.length ? out : { error: "Choose two different nodes." };
}

/**
 * A pipe profile's geometry along a routed path: stations (each node's distance, invert and rim — a
 * zero full depth reaches the highest crown at the node, as SWMM sets it) and segments (each link's
 * bottom at both ends from its offsets, and its opening height), plus the path as a map polyline.
 */
export function pipeProfile(net, path) {
  const byId = new Map(net.links.map((l) => [l.id, l]));
  const bottom = (l, nodeId, offset) => {
    const inv = net.nodes.get(nodeId).invert;
    if (offset === "*" || offset === undefined) return inv;
    return net.offsets === "ELEVATION" ? num(offset, inv) : inv + num(offset);
  };
  let d = 0;
  const stations = [{ id: path.nodes[0], d: 0 }],
    segments = [];
  path.links.forEach(({ id, reversed }, i) => {
    const l = byId.get(id),
      a = path.nodes[i],
      b = path.nodes[i + 1];
    const len = linkLength(net, l);
    const [offA, offB] = reversed ? [l.outOffset, l.inOffset] : [l.inOffset, l.outOffset];
    segments.push({ id, kind: l.kind, d0: d, d1: d + len, bottom0: bottom(l, a, offA), bottom1: bottom(l, b, offB), height: l.height });
    d += len;
    stations.push({ id: b, d });
  });
  // Crowns reaching each node, for a node whose full depth is 0.
  const crown = new Map();
  for (const s of segments) {
    const i = segments.indexOf(s);
    for (const [n, top] of [
      [path.nodes[i], s.bottom0 + s.height],
      [path.nodes[i + 1], s.bottom1 + s.height],
    ])
      crown.set(n, Math.max(crown.get(n) ?? -Infinity, top));
  }
  for (const st of stations) {
    const n = net.nodes.get(st.id);
    Object.assign(st, { kind: n.kind, invert: n.invert, rim: n.maxDepth > 0 ? n.invert + n.maxDepth : (crown.get(st.id) ?? n.invert), xy: n.xy });
  }
  // The path on the map: node coordinates and each link's vertices in travel order.
  const mapLine = [];
  path.links.forEach(({ id, reversed }, i) => {
    const a = net.nodes.get(path.nodes[i]).xy,
      b = net.nodes.get(path.nodes[i + 1]).xy,
      v = byId.get(id).vertices;
    if (a && !i) mapLine.push(a);
    mapLine.push(...(reversed ? [...v].reverse() : v));
    if (b) mapLine.push(b);
  });
  return { stations, segments, length: d, unit: net.unit, mapLine };
}

/** The time index where the path holds the most water above its inverts (a profile opens there). */
export function peakIndex(stations, heads, count) {
  let best = 0,
    most = -Infinity;
  for (let t = 0; t < count; t++) {
    let sum = 0;
    for (const s of stations) sum += Math.max(0, (heads.get(s.id)?.[t] ?? s.invert) - s.invert);
    if (sum > most) [most, best] = [sum, t];
  }
  return best;
}

/**
 * Samples along a polyline across the mesh: `n` points evenly spaced by distance, each with the mesh
 * vertices and barycentric weights that interpolate a vertex field there (null outside the mesh).
 * `locate(x, y)` is the cell under a point (view.locate).
 */
export function lineSamples(geo, locate, line, n = 400) {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = lengths[lengths.length - 1],
    out = [];
  for (let k = 0, seg = 1; k < n; k++) {
    const d = (total * k) / Math.max(1, n - 1);
    while (seg < line.length - 1 && lengths[seg] < d) seg++;
    const t = (d - lengths[seg - 1]) / (lengths[seg] - lengths[seg - 1] || 1);
    const x = line[seg - 1][0] + t * (line[seg][0] - line[seg - 1][0]),
      y = line[seg - 1][1] + t * (line[seg][1] - line[seg - 1][1]);
    const cell = locate(x, y);
    out.push({ d, x, y, cell: cell ?? null, w: cell === undefined || cell === null ? null : weights(geo, geo.cells[cell], x, y) });
  }
  return { samples: out, length: total };
}
/** Barycentric weights of (x, y) in the cell's triangle that holds it (a quad is two triangles). */
function weights(geo, cell, x, y) {
  const tris = cell.length === 4 ? [[cell[0], cell[1], cell[2]], [cell[0], cell[2], cell[3]]] : [cell];
  let best = null,
    worst = -Infinity;
  for (const [a, b, c] of tris) {
    const [xa, ya, xb, yb, xc, yc] = [geo.x[a], geo.y[a], geo.x[b], geo.y[b], geo.x[c], geo.y[c]];
    const det = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc);
    if (!det) continue;
    const l1 = ((yb - yc) * (x - xc) + (xc - xb) * (y - yc)) / det,
      l2 = ((yc - ya) * (x - xc) + (xa - xc) * (y - yc)) / det,
      l3 = 1 - l1 - l2;
    const m = Math.min(l1, l2, l3);
    if (m > worst) [worst, best] = [m, [[a, l1], [b, l2], [c, l3]]];
  }
  return best;
}
/** A vertex field at each sample (NaN outside the mesh). */
export function atSamples(samples, field) {
  return Float64Array.from(samples, (s) => (s.w ? s.w.reduce((v, [k, w]) => v + w * field[k], 0) : NaN));
}

/** The open profiles, the bottom panel's tabs ("series" is the time series tab). */
export class ProfileSet extends EventTarget {
  constructor() {
    super();
    this.profiles = [];
    this.active = "series";
    this.count = 0;
  }
  emit(kind, id) {
    this.dispatchEvent(new CustomEvent("change", { detail: { kind, id } }));
  }
  get(id) {
    return this.profiles.find((p) => p.id === id) || null;
  }
  /** Open a profile `{kind: "pipe" | "terrain", title, …}` and show it. */
  add(profile) {
    const id = "profile-" + ++this.count;
    this.profiles.push({ ...profile, id, data: null, error: null, index: null });
    this.active = id;
    this.emit("profiles", id);
    return id;
  }
  remove(id) {
    const i = this.profiles.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.profiles.splice(i, 1);
    if (this.active === id) this.active = this.profiles[Math.min(i, this.profiles.length - 1)]?.id ?? "series";
    this.emit("profiles", id);
  }
  clear() {
    if (!this.profiles.length) return;
    this.profiles = [];
    this.active = "series";
    this.emit("profiles", null);
  }
  setActive(id) {
    if (this.active === id || (id !== "series" && !this.get(id))) return;
    this.active = id;
    this.emit("active", id);
  }
  setData(id, data) {
    const p = this.get(id);
    if (!p) return;
    p.data = data;
    p.error = null;
    this.emit("data", id);
  }
  setError(id, message) {
    const p = this.get(id);
    if (!p) return;
    p.error = message;
    this.emit("data", id);
  }
  /** A profile's own time index (models without the time bar's frames). */
  setIndex(id, index) {
    const p = this.get(id);
    if (!p || p.index === index) return;
    p.index = index;
    this.emit("time", id);
  }
}
