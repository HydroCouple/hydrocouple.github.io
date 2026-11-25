import { symbols, markerOutline } from "./layers.mjs";
import { pickAt, pickInRect, pickInPolygon, modeFor, describeSelection } from "./selection.mjs";
/** Screen speed of a flow streak at the frame's reference speed (px/s). */
const STREAK_SPEED = 45;
/** Highlight color of selected objects. */
const SELECTED = "#e6007e";
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
 * What a deck's text says about its geometry and the objects the forcings can address. A deck that
 * keeps its mesh in a `[2D_MESH_FILE]` sidecar gets it from `inputs` (the project's files by name,
 * the sidecar's path relative to the deck's folder `dir`).
 */
export function sketch(text, inputs = {}, dir = "") {
  const s = sections(text);
  const sidecar = s["[2D_MESH_FILE]"]?.find((row) => /^FILE$/i.test(row[0]))?.[1]?.replace(/^"(.*)"$/, "$1");
  const bytes = sidecar && (inputs[dir + sidecar] || inputs[sidecar]);
  const mesh = bytes ? sections(new TextDecoder().decode(bytes)) : s;
  const vertices = mesh["[2D_VERTICES]"] || [],
    nodes = new Map(
      (s["[COORDINATES]"] || []).map(([id, x, y]) => [id, [+x, +y]]),
    );
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
  const shapes = (kind, section, shape) => {
    const out = [];
    ids[kind] = [];
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
    junctions: at("junctions", "JUNCTIONS"),
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
  };
  const links = ["conduits", "pumps", "weirs", "orifices", "outlets"].flatMap((k) => network[k]);
  return {
    x: vertices.map((v) => +v[0]),
    y: vertices.map((v) => +v[1]),
    cells: [
      ...(mesh["[2D_TRIANGLES]"] || []).map((v) => v.slice(0, 3).map(Number)),
      ...(mesh["[2D_QUADS]"] || []).map((v) => v.slice(0, 4).map(Number)),
    ],
    links, // every link as a polyline (saved with a run's geometry)
    network, // per kind, as the layer tree (layers.mjs) lists them
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
    // Map tools: "select" (a click selects, a drag pans), "box" and "lasso" (a drag selects).
    this.tool = "select";
    this.band = null; // the box or lasso being drawn, in screen pixels
    for (const tool of ["select", "box", "lasso"]) el("tool-" + tool).onclick = () => this.setTool(tool);
    this.canvas.onpointerdown = (e) => {
      if (this.tool !== "select") {
        this.band = { pts: [[e.offsetX, e.offsetY]] };
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      this.drag = [e.clientX, e.clientY, ...this.pan];
      this.canvas.setPointerCapture(e.pointerId);
    };
    this.canvas.onpointermove = (e) => {
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
      if (this.band) return this.finishBand(e);
      if (
        this.drag &&
        Math.hypot(e.clientX - this.drag[0], e.clientY - this.drag[1]) < 4
      )
        this.click(e.offsetX, e.offsetY, e);
      this.drag = null;
    };
    this.canvas.onpointercancel = () => {
      this.drag = this.band = null;
      this.draw();
    };
    // Escape drops a box or lasso being drawn, else the selection.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.target.closest?.("input, textarea, select, dialog")) return;
      if (this.band) {
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
    layers.addEventListener("change", ({ detail }) => {
      if (detail.kind === "opacity" && detail.id === "basemaps")
        el("map").style.opacity = String(layers.opacity("basemaps"));
      if (["visible", "order", "opacity", "content"].includes(detail.kind)) this.draw();
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
        this.draw();
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
      if (d >= 0.001 && Number.isFinite(frame.u[i] + frame.v[i]))
        this.wet.push(i);
      if (d > peak) peak = d;
    });
    this.peak = peak;
    // The frame's reference speed (95th percentile of the wet cells): streaks at this speed move
    // a fixed distance on screen, whatever the mesh size or zoom.
    const speeds = this.wet.map((i) => Math.hypot(frame.u[i], frame.v[i])).sort((a, b) => a - b);
    this.speedRef = Math.max(1e-9, speeds[Math.floor(0.95 * (speeds.length - 1))] || 0);
    this.layers.setLegend("depth", frame ? { min: 0, max: peak, unit: "m" } : null);
    this.draw();
  }
  advance(dt) {
    if (!this.wet?.length) {
      this.particles = [];
      return;
    }
    const count = Math.min(1200, Math.max(30, this.wet.length * 3)),
      f = this.frame;
    // Particles move in screen space: at the reference speed about STREAK_SPEED px/s (faster cells
    // up to twice that). Model units per step = speed × k, k from the current pixels per unit.
    const [l, b, r, t] = this.bounds,
      [x0, y0] = this.project((l + r) / 2, (b + t) / 2),
      [x1, y1] = this.project((l + r) / 2 + 1, (b + t) / 2);
    const k = (STREAK_SPEED * dt) / ((Math.hypot(x1 - x0, y1 - y0) || 1) * this.speedRef);
    for (let i = 0; i < count; i++) {
      let p = this.particles[i];
      if (!p || p.age > 3 || !(f.depth[p.cell] >= 0.001)) {
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
          age: Math.random(),
          cell,
          trail: [],
        };
        this.particles[i] = p;
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
        !(f.depth[next] >= 0.001) ||
        !Number.isFinite(u + v)
      ) {
        this.particles[i] = null;
        continue;
      }
      p.trail.push([p.x, p.y]);
      if (p.trail.length > 20) p.trail.shift();
      Object.assign(p, { x, y, cell: next, age: p.age + dt });
    }
  }
  /** A new placement for the same geometry (a CRS resolved after the model was shown). */
  setPlacement(placement) {
    this.placement = placement;
    if (this.map) this.fit();
    else this.draw();
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
  /** Observe a selection model (selection.mjs): the map draws it and changes it. */
  useSelection(selection) {
    this.selection = selection;
    selection.addEventListener("change", () => this.draw());
  }
  setTool(tool) {
    this.tool = tool;
    this.band = null;
    // Box and lasso take the pointer from the basemap while they are active.
    el("scene").classList.toggle("tool-band", tool !== "select");
    for (const t of ["select", "box", "lasso"]) el("tool-" + t).setAttribute("aria-pressed", String(t === tool));
    this.draw();
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
  draw() {
    const c = this.ctx,
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
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
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
    // Each category's own paint order; the categories go bottom → top as the tree says.
    const paint = {
      meshes: () => {
        const fill = L.visible("meshfill"),
          edges = L.visible("edges");
        if (!fill && !edges) return;
        c.fillStyle = "rgba(74,100,128,.12)";
        c.strokeStyle = "rgba(47,93,134,.6)";
        c.lineWidth = 0.75;
        for (const p of this.polys || []) {
          line(p);
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
      },
      outputs2d: () => {
        if (f && L.visible("depth"))
          (this.polys || []).forEach((p, i) => {
            const d = f.depth[i];
            if (!(d > 0.00001)) return;
            const a = Math.min(1, d / this.peak);
            line(p);
            c.closePath();
            c.fillStyle =
              "rgba(" +
              [Math.round(217 - 217 * a), Math.round(237 - 156 * a), Math.round(255 - 115 * a), 0.9].join(",") +
              ")";
            c.fill();
          });
        if (L.visible("streaks")) {
          c.strokeStyle = this.map ? "#ffe07a" : "#ffae3b";
          c.lineWidth = 1.7;
          for (const p of this.particles)
            if (p?.trail.length) {
              line([...p.trail, [p.x, p.y]]);
              c.stroke();
            }
        }
      },
    };
    for (const id of L.paintOrder()) {
      if (!paint[id]) continue; // the basemap is the Mapbox canvas underneath
      c.globalAlpha = L.opacity(id);
      paint[id]();
    }
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
  async basemap(on) {
    if (!on) {
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
    if (!this.layers.visible("basemap") || !this.placement || this.map) return; // switched off, or another call made it
    const [[west, south], [east, north]] = this.lonLatBounds();
    this.map = new window.mapboxgl.Map({
      container: "map",
      accessToken: this.token,
      style: "mapbox://styles/mapbox/outdoors-v12",
      projection: "mercator",
      pitchWithRotate: false,
      dragRotate: false,
      center: [(west + east) / 2, (south + north) / 2],
      zoom: 15,
    });
    el("scene").classList.add("geographic");
    this.map.on("move", () => this.draw());
    this.map.on("click", (e) =>
      this.onPick ? this.onPick(e.lngLat) : this.click(e.point.x, e.point.y, e.originalEvent),
    );
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
