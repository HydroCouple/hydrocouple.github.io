/**
 * Record editor views (E2): the table of a time series, curve or pattern with a chart preview, and
 * the summary card the inspector shows for one record. Views only: the model session (model.mjs,
 * in the editing worker) owns and validates the records; the editor (editor.mjs) wires them.
 *
 * Time series x values are SWMM DateTimes (days since 1899-12-30). SWMM dates are the model's wall
 * clock with no time zone, so dates and times are handled as UTC text and never converted.
 */
const DAY = 86400;
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const pad = (n, w = 2) => String(n).padStart(w, "0");

/** A SWMM DateTime as `{ date: "YYYY-MM-DD", time: "HH:MM:SS[.sss]" }`. */
export function fromDays(x) {
  let days = Math.floor(x);
  let ms = Math.round((x - days) * DAY * 1000);
  if (ms >= DAY * 1000) {
    days += 1;
    ms -= DAY * 1000;
  }
  const d = new Date((days - 25569) * DAY * 1000);
  const s = Math.floor(ms / 1000);
  const rest = ms % 1000;
  return {
    date: d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()),
    time: pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60) + (rest ? "." + pad(rest, 3) : ""),
  };
}
/** Seconds of "H:MM[:SS[.fff]]" (elapsed or time of day); NaN when malformed. */
export function seconds(text) {
  const m = String(text).trim().match(/^(\d+):([0-5]?\d)(?::([0-5]?\d(?:\.\d+)?))?$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  const hours = String(text).trim().match(/^\d+(?:\.\d+)?$/) ? Number(text) : NaN; // decimal hours, as SWMM reads them
  return hours * 3600;
}
/** "YYYY-MM-DD" + "HH:MM[:SS]" → SWMM DateTime: whole days plus the time of day, as the engine encodes them. */
export function toDays(date, time) {
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const s = seconds(time);
  if (!m || !Number.isFinite(s)) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / (DAY * 1000) + 25569 + s / DAY;
}
/** Elapsed seconds as "H:MM:SS[.sss]". */
export function elapsedText(secs) {
  const ms = Math.round(secs * 1000);
  const s = Math.floor(ms / 1000);
  const rest = ms % 1000;
  return Math.floor(s / 3600) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60) + (rest ? "." + pad(rest, 3) : "");
}
const number = (v) => (Number.isFinite(v) ? String(v) : "");

/** Factor labels per pattern type. */
const HOURS = Array.from({ length: 24 }, (_, h) => (h % 12 || 12) + (h < 12 ? " AM" : " PM"));
export const patternLabels = {
  MONTHLY: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  DAILY: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  HOURLY: HOURS,
  WEEKEND: HOURS,
};
export const curveTypes = ["STORAGE", "DIVERSION", "RATING", "SHAPE", "CONTROL", "TIDAL", "PUMP1", "PUMP2", "PUMP3", "PUMP4", "PUMP5"];
const curveTitle = (t) => (t.startsWith("PUMP") ? "Pump type " + t.slice(4) : t[0] + t.slice(1).toLowerCase());
const FLOW = { CFS: "ft³/s", GPM: "gal/min", MGD: "Mgal/d", CMS: "m³/s", LPS: "L/s", MLD: "ML/d" };
/** X and Y column headings of a curve type in the model's units. */
export function curveAxes(type, units = {}) {
  const si = units.unitSystem === "SI";
  const L = si ? "m" : "ft",
    Q = FLOW[units.flowUnits] || (si ? "m³/s" : "ft³/s");
  return (
    {
      STORAGE: [`Depth (${L})`, `Area (${L}²)`],
      DIVERSION: [`Inflow (${Q})`, `Diverted flow (${Q})`],
      RATING: [`Head (${L})`, `Outflow (${Q})`],
      SHAPE: ["Depth / full depth", "Width / full depth"],
      CONTROL: ["Control variable", "Setting"],
      TIDAL: ["Hour of day", `Stage (${L})`],
      PUMP1: [`Volume (${L}³)`, `Flow (${Q})`],
      PUMP2: [`Depth (${L})`, `Flow (${Q})`],
      PUMP3: [`Head (${L})`, `Flow (${Q})`],
      PUMP4: [`Depth (${L})`, `Flow (${Q})`],
      PUMP5: [`Head (${L})`, `Flow (${Q})`],
    }[type] || ["X", "Y"]
  );
}

/** Draw a record's values: a line through the points, or bars for pattern factors. */
export function drawRecord(canvas, record) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width,
    h = canvas.height,
    m = 6;
  ctx.clearRect(0, 0, w, h);
  const style = getComputedStyle(canvas);
  ctx.strokeStyle = ctx.fillStyle = style.getPropertyValue("--primary").trim() || "#0071bf";
  const pts = record.kind === "pattern" ? record.factors.map((f, i) => [i, f]) : record.points;
  if (!pts.length) return;
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(0, ...ys),
    y1 = Math.max(...ys);
  const X = (x) => m + ((x - x0) / (x1 - x0 || 1)) * (w - 2 * m),
    Y = (y) => h - m - ((y - y0) / (y1 - y0 || 1)) * (h - 2 * m);
  if (record.kind === "pattern") {
    const bw = (w - 2 * m) / pts.length;
    ctx.globalAlpha = 0.7;
    for (const [i, f] of pts) ctx.fillRect(m + i * bw + 1, Y(f), Math.max(1, bw - 2), Y(y0) - Y(f));
    ctx.globalAlpha = 1;
    return;
  }
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.stroke();
  if (pts.length === 1) ctx.fillRect(X(pts[0][0]) - 2, Y(pts[0][1]) - 2, 4, 4);
}

/** One line describing a record's extent, for the inspector card. */
export function describeRecord(r) {
  if (r.kind === "pattern") return r.type[0] + r.type.slice(1).toLowerCase() + " pattern · " + r.factors.length + " factors";
  const n = r.points.length + " row" + (r.points.length === 1 ? "" : "s");
  if (r.kind === "curve") return curveTitle(r.type) + " curve · " + n;
  if (r.file) return "values from " + r.file;
  if (!r.points.length) return "no rows";
  const at = (i) => {
    if (i < r.relative.count) return elapsedText((r.points[i][0] - r.relative.anchor) * DAY) + " elapsed";
    const t = fromDays(r.points[i][0]);
    return t.date + " " + t.time.slice(0, 5);
  };
  return n + " · " + at(0) + (r.points.length > 1 ? " → " + at(r.points.length - 1) : "");
}

/**
 * The record editor: rows, paste, chart and the engine's validation message.
 * @param {object} o
 * @param {object} o.record from ModelSession.record
 * @param {{unitSystem: string, flowUnits: string}} o.units
 * @param {(data: object) => Promise<object>} o.onSave stores the rows; rejects with the engine's message
 * @param {() => void} o.onCancel
 */
export function recordEditor({ record, units, onSave, onCancel }) {
  const r = structuredClone(record);
  const box = el("div", { className: "record-editor" });
  const message = el("p", { className: "hint record-message", role: "status" });
  const chart = el("canvas", { width: 560, height: 150, className: "record-chart" });
  const table = el("table", { className: "record-table" });
  const head = el("div", { className: "record-head" });
  // Row models: the text shown, and for time series the original x kept while the text is unchanged.
  let rows;
  if (r.kind === "pattern") rows = r.factors.map((f) => ({ y: number(f) }));
  else if (r.kind === "curve") rows = r.points.map(([x, y]) => ({ x: number(x), y: number(y) }));
  else
    rows = r.points.map(([x, y], i) => {
      if (i < r.relative.count) {
        const text = elapsedText((x - r.relative.anchor) * DAY);
        return { relative: true, elapsed: text, y: number(y), x0: x, k0: text };
      }
      const t = fromDays(x);
      return { relative: false, date: t.date, time: t.time, y: number(y), x0: x, k0: t.date + " " + t.time };
    });

  // Elapsed rows count from the series' anchor, or from the model's start when it had none.
  const anchor = r.kind === "timeseries" ? (r.relative.count ? r.relative.anchor : r.start) : 0;
  const typeSelect = el("select", { ariaLabel: r.kind === "curve" ? "Curve type" : "Pattern type" });
  if (r.kind === "curve") {
    const types = curveTypes.includes(r.type) ? curveTypes : [...curveTypes, r.type];
    for (const t of types) typeSelect.add(new Option(curveTitle(t), t));
    typeSelect.value = r.type;
    head.append(el("label", { className: "inline" }, "Curve type ", typeSelect));
  } else if (r.kind === "pattern") {
    for (const t of Object.keys(patternLabels)) typeSelect.add(new Option(t[0] + t.slice(1).toLowerCase(), t));
    typeSelect.value = r.type;
    head.append(el("label", { className: "inline" }, "Pattern type ", typeSelect));
  } else {
    head.append(
      el("p", {
        className: "hint",
        textContent: r.relative.count
          ? "Times are elapsed from the start of the simulation (h:mm:ss)."
          : "Dates and times are the model's clock; no time zone applies.",
      }),
    );
  }
  typeSelect.onchange = () => {
    if (r.kind === "pattern") {
      const n = patternLabels[typeSelect.value].length;
      rows = Array.from({ length: n }, (_, i) => rows[i] || { y: "1" });
    }
    render();
  };

  /** The record as the rows now stand; throws with a message when a cell is not a number or time. */
  const collect = () => {
    if (r.kind === "pattern") return { type: typeSelect.value, factors: rows.map((row) => Number(row.y)) };
    const points = rows.map((row, i) => {
      const y = Number(row.y);
      if (row.y.trim() === "" || !Number.isFinite(y)) throw new Error("Row " + (i + 1) + ": enter a number.");
      if (r.kind === "curve") {
        const x = Number(row.x);
        if (row.x.trim() === "" || !Number.isFinite(x)) throw new Error("Row " + (i + 1) + ": enter a number.");
        return [x, y];
      }
      if (row.relative && i && !rows[i - 1].relative) throw new Error("Row " + (i + 1) + ": elapsed-time rows come before dated rows.");
      const key = row.relative ? row.elapsed : row.date + " " + row.time;
      let x = row.x0;
      if (key !== row.k0) x = row.relative ? anchor + seconds(row.elapsed) / DAY : toDays(row.date, row.time);
      if (!Number.isFinite(x)) throw new Error("Row " + (i + 1) + (row.relative ? ": enter elapsed time as h:mm or h:mm:ss." : ": enter a date and a time."));
      return [x, y];
    });
    const data = { type: r.kind === "curve" ? typeSelect.value : r.type, points };
    if (r.kind === "timeseries") data.relative = { count: rows.filter((row) => row.relative).length, anchor };
    return data;
  };
  const redraw = () => {
    try {
      const data = collect();
      drawRecord(chart, { kind: r.kind, points: data.points || [], factors: data.factors || [] });
      message.textContent = "";
    } catch (e) {
      message.textContent = e.message;
    }
  };
  const cell = (row, key, props = {}) => {
    const input = el("input", { value: row[key] ?? "", ...props });
    input.oninput = () => {
      row[key] = input.value;
      redraw();
    };
    return el("td", {}, input);
  };
  const render = () => {
    let heads;
    if (r.kind === "pattern") heads = ["", "Factor"];
    else if (r.kind === "curve") heads = curveAxes(typeSelect.value, units);
    else heads = r.relative.count ? ["Elapsed", "Value"] : ["Date", "Time", "Value"];
    const mixed = r.kind === "timeseries" && rows.some((row) => row.relative) && rows.some((row) => !row.relative);
    if (mixed) heads = ["Date or elapsed", "Time", "Value"];
    const body = rows.map((row, i) => {
      const tr = el("tr");
      if (r.kind === "pattern") tr.append(el("th", { textContent: patternLabels[typeSelect.value][i], scope: "row" }), cell(row, "y", { inputMode: "decimal", ariaLabel: "Factor " + (i + 1) }));
      else if (r.kind === "curve") tr.append(cell(row, "x", { inputMode: "decimal", ariaLabel: "Row " + (i + 1) + " x" }), cell(row, "y", { inputMode: "decimal", ariaLabel: "Row " + (i + 1) + " y" }));
      else if (row.relative) {
        tr.append(cell(row, "elapsed", { ariaLabel: "Row " + (i + 1) + " elapsed time", placeholder: "h:mm" }));
        if (mixed) tr.append(el("td"));
        tr.append(cell(row, "y", { inputMode: "decimal", ariaLabel: "Row " + (i + 1) + " value" }));
      } else
        tr.append(
          cell(row, "date", { type: "date", ariaLabel: "Row " + (i + 1) + " date" }),
          cell(row, "time", { type: "time", step: "1", ariaLabel: "Row " + (i + 1) + " time" }),
          cell(row, "y", { inputMode: "decimal", ariaLabel: "Row " + (i + 1) + " value" }),
        );
      if (r.kind !== "pattern") {
        const remove = el("button", { type: "button", className: "link", textContent: "Remove", ariaLabel: "Remove row " + (i + 1) });
        remove.disabled = rows.length === 1;
        remove.onclick = () => {
          rows.splice(i, 1);
          render();
        };
        tr.append(el("td", {}, remove));
      }
      return tr;
    });
    table.replaceChildren(el("thead", {}, el("tr", {}, ...heads.map((h) => el("th", { textContent: h, scope: "col" })), ...(r.kind === "pattern" ? [] : [el("th")]))), el("tbody", {}, ...body));
    redraw();
  };

  // A new row continues the last one: one more step of its interval, or an hour.
  const addRow = el("button", { type: "button", textContent: "Add row" });
  addRow.onclick = () => {
    const last = rows[rows.length - 1];
    if (r.kind === "curve") rows.push({ x: "", y: "" });
    else if (last?.relative) {
      const prev = rows[rows.length - 2];
      const step = prev?.relative ? seconds(last.elapsed) - seconds(prev.elapsed) : 3600;
      rows.push({ relative: true, elapsed: elapsedText(seconds(last.elapsed) + (step > 0 ? step : 3600)), y: last.y, x0: NaN, k0: null });
    } else {
      const prev = rows[rows.length - 2];
      const lx = toDays(last.date, last.time);
      const step = prev && !prev.relative ? lx - toDays(prev.date, prev.time) : 1 / 24;
      const t = fromDays(lx + (step > 0 ? step : 1 / 24));
      rows.push({ relative: false, date: t.date, time: t.time, y: last.y, x0: NaN, k0: null });
    }
    render();
    table.querySelector("tbody tr:last-child input")?.focus();
  };

  // Paste rows from a spreadsheet or a deck: whitespace, tab, comma or semicolon separated.
  const paste = el("textarea", { rows: 5, ariaLabel: "Rows to paste", placeholder: pasteHint(r) });
  const usePaste = el("button", { type: "button", textContent: "Replace rows with these" });
  const pasteBox = el("details", { className: "record-paste" }, el("summary", { textContent: "Paste rows" }), paste, usePaste);
  usePaste.onclick = () => {
    try {
      rows = parseRows(paste.value, r, typeSelect.value);
      render();
      pasteBox.open = false;
    } catch (e) {
      message.textContent = e.message;
    }
  };

  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    let data;
    try {
      data = collect();
    } catch (e) {
      message.textContent = e.message;
      return;
    }
    save.disabled = true;
    try {
      await onSave(data);
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  render();
  box.append(
    head,
    chart,
    el("div", { className: "record-scroll" }, table),
    el("div", { className: "actions" }, ...(r.kind === "pattern" ? [] : [addRow]), pasteBox),
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
  return box;
}
function pasteHint(r) {
  if (r.kind === "pattern") return "Factors, in order (1.0 0.9 …)";
  if (r.kind === "curve") return "x y per line";
  return r.relative.count ? "h:mm value per line" : "date time value per line (MM/DD/YYYY or YYYY-MM-DD)";
}
/** Rows from pasted text in the form the record uses. */
function parseRows(text, r, type) {
  const lines = text.split(/\r?\n/).map((l) => l.split(";")[0].trim()).filter(Boolean);
  if (r.kind === "pattern") {
    const factors = lines.join(" ").split(/[\s,]+/).filter(Boolean);
    if (factors.length !== patternLabels[type].length) throw new Error(`A ${type.toLowerCase()} pattern has ${patternLabels[type].length} factors; found ${factors.length}.`);
    return factors.map((y) => ({ y }));
  }
  if (!lines.length) throw new Error("Paste at least one row.");
  return lines.map((line, i) => {
    const t = line.split(/[\s,\t]+/).filter(Boolean);
    if (r.kind === "curve") {
      if (t.length < 2) throw new Error("Line " + (i + 1) + ": expected x and y.");
      return { x: t[t.length - 2], y: t[t.length - 1] };
    }
    if (t.length === 2) {
      if (!Number.isFinite(seconds(t[0]))) throw new Error("Line " + (i + 1) + ": expected elapsed time and a value.");
      return { relative: true, elapsed: elapsedText(seconds(t[0])), y: t[1], x0: NaN, k0: null };
    }
    const us = t[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const date = us ? us[3] + "-" + pad(us[1]) + "-" + pad(us[2]) : t[0];
    if (t.length < 3 || !Number.isFinite(toDays(date, t[1]))) throw new Error("Line " + (i + 1) + ": expected a date, a time and a value.");
    return { relative: false, date, time: t[1].length === 5 ? t[1] + ":00" : t[1], y: t[2], x0: NaN, k0: null };
  });
}
