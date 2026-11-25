/**
 * The plot panel (interaction phase V2): a view of the plot model (plots.mjs) docked between the
 * map and the time bar. One canvas of chart rows (one per kind and variable, so each row has one
 * y-axis) on a shared time axis; legend chips; a crosshair with one tooltip for every series; the
 * time bar's current time as a cursor (a click on a chart moves it); a table of the values; CSV and
 * PNG export. Its height and whether it is open live in the panel layout model (panels.mjs).
 */
import { plotVariables, kindNames, variableOf, unitLabel, seriesName, elapsed, toCsv, niceTicks, maxSeries } from "./plots.mjs";
import { heights } from "./panels.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const css = (node, name, fallback) => getComputedStyle(node).getPropertyValue(name).trim() || fallback;
const fmt = (v) => (Number.isFinite(v) ? String(+v.toPrecision(4)) : "—");
/** Time ticks in seconds: a round step (1 min … 1 day) giving about `count` ticks. */
function timeTicks(lo, hi, count = 6) {
  const steps = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800];
  const step = steps.find((s) => (hi - lo) / s <= count) ?? steps[steps.length - 1];
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return ticks;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root the panel element (#plotpanel)
 * @param {import("./plots.mjs").PlotModel} o.model
 * @param {import("./panels.mjs").PanelLayout} o.layout open state and height
 * @param {import("./timeline.mjs").Timeline} o.timeline playback of 2D frames (cursor, seek)
 * @param {() => {unitSystem: string, flowUnits: string}} o.units the model's units now
 * @param {(kind: string, variable: string) => void} o.onAdd add the selected objects of a kind
 * @param {() => string[]} o.selectedKinds kinds in the selection now (to preselect a variable)
 */
export function plotPanel({ root, model, layout, timeline, units, onAdd, selectedKinds }) {
  const variable = el("select", { ariaLabel: "Variable to plot" });
  for (const [kind, list] of Object.entries(plotVariables)) {
    const group = el("optgroup", { label: kindNames[kind] });
    for (const [v, label] of list) group.append(new Option(kindNames[kind] + " · " + label, kind + ":" + v));
    variable.append(group);
  }
  const add = el("button", { type: "button", className: "tb ghost", textContent: "Add selection" });
  const legend = el("div", { className: "plot-legend", ariaLabel: "Series" });
  const note = el("p", { className: "plot-note", role: "status" });
  const tableBtn = el("button", { type: "button", className: "tb ghost", textContent: "Table" });
  tableBtn.setAttribute("aria-pressed", "false");
  const csvBtn = el("button", { type: "button", className: "tb ghost", textContent: "CSV" });
  const pngBtn = el("button", { type: "button", className: "tb ghost", textContent: "PNG" });
  const clear = el("button", { type: "button", className: "tb ghost", textContent: "Clear" });
  const close = el("button", { type: "button", className: "tb icon", ariaLabel: "Close plots", title: "Close plots" });
  close.innerHTML = '<svg aria-hidden="true"><use href="#i-close" /></svg>';
  const split = el("div", { className: "plot-split", role: "separator", tabIndex: 0, ariaLabel: "Resize plots" });
  split.setAttribute("aria-orientation", "horizontal");
  const canvas = el("canvas", { className: "plot-canvas", tabIndex: 0, ariaLabel: "Time series chart" });
  const tip = el("div", { className: "plot-tip", hidden: true, role: "status" });
  const table = el("div", { className: "plot-table", hidden: true });
  const body = el("div", { className: "plot-body" }, canvas, tip, table);
  const head = el(
    "div",
    { className: "plot-head" },
    el("h2", { textContent: "Time series" }),
    el("label", { className: "plot-add" }, el("span", { textContent: "Add selection as" }), variable),
    add,
    legend,
    el("span", { className: "spacer" }),
    tableBtn,
    csvBtn,
    pngBtn,
    clear,
    close,
  );
  // The time series page; profile tabs (profile-view.mjs) put theirs beside it.
  const page = el("div", { className: "panel-page" }, head, note, body);
  root.replaceChildren(split, page);

  // ---- panel state (layout model) -------------------------------------------------------------
  const place = () => {
    root.hidden = !layout.isOpen("plot");
    root.style.height = layout.height() + "px";
    split.setAttribute("aria-valuenow", String(layout.height()));
    split.setAttribute("aria-valuemin", String(heights.min));
    split.setAttribute("aria-valuemax", String(heights.max));
    draw();
  };
  layout.addEventListener("change", ({ detail }) => detail.side === "plot" && place());
  close.onclick = () => layout.setOpen("plot", false);
  let dragFrom = null;
  split.onpointerdown = (e) => {
    dragFrom = [e.clientY, layout.height()];
    split.setPointerCapture(e.pointerId);
  };
  split.onpointermove = (e) => dragFrom && layout.setHeight(dragFrom[1] + dragFrom[0] - e.clientY);
  split.onpointerup = () => (dragFrom = null);
  split.ondblclick = () => layout.setHeight(heights.plot);
  split.onkeydown = (e) => {
    const step = e.shiftKey ? 64 : 16;
    const to = { ArrowUp: layout.height() + step, ArrowDown: layout.height() - step, Home: heights.min, End: heights.max }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    layout.setHeight(to);
  };

  // ---- controls ----------------------------------------------------------------------------------
  /** Preselect the first variable of a kind in the selection (the first in the list otherwise). */
  const preselect = () => {
    const kinds = selectedKinds();
    const kind = ["node", "link", "subcatchment", "cell"].find((k) => kinds.includes(k));
    if (kind && !variable.value.startsWith(kind + ":")) variable.value = kind + ":" + plotVariables[kind][0][0];
  };
  add.onclick = () => {
    const [kind, v] = variable.value.split(":");
    onAdd(kind, v);
  };
  clear.onclick = () => model.clear();
  tableBtn.onclick = () => {
    const on = tableBtn.getAttribute("aria-pressed") !== "true";
    tableBtn.setAttribute("aria-pressed", String(on));
    table.hidden = !on;
    canvas.hidden = on;
    render();
  };
  const unitOf = (s) => unitLabel(variableOf(s.kind, s.variable).unit, units().unitSystem, units().flowUnits);
  const download = (blob, name) => {
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  csvBtn.onclick = () => download(new Blob([toCsv(model, unitOf)], { type: "text/csv" }), "time-series.csv");
  pngBtn.onclick = () => canvas.toBlob((blob) => blob && download(blob, "time-series.png"), "image/png");

  // ---- drawing -------------------------------------------------------------------------------------
  let hover = null; // index into the union of times, or null
  let geometry = null; // from the last draw: rows' y ranges and the time scale
  const colors = () => Array.from({ length: maxSeries }, (_, i) => css(root, "--series-" + (i + 1), "#2a78d6"));
  /** Every plotted series' time (seconds), sorted: the crosshair snaps to these. */
  const times = () => [...new Set(model.series.flatMap((s) => model.data.get(s.key)?.seconds || []))].sort((a, b) => a - b);

  function draw() {
    if (root.hidden || canvas.hidden || page.hidden) return;
    const c = canvas.getContext("2d"),
      w = canvas.clientWidth,
      h = canvas.clientHeight,
      dpr = Math.min(devicePixelRatio, 2);
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const surface = css(root, "--surface", "#fff"),
      ink = css(root, "--ink", "#0a1c2e"),
      soft = css(root, "--ink-soft", "#35516b"),
      mute = css(root, "--ink-mute", "#4a6480"),
      grid = css(root, "--line", "#d7e5f0");
    c.fillStyle = surface; // painted, so a PNG export has the panel's background
    c.fillRect(0, 0, w, h);
    const rows = model.rows.filter((r) => r.series.some((s) => model.data.get(s.key)?.values));
    geometry = null;
    if (!rows.length) return;
    const all = times();
    const t0 = all[0],
      t1 = all[all.length - 1] > t0 ? all[all.length - 1] : t0 + 1;
    c.font = "11px Inter, system-ui, sans-serif";
    const left = 56,
      bottom = 22,
      gap = 10,
      endLabels = rows.some((r) => r.series.length <= 4),
      right = endLabels ? 120 : 14;
    const rowH = (h - bottom - gap * (rows.length - 1) - 6) / rows.length;
    const X = (t) => left + ((t - t0) / (t1 - t0)) * (w - left - right);
    const palette = colors();
    geometry = { left, right: w - right, X, t0, t1, rows: [] };
    rows.forEach((row, n) => {
      const top = 6 + n * (rowH + gap),
        bot = top + rowH;
      const values = row.series.flatMap((s) => model.data.get(s.key)?.values || []).filter(Number.isFinite);
      let lo = Math.min(...values),
        hi = Math.max(...values);
      if (lo >= 0 && hi > 0) lo = 0; // depths, flows and volumes start at zero
      const ticks = niceTicks(lo, hi, rowH > 90 ? 4 : 2);
      lo = ticks[0];
      hi = ticks[ticks.length - 1];
      const Y = (v) => bot - ((v - lo) / (hi - lo || 1)) * (rowH - 14);
      geometry.rows.push({ top, bot, Y, row });
      // Grid and y ticks: hairline, recessive.
      c.strokeStyle = grid;
      c.lineWidth = 1;
      c.fillStyle = mute;
      c.textAlign = "right";
      c.textBaseline = "middle";
      for (const v of ticks) {
        const y = Math.round(Y(v)) + 0.5;
        c.beginPath();
        c.moveTo(left, y);
        c.lineTo(w - right, y);
        c.stroke();
        c.fillText(fmt(v), left - 6, y);
      }
      // Row title: variable and unit, in ink.
      c.textAlign = "left";
      c.textBaseline = "top";
      c.fillStyle = soft;
      c.fillText(row.label + " (" + unitOf(row.series[0]) + ")", left + 4, top);
      // Lines: 2px, round joins.
      c.lineWidth = 2;
      c.lineJoin = c.lineCap = "round";
      for (const s of row.series) {
        const d = model.data.get(s.key);
        if (!d?.values) continue;
        c.strokeStyle = palette[s.slot];
        c.beginPath();
        let moved = false;
        d.values.forEach((v, i) => {
          if (!Number.isFinite(v)) return (moved = false);
          const x = X(d.seconds[i]),
            y = Y(v);
          if (moved) c.lineTo(x, y);
          else c.moveTo(x, y);
          moved = true;
        });
        c.stroke();
      }
      // End labels (a row with four series or fewer): a short line key in the series color, the
      // name in ink. Kept apart vertically only by their own height; overlaps fall back to the legend.
      if (row.series.length <= 4) {
        const placed = [];
        for (const s of row.series) {
          const d = model.data.get(s.key);
          const v = d?.values?.[d.values.length - 1];
          if (!Number.isFinite(v)) continue;
          const y = Math.max(top + 6, Math.min(bot - 6, Y(v)));
          if (placed.some((p) => Math.abs(p - y) < 12)) continue;
          placed.push(y);
          const x = w - right + 6;
          c.strokeStyle = palette[s.slot];
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + 10, y);
          c.stroke();
          c.fillStyle = soft;
          c.textBaseline = "middle";
          c.fillText(s.kind === "system" ? "System" : s.kind === "cell" ? "Cell " + s.id : s.id, x + 14, y);
        }
      }
    });
    // Time axis under the last row.
    const axisY = h - bottom + 4;
    c.fillStyle = mute;
    c.textAlign = "center";
    c.textBaseline = "top";
    c.strokeStyle = grid;
    c.lineWidth = 1;
    for (const t of timeTicks(t0, t1)) {
      const x = Math.round(X(t)) + 0.5;
      c.beginPath();
      c.moveTo(x, 6);
      c.lineTo(x, h - bottom);
      c.stroke();
      c.fillText(elapsed(t).replace(/:00$/, ""), x, axisY);
    }
    // The time bar's current time.
    if (timeline.frames.length > 1 && timeline.seconds >= t0 && timeline.seconds <= t1) {
      const x = Math.round(X(timeline.seconds)) + 0.5;
      c.strokeStyle = ink;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, 6);
      c.lineTo(x, h - bottom);
      c.stroke();
    }
    // Crosshair: a hairline at the hovered time and a ringed dot on each series there.
    if (hover !== null && all[hover] !== undefined) {
      const t = all[hover],
        x = X(t);
      c.strokeStyle = mute;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(Math.round(x) + 0.5, 6);
      c.lineTo(Math.round(x) + 0.5, h - bottom);
      c.stroke();
      for (const g of geometry.rows)
        for (const s of g.row.series) {
          const d = model.data.get(s.key),
            i = d?.seconds?.indexOf(t) ?? -1;
          if (i < 0 || !Number.isFinite(d.values[i])) continue;
          c.beginPath();
          c.arc(x, g.Y(d.values[i]), 4, 0, 2 * Math.PI);
          c.fillStyle = palette[s.slot];
          c.fill();
          c.lineWidth = 2;
          c.strokeStyle = surface;
          c.stroke();
        }
    }
  }

  /** The tooltip at the hovered time: values first, then names, for every series. */
  function showTip(clientX) {
    const all = times();
    if (hover === null || all[hover] === undefined || !geometry) {
      tip.hidden = true;
      return;
    }
    const t = all[hover],
      palette = colors();
    const lines = [el("strong", { textContent: elapsed(t) + " elapsed" })];
    for (const s of model.series) {
      const d = model.data.get(s.key),
        i = d?.seconds?.indexOf(t) ?? -1;
      if (i < 0) continue;
      const key = el("span", { className: "plot-key" });
      key.style.background = palette[s.slot];
      lines.push(el("div", {}, key, el("b", { textContent: fmt(d.values[i]) + " " + unitOf(s) }), " " + seriesName(s)));
    }
    tip.replaceChildren(...lines);
    tip.hidden = false;
    const box = body.getBoundingClientRect(),
      x = clientX - box.left;
    tip.style.left = Math.min(Math.max(8, x + 14), box.width - tip.offsetWidth - 8) + "px";
  }
  canvas.onpointermove = (e) => {
    if (!geometry) return;
    const all = times(),
      x = e.offsetX;
    if (x < geometry.left || x > geometry.right) {
      hover = null;
      tip.hidden = true;
      return draw();
    }
    // Snap to the nearest plotted time.
    let best = 0;
    all.forEach((t, i) => Math.abs(geometry.X(t) - x) < Math.abs(geometry.X(all[best]) - x) && (best = i));
    hover = best;
    draw();
    showTip(e.clientX);
  };
  canvas.onpointerleave = () => {
    hover = null;
    tip.hidden = true;
    draw();
  };
  canvas.onkeydown = (e) => {
    const all = times();
    if (!all.length) return;
    if (e.key === "Escape") {
      hover = null;
      tip.hidden = true;
      return draw();
    }
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    hover = Math.max(0, Math.min(all.length - 1, (hover ?? (step > 0 ? -1 : all.length)) + step));
    draw();
    const box = canvas.getBoundingClientRect();
    showTip(box.left + geometry.X(all[hover]));
  };
  // A click moves the time bar to the frame nearest that time.
  canvas.onclick = (e) => {
    if (!geometry || timeline.frames.length < 2) return;
    const t = geometry.t0 + ((e.offsetX - geometry.left) / (geometry.right - geometry.left)) * (geometry.t1 - geometry.t0);
    let best = 0;
    timeline.frames.forEach((f, i) => Math.abs(f.seconds - t) < Math.abs(timeline.frames[best].seconds - t) && (best = i));
    timeline.seek(best);
  };
  timeline.addEventListener("change", ({ detail }) => detail.kind === "frame" && draw());
  new ResizeObserver(() => draw()).observe(canvas);

  // ---- legend, table, note -------------------------------------------------------------------------
  function renderTable() {
    if (table.hidden) return;
    const plotted = model.series.filter((s) => model.data.get(s.key)?.values);
    const all = times();
    const head = el("tr", {}, el("th", { textContent: "Elapsed", scope: "col" }), ...plotted.map((s) => el("th", { textContent: seriesName(s) + " (" + unitOf(s) + ")", scope: "col" })));
    const rows = all.map((t) =>
      el(
        "tr",
        {},
        el("th", { textContent: elapsed(t), scope: "row" }),
        ...plotted.map((s) => {
          const d = model.data.get(s.key),
            i = d.seconds.indexOf(t);
          return el("td", { textContent: i < 0 ? "" : fmt(d.values[i]) });
        }),
      ),
    );
    table.replaceChildren(el("table", { className: "record-table" }, el("thead", {}, head), el("tbody", {}, ...rows)));
  }
  function render() {
    const palette = colors();
    legend.replaceChildren(
      ...model.series.map((s) => {
        const key = el("span", { className: "plot-key" });
        key.style.background = palette[s.slot];
        const remove = el("button", { type: "button", className: "plot-remove", ariaLabel: "Remove " + seriesName(s), title: "Remove" });
        remove.textContent = "×";
        remove.onclick = () => model.remove(s.key);
        const d = model.data.get(s.key);
        return el("span", { className: "plot-chip" + (d?.error ? " failed" : ""), title: d?.error || "" }, key, el("span", { textContent: seriesName(s) }), remove);
      }),
    );
    const failed = model.series.filter((s) => model.data.get(s.key)?.error);
    const waiting = model.series.filter((s) => !model.data.has(s.key));
    note.textContent = !model.series.length
      ? "Select objects on the map, choose a variable and add them; or add a system series."
      : failed.length
        ? failed.map((s) => seriesName(s) + ": " + model.data.get(s.key).error).join(" · ")
        : waiting.length
          ? "Reading " + waiting.length + " series…"
          : "";
    for (const b of [csvBtn, pngBtn, tableBtn, clear]) b.disabled = !model.series.length;
    renderTable();
    draw();
  }
  model.addEventListener("change", render);
  place();
  render();
  return {
    /** The time series page (the bottom panel's first tab) and a redraw once it is shown again. */
    page,
    redraw: () => draw(),
    preselect,
    /** Add the selected objects as the chosen variable (the Plot button). */
    addSelected: () => add.onclick(),
    note: (text) => (note.textContent = text),
  };
}
