/**
 * Inflow views (E2): a node's external, dry-weather and RDII inflows, and the unit hydrograph
 * editor. Views only: the model session (model.mjs) checks the rows against the model and stores
 * them; the editor (editor.mjs) wires the dialogs.
 */
import { inflowTypes, dwfSlots } from "./model.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const FLOW = { CFS: "ft³/s", GPM: "gal/min", MGD: "Mgal/d", CMS: "m³/s", LPS: "L/s", MLD: "ML/d" };
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const RESPONSES = ["Short term", "Medium term", "Long term"];
const text = (v) => (v === null || v === undefined ? "" : String(v));

/** A select over `options`, with "" shown as `none` when given; a value not in the list stays visible. */
function select(options, value, label, none) {
  const s = el("select", { ariaLabel: label });
  if (none !== undefined) s.add(new Option(none, ""));
  for (const o of options) s.add(new Option(o, o));
  if (value && !options.some((o) => o.toUpperCase() === String(value).toUpperCase())) s.add(new Option(value + " (missing)", value));
  s.value = options.find((o) => o.toUpperCase() === String(value).toUpperCase()) ?? value ?? "";
  return s;
}
const input = (value, label, props = {}) => el("input", { value: text(value), ariaLabel: label, inputMode: "decimal", ...props });

/** One line per inflow kind for the node's inspector card. */
export function describeInflows(d, units = {}) {
  const lines = [];
  if (d.external.length)
    lines.push("External: " + d.external.map((r) => r.constituent + (r.series ? " from " + r.series : "") + (r.baseline ? " + " + r.baseline : "")).join(", "));
  if (d.dwf.length) lines.push("Dry weather: " + d.dwf.map((r) => r.constituent + " " + r.average).join(", "));
  if (d.rdii) lines.push("RDII: " + d.rdii.hydrograph + " · " + d.rdii.area + (units.unitSystem === "SI" ? " ha" : " ac"));
  return lines.length ? lines : ["No inflows."];
}

/**
 * The inflows of one node.
 * @param {object} o
 * @param {{node: string, external: object[], dwf: object[], rdii: object|null}} o.data from ModelSession.inflows
 * @param {{constituents: string[], series: string[], patterns: object, hydrographs: string[]}} o.choices
 * @param {{unitSystem: string, flowUnits: string}} o.units
 * @param {(data: object) => Promise<void>} o.onSave rejects with the session's message
 * @param {() => void} o.onCancel
 */
export function inflowsEditor({ data, choices, units, onSave, onCancel }) {
  const d = structuredClone(data);
  const flow = FLOW[units.flowUnits] || units.flowUnits || "flow units";
  const allPatterns = Object.values(choices.patterns).flat();
  const message = el("p", { className: "hint record-message", role: "status" });
  const removeButton = (list, i, redraw, what) => {
    const b = el("button", { type: "button", className: "link", textContent: "Remove", ariaLabel: "Remove " + what + " " + (i + 1) });
    b.onclick = () => {
      list.splice(i, 1);
      redraw();
    };
    return el("td", {}, b);
  };
  const bind = (row, key, control) => {
    control.onchange = control.oninput = () => (row[key] = control.value);
    return el("td", {}, control);
  };

  // External inflows: a time series scaled by the two factors, plus a baseline times a pattern.
  const extTable = el("table", { className: "record-table" });
  const drawExternal = () => {
    extTable.replaceChildren(
      el("thead", {}, el("tr", {}, ...["Constituent", "Time series", "Type", "Conversion factor", "Scale factor", "Baseline", "Baseline pattern", ""].map((h) => el("th", { textContent: h, scope: "col" })))),
      el(
        "tbody",
        {},
        ...d.external.map((r, i) => {
          const type = select(inflowTypes, r.type, "External inflow " + (i + 1) + " type");
          const constituent = select(choices.constituents, r.constituent, "External inflow " + (i + 1) + " constituent");
          const sync = () => {
            type.disabled = constituent.value.toUpperCase() === "FLOW";
            if (type.disabled) type.value = r.type = "FLOW";
            else if (type.value === "FLOW") type.value = r.type = "CONCEN";
          };
          const cells = [
            bind(r, "constituent", constituent),
            bind(r, "series", select(choices.series, r.series, "External inflow " + (i + 1) + " time series", "—")),
            bind(r, "type", type),
            bind(r, "mFactor", input(r.mFactor, "External inflow " + (i + 1) + " conversion factor")),
            bind(r, "sFactor", input(r.sFactor, "External inflow " + (i + 1) + " scale factor")),
            bind(r, "baseline", input(r.baseline, "External inflow " + (i + 1) + " baseline")),
            bind(r, "pattern", select(allPatterns, r.pattern, "External inflow " + (i + 1) + " baseline pattern", "—")),
            removeButton(d.external, i, drawExternal, "external inflow"),
          ];
          const onConstituent = constituent.onchange;
          constituent.onchange = () => {
            onConstituent();
            sync();
          };
          sync();
          return el("tr", {}, ...cells);
        }),
      ),
    );
  };
  const addExternal = el("button", { type: "button", textContent: "Add external inflow" });
  addExternal.onclick = () => {
    const used = new Set(d.external.map((r) => r.constituent.toUpperCase()));
    const constituent = choices.constituents.find((c) => !used.has(c.toUpperCase())) ?? "FLOW";
    d.external.push({ constituent, series: "", type: constituent === "FLOW" ? "FLOW" : "CONCEN", mFactor: 1, sFactor: 1, baseline: 0, pattern: "" });
    drawExternal();
  };

  // Dry-weather inflow: an average value times up to four patterns (each slot takes its own type).
  const dwfTable = el("table", { className: "record-table" });
  const drawDwf = () => {
    dwfTable.replaceChildren(
      el("thead", {}, el("tr", {}, ...["Constituent", "Average value", "Monthly", "Daily", "Hourly", "Weekend", ""].map((h) => el("th", { textContent: h, scope: "col" })))),
      el(
        "tbody",
        {},
        ...d.dwf.map((r, i) =>
          el(
            "tr",
            {},
            bind(r, "constituent", select(choices.constituents, r.constituent, "Dry-weather inflow " + (i + 1) + " constituent")),
            bind(r, "average", input(r.average, "Dry-weather inflow " + (i + 1) + " average value")),
            ...dwfSlots.map((slot) => bind(r, slot, select(choices.patterns[slot.toUpperCase()], r[slot], "Dry-weather inflow " + (i + 1) + " " + slot + " pattern", "—"))),
            removeButton(d.dwf, i, drawDwf, "dry-weather inflow"),
          ),
        ),
      ),
    );
  };
  const addDwf = el("button", { type: "button", textContent: "Add dry-weather inflow" });
  addDwf.onclick = () => {
    const used = new Set(d.dwf.map((r) => r.constituent.toUpperCase()));
    d.dwf.push({ constituent: choices.constituents.find((c) => !used.has(c.toUpperCase())) ?? "FLOW", average: 0, monthly: "", daily: "", hourly: "", weekend: "" });
    drawDwf();
  };

  // RDII: one unit hydrograph group and the sewershed area it applies to.
  const rdii = d.rdii ?? { hydrograph: "", area: "" };
  const uh = select(choices.hydrographs, rdii.hydrograph, "Unit hydrograph", "— none —");
  const area = input(rdii.area, "Sewershed area");
  uh.onchange = () => (rdii.hydrograph = uh.value);
  area.oninput = () => (rdii.area = area.value);

  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await onSave({ external: d.external, dwf: d.dwf, rdii: rdii.hydrograph ? rdii : null });
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  drawExternal();
  drawDwf();
  return el(
    "div",
    { className: "record-editor inflows-editor" },
    el("h3", { textContent: "External inflows" }),
    el("p", { className: "hint", textContent: `Each row adds its time series × conversion factor × scale factor, plus the baseline × its pattern. Flow is in ${flow}; a pollutant row is a concentration (CONCEN) or a mass flow (MASS).` }),
    el("div", { className: "record-scroll" }, extTable),
    el("div", { className: "actions" }, addExternal),
    el("h3", { textContent: "Dry-weather inflow" }),
    el("p", { className: "hint", textContent: `The average value (${flow} for flow) times the monthly, daily, hourly and weekend patterns chosen.` }),
    el("div", { className: "record-scroll" }, dwfTable),
    el("div", { className: "actions" }, addDwf),
    el("h3", { textContent: "Rainfall-dependent infiltration and inflow (RDII)" }),
    el(
      "div",
      { className: "fields" },
      el("label", {}, "Unit hydrograph", uh),
      el("label", {}, "Sewershed area (" + (units.unitSystem === "SI" ? "hectares" : "acres") + ")", area),
    ),
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}

/** Unit hydrograph ordinates (per unit of rain) of up to three triangular responses, over `n` steps. */
export function hydrographCurve(rows, n = 120) {
  const tri = rows.filter((r) => r && r.t > 0 && r.r >= 0).map((r) => ({ ...r, base: r.t * (1 + r.k) }));
  const end = Math.max(0, ...tri.map((r) => r.base));
  if (!end) return [];
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = (end * i) / n;
    let y = 0;
    for (const r of tri) {
      const peak = (2 * r.r) / r.base;
      if (x <= r.t) y += (peak * x) / r.t;
      else if (x <= r.base) y += (peak * (r.base - x)) / (r.base - r.t);
    }
    return [x, y];
  });
}
/** Responses of one month of a unit hydrograph record, in short/medium/long order. */
export const monthRows = (record, month) => [0, 1, 2].map((resp) => record.entries.find((e) => e.month === month && e.response === resp) || null);
export function describeHydrograph(r) {
  const months = [...new Set(r.entries.map((e) => e.month))].sort((a, b) => a - b).map((m) => (m < 0 ? "all months" : MONTHS[m]));
  return "Rain gage " + (r.gage || "—") + " · " + (r.entries.length ? r.entries.length + " response" + (r.entries.length > 1 ? "s" : "") + " · " + months.join(", ") : "no responses yet");
}

/**
 * The unit hydrograph editor: its rain gage and, per month (or all months), R, T, K and the initial
 * abstraction (Dmax, Drecov, Dinit) of the short, medium and long term responses.
 */
export function hydrographEditor({ record, gages, draw, onSave, onCancel }) {
  const gage = select(gages, record.gage, "Rain gage");
  const month = el("select", { ariaLabel: "Month" });
  const keys = ["r", "t", "k", "dmax", "drecov", "dinit"];
  // Working rows: month → three responses of text cells ("" r/t/k = no response).
  const work = new Map();
  for (const m of [-1, ...MONTHS.keys()])
    work.set(
      m,
      monthRows(record, m).map((e) => Object.fromEntries(keys.map((k) => [k, e ? String(e[k]) : ""]))),
    );
  const filled = (m) => work.get(m).some((row) => row.r !== "" || row.t !== "" || row.k !== "");
  const label = (m) => (m < 0 ? "All months" : MONTHS[m]) + (filled(m) ? " •" : "");
  const fillMonths = () => {
    const at = month.value;
    month.replaceChildren(...[-1, ...MONTHS.keys()].map((m) => new Option(label(m), String(m))));
    month.value = at || "-1";
  };
  const chart = el("canvas", { width: 560, height: 150, className: "record-chart" });
  const table = el("table", { className: "record-table compact" });
  const message = el("p", { className: "hint record-message", role: "status" });
  const parse = (row) => {
    if (row.r === "" && row.t === "" && row.k === "") return null;
    const v = Object.fromEntries(keys.map((k) => [k, row[k] === "" && !["r", "t", "k"].includes(k) ? 0 : Number(row[k])]));
    if (!keys.every((k) => Number.isFinite(v[k]) && v[k] >= 0)) throw new Error("R, T, K and the initial abstraction values are numbers of zero or more; leave R, T and K empty for no response.");
    return v;
  };
  const redraw = () => {
    try {
      draw(chart, hydrographCurve(work.get(Number(month.value)).map(parse)));
      message.textContent = "";
    } catch (e) {
      message.textContent = e.message;
    }
  };
  const render = () => {
    const rows = work.get(Number(month.value));
    table.replaceChildren(
      el("thead", {}, el("tr", {}, ...["Response", "R", "T (h)", "K", "Dmax", "Drecov (1/d)", "Dinit"].map((h) => el("th", { textContent: h, scope: "col" })))),
      el(
        "tbody",
        {},
        ...rows.map((row, i) =>
          el(
            "tr",
            {},
            el("th", { textContent: RESPONSES[i], scope: "row" }),
            ...keys.map((k) => {
              const c = input(row[k], RESPONSES[i] + " " + k.toUpperCase());
              c.oninput = () => {
                row[k] = c.value;
                fillMonths();
                redraw();
              };
              return el("td", {}, c);
            }),
          ),
        ),
      ),
    );
    redraw();
  };
  month.onchange = render;
  fillMonths();
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    let entries;
    try {
      entries = [];
      for (const [m, rows] of work)
        rows.forEach((row, response) => {
          const v = parse(row);
          if (v) entries.push({ month: m, response, ...v });
        });
    } catch (e) {
      message.textContent = e.message;
      return;
    }
    save.disabled = true;
    try {
      await onSave({ gage: gage.value, entries });
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  render();
  return el(
    "div",
    { className: "record-editor" },
    el("div", { className: "record-head" }, el("label", { className: "inline" }, "Rain gage ", gage), el("label", { className: "inline" }, "Month ", month)),
    el("p", {
      className: "hint",
      textContent: "R is the fraction of rain that becomes RDII, T the time to peak in hours, K the recession-to-peak ratio. A month's rows replace the all-months rows for that month; months marked • have their own.",
    }),
    chart,
    el("div", { className: "record-scroll" }, table),
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}
