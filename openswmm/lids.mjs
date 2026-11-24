/**
 * LID views (E2 increment 4): a LID control's type, layers and underdrain removals, and a
 * subcatchment's LID placements. Views only: the model session (model.mjs) checks and stores the
 * values; the editor (editor.mjs) wires the dialogs.
 */
import { lidTypes, lidLayers } from "./model.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const text = (v) => (v === null || v === undefined ? "" : String(v));
const fmt = (x) => String(+Number(x).toPrecision(6));
export const lidNames = {
  BC: "Bio-retention cell",
  RG: "Rain garden",
  GR: "Green roof",
  IT: "Infiltration trench",
  PP: "Permeable pavement",
  RB: "Rain barrel",
  RD: "Rooftop disconnection",
  VS: "Vegetative swale",
  NODE: "Node LID stack",
};
const layerNames = { surface: "Surface", pavement: "Pavement", soil: "Soil", storage: "Storage", drain: "Drain", drainmat: "Drainage mat" };
/** Fields per layer: [key, label, unit kind] (len: in or mm, rate: in/hr or mm/hr). */
function layerFields(name, type) {
  return {
    surface: [
      ["storage", "Berm height", "len"],
      ["vegetation", "Vegetation volume fraction"],
      ["roughness", "Surface roughness (Manning n)"],
      ["slope", "Surface slope (%)"],
      ...(type === "VS" ? [["sideSlope", "Swale side slope (run/rise)"]] : []),
    ],
    pavement: [
      ["thick", "Thickness", "len"],
      ["voidRatio", "Void ratio (voids/solids)"],
      ["fracImperv", "Impervious surface fraction"],
      ["ksat", "Permeability", "rate"],
      ["clogFactor", "Clogging factor"],
      ["regenDays", "Regeneration interval (days)"],
      ["regenDegree", "Regeneration fraction"],
    ],
    soil: [
      ["thick", "Thickness", "len"],
      ["porosity", "Porosity (volume fraction)"],
      ["fc", "Field capacity (volume fraction)"],
      ["wp", "Wilting point (volume fraction)"],
      ["ksat", "Conductivity", "rate"],
      ["kslope", "Conductivity slope"],
      ["suction", "Suction head", "len"],
    ],
    storage: [
      ["thick", type === "RB" ? "Barrel height" : "Thickness", "len"],
      ["voidFrac", "Void ratio (voids/solids)"],
      ["ksat", "Seepage rate", "rate"],
      ["clogging", "Clogging factor"],
    ],
    drain: [
      ["coeff", "Flow coefficient"],
      ["expon", "Flow exponent"],
      ["offset", "Offset", "len"],
      ["delay", "Drain delay (hours)"],
      ["open", "Open level", "len"],
      ["close", "Closed level", "len"],
    ],
    drainmat: [
      ["thick", "Thickness", "len"],
      ["voidFrac", "Void fraction"],
      ["roughness", "Roughness (Manning n)"],
    ],
  }[name];
}
const unitsOf = (unitSystem) => (unitSystem === "SI" ? { len: "mm", rate: "mm/hr", area: "m²", width: "m" } : { len: "in", rate: "in/hr", area: "ft²", width: "ft" });

/** One line for a LID control's card. */
export function describeLid(r) {
  const layers = (lidLayers[r.type] || []).map((n) => layerNames[n].toLowerCase());
  return lidNames[r.type] + (layers.length ? " · " + layers.join(", ") : "") + ".";
}
/** Lines for a subcatchment's LID placements. */
export function describeLidUsage(d, unitSystem) {
  const u = unitsOf(unitSystem);
  if (!d.rows.length) return ["No LID controls placed."];
  const total = d.rows.reduce((t, r) => t + r.number * r.area, 0);
  return ["LID controls: " + d.rows.map((r) => r.lid + " × " + r.number).join(", ") + " (" + fmt(total) + " " + u.area + ")."];
}

/**
 * A LID control's type, layers and removals.
 * @param {object} o
 * @param {object} o.record the control (model.mjs `lid`)
 * @param {object} o.defaults starting layer values for a type change (model.mjs `lidDefaults`)
 */
export function lidEditor({ record, defaults, unitSystem, onSave, onCancel }) {
  const u = unitsOf(unitSystem);
  let type = record.type;
  // Working layers: the control's own, or the starting values of a layer a new type adds.
  const work = {};
  const layer = (name) => (work[name] ??= Object.fromEntries(Object.entries(record.layers[name] || defaults[name]).map(([k, v]) => [k, typeof v === "boolean" ? v : text(v)])));
  const removals = record.removals.map((r) => ({ pollutant: r.pollutant, percent: text(r.percent) }));
  const message = el("p", { className: "hint record-message", role: "status" });
  const forms = el("div", { className: "quality-forms" });
  const typeSelect = el("select", { ariaLabel: "LID type" });
  for (const t of lidTypes) typeSelect.add(new Option(lidNames[t], t));
  typeSelect.value = type;
  typeSelect.disabled = record.uses > 0;
  typeSelect.onchange = () => {
    type = typeSelect.value;
    render();
  };
  const render = () => {
    const parts = lidLayers[type].map((name) => {
      const values = layer(name);
      const box = el("fieldset", { className: "quality-part" }, el("legend", { textContent: layerNames[name] }));
      for (const [key, caption, kind] of layerFields(name, type)) {
        const plain = caption.replace(/ \(.*\)$/, "");
        const aria = plain.toLowerCase().startsWith(layerNames[name].toLowerCase()) ? plain : layerNames[name] + " " + plain.toLowerCase();
        const input = el("input", { value: values[key], inputMode: "decimal", ariaLabel: aria });
        input.oninput = () => (values[key] = input.value);
        box.append(el("label", { className: "prop" }, el("span", { textContent: caption + (kind ? " (" + u[kind] + ")" : "") }), input));
      }
      if (name === "storage" && type === "RB") {
        const covered = el("input", { type: "checkbox", checked: !!values.covered, ariaLabel: "Barrel covered" });
        covered.onchange = () => (values.covered = covered.checked);
        box.append(el("label", { className: "check" }, covered, el("span", { textContent: "Covered (rain does not fall in)" })));
      }
      if (name === "drain" && values.curve) box.append(el("p", { className: "hint", textContent: "Control curve " + values.curve + " (kept; change it in Edit INP)." }));
      return box;
    });
    if (lidLayers[type].includes("drain") && removals.length) {
      const box = el("fieldset", { className: "quality-part" }, el("legend", { textContent: "Underdrain removal (%)" }));
      for (const r of removals) {
        const input = el("input", { value: r.percent, inputMode: "decimal", ariaLabel: r.pollutant + " removal" });
        input.oninput = () => (r.percent = input.value);
        box.append(el("label", { className: "prop" }, el("span", { textContent: r.pollutant }), input));
      }
      parts.push(box);
    }
    forms.replaceChildren(...parts);
  };
  render();
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await onSave({ type, layers: Object.fromEntries(lidLayers[type].map((n) => [n, layer(n)])), removals });
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  return el(
    "div",
    { className: "record-editor quality-editor lid-editor" },
    el("label", { className: "prop lid-type", title: record.uses ? "A LID control in use keeps its type." : "" }, el("span", { textContent: "Type" }), typeSelect),
    forms,
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}

/**
 * A subcatchment's LID placements as a table.
 * @param {object} o
 * @param {object} o.data the placements (model.mjs `lidUsage`)
 * @param {string[]} o.lids LID control names
 * @param {string[]} o.drains subcatchment and node names an underdrain may flow to
 */
export function lidUsageEditor({ data, lids, drains, unitSystem, onSave, onCancel }) {
  const u = unitsOf(unitSystem);
  const rows = data.rows.map((r) => ({ ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "boolean" ? v : text(v)])) }));
  const message = el("p", { className: "hint record-message", role: "status" });
  const total = el("p", { className: "hint", role: "status" });
  const table = el("table", { className: "record-table lid-usage" });
  const sqft = unitSystem === "SI" ? 10000 : 43560;
  const recount = () => {
    const covered = rows.reduce((t, r) => t + Number(r.number) * Number(r.area), 0);
    total.textContent =
      "LID units cover " + (Number.isFinite(covered) ? fmt(covered) : "?") + " " + u.area + " of the subcatchment's " + fmt(data.area * sqft) + " " + u.area + ".";
  };
  const columns = [
    ["number", "Units"],
    ["area", "Unit area (" + u.area + ")"],
    ["width", "Width (" + u.width + ")"],
    ["initSat", "Initially saturated (%)"],
    ["fromImperv", "Impervious area treated (%)"],
    ["fromPerv", "Pervious area treated (%)"],
  ];
  const render = () => {
    const body = rows.map((row, i) => {
      const control = el("select", { ariaLabel: "Row " + (i + 1) + " LID control" });
      for (const l of lids) control.add(new Option(l, l));
      control.value = row.lid;
      control.onchange = () => (row.lid = control.value);
      const cells = columns.map(([key, caption]) => {
        const input = el("input", { value: row[key], inputMode: "decimal", ariaLabel: "Row " + (i + 1) + " " + caption.replace(/ \(.*\)$/, "").toLowerCase() });
        input.oninput = () => {
          row[key] = input.value;
          recount();
        };
        return el("td", {}, input);
      });
      const toPerv = el("input", { type: "checkbox", checked: !!row.toPerv, ariaLabel: "Row " + (i + 1) + " returns outflow to the pervious area" });
      toPerv.onchange = () => (row.toPerv = toPerv.checked);
      const drain = el("select", { ariaLabel: "Row " + (i + 1) + " underdrain outlet" });
      drain.add(new Option("Subcatchment outlet", ""));
      for (const d of drains) if (d !== data.id) drain.add(new Option(d, d));
      drain.value = row.drainTo;
      drain.onchange = () => (row.drainTo = drain.value);
      const remove = el("button", { type: "button", className: "link", textContent: "Remove", ariaLabel: "Remove row " + (i + 1) });
      remove.onclick = () => {
        rows.splice(i, 1);
        render();
      };
      return el("tr", {}, el("td", {}, control), ...cells, el("td", {}, toPerv), el("td", {}, drain), el("td", {}, remove));
    });
    table.replaceChildren(
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { textContent: "LID control", scope: "col" }),
          ...columns.map(([, c]) => el("th", { textContent: c, scope: "col" })),
          el("th", { textContent: "Return to pervious", scope: "col" }),
          el("th", { textContent: "Underdrain to", scope: "col" }),
          el("th"),
        ),
      ),
      el("tbody", {}, ...body),
    );
    recount();
  };
  const add = el("button", { type: "button", textContent: "Add LID control" });
  add.disabled = !lids.length;
  add.onclick = () => {
    rows.push({ lid: lids[0], number: "1", area: "0", width: "0", initSat: "0", fromImperv: "0", fromPerv: "0", toPerv: false, drainTo: "", reportFile: "" });
    render();
    table.querySelector("tbody tr:last-child select")?.focus();
  };
  render();
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await onSave({ rows });
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  return el(
    "div",
    { className: "record-editor quality-editor lid-usage-editor" },
    el("div", { className: "record-scroll" }, table),
    total,
    el("div", { className: "actions" }, add),
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}
