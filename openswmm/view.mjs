import { symbols, markerOutline, basemapSource } from "./layers.mjs";
import { pickAt, pickInRect, pickInPolygon, modeFor, describeSelection } from "./selection.mjs";
import { classBreaks, contourLevels, triangles, vertexValues, contourBands, isolines, rampColor } from "./depth-style.mjs";
import { Scene3D } from "./scene3d.mjs";
import { rgbOf, isLight } from "./streak-style.mjs";
import { addHint, moveHint, vertexHint } from "./edit-tools.mjs";
/** Snap distances of the add tools (px): a node under the pointer, a conduit to insert on. */
const SNAP_NODE = 10,
  SNAP_LINK = 6;
/** Screen speed of a flow streak at the frame's reference speed (px/s). */
const STREAK_SPEED = 45;
/**
 * Flow streak shape, after the desktop's defaults (FlowStreakStyle): a teardrop with a 2.5 px round
 * head, a 1.5 px body tapering to a quarter of that at the tail, 85% white fading toward the tail,
 * a half-pixel dark halo outside it, and a fade in and out over each particle's life (seconds). The
 * streak style model (streak-style.mjs) sets the density, color, width, trail and speed.
 */
const STREAK = { trail: 1.5, body: 1.5, head: 2.5, alpha: 0.85, halo: 0.65, fade: 0.6, life: [3, 6] };
const smoothstep = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** Highlight color of selected objects. */
const SELECTED = "#e6007e";
/**
 * The engine's default dry depth (m). A model's [2D_OPTIONS] DRY_DEPTH replaces it (`dryDepth`): cells
 * no deeper are dry and not drawn, as in the desktop GUI, and streaks keep to the wet cells.
 */
const DRY = 1e-3;
const nodeKinds = ["junctions", "outfalls", "storage", "dividers"],
  linkKinds = ["conduits", "pumps", "orifices", "weirs", "outlets"];
const typeNames = { junctions: "junction", outfalls: "outfall", storage: "storage unit", dividers: "divider", conduits: "conduit", pumps: "pump", orifices: "orifice", weirs: "weir", outlets: "outlet" };
const xy = ([x, y]) => ({ x, y });
/** The vertex mean of a ring (enough to place an area in a box or lasso). */
function centroid(ring) {
  let x = 0,
    y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return { cx: x / ring.length, cy: y / ring.length };
}
const el = (id) => document.getElementById(id);
function sections(inp) {
  const rows = {};
  let current;
  for (const line of inp.split(/\r?\n/)) {
    const s = line.split(";")[0].trim();
    if (!s) continue;
    if (s.startsWith("[")) {
      current = s.toUpperCase();
      rows[current] ??= [];
    } else if (current) rows[current].push(s.split(/\s+/));
  }
  return rows;
}
/**
 * A deck's network as the map draws it (per kind, as the layer tree lists them, with each kind's
 * object names in `ids`) and every link as a polyline. Virtual junctions draw with the junctions and
 * are named in `virtual`. The map editor refreshes this alone after an edit (the mesh is untouched).
 */
export function deckNetwork(text) {
  return networkOf(sections(text));
}
function networkOf(s) {
  const nodes = new Map((s["[COORDINATES]"] || []).map(([id, x, y]) => [id, [+x, +y]]));
  /** Rows of a map section grouped by object, in file order: id → [[x, y], …]. */
  const points = (name) => {
    const map = new Map();
    for (const [id, x, y] of s[name] || []) {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push([+x, +y]);
    }
    return map;
  };
  const bends = points("[VERTICES]"),
    rings = points("[POLYGONS]"),
    symbolsAt = points("[SYMBOLS]");
  // Each kind's shapes, with their object names in `ids` (same order) for selection.
  const ids = {};
  const shapes = (kind, names, shape) => {
    const out = [];
    ids[kind] = [];
    for (const section of [].concat(names))
      for (const row of s["[" + section + "]"] || []) {
        const g = shape(row);
        if (!g) continue;
        out.push(g);
        ids[kind].push(row[0]);
      }
    return out;
  };
  const at = (kind, section) => shapes(kind, section, (row) => nodes.get(row[0]));
  // A link runs from its inlet node through its [VERTICES] to its outlet node.
  const polylines = (kind, section) =>
    shapes(kind, section, (row) =>
      nodes.has(row[1]) && nodes.has(row[2]) ? [nodes.get(row[1]), ...(bends.get(row[0]) || []), nodes.get(row[2])] : null,
    );
  const network = {
    junctions: at("junctions", ["JUNCTIONS", "VIRTUAL_JUNCTIONS"]),
    outfalls: at("outfalls", "OUTFALLS"),
    storage: at("storage", "STORAGE"),
    dividers: at("dividers", "DIVIDERS"),
    conduits: polylines("conduits", "CONDUITS"),
    pumps: polylines("pumps", "PUMPS"),
    orifices: polylines("orifices", "ORIFICES"),
    weirs: polylines("weirs", "WEIRS"),
    outlets: polylines("outlets", "OUTLETS"),
    subcatchments: shapes("subcatchments", "SUBCATCHMENTS", (row) => {
      const ring = rings.get(row[0]);
      return ring?.length >= 3 ? ring : null;
    }),
    gages: shapes("gages", "RAINGAGES", (row) => symbolsAt.get(row[0])?.[0]),
    ids,
    virtual: new Set((s["[VIRTUAL_JUNCTIONS]"] || []).map((row) => row[0])),
  };
  const links = ["conduits", "pumps", "weirs", "orifices", "outlets"].flatMap((k) => network[k]);
  // [MAP] UNITS: what a coordinate unit is (FEET, METERS, DEGREES or NONE), for traced lengths.
  const mapUnits = ((s["[MAP]"] || []).find((row) => /^UNITS$/i.test(row[0]))?.[1] || "NONE").toUpperCase();
  return { network, links, mapUnits };
}
/**
 * What a deck's text says about its geometry and the objects the forcings can address. A deck that
 * keeps its mesh in a `[2D_MESH_FILE]` sidecar gets it from `inputs` (the project's files by name,
 * the sidecar's path relative to the deck's folder `dir`).
 */
export function sketch(text, inputs = {}, dir = "") {
  const s = sections(text);
  const sidecar = s["[2D_MESH_FILE]"]?.find((row) => /^FILE$/i.test(row[0]))?.[1]?.replace(/^"(.*)"$/, "$1");
  const bytes = sidecar && (inputs[dir + sidecar] || inputs[sidecar]);
  const meshText = bytes ? new TextDecoder().decode(bytes) : text;
  const mesh = bytes ? sections(meshText) : s;
  const vertices = mesh["[2D_VERTICES]"] || [];
  const { network, links, mapUnits } = networkOf(s);
  return {
    x: vertices.map((v) => +v[0]),
    y: vertices.map((v) => +v[1]),
    z: vertices.map((v) => +v[2]), // bed elevations (terrain profiles)
    cells: [
      ...(mesh["[2D_TRIANGLES]"] || []).map((v) => v.slice(0, 3).map(Number)),
      ...(mesh["[2D_QUADS]"] || []).map((v) => v.slice(0, 4).map(Number)),
    ],
    links, // every link as a polyline (saved with a run's geometry)
    network, // per kind, as the layer tree (layers.mjs) lists them
    mapUnits,
    meshSI: /^\s*;;\s*UNITS\s*:\s*SI\b/im.test(meshText), // a mesh that declares itself metric
    // What the live forcings can address, and the units their values are in.
    gages: (s["[RAINGAGES]"] || []).map((row) => row[0]),
    nodes: ["JUNCTIONS", "OUTFALLS", "STORAGE", "DIVIDERS"].flatMap((k) =>
      (s["[" + k + "]"] || []).map((row) => row[0]),
    ),
    flowUnits: ((s["[OPTIONS]"] || []).find((row) => /^FLOW_UNITS$/i.test(row[0]))?.[1] || "CFS").toUpperCase(),
    // [OPTIONS] CRS as written (an EPSG code, WKT or PROJ string; crs.mjs reads it); "" for none.
    crs: ((s["[OPTIONS]"] || []).find((row) => /^CRS$/i.test(row[0])) || []).slice(1).join(" "),
  };
}
function contains(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = poly[i],
      [c, d] = poly[j];
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a)
      inside = !inside;
  }
  return inside;
}
/** Map canvas (view): draws the displayed geometry and frame as the layer tree model says. */
export class ModelView {
  /** @param {string} token Mapbox public token @param {import("./layers.mjs").LayerTree} layers */
  constructor(token, layers) {
    this.token = token;
    this.layers = layers;
    this.canvas = el("plot");
    this.ctx = this.canvas.getContext("2d");
    this.geo = { x: [], y: [], cells: [], links: [] };
    this.particles = [];
    this.zoom = 1;
    this.pan = [0, 0];
    this.drag = null;
    // Map tools: "select" (a click selects, a drag pans), "box" and "lasso" (a drag selects), "line"
    // (clicks draw a terrain profile line; a double-click or Enter ends it).
    this.tool = "select";
    this.band = null; // the box or lasso being drawn, in screen pixels
    this.trace = null; // the profile line being drawn: model points and the pointer
    this.profileLine = null; // the shown profile's path or line, model coordinates
    this.profileMarker = null; // the profile chart's crosshair on the map
    // "add" (map editing): `adding` is what (edit-tools.mjs addKinds), `hover` what a click would hit,
    // `tracing` the link being drawn (its start node, bends and the pointer).
    this.adding = null;
    this.hover = null;
    this.tracing = null;
    this.ring = null; // the subcatchment being drawn: its corners
    // "move" drags a node or rain gage; "vertex" edits the vertices of `vertexLink`. `editing` is the
    // drag under way: {kind, id, from, at} for a move, {link, index, from, at} for a vertex.
    this.editing = null;
    this.vertexLink = null;
    for (const tool of ["select", "box", "lasso", "line", "move", "vertex"]) el("tool-" + tool).onclick = () => this.setTool(tool);
    this.canvas.oncontextmenu = (e) => {
      if (this.tool !== "add" && this.tool !== "vertex") return;
      e.preventDefault();
      if (this.tool === "add") this.addBack();
      else this.vertexContext(e.offsetX, e.offsetY);
    };
    this.canvas.onpointerdown = (e) => {
      if (this.tool === "line") {
        const m = this.unproject(e.offsetX, e.offsetY),
          last = this.trace?.pts.at(-1);
        if (!m) return;
        this.trace ||= { pts: [] };
        // A double-click's second press lands on the same point: keep one.
        if (!last || Math.hypot(...this.project(...last).map((v, i) => v - [e.offsetX, e.offsetY][i])) > 3) this.trace.pts.push(m);
        this.draw();
        return;
      }
      // Move and Edit vertices: a press on a node, gage or vertex drags it; elsewhere the map pans.
      if ((this.tool === "move" || this.tool === "vertex") && e.button === 0 && this.editDown(e.offsetX, e.offsetY)) {
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (!["select", "add", "move", "vertex"].includes(this.tool)) {
        this.band = { pts: [[e.offsetX, e.offsetY]] };
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      this.drag = [e.clientX, e.clientY, ...this.pan];
      this.canvas.setPointerCapture(e.pointerId);
    };
    this.canvas.onpointermove = (e) => {
      if (this.editing) return this.editMove(e.offsetX, e.offsetY);
      if (this.tool === "add" && !this.drag) return this.addMove(e.offsetX, e.offsetY);
      if ((this.tool === "move" || this.tool === "vertex") && !this.drag) return this.editHover(e.offsetX, e.offsetY);
      if (this.tool === "line" && this.trace) {
        this.trace.at = this.unproject(e.offsetX, e.offsetY);
        this.draw();
        return;
      }
      if (this.band) {
        if (this.tool === "box") this.band.pts[1] = [e.offsetX, e.offsetY];
        else this.band.pts.push([e.offsetX, e.offsetY]);
        this.draw();
        return;
      }
      if (this.drag) {
        this.pan = [
          this.drag[2] + e.clientX - this.drag[0],
          this.drag[3] + e.clientY - this.drag[1],
        ];
        this.draw();
      }
    };
    this.canvas.onpointerup = (e) => {
      if (this.editing) return this.editUp();
      if (this.band) return this.finishBand(e);
      if (
        this.drag &&
        Math.hypot(e.clientX - this.drag[0], e.clientY - this.drag[1]) < 4
      ) {
        if (this.tool === "add") e.button === 0 && this.addClick(e.offsetX, e.offsetY);
        else if (this.tool === "vertex") e.button === 0 && this.vertexClick(e.offsetX, e.offsetY);
        else this.click(e.offsetX, e.offsetY, e);
      }
      this.drag = null;
    };
    this.canvas.onpointercancel = () => {
      this.drag = this.band = this.editing = null;
      this.draw();
    };
    this.canvas.ondblclick = () => {
      if (this.tool === "line") this.finishTrace();
      else if (this.tool === "add" && this.ring) this.finishRing();
    };
    // Escape drops a box, lasso or profile line being drawn, else the selection; Enter ends a line.
    document.addEventListener("keydown", (e) => {
      if (e.target.closest?.("input, textarea, select, dialog")) return;
      if (e.key === "Enter" && this.trace) return this.finishTrace();
      // Adding: Backspace drops the last bend or corner, Enter closes a subcatchment; Escape drops the
      // link or subcatchment being drawn, then the tool.
      if (this.tool === "add") {
        if (e.key === "Backspace" && (this.tracing || this.ring)) {
          e.preventDefault();
          this.addBack();
        } else if (e.key === "Enter" && this.ring) this.finishRing();
        else if (e.key === "Escape") {
          if (this.tracing || this.ring) {
            this.tracing = this.ring = null;
            this.hint(addHint(this.adding));
            this.draw();
          } else this.setTool("select");
        }
        return;
      }
      // Move and Edit vertices: Escape drops a drag, then the link being edited, then the tool.
      if ((this.tool === "move" || this.tool === "vertex") && e.key === "Escape") {
        if (this.editing) this.editing = null;
        else if (this.vertexLink) {
          this.vertexLink = null;
          this.hint(vertexHint(null));
        } else return this.setTool("select");
        return this.draw();
      }
      // Delete (or Backspace) deletes the selected network objects, after a confirmation.
      if ((e.key === "Delete" || e.key === "Backspace") && this.selection?.items.some((i) => i.kind !== "cell")) {
        e.preventDefault();
        this.onDelete?.(this.selection.items.filter((i) => i.kind !== "cell"));
        return;
      }
      if (e.key !== "Escape") return;
      if (this.trace) {
        this.trace = null;
        this.setTool("select");
      } else if (this.band) {
        this.band = null;
        this.draw();
      } else this.selection?.clear("map");
    });
    this.canvas.onwheel = (e) => {
      e.preventDefault();
      this.scale(e.deltaY < 0 ? 1.18 : 1 / 1.18);
    };
    el("fit").onclick = () => this.fit();
    el("zoomin").onclick = () => this.scale(1.4);
    el("zoomout").onclick = () => this.scale(1 / 1.4);
    this.mode3d = false;
    this.scene3d = new Scene3D(this);
    el("view-3d").onclick = () => this.set3D(!this.mode3d);
    el("view-north").onclick = () => this.resetView();
    layers.addEventListener("change", ({ detail }) => {
      if (detail.kind === "opacity" && detail.id === "basemaps")
        el("map").style.opacity = String(layers.opacity("basemaps"));
      if (["visible", "order", "opacity", "content"].includes(detail.kind)) this.draw();
      if (detail.kind === "visible" || detail.kind === "basemaps") {
        this.syncBuildings();
        this.syncBasemaps();
      }
    });
    new ResizeObserver(() => {
      this.map?.resize();
      this.draw();
    }).observe(this.canvas);
    let last = 0;
    const tick = (t) => {
      // Paused while a job runs: redrawing every cell ~25 times a second competes with the solver
      // (a WebGPU 2D run measured 2.6x slower with it on); new frames still draw as they arrive.
      if (
        this.frame &&
        !this.still &&
        this.layers.visible("streaks") &&
        !document.hidden &&
        t - last > 40
      ) {
        this.advance(Math.min((t - last) / 1000, 0.15));
        last = t;
        this.draw(true);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  /**
   * Show a model's geometry. `placement` (crs.mjs: `{toLonLat, …}`, null for local coordinates)
   * says where it sits on the globe; leave it undefined to keep the current one.
   */
  geometry(geo, placement) {
    this.geo = geo;
    if (placement !== undefined) this.placement = placement;
    this.frame = null;
    this.particles = [];
    // The network as the layer tree draws it: per kind, or a saved run's plain links as conduits.
    this.network = geo.network || { conduits: geo.links || [] };
    const n = this.network;
    const points = [
      ...Array.from(geo.x || [], (x, i) => [x, geo.y[i]]),
      ...[n.conduits, n.pumps, n.orifices, n.weirs, n.outlets, n.subcatchments].flatMap((list) => (list || []).flat()),
      ...[n.junctions, n.outfalls, n.storage, n.dividers, n.gages].flatMap((list) => list || []),
    ];
    this.bounds = points.reduce(
      ([l, b, r, t], [x, y]) => [
        Math.min(l, x),
        Math.min(b, y),
        Math.max(r, x),
        Math.max(t, y),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    if (!points.length) this.bounds = [0, 0, 100, 100];
    this.polys = geo.cells.map((cell) => cell.map((v) => [geo.x[v], geo.y[v]]));
    this.tris = triangles(geo.cells);
    this.runPeak = 0;
    this.contours = null; // cached band and line geometry for one frame and style
    this.bins = new Map();
    const [l, b, r, t] = this.bounds;
    this.binSize =
      Math.max(r - l, t - b, 1) /
      Math.max(1, Math.ceil(Math.sqrt(geo.cells.length) / 2));
    this.polys.forEach((poly, i) => {
      const xs = poly.map((p) => p[0]),
        ys = poly.map((p) => p[1]);
      for (
        let x = Math.floor((Math.min(...xs) - l) / this.binSize);
        x <= Math.floor((Math.max(...xs) - l) / this.binSize);
        x++
      )
        for (
          let y = Math.floor((Math.min(...ys) - b) / this.binSize);
          y <= Math.floor((Math.max(...ys) - b) / this.binSize);
          y++
        ) {
          const key = x + "," + y;
          if (!this.bins.has(key)) this.bins.set(key, []);
          this.bins.get(key).push(i);
        }
    });
    this.fit();
  }
  /**
   * Show an edited network (deckNetwork) in place: the view keeps its extent and the mesh, so objects
   * placed or deleted on the map appear where they were drawn.
   */
  setNetwork(network) {
    this.network = network;
    this.geo = { ...this.geo, network };
    this.draw();
  }
  locate(x, y) {
    const [l, b] = this.bounds;
    return (
      this.bins.get(
        Math.floor((x - l) / this.binSize) +
          "," +
          Math.floor((y - b) / this.binSize),
      ) || []
    ).find((i) => contains(this.polys[i], x, y));
  }
  setFrame(frame) {
    if (!frame || !this.frame || frame.seconds < this.frame.seconds)
      this.particles = [];
    this.frame = frame;
    this.wet = [];
    let peak = 0.001;
    frame?.depth.forEach((d, i) => {
      if (d > this.dry() && Number.isFinite(frame.u[i] + frame.v[i]))
        this.wet.push(i);
      if (d > peak) peak = d;
    });
    this.peak = peak;
    // The frame's reference speed (95th percentile of the wet cells): streaks at this speed move
    // a fixed distance on screen, whatever the mesh size or zoom.
    const speeds = this.wet.map((i) => Math.hypot(frame.u[i], frame.v[i])).sort((a, b) => a - b);
    this.speedRef = Math.max(1e-9, speeds[Math.floor(0.95 * (speeds.length - 1))] || 0);
    this.runPeak = Math.max(this.runPeak || 0, peak);
    this.depthLegend();
    this.streakLegend();
    this.draw();
  }
  advance(dt) {
    if (!this.wet?.length) {
      this.particles = [];
      return;
    }
    const now = (this.clock = (this.clock || 0) + dt),
      dry = this.dry();
    const S = this.streak(),
      count = Math.round(Math.min(1200 * S.density, Math.max(30, this.wet.length * 3 * S.density)));
    if (this.particles.length > count) this.particles.length = count; // a lower density drops the rest
    const f = this.frame;
    // Particles move in screen space: at the reference speed about STREAK_SPEED px/s (faster cells
    // up to twice that). Model units per step = speed × k, k from the current pixels per unit.
    const [l, b, r, t] = this.bounds,
      [x0, y0] = this.project((l + r) / 2, (b + t) / 2),
      [x1, y1] = this.project((l + r) / 2 + 1, (b + t) / 2);
    const k = (STREAK_SPEED * S.speed * dt) / ((Math.hypot(x1 - x0, y1 - y0) || 1) * this.speedRef);
    for (let i = 0; i < count; i++) {
      let p = this.particles[i];
      // A particle lives a few seconds; one that stopped on dry ground fades out first.
      if (!p || now - p.born > p.life || (p.stopped !== null && now - p.stopped > STREAK.fade)) {
        const cell = this.wet[Math.floor(Math.random() * this.wet.length)],
          poly = this.polys[cell];
        const [a, b, c] = poly;
        let s = Math.random(),
          t = Math.random();
        if (s + t > 1) {
          s = 1 - s;
          t = 1 - t;
        }
        p = {
          x: a[0] + s * (b[0] - a[0]) + t * (c[0] - a[0]),
          y: a[1] + s * (b[1] - a[1]) + t * (c[1] - a[1]),
          cell,
          born: now,
          life: STREAK.life[0] + Math.random() * (STREAK.life[1] - STREAK.life[0]),
          stopped: null,
          trail: [],
        };
        this.particles[i] = p;
      }
      // Samples older than the trail drop off, so a stopped particle's tail draws in to its head.
      while (p.trail.length && now - p.trail[0][2] > S.trail) p.trail.shift();
      if (p.stopped !== null) continue;
      if (!(f.depth[p.cell] > dry)) {
        p.stopped = now;
        continue;
      }
      const u = f.u[p.cell],
        v = f.v[p.cell],
        cap = Math.min(1, (2 * this.speedRef) / (Math.hypot(u, v) || 1)),
        x = p.x + u * k * cap,
        y = p.y + v * k * cap;
      const next = contains(this.polys[p.cell], x, y)
        ? p.cell
        : this.locate(x, y);
      if (
        next === undefined ||
        !(f.depth[next] > dry) ||
        !Number.isFinite(u + v)
      ) {
        p.stopped = now;
        continue;
      }
      p.trail.push([p.x, p.y, now - dt]);
      Object.assign(p, { x, y, cell: next });
    }
  }
  /**
   * The mesh vertices on screen now, as [x0, y0, x1, y1, …]. On the basemap their lon/lat are kept
   * per geometry and placement, so a redraw only asks the map to project them.
   */
  /** The mesh vertices' lon/lat as [lon0, lat0, …], kept per geometry and placement. */
  vertexLonLat() {
    const g = this.geo,
      n = g.x.length;
    if (this.lonLat?.geo !== g || this.lonLat.placement !== this.placement) {
      const ll = new Float64Array(2 * n);
      for (let k = 0; k < n; k++) [ll[2 * k], ll[2 * k + 1]] = this.placement.toLonLat(g.x[k], g.y[k]);
      this.lonLat = { geo: g, placement: this.placement, ll };
    }
    return this.lonLat.ll;
  }
  projectVertices() {
    const g = this.geo,
      n = g.x.length,
      V = new Float64Array(2 * n);
    if (this.map && this.placement) {
      const ll = this.vertexLonLat();
      for (let k = 0; k < n; k++) {
        const q = this.map.project([ll[2 * k], ll[2 * k + 1]]);
        V[2 * k] = q.x;
        V[2 * k + 1] = q.y;
      }
    } else for (let k = 0; k < n; k++) [V[2 * k], V[2 * k + 1]] = this.project(g.x[k], g.y[k]);
    return V;
  }
  /**
   * The flow streaks as teardrops: per particle one outline (tail to head, its width from STREAK,
   * a round cap at the head) filled with white fading toward the tail, and a half-pixel dark halo
   * just outside it (an even-odd ring, so the body itself stays clean).
   */
  drawStreaks(c) {
    const now = this.clock || 0,
      S = this.streak(),
      f = this.frame;
    // Colors: one for all, or each particle's from its cell's speed on the ramp (cached in 64 steps);
    // the edge is dark under light colors and white under dark ones.
    const tone = (rgb) => ({ rgb: rgb.join(","), halo: isLight(rgb) ? "20,51,71" : "255,255,255" });
    const single = tone(rgbOf(S.color)),
      tones = new Map();
    const colorOf = (p) => {
      if (S.mode !== "speed" || !f) return single;
      const step = Math.round(Math.min(1, Math.hypot(f.u[p.cell], f.v[p.cell]) / (2 * (this.speedRef || 1))) * 63);
      if (!tones.has(step)) tones.set(step, tone(rgbOf(rampColor(S.ramp, step / 63, S.invert))));
      return tones.get(step);
    };
    const width = (f) => S.body * Math.max(0.25, f) + (S.head - S.body) * smoothstep((f - 0.75) * 4);
    // On the basemap a trail sample keeps its lon/lat (s[3]), so a redraw only projects it.
    const screen =
      this.map && this.placement
        ? (s) => {
            const q = this.map.project(s[3] || (s[3] = this.placement.toLonLat(s[0], s[1])));
            return [q.x, q.y];
          }
        : ((P) => (s) => P(s[0], s[1]))(this.projector());
    for (const p of this.particles) {
      if (!p) continue;
      const fade = Math.min(S.fade, p.life * 0.2),
        age = now - p.born;
      let a = smoothstep(age / fade) * smoothstep((p.life - age) / fade);
      if (p.stopped !== null) a *= 1 - smoothstep((now - p.stopped) / S.fade);
      if (!(a > 0.01)) continue;
      // Screen points from the head back, skipping samples under half a pixel apart.
      const head = screen([p.x, p.y]),
        pts = [[head[0], head[1], now]];
      // A long trail is drawn from every other sample (its oldest kept): still smooth, half the work.
      const stride = p.trail.length > 24 ? 2 : 1;
      for (let i = p.trail.length - 1; i >= 0; i = i > 0 && i - stride < 0 ? 0 : i - stride) {
        const [x, y] = screen(p.trail[i]),
          q = pts[pts.length - 1];
        if (Math.hypot(x - q[0], y - q[1]) >= 0.5) pts.push([x, y, p.trail[i][2]]);
      }
      const col = colorOf(p);
      if (pts.length < 2) {
        c.beginPath();
        c.arc(head[0], head[1], S.head / 2, 0, 2 * Math.PI);
        c.fillStyle = "rgba(" + col.rgb + "," + S.alpha * a + ")";
        c.fill();
        continue;
      }
      pts.reverse();
      const n = pts.length,
        span = Math.max(1e-6, Math.min(S.trail, now - pts[0][2]));
      const sides = pts.map(([x, y, t], i) => {
        const [ax, ay] = pts[Math.max(0, i - 1)],
          [bx, by] = pts[Math.min(n - 1, i + 1)],
          d = Math.hypot(bx - ax, by - ay) || 1;
        return { x, y, nx: -(by - ay) / d, ny: (bx - ax) / d, r: width(1 - (now - t) / span) / 2 };
      });
      const outline = (grow) => {
        sides.forEach(({ x, y, nx, ny, r }, i) => (i ? c.lineTo(x + nx * (r + grow), y + ny * (r + grow)) : c.moveTo(x + nx * (r + grow), y + ny * (r + grow))));
        const h = sides[n - 1],
          ang = Math.atan2(h.ny, h.nx);
        c.arc(h.x, h.y, h.r + grow, ang, ang - Math.PI, true);
        for (let i = n - 1; i >= 0; i--) {
          const { x, y, nx, ny, r } = sides[i];
          c.lineTo(x - nx * (r + grow), y - ny * (r + grow));
        }
        c.closePath();
      };
      const along = (rgb, alpha) => {
        const g = c.createLinearGradient(pts[0][0], pts[0][1], head[0], head[1]);
        g.addColorStop(0, "rgba(" + rgb + ",0)");
        g.addColorStop(1, "rgba(" + rgb + "," + alpha + ")");
        return g;
      };
      c.beginPath();
      outline(0.5);
      outline(0);
      c.fillStyle = along(col.halo, S.halo * S.alpha * a);
      c.fill("evenodd");
      c.beginPath();
      outline(0);
      c.fillStyle = along(col.rgb, S.alpha * a);
      c.fill();
    }
  }
  /** A new placement for the same geometry (a CRS resolved after the model was shown). */
  setPlacement(placement) {
    this.placement = placement;
    this.particles = []; // their samples keep lon/lat for the old placement
    if (this.map) this.fit();
    else this.draw();
  }
  /**
   * Model → screen for one draw: the same as project(), with the canvas size and scale read once
   * (project() reads the layout on every call, which thousands of streak points a frame notice).
   */
  projector() {
    if (this.map && this.placement)
      return (x, y) => {
        const q = this.map.project(this.placement.toLonLat(x, y));
        return [q.x, q.y];
      };
    const [l, b, r, t] = this.bounds || [0, 0, 100, 100],
      w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const k = Math.min(w / Math.max(1, r - l), h / Math.max(1, t - b)) * 0.76 * this.zoom,
      cx = (r + l) / 2,
      cy = (b + t) / 2,
      ox = w / 2 + this.pan[0],
      oy = h / 2 + this.pan[1];
    return (x, y) => [ox + (x - cx) * k, oy - (y - cy) * k];
  }
  /**
   * Where basemap previews look: the map's center and zoom when it is shown, else the model's middle at
   * a zoom that fits it, else the whole world. `{lon, lat, zoom}`
   */
  previewCenter() {
    if (this.map) {
      const c = this.map.getCenter();
      return { lon: c.lng, lat: c.lat, zoom: this.map.getZoom() };
    }
    if (!this.placement || !this.bounds) return { lon: 0, lat: 30, zoom: 1 };
    const [[w, s], [e, n]] = this.lonLatBounds();
    return { lon: (w + e) / 2, lat: (s + n) / 2, zoom: Math.max(1, Math.min(16, Math.log2(360 / Math.max(1e-6, e - w)) + 0.5)) };
  }
  /** The model's bounds on the globe, `[[west, south], [east, north]]`, from its four corners. */
  lonLatBounds() {
    const [l, b, r, t] = this.bounds;
    const corners = [
      [l, b],
      [r, b],
      [r, t],
      [l, t],
    ].map(([x, y]) => this.placement.toLonLat(x, y));
    const lons = corners.map((c) => c[0]),
      lats = corners.map((c) => c[1]);
    return [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
  }
  project(x, y) {
    if (this.map && this.placement) {
      const p = this.map.project(this.placement.toLonLat(x, y));
      return [p.x, p.y];
    }
    const [l, b, r, t] = this.bounds || [0, 0, 100, 100],
      w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const s =
      Math.min(w / Math.max(1, r - l), h / Math.max(1, t - b)) *
      0.76 *
      this.zoom;
    return [
      w / 2 + (x - (r + l) / 2) * s + this.pan[0],
      h / 2 - (y - (b + t) / 2) * s + this.pan[1],
    ];
  }
  fit() {
    this.zoom = 1;
    this.pan = [0, 0];
    if (this.map && this.placement && this.bounds)
      this.map.fitBounds(this.lonLatBounds(), { padding: 55, duration: 0, maxZoom: 20 });
    this.draw();
  }
  scale(f) {
    if (this.map) this.map.zoomTo(this.map.getZoom() + Math.log2(f));
    else this.zoom = Math.min(100, Math.max(0.1, this.zoom * f));
    this.draw();
  }
  /** Observe the water depth style (depth-style.mjs): classes, colors, range, contours. */
  useDepthStyle(style) {
    this.depthStyle = style;
    style.addEventListener("change", () => {
      this.contours = null;
      if (this.frame) this.setFrame(this.frame); // the wet cells follow the display threshold
      else {
        this.depthLegend();
        this.draw();
      }
    });
  }
  /** Observe a streak style model (streak-style.mjs): the streaks and their legend follow it. */
  useStreakStyle(style) {
    this.streakStyle = style;
    style.addEventListener("change", () => {
      this.streakLegend();
      this.draw();
    });
  }
  /** The streaks' drawing parameters now: STREAK with the style's density, width, trail and speed. */
  streak() {
    const st = this.streakStyle?.state || {};
    const body = st.width ?? STREAK.body;
    return { ...STREAK, body, head: body + 1, trail: st.trail ?? STREAK.trail, speed: st.speed ?? 1, density: st.density ?? 1, mode: st.mode || "single", color: st.color || "#ffffff", ramp: st.ramp || "viridis", invert: !!st.invert };
  }
  /** The streaks' legend: the single color, or the speed ramp over 0 … twice the reference speed. */
  streakLegend() {
    const S = this.streak();
    this.layers.setLegend(
      "streaks",
      S.mode === "speed" && this.frame
        ? { ramp: Array.from({ length: 7 }, (_, i) => rampColor(S.ramp, i / 6, S.invert)), min: 0, max: 2 * (this.speedRef || 0), unit: "m/s" }
        : { color: S.color },
    );
  }
  /** The model's dry depth (m): its DRY_DEPTH, or the engine's default. */
  modelDry() {
    return this.dryDepth ?? DRY;
  }
  /** Water no deeper than this (m) is not drawn: the style's threshold, or the model's dry depth. */
  dry() {
    return this.depthStyle?.state.hideBelow ?? this.modelDry();
  }
  /**
   * How depth is colored now: the range (per frame, whole run or fixed), the class breaks (none for
   * a continuous ramp) and the color of a value. Kept until the frame or the style changes (the
   * streak animation redraws many times a frame).
   */
  depthScheme() {
    const st = this.depthStyle?.state || { method: "continuous", range: "frame", ramp: "blues", display: "cells" };
    const f = this.frame;
    const key = this.peak + "|" + this.runPeak + "|" + this.dry() + "|" + JSON.stringify(st);
    if (this.scheme?.frame === f && this.scheme.key === key) return this.scheme;
    let lo = 0,
      hi = this.peak || 0.001;
    if (st.range === "run") hi = Math.max(this.runPeak || 0, hi);
    if (st.range === "fixed") [lo, hi] = [st.min, st.max];
    const bands = st.display === "bands";
    // No water deeper than the threshold (all of it hidden): no classes, nothing to draw.
    const empty = !(hi > Math.max(lo, this.dry()));
    let breaks = null;
    if (!empty && (st.method !== "continuous" || bands)) {
      const method = st.method === "continuous" ? "equal" : st.method;
      const wet = f ? Array.from(f.depth).filter((d) => d > this.dry()) : [];
      breaks = classBreaks(wet, method, st.method === "continuous" ? 8 : st.classes, Math.max(lo, this.dry()), hi, st.manual);
    }
    const n = breaks ? breaks.length - 1 : 0;
    const classColor = (k) => rampColor(st.ramp, n > 1 ? k / (n - 1) : 1, st.invert);
    const colorOf = (d) => {
      if (!breaks) return rampColor(st.ramp, (d - lo) / (hi - lo || 1), st.invert);
      let k = 0;
      while (k < n - 1 && d >= breaks[k + 1]) k++;
      return classColor(k);
    };
    return (this.scheme = { frame: f, key, st, lo, hi, breaks, classColor, colorOf, empty });
  }
  /** The layer panel's depth legend: the classes, or the ramp with its range. */
  depthLegend() {
    if (!this.frame) return this.layers.setLegend("depth", null);
    const { st, lo, hi, breaks, classColor, empty } = this.depthScheme();
    if (empty) return this.layers.setLegend("depth", { empty: true, min: this.dry(), unit: "m" });
    this.layers.setLegend("depth", {
      min: lo,
      max: hi,
      unit: "m", // 2D depths are in meters whatever the deck's units
      ramp: Array.from({ length: 7 }, (_, i) => rampColor(st.ramp, i / 6, st.invert)),
      classes: breaks ? breaks.slice(0, -1).map((from, k) => ({ from, to: breaks[k + 1], color: classColor(k), last: k === breaks.length - 2 })) : null,
    });
  }
  /** Band and line geometry for the current frame and style, made once and kept until either changes. */
  contourGeometry(scheme) {
    const st = scheme.st,
      f = this.frame;
    const key = JSON.stringify(st) + "|" + this.dry() + "|" + scheme.lo + "|" + scheme.hi + "|" + (scheme.breaks || []).join(",");
    if (this.contours?.frame === f && this.contours.key === key) return this.contours;
    const values = vertexValues(this.geo.cells, f.depth, this.geo.x.length);
    const levels = st.lines ? contourLevels(Math.max(scheme.lo, this.dry()), scheme.hi, { mode: st.levelMode, count: st.levelCount, interval: st.interval, base: st.base }) : [];
    const index = levels.map((v, i) =>
      st.indexEvery > 0 && (st.levelMode === "interval" ? Math.round((v - st.base) / st.interval) % st.indexEvery === 0 : (i + 1) % st.indexEvery === 0),
    );
    this.contours = {
      frame: f,
      key,
      bands: st.display === "bands" && scheme.breaks ? contourBands(this.tris, values, scheme.breaks) : null,
      levels,
      index,
      lines: levels.length ? isolines(this.tris, values, levels) : [],
    };
    return this.contours;
  }
  /** Observe a selection model (selection.mjs): the map draws it and changes it. */
  useSelection(selection) {
    this.selection = selection;
    selection.addEventListener("change", () => this.draw());
  }
  /**
   * Arm a map tool; "add" takes what to add (edit-tools.mjs addKinds). While adding, a drag still pans
   * the map and the wheel zooms; a click places, inserts or traces.
   */
  setTool(tool, adding = null) {
    this.tool = tool;
    this.band = null;
    if (tool !== "line") this.trace = null;
    this.adding = tool === "add" ? adding : null;
    this.hover = this.tracing = this.ring = this.editing = this.vertexLink = null;
    // Box and lasso take the pointer from the basemap while they are active; the editing tools leave
    // it to the basemap (its clicks and moves come from the map) so a drag still pans.
    const editTool = ["add", "move", "vertex"].includes(tool);
    el("scene").classList.toggle("tool-band", tool !== "select" && !editTool);
    el("scene").classList.toggle("tool-add", editTool);
    for (const t of ["select", "box", "lasso", "line", "add", "move", "vertex"]) el("tool-" + t).setAttribute("aria-pressed", String(t === tool));
    el("tool-add").title = tool === "add" ? "Adding: " + adding.label.toLowerCase() + " (Esc ends)" : "Add objects to the model";
    if (this.map) this.map.doubleClickZoom[tool === "add" ? "disable" : "enable"]();
    this.hint(tool === "add" ? addHint(adding) : tool === "move" ? moveHint : tool === "vertex" ? vertexHint(null) : "");
    this.draw();
  }
  /** The add tools' line on the map (what a click does, or why it was refused); empty hides it. */
  hint(text) {
    const h = el("edithint");
    h.textContent = text;
    h.hidden = !text;
  }
  /** The visible node nearest screen (x, y) within `SNAP_NODE` px: {id, point, virtual}, or null. */
  nodeAt(x, y) {
    const n = this.network || {},
      ids = n.ids || {};
    let best = null,
      bestD = SNAP_NODE;
    for (const k of nodeKinds) {
      if (!this.layers.visible(k)) continue;
      (n[k] || []).forEach((p, i) => {
        const [px, py] = this.project(p[0], p[1]),
          d = Math.hypot(px - x, py - y);
        if (d <= bestD && ids[k]?.[i] !== undefined) {
          bestD = d;
          best = { kind: "node", id: ids[k][i], point: p, virtual: !!n.virtual?.has(ids[k][i]) };
        }
      });
    }
    return best;
  }
  /** The visible rain gage nearest screen (x, y) within `SNAP_NODE` px: {kind, id, point}, or null. */
  gageAt(x, y) {
    const n = this.network || {};
    if (!this.layers.visible("gages")) return null;
    let best = null,
      bestD = SNAP_NODE;
    (n.gages || []).forEach((p, i) => {
      const [px, py] = this.project(p[0], p[1]),
        d = Math.hypot(px - x, py - y);
      if (d <= bestD && n.ids?.gages?.[i] !== undefined) [best, bestD] = [{ kind: "gage", id: n.ids.gages[i], point: p }, d];
    });
    return best;
  }
  /** A link's polyline (its end nodes included), model coordinates, or null. */
  linkLine(id) {
    const n = this.network || {};
    for (const k of linkKinds) {
      const i = n.ids?.[k]?.indexOf(id) ?? -1;
      if (i >= 0) return n[k][i];
    }
    return null;
  }
  /** The interior vertex of `line` within 7 px of screen (x, y): its index in the polyline, or -1. */
  handleAt(line, x, y) {
    let best = -1,
      bestD = 7;
    for (let i = 1; i < line.length - 1; i++) {
      const [px, py] = this.project(line[i][0], line[i][1]),
        d = Math.hypot(px - x, py - y);
      if (d <= bestD) [best, bestD] = [i, d];
    }
    return best;
  }
  /**
   * The ground elevation under (x, y) in model coordinates, from the 2D mesh's vertex elevations
   * (linear in the triangle that holds the point), or undefined off the mesh or without one.
   */
  bedAt(x, y) {
    const g = this.geo,
      z = g?.z;
    if (!z?.length || !this.polys?.length) return undefined;
    const i = this.locate(x, y);
    if (i === undefined) return undefined;
    const cell = g.cells[i];
    for (let k = 1; k + 1 < cell.length; k++) {
      const [a, b, c] = [cell[0], cell[k], cell[k + 1]];
      const d = (g.y[b] - g.y[c]) * (g.x[a] - g.x[c]) + (g.x[c] - g.x[b]) * (g.y[a] - g.y[c]);
      if (!d) continue;
      const w1 = ((g.y[b] - g.y[c]) * (x - g.x[c]) + (g.x[c] - g.x[b]) * (y - g.y[c])) / d,
        w2 = ((g.y[c] - g.y[a]) * (x - g.x[c]) + (g.x[a] - g.x[c]) * (y - g.y[c])) / d,
        w3 = 1 - w1 - w2;
      if (w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9) {
        const v = w1 * z[a] + w2 * z[b] + w3 * z[c];
        return Number.isFinite(v) ? v : undefined;
      }
    }
    return undefined;
  }
  /**
   * The visible conduit nearest screen (x, y) within `SNAP_LINK` px: {id, t, point}, `t` the fraction
   * of its length (model units) at the nearest point, as the engine's split takes it.
   */
  conduitAt(x, y) {
    const n = this.network || {};
    if (!this.layers.visible("conduits")) return null;
    let best = null,
      bestD = SNAP_LINK;
    (n.conduits || []).forEach((pts, i) => {
      const id = n.ids?.conduits?.[i];
      if (id === undefined || pts.length < 2) return;
      const P = pts.map((p) => this.project(p[0], p[1]));
      let total = 0;
      const lengths = pts.slice(1).map((p, j) => {
        const d = Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]);
        total += d;
        return d;
      });
      let before = 0;
      for (let j = 0; j < P.length - 1; j++) {
        const [ax, ay] = P[j],
          [bx, by] = P[j + 1],
          dx = bx - ax,
          dy = by - ay,
          f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))),
          d = Math.hypot(ax + f * dx - x, ay + f * dy - y);
        if (d <= bestD && total > 0) {
          bestD = d;
          const a = pts[j],
            b = pts[j + 1];
          best = { id, t: (before + f * lengths[j]) / total, point: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])] };
        }
        before += lengths[j];
      }
    });
    return best;
  }
  /** The pointer moved with an add tool armed: what a click would hit, for the preview. */
  addMove(x, y) {
    const a = this.adding;
    if (!a) return;
    const node = a.kind === "gage" ? null : this.nodeAt(x, y);
    this.hover = { at: this.unproject(x, y), node, conduit: a.kind === "node" && !node ? this.conduitAt(x, y) : null };
    this.draw();
  }
  /** A click with an add tool armed: place, insert, or trace (desktop rules); `onAdd` makes the edit. */
  addClick(x, y) {
    const a = this.adding,
      at = this.unproject(x, y);
    if (!a || !at) return;
    this.hint(this.tracing ? this.traceHint() : addHint(a)); // a refusal below says why instead
    if (a.kind === "gage") return this.onAdd?.({ op: "gage", x: at[0], y: at[1] });
    // Subcatchments: clicks place corners; a double-click or Enter closes the outline.
    if (a.kind === "subcatchment") {
      this.ring ||= { pts: [] };
      const last = this.ring.pts.at(-1);
      // A double-click's second press lands on the same point: keep one.
      if (!last || Math.hypot(...this.project(...last).map((v, i) => v - [x, y][i])) > 3) this.ring.pts.push(at);
      this.hint("Click the next corner; a double-click or Enter closes the subcatchment. Backspace drops a corner; Esc stops.");
      return this.draw();
    }
    const node = this.nodeAt(x, y);
    if (a.kind === "node") {
      if (node) return this.hint(node.id + " is already there: click a free spot" + (a.type === "OUTFALL" ? "." : " or a conduit."));
      const conduit = this.conduitAt(x, y);
      if (a.virtual) {
        if (!conduit) return this.hint("Virtual junctions are inserted on a conduit — click a conduit.");
        return this.onAdd?.({ op: "insert", type: "JUNCTION", link: conduit.id, t: conduit.t, virtual: true });
      }
      if (conduit) {
        if (a.type === "OUTFALL") return this.hint("This tool requires a free location; select another point away from " + conduit.id + ".");
        return this.onAdd?.({ op: "insert", type: a.type, link: conduit.id, t: conduit.t });
      }
      return this.onAdd?.({ op: "node", type: a.type, x: at[0], y: at[1], bed: this.bedAt(at[0], at[1]) });
    }
    // Links: start on a node, bend on a free spot, end on another node; the next link starts there.
    if (node?.virtual) return this.hint(node.id + " is a virtual junction: it keeps the two conduits it splits.");
    const t = this.tracing;
    if (!t) {
      if (!node) return this.hint("Start the " + a.noun + " on a node.");
      this.tracing = { from: node.id, start: node.point, bends: [] };
      this.hint(this.traceHint());
    } else if (node && node.id !== t.from) {
      this.onAdd?.({ op: "link", type: a.type, from: t.from, to: node.id, vertices: t.bends, line: [t.start, ...t.bends, node.point] });
      this.tracing = { from: node.id, start: node.point, bends: [] };
      this.hint(this.traceHint());
    } else if (!node) t.bends.push(at);
    this.draw();
  }
  /** The pointer over the map with Move or Edit vertices: what a press would take. */
  editHover(x, y) {
    const h =
      this.tool === "move"
        ? this.nodeAt(x, y) || this.gageAt(x, y)
        : this.vertexLink && this.handleAt(this.linkLine(this.vertexLink) || [], x, y) > 0
          ? { handle: true }
          : null;
    const was = !!this.hover?.target;
    this.hover = h ? { target: h } : null;
    el("scene").classList.toggle("over-target", !!h);
    if (was || h) this.draw();
  }
  /** A press with Move or Edit vertices: true when it took a node, gage or vertex to drag. */
  editDown(x, y) {
    if (this.tool === "move") {
      const t = this.nodeAt(x, y) || this.gageAt(x, y);
      if (!t) return false;
      this.editing = { kind: t.kind, id: t.id, from: t.point, at: t.point };
      return true;
    }
    const line = this.vertexLink && this.linkLine(this.vertexLink);
    const i = line ? this.handleAt(line, x, y) : -1;
    if (i < 1) return false;
    this.editing = { link: this.vertexLink, index: i, from: line[i], at: line[i] };
    return true;
  }
  editMove(x, y) {
    const at = this.unproject(x, y);
    if (at) this.editing.at = at;
    this.draw();
  }
  /** The drag ends: a move or the link's new vertices go to `onEdit` (nothing when it did not move). */
  editUp() {
    const ed = this.editing;
    this.editing = null;
    const [x0, y0] = this.project(...ed.from),
      [x1, y1] = this.project(...ed.at);
    if (Math.hypot(x1 - x0, y1 - y0) < 2) return this.draw();
    if (ed.kind) this.onEdit?.({ op: "move", kind: ed.kind, id: ed.id, x: ed.at[0], y: ed.at[1] });
    else {
      const vertices = this.linkLine(ed.link).slice(1, -1);
      vertices[ed.index - 1] = ed.at;
      this.onEdit?.({ op: "vertices", link: ed.link, vertices });
    }
    this.draw();
  }
  /** A click with Edit vertices: the link under it becomes the one edited (and the selection). */
  vertexClick(x, y) {
    const hit = pickAt(this.scene("click"), x, y);
    this.vertexLink = hit?.kind === "link" ? hit.id : null;
    if (hit?.kind === "link") this.selection?.apply([hit], "replace", "map");
    this.hint(vertexHint(this.vertexLink));
    this.draw();
  }
  /** A right-click with Edit vertices: on a vertex it goes; on the link's line one is added there. */
  vertexContext(x, y) {
    const line = this.vertexLink && this.linkLine(this.vertexLink);
    if (!line) return;
    const vertices = line.slice(1, -1),
      i = this.handleAt(line, x, y);
    if (i > 0) {
      vertices.splice(i - 1, 1);
      return this.onEdit?.({ op: "vertices", link: this.vertexLink, vertices });
    }
    let best = null,
      bestD = SNAP_LINK;
    for (let j = 0; j + 1 < line.length; j++) {
      const [ax, ay] = this.project(...line[j]),
        [bx, by] = this.project(...line[j + 1]),
        dx = bx - ax,
        dy = by - ay,
        f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))),
        d = Math.hypot(ax + f * dx - x, ay + f * dy - y);
      if (d <= bestD) [best, bestD] = [{ j, f }, d];
    }
    if (!best) return;
    const a = line[best.j],
      b = line[best.j + 1];
    vertices.splice(best.j, 0, [a[0] + best.f * (b[0] - a[0]), a[1] + best.f * (b[1] - a[1])]);
    this.onEdit?.({ op: "vertices", link: this.vertexLink, vertices });
  }
  traceHint() {
    return "From " + this.tracing.from + ": click to add bends, click another node to end. Backspace drops a bend; Esc stops.";
  }
  /** Close the subcatchment being drawn: three corners or more go to `onAdd`. */
  finishRing() {
    const pts = this.ring?.pts || [];
    this.ring = null;
    this.hint(pts.length >= 3 ? addHint(this.adding) : "A subcatchment needs three corners or more.");
    if (pts.length >= 3) this.onAdd?.({ op: "subcatchment", ring: pts });
    this.draw();
  }
  /** Right-click or Backspace while tracing: drop the last bend, or the link when it has none. */
  addBack() {
    if (this.ring) {
      this.ring.pts.pop();
      if (!this.ring.pts.length) {
        this.ring = null;
        this.hint(addHint(this.adding));
      }
      return this.draw();
    }
    const t = this.tracing;
    if (!t) return;
    if (t.bends.length) t.bends.pop();
    else {
      this.tracing = null;
      this.hint(addHint(this.adding));
    }
    this.draw();
  }
  /** End the profile line being drawn: two points or more go to `onTrace`; the select tool returns. */
  finishTrace() {
    const pts = this.trace?.pts || [];
    this.trace = null;
    this.setTool("select");
    if (pts.length >= 2) this.onTrace?.(pts);
  }
  /** The shown profile on the map: its path or line (model coordinates), or null. */
  setProfileLine(line) {
    this.profileLine = line?.length >= 2 ? line : null;
    this.profileMarker = null;
    this.draw();
  }
  /** The profile chart's crosshair as a point on the map (model coordinates), or null. */
  setProfileMarker(point) {
    this.profileMarker = point;
    this.draw(true);
  }
  /** A click at screen (x, y): the object under it joins, leaves or replaces the selection by the event's modifiers. */
  click(x, y, e) {
    if (!this.selection) return;
    const hit = pickAt(this.scene("click"), x, y),
      mode = modeFor(e);
    if (hit) this.selection.apply([hit], mode, "map");
    else if (mode === "replace") this.selection.clear("map");
  }
  finishBand(e) {
    const pts = this.band.pts;
    this.band = null;
    const far = pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) >= 4;
    if (!far) return this.click(pts[0][0], pts[0][1], e); // a click with the box or lasso tool
    const scene = this.scene("area");
    const items = this.tool === "box" ? pickInRect(scene, [...pts[0], ...pts[1]]) : pickInPolygon(scene, pts);
    const mode = modeFor(e);
    if (items.length || mode === "replace") this.selection?.apply(items, mode, "map");
    this.draw();
  }
  /** Model coordinates at a screen point (the inverse of project). */
  unproject(x, y) {
    if (this.map && this.placement) {
      const { lng, lat } = this.map.unproject([x, y]);
      return this.placement.fromLonLat(lng, lat);
    }
    const [l, b, r, t] = this.bounds || [0, 0, 100, 100],
      w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const s = Math.min(w / Math.max(1, r - l), h / Math.max(1, t - b)) * 0.76 * this.zoom;
    return [(x - w / 2 - this.pan[0]) / s + (r + l) / 2, -(y - h / 2 - this.pan[1]) / s + (b + t) / 2];
  }
  /**
   * The visible objects in screen pixels for picking (selection.mjs): markers, links, subcatchments
   * and, for a click, the 2D cell under a point.
   */
  scene(purpose) {
    const L = this.layers,
      n = this.network || {},
      ids = n.ids || {};
    const P = (p) => this.project(p[0], p[1]);
    const points = [],
      lines = [],
      areas = [];
    const add = (list, item) => item.id !== undefined && list.push(item);
    if (L.visible("gages")) (n.gages || []).forEach((p, i) => add(points, { kind: "gage", id: ids.gages?.[i], type: "rain gage", ...xy(P(p)), r: symbols.gages.size / 2 + 2 }));
    for (const k of nodeKinds)
      if (L.visible(k)) (n[k] || []).forEach((p, i) => add(points, { kind: "node", id: ids[k]?.[i], type: typeNames[k], ...xy(P(p)), r: symbols[k].size / 2 + 2 }));
    for (const k of linkKinds) if (L.visible(k)) (n[k] || []).forEach((pl, i) => add(lines, { kind: "link", id: ids[k]?.[i], type: typeNames[k], pts: pl.map(P) }));
    if (L.visible("subcatchments"))
      (n.subcatchments || []).forEach((ring, i) => {
        const r = ring.map(P);
        add(areas, { kind: "subcatchment", id: ids.subcatchments?.[i], type: "subcatchment", ring: r, ...centroid(r) });
      });
    const scene = { points, lines, areas };
    if (purpose === "click" && this.polys?.length && (L.visible("meshfill") || L.visible("edges") || (this.frame && L.visible("depth"))))
      scene.cellAt = (x, y) => {
        const m = this.unproject(x, y);
        return m ? this.locate(m[0], m[1]) : undefined;
      };
    return scene;
  }
  /** The shape of a selected item in model coordinates, or null when the model has none. */
  shapeOf(item) {
    const n = this.network || {},
      ids = n.ids || {};
    if (item.kind === "cell") return this.polys?.[+item.id] ? { ring: this.polys[+item.id] } : null;
    const kinds = { node: nodeKinds, link: linkKinds, subcatchment: ["subcatchments"], gage: ["gages"] }[item.kind] || [];
    for (const k of kinds) {
      const i = ids[k]?.indexOf(item.id) ?? -1;
      if (i < 0) continue;
      if (item.kind === "node" || item.kind === "gage") return { point: n[k][i], r: symbols[k].size / 2 };
      if (item.kind === "link") return { line: n[k][i] };
      return { ring: n[k][i] };
    }
    return null;
  }
  /**
   * Draw the map. Everything under the flow streaks is painted into an offscreen image and copied to
   * the map; a streak tick (`streaksOnly`) reuses that image and draws only the streaks and what lies
   * above them.
   */
  draw(streaksOnly = false) {
    const main = this.ctx,
      w = this.canvas.clientWidth,
      h = this.canvas.clientHeight,
      dpr = Math.min(devicePixelRatio, 2);
    if (
      this.canvas.width !== Math.round(w * dpr) ||
      this.canvas.height !== Math.round(h * dpr)
    ) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const under = this.under || (this.under = document.createElement("canvas"));
    if (under.width !== this.canvas.width || under.height !== this.canvas.height) {
      under.width = this.canvas.width;
      under.height = this.canvas.height;
      this.underReady = false;
    }
    const reuse = streaksOnly && this.underReady;
    if (this.mode3d && !streaksOnly) this.scene3d.sync();
    let c = under.getContext("2d");
    for (const x of [c, main]) x.setTransform(dpr, 0, 0, dpr, 0, 0);
    main.clearRect(0, 0, w, h);
    if (!reuse) c.clearRect(0, 0, w, h);
    const f = this.frame,
      L = this.layers;
    const line = (points) => {
      c.beginPath();
      points.forEach((p, j) => {
        const [x, y] = this.project(...p);
        if (j) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
    };
    const marker = (kind, [px, py]) => {
      const s = symbols[kind],
        [x, y] = this.project(px, py),
        r = s.size / 2;
      c.beginPath();
      if (s.shape === "circle") c.arc(x, y, r, 0, 2 * Math.PI);
      else if (s.shape === "square") c.rect(x - r, y - r, 2 * r, 2 * r);
      else if (s.shape === "triangle") {
        c.moveTo(x, y - r);
        c.lineTo(x + r, y + r * 0.8);
        c.lineTo(x - r, y + r * 0.8);
        c.closePath();
      } else {
        c.moveTo(x, y - r);
        c.lineTo(x + r, y);
        c.lineTo(x, y + r);
        c.lineTo(x - r, y);
        c.closePath();
      }
      c.fillStyle = s.fill;
      c.fill();
      c.stroke();
    };
    const n = this.network || {};
    let PV = null;
    const vertices = () => PV || (PV = this.projectVertices());
    // Each category's own paint order; the categories go bottom → top as the tree says.
    const paint = {
      meshes: () => {
        const fill = L.visible("meshfill"),
          edges = L.visible("edges");
        if (!fill && !edges) return;
        c.fillStyle = "rgba(74,100,128,.12)";
        c.strokeStyle = "rgba(47,93,134,.6)";
        c.lineWidth = 0.75;
        const V = vertices();
        for (const cell of this.geo.cells) {
          c.beginPath();
          cell.forEach((v, j) => (j ? c.lineTo(V[2 * v], V[2 * v + 1]) : c.moveTo(V[2 * v], V[2 * v + 1])));
          c.closePath();
          if (fill) c.fill();
          if (edges) c.stroke();
        }
      },
      swmm: () => {
        if (L.visible("subcatchments")) {
          const s = symbols.subcatchments;
          c.fillStyle = s.fill;
          c.strokeStyle = s.outline;
          c.lineWidth = s.width;
          for (const ring of n.subcatchments || []) {
            line(ring);
            c.closePath();
            c.fill();
            c.stroke();
          }
        }
        c.lineCap = c.lineJoin = "round";
        for (const kind of ["conduits", "pumps", "orifices", "weirs", "outlets"]) {
          if (!L.visible(kind)) continue;
          c.strokeStyle = symbols[kind].stroke;
          c.lineWidth = symbols[kind].width;
          for (const points of n[kind] || []) {
            line(points);
            c.stroke();
          }
        }
        c.strokeStyle = markerOutline.stroke;
        c.lineWidth = markerOutline.width;
        for (const kind of ["junctions", "dividers", "storage", "outfalls", "gages"])
          if (L.visible(kind)) for (const p of n[kind] || []) marker(kind, p);
        // A virtual junction is the junction dot with a dotted ring around it (as in the desktop).
        if (L.visible("junctions") && n.virtual?.size) {
          c.save();
          c.setLineDash([1.5, 2]);
          c.lineWidth = 1.2;
          c.strokeStyle = symbols.junctions.fill;
          (n.ids?.junctions || []).forEach((id, i) => {
            if (!n.virtual.has(id)) return;
            const [x, y] = this.project(...n.junctions[i]);
            c.beginPath();
            c.arc(x, y, symbols.junctions.size / 2 + 3, 0, 2 * Math.PI);
            c.stroke();
          });
          c.restore();
        }
      },
      outputs2d: () => {
        if (f && L.visible("depth")) {
          const dry = this.dry();
          const scheme = this.depthScheme();
          const geom = scheme.st.display === "bands" || scheme.st.lines ? this.contourGeometry(scheme) : null;
          // Band and line points lie along mesh edges: [a, b, t] between projected vertices.
          const V = vertices();
          const point = ([a, b, t]) => [V[2 * a] + t * (V[2 * b] - V[2 * a]), V[2 * a + 1] + t * (V[2 * b + 1] - V[2 * a + 1])];
          c.globalAlpha *= 0.9;
          if (geom?.bands)
            geom.bands.forEach((polys, k) => {
              c.beginPath();
              // Each polygon is closed with a line back to its start: closePath on a path of many
              // thousand polygons took seconds in Chrome.
              for (const poly of polys) {
                poly.forEach((q, j) => {
                  const [x, y] = point(q);
                  if (j) c.lineTo(x, y);
                  else c.moveTo(x, y);
                });
                const [x0, y0] = point(poly[0]);
                c.lineTo(x0, y0);
              }
              c.fillStyle = scheme.classColor(k);
              c.fill();
              // A hairline of the same color closes the seams between neighboring triangles.
              c.strokeStyle = c.fillStyle;
              c.lineWidth = 0.6;
              c.stroke();
            });
          else
            this.geo.cells.forEach((cell, i) => {
              const d = f.depth[i];
              if (!(d > dry)) return;
              c.beginPath();
              cell.forEach((v, j) => (j ? c.lineTo(V[2 * v], V[2 * v + 1]) : c.moveTo(V[2 * v], V[2 * v + 1])));
              c.closePath();
              c.fillStyle = scheme.colorOf(d);
              c.fill();
            });
          c.globalAlpha /= 0.9;
          if (geom?.lines.length) {
            const ink = getComputedStyle(this.canvas).getPropertyValue("--ink").trim() || "#0a1c2e";
            c.strokeStyle = ink;
            geom.lines.forEach((segs, i) => {
              c.lineWidth = geom.index[i] ? 1.6 : 0.8;
              c.beginPath();
              for (const [p, q] of segs) {
                const [x0, y0] = point(p),
                  [x1, y1] = point(q);
                c.moveTo(x0, y0);
                c.lineTo(x1, y1);
              }
              c.stroke();
            });
            if (scheme.st.labels) {
              // A few labels per level, on segments long enough to read, with a halo.
              const surface = getComputedStyle(this.canvas).getPropertyValue("--surface").trim() || "#fff";
              c.font = "10px Inter, system-ui, sans-serif";
              c.textAlign = "center";
              c.textBaseline = "middle";
              c.lineJoin = "round";
              geom.lines.forEach((segs, i) => {
                const text = String(+geom.levels[i].toPrecision(3));
                const every = Math.max(1, Math.floor(segs.length / 3));
                for (let s2 = Math.floor(every / 2); s2 < segs.length; s2 += every) {
                  const [x0, y0] = point(segs[s2][0]),
                    [x1, y1] = point(segs[s2][1]);
                  if (Math.hypot(x1 - x0, y1 - y0) < 3) continue;
                  c.lineWidth = 3;
                  c.strokeStyle = surface;
                  c.strokeText(text, (x0 + x1) / 2, (y0 + y1) / 2);
                  c.fillStyle = ink;
                  c.fillText(text, (x0 + x1) / 2, (y0 + y1) / 2);
                }
              });
            }
          }
        }
      },
    };
    // Up to the water depth everything goes into the offscreen image; then the image is copied to
    // the map, and the streaks and the categories above are drawn on top.
    let copied = false;
    const copy = () => {
      if (copied) return;
      copied = true;
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalAlpha = 1;
      main.drawImage(under, 0, 0);
      main.setTransform(dpr, 0, 0, dpr, 0, 0);
      c = main;
      this.underReady = true;
    };
    for (const id of L.paintOrder()) {
      if (!paint[id]) continue; // the basemap is the Mapbox canvas underneath
      if (this.mode3d) {
        // In the 3D view the model is in Mapbox's scene (scene3d.mjs); the canvas keeps the streaks.
        if (id === "outputs2d") {
          copy();
          c.globalAlpha = L.opacity(id);
          if (L.visible("streaks")) this.drawStreaks(c);
        }
        continue;
      }
      if (reuse && !copied && id !== "outputs2d") continue; // already in the image
      if (id !== "outputs2d") {
        c.globalAlpha = L.opacity(id);
        paint[id]();
        continue;
      }
      c.globalAlpha = L.opacity(id);
      if (!reuse) paint.outputs2d();
      copy();
      c.globalAlpha = L.opacity(id);
      if (L.visible("streaks")) this.drawStreaks(c);
    }
    copy();
    c.globalAlpha = 1;
    // The selection: a white halo under a magenta stroke reads on the basemap, the depth ramp and
    // both themes.
    const items = this.selection?.items || [];
    for (const [width, color] of [[6, "rgba(255,255,255,0.85)"], [2.5, SELECTED]])
      for (const item of items) {
        const shape = this.shapeOf(item);
        if (!shape) continue;
        c.lineWidth = width;
        c.strokeStyle = color;
        if (shape.point) {
          const [x, y] = this.project(...shape.point);
          c.beginPath();
          c.arc(x, y, shape.r + 4, 0, 2 * Math.PI);
        } else {
          line(shape.line || shape.ring);
          if (shape.ring) c.closePath();
        }
        c.stroke();
      }
    // The shown profile's path or line, the line being drawn, and the chart's crosshair (SWMM amber
    // over a white halo, as the selection is magenta over white).
    const flag = getComputedStyle(this.canvas).getPropertyValue("--flag").trim() || "#f29f38";
    const polyline = (pts, width, color, dash = []) => {
      c.beginPath();
      pts.forEach((p, j) => {
        const [x, y] = this.project(p[0], p[1]);
        if (j) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.setLineDash(dash);
      c.lineWidth = width;
      c.strokeStyle = color;
      c.lineJoin = c.lineCap = "round";
      c.stroke();
      c.setLineDash([]);
    };
    if (this.profileLine) {
      polyline(this.profileLine, 6, "rgba(255,255,255,0.85)");
      polyline(this.profileLine, 3, flag);
    }
    if (this.trace?.pts.length) {
      const pts = this.trace.at ? [...this.trace.pts, this.trace.at] : this.trace.pts;
      polyline(pts, 5, "rgba(255,255,255,0.85)");
      polyline(pts, 2.5, flag, [6, 4]);
      for (const p of this.trace.pts) {
        const [x, y] = this.project(p[0], p[1]);
        c.beginPath();
        c.arc(x, y, 3.5, 0, 2 * Math.PI);
        c.fillStyle = flag;
        c.fill();
      }
    }
    if (this.profileMarker) {
      const [x, y] = this.project(this.profileMarker[0], this.profileMarker[1]);
      c.beginPath();
      c.arc(x, y, 7, 0, 2 * Math.PI);
      c.lineWidth = 4;
      c.strokeStyle = "rgba(255,255,255,0.9)";
      c.stroke();
      c.lineWidth = 2.5;
      c.strokeStyle = flag;
      c.stroke();
    }
    if (this.tool === "add" && this.adding) {
      const a = this.adding,
        h = this.hover,
        ring = (p, r, color, dash = []) => {
          const [x, y] = this.project(p[0], p[1]);
          c.beginPath();
          c.arc(x, y, r, 0, 2 * Math.PI);
          c.setLineDash(dash);
          c.lineWidth = 4;
          c.strokeStyle = "rgba(255,255,255,0.85)";
          c.stroke();
          c.lineWidth = 2;
          c.strokeStyle = color;
          c.stroke();
          c.setLineDash([]);
        };
      const color = (symbols[a.leaf]?.fill || symbols[a.leaf]?.stroke || flag);
      if (this.ring?.pts.length) {
        const pts = h?.at ? [...this.ring.pts, h.at] : this.ring.pts;
        c.beginPath();
        pts.forEach((p, j) => {
          const [x, y] = this.project(p[0], p[1]);
          if (j) c.lineTo(x, y);
          else c.moveTo(x, y);
        });
        c.closePath();
        c.fillStyle = symbols.subcatchments.fill;
        c.fill();
        polyline([...pts, pts[0]], 5, "rgba(255,255,255,0.85)");
        polyline([...pts, pts[0]], 2, symbols.subcatchments.outline, [6, 4]);
        for (const p of this.ring.pts) {
          const [x, y] = this.project(p[0], p[1]);
          c.beginPath();
          c.arc(x, y, 3, 0, 2 * Math.PI);
          c.fillStyle = symbols.subcatchments.outline;
          c.fill();
        }
      }
      if (this.tracing) {
        const t = this.tracing,
          end = h?.node && h.node.id !== t.from && !h.node.virtual ? h.node.point : h?.at;
        polyline([t.start, ...t.bends, ...(end ? [end] : [])], 5, "rgba(255,255,255,0.85)");
        polyline([t.start, ...t.bends, ...(end ? [end] : [])], 2.5, symbols[a.leaf]?.stroke || flag, [6, 4]);
        for (const p of t.bends) {
          const [x, y] = this.project(p[0], p[1]);
          c.beginPath();
          c.arc(x, y, 3, 0, 2 * Math.PI);
          c.fillStyle = symbols[a.leaf]?.stroke || flag;
          c.fill();
        }
        ring(t.start, 8, flag);
      }
      // A node under the pointer: a solid ring where a link can snap, dotted where it cannot.
      if (h?.node) ring(h.node.point, 8, flag, a.kind === "node" || h.node.virtual ? [2, 3] : []);
      // A conduit under the pointer: where the click inserts (a ring and a cross; dotted when refused).
      else if (h?.conduit) {
        const refused = a.type === "OUTFALL" && !a.virtual;
        ring(h.conduit.point, 7, color, refused ? [2, 3] : []);
        if (!refused) {
          const [x, y] = this.project(...h.conduit.point);
          c.beginPath();
          c.moveTo(x - 11, y);
          c.lineTo(x + 11, y);
          c.moveTo(x, y - 11);
          c.lineTo(x, y + 11);
          c.lineWidth = 1.5;
          c.strokeStyle = color;
          c.stroke();
        }
      }
    }
    if (this.tool === "move" || this.tool === "vertex") {
      const handle = (p, active) => {
        const [x, y] = this.project(p[0], p[1]);
        c.beginPath();
        c.rect(x - 4, y - 4, 8, 8);
        c.fillStyle = active ? flag : "#fff";
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = active ? "#fff" : flag;
        c.stroke();
      };
      const ed = this.editing;
      if (this.tool === "move") {
        if (this.hover?.target) {
          const [x, y] = this.project(...this.hover.target.point);
          c.beginPath();
          c.arc(x, y, 9, 0, 2 * Math.PI);
          c.lineWidth = 2;
          c.strokeStyle = flag;
          c.stroke();
        }
        if (ed) {
          // The links that end at the node follow it (a dashed preview), and the node itself.
          const n = this.network || {},
            same = (p) => p[0] === ed.from[0] && p[1] === ed.from[1];
          if (ed.kind === "node")
            for (const k of linkKinds)
              for (const line of n[k] || []) {
                if (!same(line[0]) && !same(line.at(-1))) continue;
                const moved = line.map((p, j) => ((j === 0 || j === line.length - 1) && same(p) ? ed.at : p));
                polyline(moved, 2, flag, [5, 4]);
              }
          handle(ed.at, true);
        }
      } else if (this.vertexLink) {
        const line = this.linkLine(this.vertexLink);
        if (line) {
          const shown = ed ? line.map((p, j) => (j === ed.index ? ed.at : p)) : line;
          polyline(shown, 6, "rgba(255,255,255,0.85)");
          polyline(shown, 2.5, flag);
          shown.slice(1, -1).forEach((p, j) => handle(p, ed?.index === j + 1));
        }
      }
    }
    if (this.band) {
      const pts = this.band.pts;
      c.beginPath();
      if (this.tool === "box" && pts[1]) c.rect(pts[0][0], pts[0][1], pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      else pts.forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y)));
      if (this.tool === "lasso") c.closePath();
      c.fillStyle = "rgba(230,0,126,0.08)";
      c.fill();
      c.setLineDash([5, 4]);
      c.lineWidth = 1.5;
      c.strokeStyle = SELECTED;
      c.stroke();
      c.setLineDash([]);
    }
    const one = items.length === 1 ? items[0] : null;
    let probe = items.length ? describeSelection(items) : "Select an object to inspect";
    if (one?.kind === "cell") {
      const i = +one.id;
      probe =
        "Cell " +
        i +
        (f
          ? " · " + f.depth[i].toFixed(4) + " m · " + Math.hypot(f.u[i], f.v[i]).toFixed(3) + " m/s"
          : " · run the model for depth and speed");
    }
    if (el("probe").textContent !== probe) el("probe").textContent = probe;
  }
  /**
   * The 3D view (basemap only): rotate and tilt gestures, the map tilted, the buildings raised. Off:
   * flat, north up, no rotation (the map as before).
   */
  set3D(on) {
    on = !!on && !!this.map;
    if (this.mode3d === on) return;
    this.mode3d = on;
    const m = this.map;
    if (m) {
      for (const h of [m.dragRotate, m.touchPitch]) on ? h.enable() : h.disable();
      for (const h of [m.touchZoomRotate, m.keyboard]) on ? h.enableRotation?.() : h.disableRotation?.();
      m.easeTo(on ? { pitch: 60, duration: 800 } : { pitch: 0, bearing: 0, duration: 600 });
    }
    el("view-3d").setAttribute("aria-pressed", String(on));
    el("view-north").hidden = !on;
    this.syncBuildings();
    if (on) this.scene3d.attach();
    else this.scene3d.detach();
    this.draw();
  }
  /** North up and flat; the 3D view stays on for the next tilt. */
  resetView() {
    this.map?.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }
  /**
   * Buildings as extrusions, above the basemap's own layers but under its labels. They come from their
   * own Mapbox Streets source, so they stand over any basemap (imagery too).
   */
  addBuildings() {
    const m = this.map;
    if (!m || m.getLayer("osw-buildings")) return;
    if (!m.getSource("osw-streets")) m.addSource("osw-streets", { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" });
    m.addLayer(
      {
        id: "osw-buildings",
        type: "fill-extrusion",
        source: "osw-streets",
        "source-layer": "building",
        filter: ["==", ["get", "extrude"], "true"],
        minzoom: 14,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#cdd2d9",
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": ["get", "min_height"],
          "fill-extrusion-opacity": 0.85,
        },
      },
      this.labelLayer(),
    );
    this.syncBuildings();
  }
  /** The basemap style's first label layer (ours go under it), if any. */
  labelLayer() {
    return this.map.getStyle().layers.find((l) => l.type === "symbol" && l.layout?.["text-field"] && !l.id.startsWith("osw-"))?.id;
  }
  /**
   * The basemap stack on the map (LayerTree basemap rows): the Mapbox style row's own layers shown or
   * hidden (another style is loaded when it changes); each raster row a raster layer, bottom → top in
   * the stack's order with its opacity, under the style's labels, the model (3D) and the buildings.
   */
  syncBasemaps() {
    const m = this.map,
      L = this.layers;
    if (!m) return;
    const style = basemapSource(L.basemapRow("basemap")).style;
    if (style !== this.styleUrl) {
      this.styleUrl = style;
      this.styleReady = false;
      m.setStyle(style); // style.load adds the buildings, the rasters and the 3D model again
      return;
    }
    if (!this.styleReady) return;
    const showStyle = L.visible("basemap");
    if (this.styleShown !== showStyle) {
      this.styleShown = showStyle;
      for (const [id, visibility] of this.styleVisibility) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", showStyle ? visibility : "none");
    }
    const rasters = L.basemaps.filter((b) => b.id !== "basemap"),
      wanted = new Set(rasters.map((b) => "osw-bm-" + b.id));
    for (const layer of m.getStyle().layers)
      if (layer.id.startsWith("osw-bm-") && !wanted.has(layer.id)) {
        m.removeLayer(layer.id);
        m.removeSource(layer.id);
      }
    const before = m.getLayer("osw-buildings") ? "osw-buildings" : this.labelLayer();
    for (const b of [...rasters].reverse()) {
      const id = "osw-bm-" + b.id,
        src = basemapSource(b);
      if (!m.getSource(id)) {
        // Only the fields a source has: the style validator refuses an undefined attribution.
        const spec = src.url ? { type: "raster", url: src.url, tileSize: src.tileSize } : { type: "raster", tiles: src.tiles, tileSize: src.tileSize, maxzoom: src.maxzoom };
        if (src.attribution) spec.attribution = src.attribution;
        m.addSource(id, spec);
        m.addLayer({ id, type: "raster", source: id });
      }
      m.moveLayer(id, before);
      m.setPaintProperty(id, "raster-opacity", b.opacity);
      m.setLayoutProperty(id, "visibility", L.visible(b.id) ? "visible" : "none");
    }
    // The model's layers (3D view) go back above the rasters, right under the buildings.
    if (this.scene3d.on && this.scene3d.keys) {
      this.scene3d.keys.order = null;
      this.scene3d.sync();
    }
  }
  /** Buildings show in the 3D view when their layer row is on. */
  syncBuildings() {
    if (this.map?.getLayer("osw-buildings"))
      this.map.setLayoutProperty("osw-buildings", "visibility", this.mode3d && this.layers.visible("buildings") ? "visible" : "none");
  }
  async basemap(on) {
    if (!on) {
      this.set3D(false);
      el("viewtools").hidden = true;
      this.map?.remove();
      this.map = null;
      el("scene").classList.remove("geographic");
      this.draw();
      return;
    }
    if (!this.token)
      throw new Error(
        "A site Mapbox public token is required for the basemap.",
      );
    if (!this.placement)
      throw new Error(
        "This model has no coordinate system or map reference. Use the local model view.",
      );
    if (this.map) {
      this.fit();
      return;
    }
    if (!window.mapboxgl) {
      const base = "https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl";
      if (!this.loader)
        this.loader = (async () => {
          const css = document.createElement("link");
          css.rel = "stylesheet";
          css.href = base + ".css";
          css.crossOrigin = "anonymous"; // COEP require-corp: cross-origin loads must use CORS
          document.head.append(css);
          const script = document.createElement("script");
          script.src = base + ".js";
          script.crossOrigin = "anonymous";
          await new Promise((ok, no) => {
            script.onload = ok;
            script.onerror = () => no(new Error("Cannot load Mapbox GL JS"));
            document.head.append(script);
          });
        })().catch((e) => {
          this.loader = null;
          throw e;
        });
      await this.loader;
    }
    if (!this.layers.anyBasemap() || !this.placement || this.map) return; // switched off, or another call made it
    const [[west, south], [east, north]] = this.lonLatBounds();
    this.map = new window.mapboxgl.Map({
      container: "map",
      accessToken: this.token,
      style: (this.styleUrl = basemapSource(this.layers.basemapRow("basemap")).style),
      projection: "mercator",
      // Rotation and tilt wait for the 3D view (set3D).
      pitchWithRotate: true,
      dragRotate: false,
      touchPitch: false,
      maxPitch: 60,
      center: [(west + east) / 2, (south + north) / 2],
      zoom: 15,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation?.();
    this.styleReady = false; // set on style.load: layers can be added from then on, while tiles still load
    this.map.on("style.load", () => {
      this.styleReady = true;
      // The style's own layers and how they were shown, for switching the style row off and on.
      this.styleVisibility = new Map(this.map.getStyle().layers.map((l) => [l.id, l.layout?.visibility || "visible"]));
      this.styleShown = true;
      this.addBuildings();
      this.syncBasemaps();
      if (this.mode3d) this.scene3d.attach();
    });
    el("scene").classList.add("geographic");
    el("viewtools").hidden = false;
    this.map.on("move", () => {
      // The compass points north as the map turns.
      el("view-north").firstElementChild.style.transform = "rotate(" + -this.map.getBearing() + "deg)";
      this.draw();
    });
    this.map.on("click", (e) =>
      this.onPick
        ? this.onPick(e.lngLat)
        : this.tool === "add"
          ? this.addClick(e.point.x, e.point.y)
          : this.tool === "vertex"
            ? this.vertexClick(e.point.x, e.point.y)
            : this.click(e.point.x, e.point.y, e.originalEvent),
    );
    this.map.on("dblclick", () => this.tool === "add" && this.ring && this.finishRing());
    this.map.on("mousemove", (e) => {
      if (this.editing) this.editMove(e.point.x, e.point.y);
      else if (this.tool === "add") this.addMove(e.point.x, e.point.y);
      else if (this.tool === "move" || this.tool === "vertex") this.editHover(e.point.x, e.point.y);
    });
    // A press on a node, gage or vertex drags it instead of the map.
    this.map.on("mousedown", (e) => {
      if ((this.tool === "move" || this.tool === "vertex") && e.originalEvent.button === 0 && this.editDown(e.point.x, e.point.y)) e.preventDefault();
    });
    this.map.on("mouseup", () => this.editing && this.editUp());
    this.map.on("contextmenu", (e) => {
      if (this.tool !== "add" && this.tool !== "vertex") return;
      e.originalEvent.preventDefault();
      if (this.tool === "add") this.addBack();
      else this.vertexContext(e.point.x, e.point.y);
    });
    this.map.on("error", (e) =>
      this.onMapError?.(
        e.error?.status === 403
          ? "Mapbox denied this origin or token. Check its URL restrictions."
          : "Basemap request failed. Local modeling remains available.",
      ),
    );
    this.fit();
  }
}
