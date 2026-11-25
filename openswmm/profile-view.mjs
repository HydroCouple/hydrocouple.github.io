/**
 * Profile tabs of the bottom panel (interaction phase V3): a view of the profile set (profiles.mjs)
 * beside the time series page (plot-view.mjs). A pipe profile draws the ground, the pipes (inverts and
 * crowns from the offsets), the water in them up to the hydraulic grade line or the crown, the nodes,
 * the HGL at the shown time and its maximum; a terrain profile draws the bed, the water and its surface
 * at the shown time, and the maximum surface. One elevation axis. A crosshair lists the values at the
 * nearest node or sample and marks the place on the map (`onHover`); a table, CSV and PNG. The time
 * follows the time bar when the run has 2D frames; otherwise the profile has its own slider.
 */
import { niceTicks, elapsed } from "./plots.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const css = (node, name, fallback) => getComputedStyle(node).getPropertyValue(name).trim() || fallback;
const fmt = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)) : "—");
/** The index of the time nearest `t` in a sorted list. */
const nearest = (times, t) => {
  let best = 0;
  times.forEach((s, i) => Math.abs(s - t) < Math.abs(times[best] - t) && (best = i));
  return best;
};

/**
 * @param {object} o
 * @param {HTMLElement} o.root the bottom panel (#plotpanel)
 * @param {{page: HTMLElement, redraw: () => void}} o.series the time series page (plot-view.mjs)
 * @param {import("./profiles.mjs").ProfileSet} o.set
 * @param {import("./timeline.mjs").Timeline} o.timeline
 * @param {() => void} o.onClose close the panel
 * @param {(point: number[] | null) => void} o.onHover the crosshair's place on the map (model x, y)
 */
export function profilePanel({ root, series, set, timeline, onClose, onHover }) {
  const tabs = el("div", { className: "panel-tabs", role: "tablist", ariaLabel: "Bottom panel tabs" });
  root.insertBefore(tabs, series.page);
  const title = el("h2"),
    slider = el("input", { type: "range", min: 0, max: 0, step: 1, value: 0, ariaLabel: "Profile time" }),
    clock = el("output", { className: "profile-clock" }),
    legend = el("div", { className: "plot-legend profile-legend", ariaLabel: "Profile key" }),
    note = el("p", { className: "plot-note", role: "status" });
  const button = (text) => el("button", { type: "button", className: "tb ghost", textContent: text });
  const tableBtn = button("Table"),
    csvBtn = button("CSV"),
    pngBtn = button("PNG");
  tableBtn.setAttribute("aria-pressed", "false");
  const close = el("button", { type: "button", className: "tb icon", ariaLabel: "Close profiles", title: "Close the panel" });
  close.innerHTML = '<svg aria-hidden="true"><use href="#i-close" /></svg>';
  close.onclick = onClose;
  const canvas = el("canvas", { className: "plot-canvas", tabIndex: 0, ariaLabel: "Profile chart" }),
    tip = el("div", { className: "plot-tip", hidden: true, role: "status" }),
    table = el("div", { className: "plot-table", hidden: true });
  const body = el("div", { className: "plot-body" }, canvas, tip, table);
  const page = el(
    "div",
    { className: "panel-page", hidden: true },
    el("div", { className: "plot-head" }, title, el("label", { className: "profile-time" }, slider), clock, legend, el("span", { className: "spacer" }), tableBtn, csvBtn, pngBtn, close),
    note,
    body,
  );
  root.append(page);

  // ---- tabs ------------------------------------------------------------------------------------------
  function renderTabs() {
    tabs.hidden = !set.profiles.length;
    const tab = (id, label, closable) => {
      const b = el("button", { type: "button", role: "tab", className: "panel-tab", textContent: label });
      b.setAttribute("aria-selected", String(set.active === id));
      b.onclick = () => set.setActive(id);
      if (!closable) return b;
      const x = el("button", { type: "button", className: "panel-tab-close", ariaLabel: "Close profile " + label, title: "Close", textContent: "×" });
      x.onclick = () => set.remove(id);
      return el("span", { className: "panel-tab-wrap" + (set.active === id ? " on" : "") }, b, x);
    };
    tabs.replaceChildren(tab("series", "Time series", false), ...set.profiles.map((p) => tab(p.id, p.title, true)));
    series.page.hidden = set.active !== "series";
    page.hidden = set.active === "series";
    if (!series.page.hidden) series.redraw();
    render();
  }
  set.addEventListener("change", ({ detail }) => {
    if (detail.kind === "profiles" || detail.kind === "active") renderTabs();
    else if (detail.id === set.active) render();
  });
  timeline.addEventListener("change", ({ detail }) => detail.kind === "frame" && render());
  new ResizeObserver(() => render()).observe(body);

  // ---- time ------------------------------------------------------------------------------------------
  const active = () => set.get(set.active);
  const frameTimes = () => (timeline.frames || []).map((f) => f.seconds);
  const times = (p) => (p.kind === "pipe" ? p.data?.seconds || [] : frameTimes());
  function indexOf(p) {
    const t = times(p);
    if (!t.length) return 0;
    if (p.kind === "terrain") return Math.min(t.length - 1, Math.max(0, timeline.index));
    if (frameTimes().length > 1) return nearest(t, timeline.seconds);
    return Math.min(t.length - 1, p.index ?? 0);
  }
  slider.oninput = () => {
    const p = active();
    if (!p?.data) return;
    const i = +slider.value;
    if (p.kind === "terrain") timeline.seek(i);
    else if (frameTimes().length > 1) timeline.seek(nearest(frameTimes(), p.data.seconds[i]));
    else set.setIndex(p.id, i);
  };

  // ---- table and exports -----------------------------------------------------------------------------
  /** Rows of the active profile at the shown time: [header, ...rows]. */
  function rows(p, i) {
    if (p.kind === "pipe") {
      const u = p.geometry.unit;
      return [
        ["Node", "Distance (" + u + ")", "Invert (" + u + ")", "Rim (" + u + ")", "Head (" + u + ")", "Max head (" + u + ")"],
        ...p.geometry.stations.map((s) => [s.id, fmt(s.d), fmt(s.invert), fmt(s.rim), fmt(p.data.heads[s.id]?.[i]), fmt(p.data.max[s.id])]),
      ];
    }
    const d = p.data,
      depth = d.depth[i];
    return [
      ["Distance (m)", "Bed (m)", "Depth (m)", "Surface (m)", "Max depth (m)"],
      ...d.samples.map((s, k) => [fmt(s.d), fmt(d.bed[k]), fmt(depth?.[k]), fmt(depth?.[k] > d.dry ? d.bed[k] + depth[k] : NaN), fmt(d.max[k])]),
    ];
  }
  const download = (blob, name) => {
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const fileName = (p) => p.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "profile";
  csvBtn.onclick = () => {
    const p = active();
    if (!p?.data) return;
    const i = indexOf(p);
    const text = ["Time," + elapsed(times(p)[i] || 0), ...rows(p, i).map((r) => r.join(","))].join("\n");
    download(new Blob([text], { type: "text/csv" }), fileName(p) + ".csv");
  };
  pngBtn.onclick = () => canvas.toBlob((blob) => blob && download(blob, fileName(active() || { title: "" }) + ".png"), "image/png");
  tableBtn.onclick = () => {
    const on = tableBtn.getAttribute("aria-pressed") !== "true";
    tableBtn.setAttribute("aria-pressed", String(on));
    table.hidden = !on;
    canvas.hidden = on;
    render();
  };

  // ---- drawing -----------------------------------------------------------------------------------------
  let hover = null, // the crosshair's distance along the profile
    frame = null; // the last draw's scales
  const colors = () => ({
    ink: css(root, "--ink", "#0a1c2e"),
    soft: css(root, "--ink-soft", "#35516b"),
    mute: css(root, "--ink-mute", "#4a6480"),
    line: css(root, "--line", "#d7e5f0"),
    surface: css(root, "--surface", "#fff"),
    water: css(root, "--series-1", "#2a78d6"),
    ground: css(root, "--ground", "#9b7b55"),
    earth: css(root, "--ground-fill", "#eadfcd"),
    flag: css(root, "--flag", "#f29f38"),
  });
  const key = (label, draw) => {
    const k = el("canvas", { width: 28, height: 12, className: "profile-key" });
    draw(k.getContext("2d"));
    return el("span", { className: "plot-chip" }, k, el("span", { textContent: label }));
  };
  function renderLegend(p, k) {
    const line = (color, width, dash = []) => (c) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.setLineDash(dash);
      c.beginPath();
      c.moveTo(2, 6);
      c.lineTo(26, 6);
      c.stroke();
    };
    const box = (fill, stroke) => (c) => {
      c.fillStyle = fill;
      c.fillRect(2, 2, 24, 8);
      if (stroke) {
        c.strokeStyle = stroke;
        c.strokeRect(2.5, 2.5, 23, 7);
      }
    };
    const water = (c) => {
      c.globalAlpha = 0.4;
      box(k.water)(c);
    };
    legend.replaceChildren(
      ...(p.kind === "pipe"
        ? [key("Water", water), key("HGL", line(k.water, 2)), key("Max HGL", line(k.water, 1.5, [5, 3])), key("Pipe", box(k.surface, k.soft)), key("Ground", line(k.ground, 1.5, [4, 3]))]
        : [key("Bed", box(k.earth, k.ground)), key("Water", water), key("Surface", line(k.water, 2)), key("Max surface", line(k.water, 1.5, [5, 3]))]),
    );
  }

  function render() {
    const p = active();
    if (!p || page.hidden) return;
    title.textContent = p.title;
    note.textContent = p.error || (p.data ? p.data.note || "" : p.kind === "pipe" ? "Reading the heads from the run's output…" : "Sampling the surface…");
    const t = p.data ? times(p) : [];
    slider.max = String(Math.max(0, t.length - 1));
    slider.disabled = t.length < 2;
    const i = indexOf(p);
    slider.value = String(i);
    clock.value = t.length ? elapsed(t[i]) : "—";
    const k = colors();
    renderLegend(p, k);
    if (!table.hidden) {
      const r = p.data ? rows(p, i) : [[]];
      const tb = el("table", {}, el("thead", {}, el("tr", {}, ...r[0].map((h) => el("th", { textContent: h })))), el("tbody", {}, ...r.slice(1).map((row) => el("tr", {}, ...row.map((v) => el("td", { textContent: v }))))));
      table.replaceChildren(tb);
    }
    draw(p, i, k);
  }

  function draw(p, i, k) {
    if (canvas.hidden) return;
    const w = canvas.clientWidth,
      h = canvas.clientHeight,
      dpr = Math.min(devicePixelRatio, 2);
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    frame = null;
    if (!p.data) return;
    const pipe = p.kind === "pipe",
      unit = pipe ? p.geometry.unit : "m",
      length = pipe ? p.geometry.length : p.data.length;
    // Elevation range: everything drawn, on round ticks.
    let lo = Infinity,
      hi = -Infinity;
    const take = (v) => Number.isFinite(v) && ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
    if (pipe) {
      for (const s of p.geometry.stations) [s.invert, s.rim, p.data.max[s.id]].forEach(take);
      for (const s of p.geometry.segments) [s.bottom0, s.bottom1, s.bottom0 + s.height, s.bottom1 + s.height].forEach(take);
    } else p.data.bed.forEach((b, j) => (take(b), take(b + (p.data.max[j] || 0))));
    const yt = niceTicks(lo, hi, 4),
      xt = niceTicks(0, length, 6).filter((v) => v <= length + 1e-9);
    const [y0, y1] = [yt[0], yt[yt.length - 1]];
    const left = 58,
      right = 14,
      top = pipe ? 26 : 12,
      bottom = 30;
    const X = (d) => left + (d / (length || 1)) * (w - left - right),
      Y = (e) => top + ((y1 - e) / (y1 - y0 || 1)) * (h - top - bottom);
    frame = { X, Y, left, right, top, bottom, w, h, length, p, i };
    // Grid and axes.
    c.font = "11px Inter, system-ui, sans-serif";
    c.fillStyle = k.mute;
    c.strokeStyle = k.line;
    c.lineWidth = 1;
    c.textAlign = "right";
    c.textBaseline = "middle";
    for (const v of yt) {
      const y = Math.round(Y(v)) + 0.5;
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(w - right, y);
      c.stroke();
      c.fillText(String(v), left - 6, y);
    }
    c.textAlign = "center";
    c.textBaseline = "top";
    for (const v of xt) c.fillText(String(v), X(v), h - bottom + 6);
    c.save();
    c.translate(12, top + (h - top - bottom) / 2);
    c.rotate(-Math.PI / 2);
    c.fillText("Elevation (" + unit + ")", 0, -6);
    c.restore();
    c.textAlign = "right";
    c.fillText("Distance (" + unit + ")", w - right, h - 13);
    if (pipe) drawPipe(c, p, i, k, X, Y);
    else drawTerrain(c, p, i, k, X, Y, h - bottom);
    // The crosshair.
    if (hover !== null) {
      const x = Math.round(X(hover)) + 0.5;
      c.strokeStyle = k.soft;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(x, top);
      c.lineTo(x, h - bottom);
      c.stroke();
      c.setLineDash([]);
    }
  }

  function drawPipe(c, p, i, k, X, Y) {
    const { stations, segments } = p.geometry,
      head = (id) => p.data.heads[id]?.[i];
    // Ground through the rims.
    c.strokeStyle = k.ground;
    c.lineWidth = 1.5;
    c.setLineDash([4, 3]);
    c.beginPath();
    stations.forEach((s, j) => (j ? c.lineTo(X(s.d), Y(s.rim)) : c.moveTo(X(s.d), Y(s.rim))));
    c.stroke();
    c.setLineDash([]);
    // Pipes, and the water in them up to the HGL (between the end nodes' heads) or the crown.
    segments.forEach((s, j) => {
      const a = stations[j],
        b = stations[j + 1];
      const ha = head(a.id),
        hb = head(b.id);
      const bot = (t) => s.bottom0 + t * (s.bottom1 - s.bottom0),
        crown = (t) => bot(t) + s.height,
        hgl = (t) => ha + t * (hb - ha);
      const xs = (t) => X(s.d0 + t * (s.d1 - s.d0));
      if (s.height > 0) {
        c.beginPath();
        c.moveTo(xs(0), Y(bot(0)));
        c.lineTo(xs(1), Y(bot(1)));
        c.lineTo(xs(1), Y(crown(1)));
        c.lineTo(xs(0), Y(crown(0)));
        c.closePath();
        c.fillStyle = k.surface;
        c.fill();
        if (Number.isFinite(ha) && Number.isFinite(hb)) {
          const n = 24,
            ts = Array.from({ length: n + 1 }, (_, q) => q / n);
          c.beginPath();
          ts.forEach((t, q) => (q ? c.lineTo(xs(t), Y(bot(t))) : c.moveTo(xs(t), Y(bot(t)))));
          for (const t of [...ts].reverse()) c.lineTo(xs(t), Y(Math.min(crown(t), Math.max(bot(t), hgl(t)))));
          c.closePath();
          c.globalAlpha = 0.4;
          c.fillStyle = k.water;
          c.fill();
          c.globalAlpha = 1;
        }
        c.beginPath();
        c.moveTo(xs(0), Y(bot(0)));
        c.lineTo(xs(1), Y(bot(1)));
        c.lineTo(xs(1), Y(crown(1)));
        c.lineTo(xs(0), Y(crown(0)));
        c.closePath();
        c.strokeStyle = k.soft;
        c.lineWidth = 1.2;
        c.stroke();
      } else {
        // A pump or a link without an opening height: a dashed connector at its bottom.
        c.strokeStyle = k.soft;
        c.lineWidth = 1.2;
        c.setLineDash([2, 3]);
        c.beginPath();
        c.moveTo(xs(0), Y(bot(0)));
        c.lineTo(xs(1), Y(bot(1)));
        c.stroke();
        c.setLineDash([]);
      }
    });
    // Nodes: a wall from invert to rim, the water in it, flooding marked in amber.
    for (const s of stations) {
      const x = X(s.d),
        hd = head(s.id);
      if (Number.isFinite(hd) && hd > s.invert) {
        c.globalAlpha = 0.4;
        c.fillStyle = k.water;
        c.fillRect(x - 3, Y(Math.min(hd, s.rim)), 6, Y(s.invert) - Y(Math.min(hd, s.rim)));
        c.globalAlpha = 1;
      }
      c.strokeStyle = k.soft;
      c.lineWidth = 1;
      c.strokeRect(Math.round(x - 3) + 0.5, Math.round(Y(s.rim)) + 0.5, 6, Math.max(1, Y(s.invert) - Y(s.rim)));
      if (Number.isFinite(hd) && hd > s.rim + 1e-6 && s.kind !== "outfall") {
        c.fillStyle = k.flag;
        c.beginPath();
        c.moveTo(x, Y(s.rim) - 3);
        c.lineTo(x - 5, Y(s.rim) - 11);
        c.lineTo(x + 5, Y(s.rim) - 11);
        c.closePath();
        c.fill();
      }
    }
    // The HGL now and its maximum.
    const polyline = (value, width, dash) => {
      c.strokeStyle = k.water;
      c.lineWidth = width;
      c.setLineDash(dash);
      c.beginPath();
      let on = false;
      for (const s of stations) {
        const v = value(s);
        if (!Number.isFinite(v)) {
          on = false;
          continue;
        }
        if (on) c.lineTo(X(s.d), Y(v));
        else c.moveTo(X(s.d), Y(v));
        on = true;
      }
      c.stroke();
      c.setLineDash([]);
    };
    polyline((s) => p.data.max[s.id], 1.5, [5, 3]);
    polyline((s) => head(s.id), 2, []);
    // Node names along the top, thinned where they would collide.
    c.fillStyle = k.soft;
    c.font = "10.5px Inter, system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    let last = -Infinity;
    for (const s of stations) {
      const x = X(s.d),
        wd = c.measureText(s.id).width;
      if (x - wd / 2 < last + 6) continue;
      c.fillText(s.id, x, 16);
      last = x + wd / 2;
    }
  }

  function drawTerrain(c, p, i, k, X, Y, base) {
    const d = p.data,
      depth = d.depth[i],
      S = d.samples;
    // Runs of samples inside the mesh (a line may leave it).
    const runs = [];
    let run = [];
    S.forEach((s, j) => {
      if (Number.isFinite(d.bed[j])) run.push(j);
      else if (run.length) (runs.push(run), (run = []));
    });
    if (run.length) runs.push(run);
    for (const r of runs) {
      // The bed as earth from the axis up.
      c.beginPath();
      c.moveTo(X(S[r[0]].d), base);
      for (const j of r) c.lineTo(X(S[j].d), Y(d.bed[j]));
      c.lineTo(X(S[r[r.length - 1]].d), base);
      c.closePath();
      c.fillStyle = k.earth;
      c.fill();
      // Water between the bed and the surface where it is wet.
      let wet = [];
      const flush = () => {
        if (wet.length > 1) {
          c.beginPath();
          wet.forEach((j, q) => (q ? c.lineTo(X(S[j].d), Y(d.bed[j] + depth[j])) : c.moveTo(X(S[j].d), Y(d.bed[j] + depth[j]))));
          for (const j of [...wet].reverse()) c.lineTo(X(S[j].d), Y(d.bed[j]));
          c.closePath();
          c.globalAlpha = 0.4;
          c.fillStyle = k.water;
          c.fill();
          c.globalAlpha = 1;
          c.beginPath();
          wet.forEach((j, q) => (q ? c.lineTo(X(S[j].d), Y(d.bed[j] + depth[j])) : c.moveTo(X(S[j].d), Y(d.bed[j] + depth[j]))));
          c.strokeStyle = k.water;
          c.lineWidth = 2;
          c.stroke();
        }
        wet = [];
      };
      for (const j of r) depth?.[j] > d.dry ? wet.push(j) : flush();
      flush();
      // The bed line and the maximum surface.
      c.beginPath();
      r.forEach((j, q) => (q ? c.lineTo(X(S[j].d), Y(d.bed[j])) : c.moveTo(X(S[j].d), Y(d.bed[j]))));
      c.strokeStyle = k.ground;
      c.lineWidth = 1.5;
      c.stroke();
      c.beginPath();
      let on = false;
      for (const j of r) {
        if (!(d.max[j] > d.dry)) {
          on = false;
          continue;
        }
        if (on) c.lineTo(X(S[j].d), Y(d.bed[j] + d.max[j]));
        else c.moveTo(X(S[j].d), Y(d.bed[j] + d.max[j]));
        on = true;
      }
      c.strokeStyle = k.water;
      c.lineWidth = 1.5;
      c.setLineDash([5, 3]);
      c.stroke();
      c.setLineDash([]);
    }
  }

  // ---- crosshair -----------------------------------------------------------------------------------------
  canvas.onpointermove = (e) => {
    if (!frame) return;
    const { left, right, w, length, p, i } = frame;
    const d = Math.min(length, Math.max(0, ((e.offsetX - left) / (w - left - right)) * length));
    const u = p.kind === "pipe" ? p.geometry.unit : "m";
    let heading, lines, point;
    if (p.kind === "pipe") {
      const s = p.geometry.stations.reduce((a, b) => (Math.abs(b.d - d) < Math.abs(a.d - d) ? b : a));
      hover = s.d;
      point = s.xy;
      heading = s.id + " · " + s.kind;
      lines = [
        ["Distance", fmt(s.d) + " " + u],
        ["Invert", fmt(s.invert) + " " + u],
        ["Rim", fmt(s.rim) + " " + u],
        ["Head", fmt(p.data.heads[s.id]?.[i]) + " " + u],
        ["Max head", fmt(p.data.max[s.id]) + " " + u],
      ];
    } else {
      const D = p.data,
        j = Math.round((d / (length || 1)) * (D.samples.length - 1));
      const s = D.samples[j],
        dp = D.depth[i]?.[j];
      hover = s.d;
      point = Number.isFinite(D.bed[j]) ? [s.x, s.y] : null;
      heading = "At " + fmt(s.d) + " m";
      lines = [
        ["Bed", fmt(D.bed[j]) + " m"],
        ["Depth", (dp > D.dry ? fmt(dp) : "dry") + (dp > D.dry ? " m" : "")],
        ["Surface", dp > D.dry ? fmt(D.bed[j] + dp) + " m" : "—"],
        ["Max depth", fmt(D.max[j]) + " m"],
      ];
    }
    tip.replaceChildren(el("strong", { textContent: heading }), ...lines.map(([a, b]) => el("div", {}, a + " ", el("b", { textContent: b }))));
    tip.hidden = false;
    const x = frame.X(hover);
    tip.style.left = Math.min(x + 12, w - 200) + "px";
    onHover(point || null);
    render();
  };
  canvas.onpointerleave = () => {
    hover = null;
    tip.hidden = true;
    onHover(null);
    render();
  };

  renderTabs();
  return {
    /** Show or hide the active profile's tab page (the panel opened). */
    render,
  };
}
