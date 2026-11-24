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
export function sketch(text) {
  const s = sections(text),
    vertices = s["[2D_VERTICES]"] || [],
    nodes = new Map(
      (s["[COORDINATES]"] || []).map(([id, x, y]) => [id, [+x, +y]]),
    );
  const links = ["CONDUITS", "PUMPS", "WEIRS", "ORIFICES", "OUTLETS"].flatMap(
    (k) =>
      (s["[" + k + "]"] || [])
        .map((row) => [nodes.get(row[1]), nodes.get(row[2])])
        .filter((pair) => pair.every(Boolean)),
  );
  return {
    x: vertices.map((v) => +v[0]),
    y: vertices.map((v) => +v[1]),
    cells: [
      ...(s["[2D_TRIANGLES]"] || []).map((v) => v.slice(0, 3).map(Number)),
      ...(s["[2D_QUADS]"] || []).map((v) => v.slice(0, 4).map(Number)),
    ],
    links,
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
export class ModelView {
  constructor(token) {
    this.token = token;
    this.canvas = el("plot");
    this.ctx = this.canvas.getContext("2d");
    this.geo = { x: [], y: [], cells: [], links: [] };
    this.particles = [];
    this.zoom = 1;
    this.pan = [0, 0];
    this.drag = null;
    this.canvas.onpointerdown = (e) => {
      this.drag = [e.clientX, e.clientY, ...this.pan];
      this.canvas.setPointerCapture(e.pointerId);
    };
    this.canvas.onpointermove = (e) => {
      if (this.drag) {
        this.pan = [
          this.drag[2] + e.clientX - this.drag[0],
          this.drag[3] + e.clientY - this.drag[1],
        ];
        this.draw();
      }
    };
    this.canvas.onpointerup = (e) => {
      if (
        this.drag &&
        Math.hypot(e.clientX - this.drag[0], e.clientY - this.drag[1]) < 4
      )
        this.inspect(e.offsetX, e.offsetY);
      this.drag = null;
    };
    this.canvas.onpointercancel = () => (this.drag = null);
    this.canvas.onwheel = (e) => {
      e.preventDefault();
      this.scale(e.deltaY < 0 ? 1.18 : 1 / 1.18);
    };
    el("fit").onclick = () => this.fit();
    el("zoomin").onclick = () => this.scale(1.4);
    el("zoomout").onclick = () => this.scale(1 / 1.4);
    for (const id of ["edges", "wet", "streaks"])
      el(id).onchange = () => this.draw();
    el("streaks").checked = !matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
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
        el("streaks").checked &&
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
    this.selected = -1;
    const points = geo.cells.length
      ? Array.from(geo.x, (x, i) => [x, geo.y[i]])
      : (geo.links || []).flat();
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
    el("probe").textContent = "Select a cell to inspect";
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
    el("scale").textContent = "0 — " + peak.toPrecision(3);
    this.draw();
  }
  advance(dt) {
    if (!this.wet?.length) {
      this.particles = [];
      return;
    }
    const count = Math.min(360, Math.max(30, this.wet.length * 3)),
      f = this.frame;
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
        x = p.x + u * dt * 4,
        y = p.y + v * dt * 4;
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
  inspect(x, y) {
    this.selected = this.polys?.findIndex((poly) =>
      contains(
        poly.map((p) => this.project(...p)),
        x,
        y,
      ),
    );
    this.draw();
    this.onSelect?.(this.selected);
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
      edges = el("edges").checked,
      wet = el("wet").checked;
    const line = (points) => {
      c.beginPath();
      points.forEach((p, j) => {
        const [x, y] = this.project(...p);
        if (j) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
    };
    (this.polys || []).forEach((p, i) => {
      line(p);
      c.closePath();
      const d = f?.depth[i] || 0;
      if (wet && d > 0.00001) {
        const a = Math.min(1, d / this.peak);
        c.fillStyle =
          "rgba(" +
          [
            Math.round(217 - 217 * a),
            Math.round(237 - 156 * a),
            Math.round(255 - 115 * a),
            0.9,
          ].join(",") +
          ")";
        c.fill();
      } else if (!f) {
        c.fillStyle = "rgba(0,113,191,.14)";
        c.fill();
      }
      if (edges || this.selected === i) {
        c.strokeStyle = this.selected === i ? "#0a1c2e" : "rgba(47,93,134,.6)";
        c.lineWidth = this.selected === i ? 2 : 0.75;
        c.stroke();
      }
    });
    c.strokeStyle = "#c4760d";
    c.lineWidth = 2;
    for (const pair of this.geo.links || []) {
      line(pair);
      c.stroke();
    }
    if (el("streaks").checked) {
      c.strokeStyle = this.map ? "#ffe07a" : "#ffae3b";
      c.lineWidth = 1.7;
      for (const p of this.particles)
        if (p?.trail.length) {
          line([...p.trail, [p.x, p.y]]);
          c.stroke();
        }
    }
    if (this.selected >= 0) {
      const i = this.selected;
      el("probe").textContent =
        "Cell " +
        i +
        (f
          ? " · " +
            f.depth[i].toFixed(4) +
            " m · " +
            Math.hypot(f.u[i], f.v[i]).toFixed(3) +
            " m/s"
          : " · run the model for depth and speed");
    }
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
    if (!el("basemap").checked || !this.placement) return;
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
      this.onPick ? this.onPick(e.lngLat) : this.inspect(e.point.x, e.point.y),
    );
    this.map.on("error", (e) => {
      el("mapstatus").textContent =
        e.error?.status === 403
          ? "Mapbox denied this origin or token. Check its URL restrictions."
          : "Basemap request failed. Local modeling remains available.";
    });
    this.fit();
  }
}
