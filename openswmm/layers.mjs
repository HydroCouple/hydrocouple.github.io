/**
 * Map layer tree (model layer, no DOM): what the map shows, in which order and how strongly, organized
 * as the desktop GUI's layer tree. The desktop seeds its categories top → bottom as SWMM 1D Outputs,
 * SWMM 2D Outputs, SWMM, Meshes, Time series, Feature, Raster layers, Basemaps, Tables
 * (openswmm.gui include/ui/panels/layertreecategories.h, kDefaultCategoryDisplayOrder); the top of the
 * tree paints last. The browser has the four categories below. The SWMM layer groups its kinds as the
 * desktop's style subjects do (swmmmodellayer.cpp styleSubjects: Nodes, Links, Areas, Other) and draws
 * them with the desktop's default symbols (SWMMModelLayer constructor, PreferencesManager pen defaults).
 *
 * Views (layers-panel.mjs, view.mjs) read this state and listen for `change` events
 * (`detail: {kind, id}`, kind = visible | order | opacity | content | enabled | note | legend).
 */

/**
 * Desktop default symbols: marker shape and size in pixels, line width in pixels, colors. The symbol
 * style (symbol-style.mjs) starts from them; what the map draws is the style.
 */
export const symbols = {
  junctions: { shape: "circle", size: 8, fill: "#0078ff" },
  outfalls: { shape: "triangle", size: 12.5, fill: "#dc0000" },
  storage: { shape: "square", size: 12, fill: "#b43cc8" },
  dividers: { shape: "diamond", size: 8, fill: "#00ff00" },
  conduits: { width: 1, stroke: "#3232c8" },
  pumps: { width: 3, stroke: "#ff0000" },
  orifices: { width: 2.5, stroke: "#c89600" },
  weirs: { width: 2.5, stroke: "#00b464" },
  outlets: { width: 2, stroke: "#785a28" },
  subcatchments: { fill: "#b4dcb4", outline: "#003c00", width: 1.5 },
  gages: { shape: "diamond", size: 10, fill: "#00ffff" },
};
/**
 * Basemaps (the desktop's built-in XYZ connections, basemapconnection.h, plus Mapbox's own). A `style`
 * is a Mapbox vector style: one at a time, at the bottom of the stack (the `basemap` row). A `raster`
 * is a tile layer stacked above it. Stadia and CARTO are left out: their tiles need an account key now
 * (CARTO's answer an "API KEY REQUIRED" image); a keyed URL can be added as a custom XYZ layer.
 */
export const basemapSources = {
  outdoors: { label: "Mapbox Outdoors", kind: "style", style: "mapbox://styles/mapbox/outdoors-v12" },
  streets: { label: "Mapbox Streets", kind: "style", style: "mapbox://styles/mapbox/streets-v12" },
  light: { label: "Mapbox Light", kind: "style", style: "mapbox://styles/mapbox/light-v11" },
  dark: { label: "Mapbox Dark", kind: "style", style: "mapbox://styles/mapbox/dark-v11" },
  "satellite-streets": { label: "Mapbox Satellite Streets", kind: "style", style: "mapbox://styles/mapbox/satellite-streets-v12" },
  satellite: { label: "Mapbox Satellite", kind: "raster", url: "mapbox://mapbox.satellite", tileSize: 256, maxzoom: 22 },
  osm: {
    label: "OpenStreetMap",
    kind: "raster",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  esri: {
    label: "Esri World Imagery",
    kind: "raster",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 19,
    attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
};
/** A basemap row's source: a preset, or a custom XYZ layer `{label, url, maxzoom}`. */
export function basemapSource(row) {
  if (row.source !== "custom") return basemapSources[row.source];
  return { label: row.label, kind: "raster", tiles: [row.url], tileSize: 256, maxzoom: row.maxzoom };
}
/** A custom XYZ URL must be http(s) with {z}, {x} and {y}. */
export const validTileUrl = (url) => /^https?:\/\/\S+$/.test(url || "") && ["{z}", "{x}", "{y}"].every((k) => url.includes(k));
const basemapKey = "openswmm.basemaps";
/** The stack kept in this browser, top → bottom, the Mapbox style row last; unusable entries dropped. */
function loadBasemaps(storage) {
  let rows = [];
  try {
    rows = JSON.parse(storage?.getItem(basemapKey) || "[]");
  } catch {}
  const ok = (r) =>
    r && typeof r.id === "string" && /^bm-\d+$/.test(r.id) && (r.source === "custom" ? validTileUrl(r.url) && !!r.label : basemapSources[r.source]?.kind === "raster");
  const style = Array.isArray(rows) ? rows.find((r) => r?.id === "basemap" && basemapSources[r.source]?.kind === "style") : null;
  const opacity = (v) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : 1);
  return [
    ...(Array.isArray(rows) ? rows.filter(ok) : []).map((r) => ({ ...r, opacity: opacity(r.opacity), maxzoom: r.source === "custom" ? Math.round(Math.min(24, Math.max(1, +r.maxzoom || 19))) : undefined })),
    { id: "basemap", source: style?.source || "outdoors", opacity: 1 },
  ];
}

/** Marker outline of every node and gage symbol (desktop SWMMElementSymbol: Qt::darkBlue, 1 px). */
export const markerOutline = { stroke: "#000080", width: 1 };

const leafLabels = {
  depth: "Water depth",
  streaks: "Flow streaks",
  junctions: "Junctions",
  outfalls: "Outfalls",
  storage: "Storage units",
  dividers: "Dividers",
  conduits: "Conduits",
  pumps: "Pumps",
  orifices: "Orifices",
  weirs: "Weirs",
  outlets: "Outlets",
  subcatchments: "Subcatchments",
  gages: "Rain gages",
  labels: "Map labels",
  meshfill: "Mesh fill",
  edges: "Mesh edges",
  basemap: "Mapbox outdoors",
  buildings: "3D buildings",
};
/** Categories in the desktop's seed order; `groups` with a null label are rows without a heading. */
const tree = [
  { id: "outputs2d", label: "SWMM 2D Outputs", groups: [{ id: null, label: null, rows: ["depth", "streaks"] }] },
  {
    id: "swmm",
    label: "SWMM",
    groups: [
      { id: "nodes", label: "Nodes", rows: ["junctions", "outfalls", "storage", "dividers"] },
      { id: "links", label: "Links", rows: ["conduits", "pumps", "orifices", "weirs", "outlets"] },
      { id: "areas", label: "Areas", rows: ["subcatchments"] },
      { id: "other", label: "Other", rows: ["gages", "labels"] },
    ],
  },
  { id: "meshes", label: "Meshes", groups: [{ id: null, label: null, rows: ["meshfill", "edges"] }] },
  // The basemap is the Mapbox canvas under the drawing canvas, so it always paints at the bottom. Its
  // 3D buildings are extruded in the 3D view only (view.mjs set3D).
  { id: "basemaps", label: "Basemaps", fixed: true, groups: [{ id: null, label: null, rows: ["buildings", "basemap"] }] },
];
const surfaceLeaves = new Set(["depth", "streaks", "meshfill", "edges"]);

/** The counts a layer tree shows for a displayed geometry (view.mjs sketch or a run's geometry). */
export function contentOf(geo) {
  const counts = { cells: geo?.cells?.length || 0 };
  const network = geo?.network;
  if (network) {
    for (const [kind, list] of Object.entries(network)) if (Array.isArray(list)) counts[kind] = list.length; // not network.ids
  } else counts.conduits = geo?.links?.length || 0;
  return counts;
}

export class LayerTree extends EventTarget {
  /**
   * @param {{reducedMotion?: boolean, storage?: Storage}} [o] flow streaks start off when the user asks
   * for less motion; the basemap stack is kept in `storage` (this browser's by default)
   */
  constructor({ reducedMotion = false, storage } = {}) {
    super();
    try {
      this.storage = storage === undefined ? globalThis.localStorage : storage;
    } catch {
      this.storage = null;
    }
    this.basemaps = loadBasemaps(this.storage);
    this.order = tree.map((c) => c.id);
    this.on = Object.fromEntries(Object.keys(leafLabels).map((id) => [id, true]));
    this.on.streaks = !reducedMotion;
    this.on.basemap = false; // basemap rows start off: the map loads when the basemap is switched on
    for (const b of this.basemaps) this.on[b.id] = false;
    this.alpha = Object.fromEntries(tree.map((c) => [c.id, 1]));
    this.counts = {};
    this.disabled = new Set();
    this.notes = {};
    this.legends = {};
  }
  emit(kind, id) {
    this.dispatchEvent(new CustomEvent("change", { detail: { kind, id } }));
  }
  /** Categories in tree order (top first) with their groups. */
  categories() {
    return this.order.map((id) => tree.find((c) => c.id === id));
  }
  /** A leaf row: a fixed layer or a basemap row. */
  isLeaf(id) {
    return id in leafLabels || this.basemaps.some((b) => b.id === id);
  }
  label(id) {
    const b = this.basemaps.find((b) => b.id === id);
    if (b) return basemapSource(b).label;
    return leafLabels[id] ?? tree.find((c) => c.id === id)?.label ?? tree.flatMap((c) => c.groups).find((g) => g.id === id)?.label;
  }
  /** The leaf rows under a category, a group or a leaf. */
  leaves(id) {
    if (this.isLeaf(id)) return [id];
    if (id === "basemaps") return ["buildings", ...this.basemaps.map((b) => b.id)];
    const cat = tree.find((c) => c.id === id);
    if (cat) return cat.groups.flatMap((g) => g.rows);
    return tree.flatMap((c) => c.groups).find((g) => g.id === id)?.rows || [];
  }
  /** Objects of a leaf kind in the displayed model (null for rows that are not counted). */
  count(leaf) {
    if (leaf === "buildings" || this.basemaps.some((b) => b.id === leaf)) return null;
    return surfaceLeaves.has(leaf) ? null : this.counts[leaf] || 0;
  }
  /** A leaf is listed when the model has something for it; a category or group when any leaf is. */
  present(id) {
    return this.leaves(id).some((leaf) =>
      leaf === "buildings" || this.basemaps.some((b) => b.id === leaf) ? true : surfaceLeaves.has(leaf) ? (this.counts.cells || 0) > 0 : (this.counts[leaf] || 0) > 0,
    );
  }
  /** Drawn: switched on and present. */
  visible(leaf) {
    return !!this.on[leaf] && this.present(leaf);
  }
  /** "on", "off" or "mixed" over the present leaves under `id`. */
  state(id) {
    const leaves = this.leaves(id).filter((leaf) => this.present(leaf));
    const n = leaves.filter((leaf) => this.on[leaf]).length;
    return n === 0 ? "off" : n === leaves.length ? "on" : "mixed";
  }
  /** Switch a leaf, or every present leaf under a group or category. */
  setVisible(id, on) {
    const leaves = this.isLeaf(id) ? [id] : this.leaves(id).filter((leaf) => this.present(leaf));
    let changed = false;
    for (const leaf of leaves)
      if (this.on[leaf] !== !!on && this.enabled(leaf)) {
        this.on[leaf] = !!on;
        changed = true;
      }
    if (changed) this.emit("visible", id);
  }
  /** Whether a category can move `delta` places among the movable categories. */
  canMove(id, delta) {
    const movable = this.order.filter((c) => !tree.find((t) => t.id === c).fixed);
    const i = movable.indexOf(id);
    return i >= 0 && i + delta >= 0 && i + delta < movable.length;
  }
  move(id, delta) {
    if (!this.canMove(id, delta)) return;
    const movable = this.order.filter((c) => !tree.find((t) => t.id === c).fixed);
    const i = movable.indexOf(id);
    [movable[i], movable[i + delta]] = [movable[i + delta], movable[i]];
    this.order = [...movable, ...this.order.filter((c) => tree.find((t) => t.id === c).fixed)];
    this.emit("order", id);
  }
  /** Present categories bottom → top: the order the map paints them in. */
  paintOrder() {
    return [...this.order].reverse().filter((id) => this.present(id));
  }
  opacity(id) {
    return this.alpha[id];
  }
  setOpacity(id, value) {
    const v = Math.min(1, Math.max(0, Number(value)));
    if (this.alpha[id] === v) return;
    this.alpha[id] = v;
    this.emit("opacity", id);
  }
  /** What the displayed model holds: `{cells, junctions, conduits, …}` (contentOf). */
  setContent(counts) {
    this.counts = { ...counts };
    this.emit("content", null);
  }
  /** Switchable; a raster basemap row follows the style row (no map without a token). */
  enabled(leaf) {
    if (leaf.startsWith("bm-") && this.disabled.has("basemap")) return false;
    return !this.disabled.has(leaf);
  }
  setEnabled(leaf, on) {
    if (on) this.disabled.delete(leaf);
    else this.disabled.add(leaf);
    this.emit("enabled", leaf);
  }
  note(leaf) {
    return this.notes[leaf] || "";
  }
  setNote(leaf, text) {
    if ((this.notes[leaf] || "") === (text || "")) return;
    this.notes[leaf] = text || "";
    this.emit("note", leaf);
  }
  /** The map shows a basemap: any basemap row is on. */
  anyBasemap() {
    return this.basemaps.some((b) => this.visible(b.id));
  }
  basemapRow(id) {
    return this.basemaps.find((b) => b.id === id) || null;
  }
  /**
   * Add a basemap: a Mapbox style replaces the style row's; a raster (a preset key, or "custom" with
   * `{label, url, maxzoom}`) goes on top of the stack. The new layer is switched on.
   */
  addBasemap(source, custom = {}) {
    let id;
    if (basemapSources[source]?.kind === "style") {
      this.basemaps[this.basemaps.length - 1].source = source;
      id = "basemap";
    } else if (basemapSources[source]?.kind === "raster" || (source === "custom" && validTileUrl(custom.url) && custom.label)) {
      const n = Math.max(0, ...this.basemaps.map((b) => +(b.id.split("-")[1] || 0))) + 1;
      id = "bm-" + n;
      const row = { id, source, opacity: 1 };
      if (source === "custom") Object.assign(row, { label: String(custom.label), url: custom.url, maxzoom: Math.round(Math.min(24, Math.max(1, +custom.maxzoom || 19))) });
      this.basemaps.unshift(row);
    } else return null;
    this.on[id] = this.enabled(id);
    this.saveBasemaps();
    this.emit("basemaps", id);
    return id;
  }
  removeBasemap(id) {
    const i = this.basemaps.findIndex((b) => b.id === id);
    if (i < 0 || id === "basemap") return;
    this.basemaps.splice(i, 1);
    delete this.on[id];
    this.saveBasemaps();
    this.emit("basemaps", id);
  }
  /** Whether a raster row can move `delta` places (it stays above the style row). */
  canMoveBasemap(id, delta) {
    const i = this.basemaps.findIndex((b) => b.id === id);
    return id !== "basemap" && i >= 0 && i + delta >= 0 && i + delta < this.basemaps.length - 1;
  }
  moveBasemap(id, delta) {
    if (!this.canMoveBasemap(id, delta)) return;
    const i = this.basemaps.findIndex((b) => b.id === id);
    const [row] = this.basemaps.splice(i, 1);
    this.basemaps.splice(i + delta, 0, row);
    this.saveBasemaps();
    this.emit("basemaps", id);
  }
  setBasemapOpacity(id, value) {
    const b = this.basemapRow(id),
      v = Math.min(1, Math.max(0, Number(value)));
    if (!b || b.opacity === v) return;
    b.opacity = v;
    this.saveBasemaps();
    this.emit("basemaps", id);
  }
  saveBasemaps() {
    try {
      this.storage?.setItem(basemapKey, JSON.stringify(this.basemaps));
    } catch {}
  }
  /** A leaf's legend, e.g. the depth ramp's range `{min, max, unit}`. */
  legend(leaf) {
    return this.legends[leaf] || null;
  }
  setLegend(leaf, legend) {
    this.legends[leaf] = legend;
    this.emit("legend", leaf);
  }
}
