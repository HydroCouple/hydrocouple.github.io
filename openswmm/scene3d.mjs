/**
 * The model inside Mapbox's 3D scene (interaction phase V7b). In the 3D view the meshes and the water
 * depth (WebGL custom layers), the SWMM network and the contour lines (GeoJSON layers) are Mapbox
 * layers in the layer tree's order, under the 3D buildings, so buildings hide what stands behind them.
 * A view of the same models as the map canvas: the ModelView's geometry, frame and depth scheme, and
 * the layer tree. The canvas keeps what moves or answers the pointer: streaks, selection, box/lasso.
 */
import { symbols, markerOutline } from "./layers.mjs";
import { chainSegments } from "./depth-style.mjs";

const linkKinds = ["conduits", "pumps", "orifices", "weirs", "outlets"],
  markerKinds = ["junctions", "dividers", "storage", "outfalls", "gages"];
/** Mapbox layers of each layer tree category, bottom → top. */
const categoryLayers = {
  meshes: ["osw-meshes"],
  swmm: ["osw-subcatch-fill", "osw-subcatch-line", "osw-links", "osw-markers"],
  outputs2d: ["osw-depth", "osw-contours", "osw-contour-labels"],
};
const empty = { type: "FeatureCollection", features: [] };
/** Mesh positions are kept relative to a Mercator origin, times K (float32 holds them to ~0.3 mm). */
const K = 1e6;
const mercator = ([lon, lat]) => [(lon + 180) / 360, (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360];
const rgba = (() => {
  const cache = new Map();
  return (css) => {
    let c = cache.get(css);
    if (!c) {
      const hex = /^#([0-9a-f]{6})$/i.exec(css);
      c = hex ? [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) : (css.match(/[\d.]+/g) || [0, 0, 0]).map(Number).concat(1).slice(0, 4);
      cache.set(css, c);
    }
    return c;
  };
})();

/** Interleaved vertices: x, y (float32, relative × K) and RGBA (bytes), 12 bytes each. */
class Vertices {
  constructor(n) {
    this.buffer = new ArrayBuffer(12 * n);
    this.f = new Float32Array(this.buffer);
    this.b = new Uint8Array(this.buffer);
    this.count = 0;
  }
  push(x, y, [r, g, b, a]) {
    const i = this.count++;
    this.f[3 * i] = x;
    this.f[3 * i + 1] = y;
    const o = 12 * i + 8;
    this.b[o] = r;
    this.b[o + 1] = g;
    this.b[o + 2] = b;
    this.b[o + 3] = Math.round(a * 255);
  }
}

const vertexShader = `
uniform mat4 u_matrix;
attribute vec2 a_pos;
attribute vec4 a_color;
varying vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  v_color = a_color;
}`;
const fragmentShader = `
precision mediump float;
uniform float u_opacity;
varying vec4 v_color;
void main() {
  float a = v_color.a * u_opacity;
  gl_FragColor = vec4(v_color.rgb * a, a); // premultiplied, as Mapbox blends
}`;

/** A Mapbox custom layer of colored triangles and lines on the ground. */
function groundLayer(id) {
  return {
    id,
    type: "custom",
    renderingMode: "3d",
    origin: [0, 0],
    opacity: 1,
    parts: { tris: null, lines: null },
    onAdd(map, gl) {
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vertexShader));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragmentShader));
      gl.linkProgram(p);
      this.program = { p, matrix: gl.getUniformLocation(p, "u_matrix"), opacity: gl.getUniformLocation(p, "u_opacity"), pos: gl.getAttribLocation(p, "a_pos"), color: gl.getAttribLocation(p, "a_color") };
      this.buffers = { tris: gl.createBuffer(), lines: gl.createBuffer() };
    },
    onRemove(map, gl) {
      gl.deleteBuffer(this.buffers.tris);
      gl.deleteBuffer(this.buffers.lines);
      gl.deleteProgram(this.program.p);
    },
    /** New geometry for a part ("tris" or "lines"): Vertices, or null to draw none. */
    set(part, vertices) {
      this.parts[part] = vertices && vertices.count ? { vertices, upload: true } : null;
    },
    render(gl, matrix) {
      const P = this.program;
      if (!this.parts.tris && !this.parts.lines) return;
      gl.bindVertexArray?.(null); // never change the map's own vertex array objects
      gl.useProgram(P.p);
      // The map's matrix takes Mercator coordinates; ours are (Mercator − origin) × K.
      const m = matrix,
        r = new Float64Array(m);
      for (let row = 0; row < 4; row++) {
        r[12 + row] = m[12 + row] + this.origin[0] * m[row] + this.origin[1] * m[4 + row];
        r[row] = m[row] / K;
        r[4 + row] = m[4 + row] / K;
      }
      gl.uniformMatrix4fv(P.matrix, false, new Float32Array(r));
      gl.uniform1f(P.opacity, this.opacity);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // On the ground under everything 3D: the buildings drawn after it cover it where they stand.
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      for (const [part, mode] of [["tris", gl.TRIANGLES], ["lines", gl.LINES]]) {
        const it = this.parts[part];
        if (!it) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[part]);
        if (it.upload) {
          gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(it.vertices.buffer, 0, 12 * it.vertices.count), gl.DYNAMIC_DRAW);
          it.upload = false;
        }
        gl.enableVertexAttribArray(P.pos);
        gl.vertexAttribPointer(P.pos, 2, gl.FLOAT, false, 12, 0);
        gl.enableVertexAttribArray(P.color);
        gl.vertexAttribPointer(P.color, 4, gl.UNSIGNED_BYTE, true, 12, 8);
        gl.drawArrays(mode, 0, it.vertices.count);
      }
      gl.disableVertexAttribArray(P.pos);
      gl.disableVertexAttribArray(P.color);
    },
  };
}

/** A node or gage marker as the map canvas draws it (2× pixels), for a symbol layer icon. */
function markerImage(kind) {
  const s = symbols[kind],
    r = s.size / 2,
    size = Math.ceil(s.size + 2 * markerOutline.width + 2),
    c = new OffscreenCanvas(2 * size, 2 * size).getContext("2d");
  c.scale(2, 2);
  const x = size / 2,
    y = size / 2;
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
  c.strokeStyle = markerOutline.stroke;
  c.lineWidth = markerOutline.width;
  c.stroke();
  return c.getImageData(0, 0, 2 * size, 2 * size);
}

export class Scene3D {
  /** @param {import("./view.mjs").ModelView} view */
  constructor(view) {
    this.view = view;
    this.on = false;
  }
  get map() {
    return this.view.map;
  }
  /** Put the model's layers into the map (the 3D view starts, or the style loaded again). */
  attach() {
    const m = this.map;
    this.on = true;
    if (!m || !this.view.styleReady || m.getLayer("osw-depth")) return this.sync(); // style.load attaches again
    this.keys = {};
    for (const kind of markerKinds) if (!m.hasImage("osw-" + kind)) m.addImage("osw-" + kind, markerImage(kind), { pixelRatio: 2 });
    m.addSource("osw-network", { type: "geojson", data: empty });
    m.addSource("osw-contours", { type: "geojson", data: empty });
    this.meshes = groundLayer("osw-meshes");
    this.depth = groundLayer("osw-depth");
    const ink = getComputedStyle(this.view.canvas).getPropertyValue("--ink").trim() || "#0a1c2e",
      surface = getComputedStyle(this.view.canvas).getPropertyValue("--surface").trim() || "#fff";
    for (const layer of [
      this.meshes,
      { id: "osw-subcatch-fill", type: "fill", source: "osw-network", filter: ["==", ["get", "kind"], "subcatchments"], paint: { "fill-color": symbols.subcatchments.fill } },
      { id: "osw-subcatch-line", type: "line", source: "osw-network", filter: ["==", ["get", "kind"], "subcatchments"], paint: { "line-color": symbols.subcatchments.outline, "line-width": symbols.subcatchments.width } },
      {
        id: "osw-links",
        type: "line",
        source: "osw-network",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "kind"], ...linkKinds.flatMap((k) => [k, symbols[k].stroke]), "#000"],
          "line-width": ["match", ["get", "kind"], ...linkKinds.flatMap((k) => [k, symbols[k].width]), 1],
        },
      },
      {
        id: "osw-markers",
        type: "symbol",
        source: "osw-network",
        layout: { "icon-image": ["concat", "osw-", ["get", "kind"]], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "order"] },
      },
      this.depth,
      { id: "osw-contours", type: "line", source: "osw-contours", paint: { "line-color": ink, "line-width": ["case", ["get", "index"], 1.6, 0.8] } },
      {
        id: "osw-contour-labels",
        type: "symbol",
        source: "osw-contours",
        layout: { "symbol-placement": "line", "text-field": ["get", "label"], "text-size": 10, "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"], "symbol-spacing": 220 },
        paint: { "text-color": ink, "text-halo-color": surface, "text-halo-width": 1.5 },
      },
    ])
      m.addLayer(layer);
    this.sync();
  }
  /** Take the model's layers out of the map (back to the flat map, drawn on the canvas). */
  detach() {
    this.on = false;
    const m = this.map;
    if (!m?.getLayer("osw-depth")) return;
    for (const id of Object.values(categoryLayers).flat()) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of ["osw-network", "osw-contours"]) if (m.getSource(id)) m.removeSource(id);
  }
  /** Bring the layers up to date with the models; each part only when what it shows changed. */
  sync() {
    const m = this.map,
      v = this.view,
      L = v.layers;
    if (!this.on || !m?.getLayer("osw-depth") || !v.placement) return;
    const ll = v.vertexLonLat(),
      geo = v.geo;
    const changed = (part, ...key) => {
      if (this.keys[part]?.length === key.length && key.every((k, i) => k === this.keys[part][i])) return false;
      this.keys[part] = key;
      return true;
    };
    // Mesh positions relative to the origin (the mesh's middle), once per geometry and placement.
    if (changed("positions", geo, v.placement)) {
      const n = geo.x.length,
        merc = new Float64Array(2 * n);
      let sx = 0,
        sy = 0;
      for (let k = 0; k < n; k++) {
        [merc[2 * k], merc[2 * k + 1]] = mercator([ll[2 * k], ll[2 * k + 1]]);
        sx += merc[2 * k];
        sy += merc[2 * k + 1];
      }
      this.origin = n ? [sx / n, sy / n] : [0, 0];
      this.pos = new Float32Array(2 * n);
      for (let k = 0; k < 2 * n; k++) this.pos[k] = (merc[k] - this.origin[k % 2]) * K;
      this.meshes.origin = this.depth.origin = this.origin;
    }
    const P = this.pos;
    if (changed("meshes", geo, v.placement, L.visible("meshfill"), L.visible("edges"))) {
      const fill = L.visible("meshfill") ? new Vertices(v.tris.length) : null;
      if (fill) for (const k of v.tris) fill.push(P[2 * k], P[2 * k + 1], [74, 100, 128, 0.12]);
      let lines = null;
      if (L.visible("edges")) {
        const seen = new Set(),
          pairs = [];
        for (const cell of geo.cells)
          cell.forEach((a, j) => {
            const b = cell[(j + 1) % cell.length],
              key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
            if (!seen.has(key)) {
              seen.add(key);
              pairs.push(a, b);
            }
          });
        lines = new Vertices(pairs.length);
        for (const k of pairs) lines.push(P[2 * k], P[2 * k + 1], [47, 93, 134, 0.6]);
      }
      this.meshes.set("tris", fill);
      this.meshes.set("lines", lines);
    }
    // Water depth and contour lines: per frame and style.
    const f = v.frame,
      showDepth = !!f && L.visible("depth");
    const scheme = showDepth ? v.depthScheme() : null,
      geom = scheme && (scheme.st.display === "bands" || scheme.st.lines) ? v.contourGeometry(scheme) : null;
    if (changed("depth", f, showDepth, scheme, geom, v.dry())) {
      let tris = null;
      if (showDepth && geom?.bands) {
        const at = ([a, b, t]) => [P[2 * a] + t * (P[2 * b] - P[2 * a]), P[2 * a + 1] + t * (P[2 * b + 1] - P[2 * a + 1])];
        let n = 0;
        for (const polys of geom.bands) for (const poly of polys) n += 3 * (poly.length - 2);
        tris = new Vertices(n);
        geom.bands.forEach((polys, k) => {
          const color = rgba(scheme.classColor(k));
          for (const poly of polys) {
            const q = poly.map(at);
            for (let j = 1; j + 1 < q.length; j++) for (const [x, y] of [q[0], q[j], q[j + 1]]) tris.push(x, y, color);
          }
        });
      } else if (showDepth) {
        const dry = v.dry(),
          clear = [0, 0, 0, 0];
        tris = new Vertices(v.tris.length);
        geo.cells.forEach((cell, i) => {
          const d = f.depth[i],
            color = d > dry ? rgba(scheme.colorOf(d)) : clear;
          for (let j = 1; j + 1 < cell.length; j++) for (const k of [cell[0], cell[j], cell[j + 1]]) tris.push(P[2 * k], P[2 * k + 1], color);
        });
      }
      this.depth.set("tris", tris);
      // Contour lines as polylines (labels follow them), in lon/lat.
      const lonLat = ([a, b, t]) => [ll[2 * a] + t * (ll[2 * b] - ll[2 * a]), ll[2 * a + 1] + t * (ll[2 * b + 1] - ll[2 * a + 1])];
      const features = [];
      if (showDepth && geom?.lines.length)
        geom.lines.forEach((segs, i) => {
          const label = String(+geom.levels[i].toPrecision(3));
          for (const chain of chainSegments(segs))
            features.push({ type: "Feature", properties: { index: geom.index[i], label }, geometry: { type: "LineString", coordinates: chain.map(lonLat) } });
        });
      m.getSource("osw-contours").setData({ type: "FeatureCollection", features });
    }
    // The network, once per network and placement.
    if (changed("network", v.network, v.placement)) {
      const n = v.network || {},
        to = (p) => v.placement.toLonLat(p[0], p[1]),
        features = [];
      for (const ring of n.subcatchments || []) features.push({ type: "Feature", properties: { kind: "subcatchments" }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]].map(to)] } });
      for (const kind of linkKinds) for (const points of n[kind] || []) features.push({ type: "Feature", properties: { kind }, geometry: { type: "LineString", coordinates: points.map(to) } });
      markerKinds.forEach((kind, order) => {
        for (const p of n[kind] || []) features.push({ type: "Feature", properties: { kind, order }, geometry: { type: "Point", coordinates: to(p) } });
      });
      m.getSource("osw-network").setData({ type: "FeatureCollection", features });
    }
    // What shows and how strongly, as the layer tree says.
    const st = scheme?.st;
    if (changed("style", JSON.stringify([L.on, L.alpha, L.counts, !!st?.lines, !!st?.labels]))) {
      const a = (id) => L.opacity(id),
        show = (id, on) => m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      this.meshes.opacity = a("meshes");
      this.depth.opacity = 0.9 * a("outputs2d");
      show("osw-subcatch-fill", L.visible("subcatchments"));
      show("osw-subcatch-line", L.visible("subcatchments"));
      m.setPaintProperty("osw-subcatch-fill", "fill-opacity", a("swmm"));
      m.setPaintProperty("osw-subcatch-line", "line-opacity", a("swmm"));
      m.setFilter("osw-links", ["in", ["get", "kind"], ["literal", linkKinds.filter((k) => L.visible(k))]]);
      m.setPaintProperty("osw-links", "line-opacity", a("swmm"));
      m.setFilter("osw-markers", ["in", ["get", "kind"], ["literal", markerKinds.filter((k) => L.visible(k))]]);
      m.setPaintProperty("osw-markers", "icon-opacity", a("swmm"));
      show("osw-contours", L.visible("depth") && !!st?.lines);
      show("osw-contour-labels", L.visible("depth") && !!st?.lines && !!st?.labels);
      m.setPaintProperty("osw-contours", "line-opacity", a("outputs2d"));
      m.setPaintProperty("osw-contour-labels", "text-opacity", a("outputs2d"));
    }
    // The tree's order, bottom → top, under the buildings (or the basemap's labels).
    const order = L.paintOrder().flatMap((id) => categoryLayers[id] || []);
    if (changed("order", order.join())) {
      let before = m.getLayer("osw-buildings") ? "osw-buildings" : m.getStyle().layers.find((l) => l.type === "symbol" && l.layout?.["text-field"] && !l.id.startsWith("osw-"))?.id;
      for (let i = order.length - 1; i >= 0; i--) {
        m.moveLayer(order[i], before);
        before = order[i];
      }
    }
    m.triggerRepaint();
  }
}
