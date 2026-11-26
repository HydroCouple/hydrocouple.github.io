/**
 * Symbols of the map's layers (interaction phase L2), model, no DOM. Per SWMM kind the desktop's
 * SWMMElementSymbol (openswmm.gui swmmmodellayer.h): a node's or rain gage's marker (shape, size, fill,
 * outline), a link's line (color, width) with its flow-direction arrow, the subcatchment area, and ID
 * labels; the mesh fill (one color, or the bed elevation on a ramp — the desktop's Terrain Fill) and
 * the mesh edges. Remembered in this browser. Views (view.mjs, scene3d.mjs, layers-panel.mjs,
 * symbol-style-view.mjs) listen for `change` events (`detail: {leaf}`).
 */
import { symbols, markerOutline } from "./layers.mjs";
import { ramps, rampColor } from "./depth-style.mjs";

export const markerKinds = ["junctions", "outfalls", "storage", "dividers", "gages"];
export const lineKinds = ["conduits", "pumps", "orifices", "weirs", "outlets"];
export const meshLeaves = ["meshfill", "edges"];
/** The leaves this model styles. */
export const styledLeaves = [...markerKinds, ...lineKinds, "subcatchments", ...meshLeaves];
export const markerShapes = { circle: "Circle", square: "Square", triangle: "Triangle", diamond: "Diamond", star: "Star", cross: "Cross" };
/** Elevation ramps: the desktop's Terrain (its mesh default) and the depth ramps. */
export const elevationRamps = { terrain: "Terrain", viridis: "Viridis", cividis: "Cividis", magma: "Magma", inferno: "Inferno", plasma: "Plasma", blues: "Blues" };
// The desktop's Terrain ramp (colorramp.cpp RasterColorRamp::terrain): water blue, marsh green, ochre,
// off-white, at uneven positions.
const terrain = [
  [0, [0x1a, 0x3d, 0x6b]],
  [0.2, [0x2e, 0x8b, 0x57]],
  [0.5, [0xc8, 0xd9, 0x4e]],
  [0.75, [0xc8, 0xa0, 0x00]],
  [1, [0xf0, 0xf0, 0xe8]],
];
/** The color of fraction `f` (0–1) of an elevation ramp, as "rgb(r,g,b)". */
export function elevationColor(name, f, invert = false) {
  if (name !== "terrain") return rampColor(name, f, invert);
  const x = Math.min(1, Math.max(0, invert ? 1 - f : f));
  let k = 0;
  while (k < terrain.length - 2 && x > terrain[k + 1][0]) k++;
  const [p0, a] = terrain[k],
    [p1, b] = terrain[k + 1],
    u = (x - p0) / (p1 - p0);
  return "rgb(" + a.map((v, i) => Math.round(v + u * (b[i] - v))).join(",") + ")";
}

/**
 * A marker's outline around its center for radius `r`, as `[dx, dy]` corners (y down), or null for a
 * circle. The triangle is the one the map always drew (point up, base at 0.8 r).
 */
export function markerPoints(shape, r) {
  if (shape === "square") return [[-r, -r], [r, -r], [r, r], [-r, r]];
  if (shape === "triangle") return [[0, -r], [r, 0.8 * r], [-r, 0.8 * r]];
  if (shape === "diamond") return [[0, -r], [r, 0], [0, r], [-r, 0]];
  if (shape === "star")
    return Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5,
        q = i % 2 ? 0.45 * r : r;
      return [q * Math.cos(a), q * Math.sin(a)];
    });
  if (shape === "cross") {
    const a = 0.35 * r;
    return [[-a, -r], [a, -r], [a, -a], [r, -a], [r, a], [a, a], [a, r], [-a, r], [-a, a], [-r, a], [-r, -a], [-a, -a]];
  }
  return null;
}

const labels = { labels: false, labelColor: "#000000", labelSize: 11 };
// SWMMModelLayer seeds flow arrows on for the five link kinds (arrowSize 16, arrowWidth 8, #222222).
const arrows = { arrows: true, arrowLength: 16, arrowWidth: 8, arrowColor: "#222222" };
/** The desktop's default symbols (what the map drew before L2); the mesh keeps the browser's look. */
export const symbolDefaults = Object.freeze({
  ...Object.fromEntries(markerKinds.map((k) => [k, { shape: symbols[k].shape, size: symbols[k].size, fill: symbols[k].fill, outline: markerOutline.stroke, outlineWidth: markerOutline.width, ...labels }])),
  ...Object.fromEntries(lineKinds.map((k) => [k, { color: symbols[k].stroke, width: symbols[k].width, ...arrows, ...labels }])),
  subcatchments: { fill: symbols.subcatchments.fill, fillOpacity: 1, outline: symbols.subcatchments.outline, outlineWidth: symbols.subcatchments.width, ...labels },
  meshfill: { mode: "single", color: "#4a6480", opacity: 0.12, ramp: "terrain", invert: false },
  edges: { color: "#2f5d86", opacity: 0.6, width: 0.75 },
});

const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
const num = (v, d, lo, hi) => (Number.isFinite(+v) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, +v)) : d);
/** A leaf's style with every value in range (unknown keys dropped). */
function check(leaf, s) {
  const d = symbolDefaults[leaf];
  const lab = () => ({ labels: !!s.labels, labelColor: hex(s.labelColor, d.labelColor), labelSize: num(s.labelSize, d.labelSize, 8, 24) });
  if (markerKinds.includes(leaf))
    return { shape: s.shape in markerShapes ? s.shape : d.shape, size: num(s.size, d.size, 2, 30), fill: hex(s.fill, d.fill), outline: hex(s.outline, d.outline), outlineWidth: num(s.outlineWidth, d.outlineWidth, 0, 4), ...lab() };
  if (lineKinds.includes(leaf))
    return {
      color: hex(s.color, d.color),
      width: num(s.width, d.width, 0.5, 10),
      arrows: !!s.arrows,
      arrowLength: num(s.arrowLength, d.arrowLength, 4, 40),
      arrowWidth: num(s.arrowWidth, d.arrowWidth, 2, 30),
      arrowColor: hex(s.arrowColor, d.arrowColor),
      ...lab(),
    };
  if (leaf === "subcatchments") return { fill: hex(s.fill, d.fill), fillOpacity: num(s.fillOpacity, d.fillOpacity, 0, 1), outline: hex(s.outline, d.outline), outlineWidth: num(s.outlineWidth, d.outlineWidth, 0, 6), ...lab() };
  if (leaf === "meshfill")
    return { mode: s.mode === "elevation" ? "elevation" : "single", color: hex(s.color, d.color), opacity: num(s.opacity, d.opacity, 0, 1), ramp: s.ramp in elevationRamps && (s.ramp === "terrain" || s.ramp in ramps) ? s.ramp : d.ramp, invert: !!s.invert };
  return { color: hex(s.color, d.color), opacity: num(s.opacity, d.opacity, 0, 1), width: num(s.width, d.width, 0.25, 3) };
}

export class SymbolStyle extends EventTarget {
  /** @param {{storage?: Storage, key?: string}} [o] where the styles are remembered */
  constructor({ storage, key = "openswmm.symbolStyle" } = {}) {
    super();
    this.key = key;
    try {
      this.storage = storage === undefined ? globalThis.localStorage : storage;
    } catch {
      this.storage = null;
    }
    let saved = {};
    try {
      saved = JSON.parse(this.storage?.getItem(key) || "{}") || {};
    } catch {}
    this.state = Object.fromEntries(styledLeaves.map((leaf) => [leaf, check(leaf, { ...symbolDefaults[leaf], ...(saved[leaf] || {}) })]));
  }
  /** A leaf's style (its own copy). */
  of(leaf) {
    return { ...this.state[leaf] };
  }
  /** Change some of a leaf's settings; values out of range are brought into it. */
  set(leaf, changes) {
    if (!(leaf in this.state)) throw new Error("No symbol for " + leaf + ".");
    const next = check(leaf, { ...this.state[leaf], ...changes });
    if (JSON.stringify(next) === JSON.stringify(this.state[leaf])) return;
    this.state[leaf] = next;
    try {
      // Only what differs from the defaults is kept, so new defaults reach leaves left alone.
      const kept = {};
      for (const l of styledLeaves) {
        const diff = Object.fromEntries(Object.entries(this.state[l]).filter(([k, v]) => v !== symbolDefaults[l][k]));
        if (Object.keys(diff).length) kept[l] = diff;
      }
      this.storage?.setItem(this.key, JSON.stringify(kept));
    } catch {}
    this.dispatchEvent(new CustomEvent("change", { detail: { leaf } }));
  }
  /** Back to the desktop's default symbol. */
  reset(leaf) {
    this.set(leaf, { ...symbolDefaults[leaf] });
  }
}
