/**
 * Transect views (E2 increment 4): the card line and cross-section preview of a transect, and its
 * editor dialog (roughness, bank stations, modifiers, station / elevation points). Views only: the
 * model session (model.mjs) checks and stores the values; the editor (editor.mjs) wires them.
 */
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const text = (v) => (v === null || v === undefined ? "" : String(v));
const fmt = (x) => String(+Number(x).toPrecision(6));

/** One line for a transect's card: points, depth and width. */
export function describeTransect(t) {
  if (!t.points.length) return "No points.";
  const xs = t.points.map((p) => p[0]),
    ys = t.points.map((p) => p[1]);
  return (
    t.points.length + " points · " + fmt(Math.max(...ys) - Math.min(...ys)) + " deep · " + fmt(Math.max(...xs) - Math.min(...xs)) + " wide · channel n " + fmt(t.roughness.channel)
  );
}

/** Draw the cross-section: ground line, water-filled below the lower bank top, bank stations dashed. */
export function drawTransect(canvas, t) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width,
    h = canvas.height,
    m = 6;
  ctx.clearRect(0, 0, w, h);
  const pts = t.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length < 2) return;
  const style = getComputedStyle(canvas);
  const ink = style.getPropertyValue("--ink-soft").trim() || "#35516b";
  const primary = style.getPropertyValue("--primary").trim() || "#0071bf";
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  const X = (x) => m + ((x - x0) / (x1 - x0 || 1)) * (w - 2 * m),
    Y = (y) => h - m - ((y - y0) / (y1 - y0 || 1)) * (h - 2 * m);
  // Water up to the lower of the two end elevations (the full-section depth).
  const top = Math.min(pts[0][1], pts[pts.length - 1][1]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, Y(top), w, h);
  ctx.clip();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.lineTo(X(x1), Y(top));
  ctx.lineTo(X(x0), Y(top));
  ctx.closePath();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = primary;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.stroke();
  const { left, right } = t.banks || {};
  if (left || right) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1;
    for (const b of [left, right]) {
      if (!Number.isFinite(b) || b < x0 || b > x1) continue;
      ctx.beginPath();
      ctx.moveTo(X(b), m);
      ctx.lineTo(X(b), h - m);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

/**
 * The transect dialog.
 * @param {object} o
 * @param {object} o.record the transect (model.mjs `transect`)
 * @param {string} o.unitSystem "US" or "SI" (stations and elevations in ft or m)
 */
export function transectEditor({ record, unitSystem, onSave, onCancel }) {
  const unit = unitSystem === "SI" ? "m" : "ft";
  const w = {
    roughness: Object.fromEntries(Object.entries(record.roughness).map(([k, v]) => [k, text(v)])),
    banks: Object.fromEntries(Object.entries(record.banks).map(([k, v]) => [k, text(v)])),
    modifiers: Object.fromEntries(Object.entries(record.modifiers).map(([k, v]) => [k, text(v)])),
    comment: record.comment,
  };
  let rows = record.points.map(([x, y]) => ({ x: text(x), y: text(y) }));
  const message = el("p", { className: "hint record-message", role: "status" });
  const chart = el("canvas", { width: 560, height: 160, className: "record-chart", ariaLabel: "Cross-section of " + record.id });
  const table = el("table", { className: "record-table" });
  const redraw = () =>
    drawTransect(chart, { points: rows.map((r) => [Number(r.x), Number(r.y)]), banks: { left: Number(w.banks.left), right: Number(w.banks.right) } });
  const box = (obj, key, label) => {
    const input = el("input", { value: obj[key], inputMode: "decimal", ariaLabel: label });
    input.oninput = () => {
      obj[key] = input.value;
      redraw();
    };
    return input;
  };
  const field = (caption, input) => el("label", { className: "prop" }, el("span", { textContent: caption }), input);
  const part = (legend, ...fields) => el("fieldset", { className: "quality-part" }, el("legend", { textContent: legend }), ...fields);
  const comment = el("input", { value: w.comment, ariaLabel: "Description" });
  comment.oninput = () => (w.comment = comment.value);
  const settings = el(
    "div",
    { className: "quality-forms" },
    part(
      "Manning's n",
      field("Left overbank", box(w.roughness, "left", "Left overbank n")),
      field("Right overbank", box(w.roughness, "right", "Right overbank n")),
      field("Main channel", box(w.roughness, "channel", "Channel n")),
    ),
    part(
      "Bank stations (" + unit + ")",
      field("Left bank", box(w.banks, "left", "Left bank station")),
      field("Right bank", box(w.banks, "right", "Right bank station")),
      el("p", { className: "hint", textContent: "0 and 0: no overbanks." }),
    ),
    part(
      "Modifiers",
      field("Meander factor", box(w.modifiers, "meander", "Meander factor")),
      field("Station factor", box(w.modifiers, "stationFactor", "Station factor")),
      field("Elevation offset (" + unit + ")", box(w.modifiers, "elevationOffset", "Elevation offset")),
    ),
  );
  const render = () => {
    const body = rows.map((row, i) => {
      const cell = (key, label) => {
        const input = el("input", { value: row[key], inputMode: "decimal", ariaLabel: "Point " + (i + 1) + " " + label });
        input.oninput = () => {
          row[key] = input.value;
          redraw();
        };
        return el("td", {}, input);
      };
      const remove = el("button", { type: "button", className: "link", textContent: "Remove", ariaLabel: "Remove point " + (i + 1) });
      remove.disabled = rows.length <= 2;
      remove.onclick = () => {
        rows.splice(i, 1);
        render();
      };
      return el("tr", {}, cell("x", "station"), cell("y", "elevation"), el("td", {}, remove));
    });
    table.replaceChildren(
      el("thead", {}, el("tr", {}, el("th", { textContent: "Station (" + unit + ")", scope: "col" }), el("th", { textContent: "Elevation (" + unit + ")", scope: "col" }), el("th"))),
      el("tbody", {}, ...body),
    );
    redraw();
  };
  const addRow = el("button", { type: "button", textContent: "Add point" });
  addRow.onclick = () => {
    const last = rows[rows.length - 1];
    rows.push({ x: last ? text(Number(last.x) + 10) : "0", y: last ? last.y : "0" });
    render();
    table.querySelector("tbody tr:last-child input")?.focus();
  };
  // Paste station / elevation pairs from a spreadsheet or an HEC-2 GR row (whitespace, tab, comma).
  const paste = el("textarea", { rows: 4, ariaLabel: "Points to paste", placeholder: "station elevation, one pair per line (or a GR row: elevation station …)" });
  const usePaste = el("button", { type: "button", textContent: "Replace points with these" });
  const pasteBox = el("details", { className: "record-paste" }, el("summary", { textContent: "Paste points" }), paste, usePaste);
  usePaste.onclick = () => {
    const lines = paste.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const next = [];
    for (const line of lines) {
      const tok = line.split(/[\s,;]+/).filter(Boolean);
      if (/^GR$/i.test(tok[0])) for (let k = 1; k + 1 < tok.length; k += 2) next.push({ x: tok[k + 1], y: tok[k] }); // GR: elevation, station
      else if (tok.length >= 2) next.push({ x: tok[0], y: tok[1] });
    }
    if (next.length < 2) {
      message.textContent = "Paste at least two station / elevation pairs.";
      return;
    }
    rows = next;
    render();
    pasteBox.open = false;
  };
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await onSave({ roughness: w.roughness, banks: w.banks, modifiers: w.modifiers, comment: w.comment, points: rows.map((r) => [r.x, r.y]) });
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  render();
  return el(
    "div",
    { className: "record-editor transect-editor" },
    chart,
    settings,
    field("Description", comment),
    el("div", { className: "record-scroll" }, table),
    el("div", { className: "actions" }, addRow, pasteBox),
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}
