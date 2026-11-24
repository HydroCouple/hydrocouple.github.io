/**
 * Water-quality views (E2 increment 3): a land use's buildup and washoff per pollutant, a
 * subcatchment's land-use coverage and initial loadings, and a node's treatment expressions. Views
 * only: the model session (model.mjs) checks and stores the values; the editor (editor.mjs) wires
 * the dialogs.
 */
import { buildupFuncs, washoffFuncs, normalizers } from "./model.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const text = (v) => (v === null || v === undefined ? "" : String(v));
export const buildupNames = { NONE: "None", POW: "Power", EXP: "Exponential", SAT: "Saturation", EXT: "External time series" };
export const washoffNames = { NONE: "None", EXP: "Exponential", RC: "Rating curve", EMC: "Event mean concentration" };
const perNames = { AREA: "Area", CURB: "Curb length" };
/** Initial loading units: mass per area in the model's unit system. */
const loadingUnit = (unitSystem) => (unitSystem === "SI" ? "kg/ha" : "lb/ac");
/** The coefficients a buildup or washoff function uses, with the label each takes. */
const buildupFields = {
  POW: [["c1", "Max. buildup"], ["c2", "Rate constant"], ["c3", "Power"]],
  EXP: [["c1", "Max. buildup"], ["c2", "Rate constant (1/d)"]],
  SAT: [["c1", "Max. buildup"], ["c3", "Half-saturation (d)"]],
  EXT: [["c1", "Max. buildup"], ["c2", "Scaling factor"]],
};
const washoffFields = {
  EXP: [["coeff", "Coefficient"], ["expon", "Exponent"]],
  RC: [["coeff", "Coefficient"], ["expon", "Exponent"]],
  EMC: [["coeff", "Event mean concentration"]],
};

/** One line for a land use's inspector card. */
export function describeLanduse(record) {
  const listed = (part, names) =>
    record.rows
      .filter((r) => r[part].func !== "NONE")
      .map((r) => r.pollutant + " (" + names[r[part].func].toLowerCase() + (part === "buildup" ? " per " + perNames[r.buildup.per].toLowerCase() : "") + ")");
  const b = listed("buildup", buildupNames),
    w = listed("washoff", washoffNames);
  if (!record.rows.length) return "The model has no pollutants; add one for buildup and washoff.";
  return (b.length ? "Buildup: " + b.join(", ") : "No buildup") + " · " + (w.length ? "washoff: " + w.join(", ") : "no washoff") + ".";
}
/** Lines for a subcatchment's land uses and initial loadings. */
export function describeSubQuality(d, units = {}) {
  const used = d.coverages.filter((c) => c.percent > 0);
  const total = used.reduce((s, c) => s + c.percent, 0);
  const loads = d.loadings.filter((l) => l.value > 0);
  return [
    used.length ? "Land uses: " + used.map((c) => c.landuse + " " + +c.percent.toFixed(4) + " %").join(", ") + (used.length > 1 ? " (" + +total.toFixed(4) + " %)" : "") + "." : "No land uses.",
    loads.length ? "Initial loadings: " + loads.map((l) => l.pollutant + " " + l.value + " " + loadingUnit(units.unitSystem)).join(", ") + "." : "No initial loadings.",
  ];
}
/** One line for a node's treatment. */
export function describeTreatment(d) {
  const set = d.rows.filter((r) => r.expression);
  return set.length ? "Treatment: " + set.map((r) => r.pollutant + " " + r.expression).join("; ") + "." : "No treatment.";
}

function select(entries, value, label) {
  const s = el("select", { ariaLabel: label });
  for (const [v, name] of entries) s.add(new Option(name, v));
  s.value = value;
  return s;
}
const actions = (onCancel, onSave, message, collect) => {
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
  return el("div", { className: "actions end" }, cancel, save);
};

/**
 * A land use's buildup and washoff, one pollutant at a time (as the desktop's land use editor).
 * @param {object} o
 * @param {{id: string, rows: object[]}} o.record the land use (model.mjs `landuse`)
 * @param {string[]} o.series time series names (external buildup)
 */
export function landuseEditor({ record, series, onSave, onCancel }) {
  // Working copy: every value as text, so a half-typed number stays as typed.
  const work = record.rows.map((r) => ({
    pollutant: r.pollutant,
    buildup: Object.fromEntries(Object.entries(r.buildup).map(([k, v]) => [k, text(v)])),
    washoff: Object.fromEntries(Object.entries(r.washoff).map(([k, v]) => [k, text(v)])),
  }));
  const pollutant = el("select", { ariaLabel: "Pollutant" });
  const label = (r) => r.pollutant + (r.buildup.func !== "NONE" || r.washoff.func !== "NONE" ? " •" : "");
  const fillPollutants = () => {
    const at = pollutant.value;
    pollutant.replaceChildren(...work.map((r, i) => new Option(label(r), String(i))));
    pollutant.value = at || "0";
  };
  const forms = el("div", { className: "quality-forms" });
  const message = el("p", { className: "hint record-message", role: "status" });
  const field = (part, key, caption, row) => {
    const box = el("input", { value: row[part][key], inputMode: "decimal" });
    box.oninput = () => (row[part][key] = box.value);
    return el("label", { className: "prop" }, el("span", { textContent: caption }), box);
  };
  const render = () => {
    const row = work[Number(pollutant.value)];
    if (!row) {
      forms.replaceChildren(el("p", { className: "hint", textContent: "The model has no pollutants." }));
      return;
    }
    const bFunc = select(buildupFuncs.map((f) => [f, buildupNames[f]]), row.buildup.func, "Buildup function");
    bFunc.onchange = () => {
      row.buildup.func = bFunc.value;
      fillPollutants();
      render();
    };
    const wFunc = select(washoffFuncs.map((f) => [f, washoffNames[f]]), row.washoff.func, "Washoff function");
    wFunc.onchange = () => {
      row.washoff.func = wFunc.value;
      fillPollutants();
      render();
    };
    const buildup = el("fieldset", { className: "quality-part" }, el("legend", { textContent: "Buildup" }), el("label", { className: "prop" }, el("span", { textContent: "Function" }), bFunc));
    for (const [key, caption] of buildupFields[row.buildup.func] || []) buildup.append(field("buildup", key, caption, row));
    if (row.buildup.func === "EXT") {
      const ts = select([["", "(choose)"], ...series.map((n) => [n, n])], row.buildup.series, "Time series");
      ts.onchange = () => (row.buildup.series = ts.value);
      buildup.append(el("label", { className: "prop" }, el("span", { textContent: "Time series" }), ts));
    }
    if (row.buildup.func !== "NONE") {
      const per = select(normalizers.map((n) => [n, perNames[n]]), row.buildup.per, "Buildup per");
      per.onchange = () => (row.buildup.per = per.value);
      buildup.append(el("label", { className: "prop" }, el("span", { textContent: "Per" }), per));
    }
    const washoff = el("fieldset", { className: "quality-part" }, el("legend", { textContent: "Washoff" }), el("label", { className: "prop" }, el("span", { textContent: "Function" }), wFunc));
    for (const [key, caption] of washoffFields[row.washoff.func] || []) washoff.append(field("washoff", key, caption, row));
    if (row.washoff.func !== "NONE")
      washoff.append(field("washoff", "cleaning", "Cleaning efficiency (%)", row), field("washoff", "bmp", "BMP efficiency (%)", row));
    forms.replaceChildren(buildup, washoff);
  };
  pollutant.onchange = render;
  fillPollutants();
  render();
  const collect = () => ({
    id: record.id,
    rows: work.map((r) => ({
      pollutant: r.pollutant,
      buildup: { ...r.buildup, c1: Number(r.buildup.c1), c2: Number(r.buildup.c2), c3: Number(r.buildup.c3) },
      washoff: { ...r.washoff, coeff: Number(r.washoff.coeff), expon: Number(r.washoff.expon), cleaning: Number(r.washoff.cleaning), bmp: Number(r.washoff.bmp) },
    })),
  });
  return el(
    "div",
    { className: "record-editor quality-editor" },
    el("div", { className: "record-head" }, el("label", { className: "inline" }, "Pollutant ", pollutant)),
    el("p", {
      className: "hint",
      textContent:
        "Buildup is mass per unit of area or curb length; washoff removes it with runoff. Pollutants marked • have buildup or washoff on this land use. Each function shows the coefficients it uses.",
    }),
    forms,
    message,
    actions(onCancel, onSave, message, collect),
  );
}

/** A subcatchment's land-use coverage (% of its area) and initial loadings. */
export function subQualityEditor({ data, units = {}, onSave, onCancel }) {
  const cover = data.coverages.map((c) => ({ landuse: c.landuse, percent: text(c.percent) }));
  const loads = data.loadings.map((l) => ({ pollutant: l.pollutant, value: text(l.value) }));
  const total = el("output", { className: "quality-total" });
  const message = el("p", { className: "hint record-message", role: "status" });
  const sum = () => {
    const t = cover.reduce((s, c) => s + (Number(c.percent) || 0), 0);
    total.value = +t.toFixed(6) + " %";
    total.classList.toggle("over", t > 100 + 1e-9);
  };
  const table = (caption, rows, key, nameKey, unit, labelOf) =>
    el(
      "table",
      { className: "record-table compact" },
      el("caption", { textContent: caption }),
      el("tbody", {}, ...rows.map((r) => {
        const box = el("input", { value: r[key], inputMode: "decimal", ariaLabel: labelOf(r[nameKey]) });
        box.oninput = () => {
          r[key] = box.value;
          sum();
        };
        return el("tr", {}, el("th", { scope: "row", textContent: r[nameKey] }), el("td", {}, box), el("td", { className: "unit", textContent: unit }));
      })),
    );
  sum();
  const parts = [];
  if (cover.length)
    parts.push(
      table("Land use coverage", cover, "percent", "landuse", "%", (n) => n + " coverage"),
      el("p", { className: "hint" }, "Total ", total, " of the subcatchment (at most 100 %)."),
    );
  else parts.push(el("p", { className: "hint", textContent: "The model has no land uses." }));
  if (loads.length) parts.push(table("Initial loadings", loads, "value", "pollutant", loadingUnit(units.unitSystem), (n) => n + " initial loading"));
  const collect = () => ({ id: data.id, coverages: cover, loadings: loads });
  return el("div", { className: "record-editor quality-editor" }, ...parts, message, actions(onCancel, onSave, message, collect));
}

/** A node's treatment expressions, one per pollutant, each checked as it is typed. */
export function treatmentEditor({ data, onCheck, onSave, onCancel }) {
  const rows = data.rows.map((r) => ({ pollutant: r.pollutant, expression: r.expression }));
  const verdicts = rows.map(() => el("span", { className: "quality-verdict" }));
  const message = el("p", { className: "hint record-message", role: "status" });
  let timer,
    seq = 0;
  const check = async () => {
    const mine = ++seq;
    const results = await onCheck(rows).catch((e) => rows.map(() => ({ message: e.message })));
    if (mine !== seq) return;
    results.forEach((r, i) => {
      verdicts[i].textContent = rows[i].expression.trim() ? (r.message ? r.message : "Checked") : "";
      verdicts[i].className = "quality-verdict " + (r.message ? "bad" : "ok");
    });
  };
  const body = rows.map((r, i) => {
    const box = el("input", { value: r.expression, ariaLabel: r.pollutant + " treatment", spellcheck: false, className: "quality-expression" });
    box.oninput = () => {
      r.expression = box.value;
      clearTimeout(timer);
      timer = setTimeout(check, 400);
    };
    return el("tr", {}, el("th", { scope: "row", textContent: r.pollutant }), el("td", {}, box, verdicts[i]));
  });
  check();
  return el(
    "div",
    { className: "record-editor quality-editor" },
    el("p", {
      className: "hint",
      textContent:
        "R = removal fraction or C = outlet concentration. Variables: C, R, HRT (hours), DT (seconds), Q (flow), V (volume), D (depth), AREA; a pollutant's name is its concentration and R_name its removal; functions exp, log, ln, sqrt, min, max, abs, sgn, step. Leave a row empty for no treatment.",
    }),
    el("table", { className: "record-table" }, el("tbody", {}, ...body)),
    message,
    actions(onCancel, onSave, message, () => ({ node: data.node, rows })),
  );
}
