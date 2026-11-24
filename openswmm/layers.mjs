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

/** Desktop default symbols: marker shape and size in pixels, line width in pixels, colors. */
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
  meshfill: "Mesh fill",
  edges: "Mesh edges",
  basemap: "Mapbox outdoors",
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
      { id: "other", label: "Other", rows: ["gages"] },
    ],
  },
  { id: "meshes", label: "Meshes", groups: [{ id: null, label: null, rows: ["meshfill", "edges"] }] },
  // The basemap is the Mapbox canvas under the drawing canvas, so it always paints at the bottom.
  { id: "basemaps", label: "Basemaps", fixed: true, groups: [{ id: null, label: null, rows: ["basemap"] }] },
];
const surfaceLeaves = new Set(["depth", "streaks", "meshfill", "edges"]);

/** The counts a layer tree shows for a displayed geometry (view.mjs sketch or a run's geometry). */
export function contentOf(geo) {
  const counts = { cells: geo?.cells?.length || 0 };
  const network = geo?.network;
  if (network) for (const [kind, list] of Object.entries(network)) counts[kind] = list.length;
  else counts.conduits = geo?.links?.length || 0;
  return counts;
}

export class LayerTree extends EventTarget {
  /** @param {{reducedMotion?: boolean}} [o] flow streaks start off when the user asks for less motion */
  constructor({ reducedMotion = false } = {}) {
    super();
    this.order = tree.map((c) => c.id);
    this.on = Object.fromEntries(Object.keys(leafLabels).map((id) => [id, true]));
    this.on.streaks = !reducedMotion;
    this.on.basemap = false;
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
  label(id) {
    return leafLabels[id] ?? tree.find((c) => c.id === id)?.label ?? tree.flatMap((c) => c.groups).find((g) => g.id === id)?.label;
  }
  /** The leaf rows under a category, a group or a leaf. */
  leaves(id) {
    if (id in leafLabels) return [id];
    const cat = tree.find((c) => c.id === id);
    if (cat) return cat.groups.flatMap((g) => g.rows);
    return tree.flatMap((c) => c.groups).find((g) => g.id === id)?.rows || [];
  }
  /** Objects of a leaf kind in the displayed model (null for rows that are not counted). */
  count(leaf) {
    if (leaf === "basemap") return null;
    return surfaceLeaves.has(leaf) ? null : this.counts[leaf] || 0;
  }
  /** A leaf is listed when the model has something for it; a category or group when any leaf is. */
  present(id) {
    return this.leaves(id).some((leaf) =>
      leaf === "basemap" ? true : surfaceLeaves.has(leaf) ? (this.counts.cells || 0) > 0 : (this.counts[leaf] || 0) > 0,
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
    const leaves = id in leafLabels ? [id] : this.leaves(id).filter((leaf) => this.present(leaf));
    let changed = false;
    for (const leaf of leaves)
      if (this.on[leaf] !== !!on && !this.disabled.has(leaf)) {
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
  enabled(leaf) {
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
  /** A leaf's legend, e.g. the depth ramp's range `{min, max, unit}`. */
  legend(leaf) {
    return this.legends[leaf] || null;
  }
  setLegend(leaf, legend) {
    this.legends[leaf] = legend;
    this.emit("legend", leaf);
  }
}
