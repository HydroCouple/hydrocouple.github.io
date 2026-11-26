/**
 * Snowpack editor (interaction phase E3a): a view of one [SNOWPACKS] record (model.mjs snowpack) — melt
 * parameters for the plowable, impervious and pervious areas side by side (as the desktop's Snowpack
 * dialog), and snow removal with the subcatchment that receives plowed snow.
 */
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const text = (v) => String(+(+v).toPrecision(8));
const surfaces = [
  ["plowable", "Plowable"],
  ["impervious", "Impervious"],
  ["pervious", "Pervious"],
];
const unitsOf = (unitSystem) => (unitSystem === "SI" ? { melt: "mm/hr/°C", temp: "°C", depth: "mm" } : { melt: "in/hr/°F", temp: "°F", depth: "in" });
/** [key, label, unit kind] of the surface rows; the last row differs by surface. */
const surfaceRows = [
  ["cmin", "Min. melt coefficient", "melt"],
  ["cmax", "Max. melt coefficient", "melt"],
  ["tbase", "Base temperature", "temp"],
  ["fwfrac", "Free water capacity (fraction)", null],
  ["sd0", "Initial snow water equivalent", "depth"],
  ["fw0", "Initial free water", "depth"],
];
const removalRows = [
  ["dsnow", "Depth at which removal begins", "depth"],
  ["fout", "Fraction transferred out of the watershed", null],
  ["fimp", "Fraction transferred to impervious area", null],
  ["fperv", "Fraction transferred to pervious area", null],
  ["fimelt", "Fraction converted to immediate melt", null],
  ["fsubcatch", "Fraction transferred to a subcatchment", null],
];

/** One line for the snowpack's card. */
export function describeSnowpack(r, unitSystem) {
  const u = unitsOf(unitSystem);
  return "Melt from " + text(r.impervious.tbase) + " " + u.temp + " on impervious ground; " + Math.round(r.plowable.last * 100) + " % of impervious area plowable" + (r.removalSubcatch ? ", plowed snow to " + r.removalSubcatch : "") + ".";
}

/** @param {{record: object, subcatchments: string[], unitSystem: string, onSave: (data) => Promise, onCancel: () => void}} o */
export function snowpackEditor({ record, subcatchments, unitSystem, onSave, onCancel }) {
  const u = unitsOf(unitSystem);
  const work = Object.fromEntries([...surfaces.map(([k]) => k), "removal"].map((k) => [k, Object.fromEntries(Object.entries(record[k]).map(([f, v]) => [f, text(v)]))]));
  const message = el("p", { className: "hint record-message", role: "status" });
  const input = (part, key, label) => {
    const i = el("input", { value: work[part][key], inputMode: "decimal", ariaLabel: label });
    i.oninput = () => (work[part][key] = i.value);
    return i;
  };
  // Melt parameters: one row per parameter, one column per surface.
  const head = el("tr", {}, el("th", { textContent: "" }), ...surfaces.map(([, name]) => el("th", { textContent: name })));
  const body = [...surfaceRows, ["last", null, null]].map(([key, label, unit]) =>
    el(
      "tr",
      {},
      el("th", { scope: "row", textContent: key === "last" ? "Plowable fraction / depth at 100 % cover (" + u.depth + ")" : label + (unit ? " (" + u[unit] + ")" : "") }),
      ...surfaces.map(([part, name]) => el("td", {}, input(part, key, name + " " + (key === "last" ? (part === "plowable" ? "plowable fraction" : "depth at 100 % cover") : label.toLowerCase())))),
    ),
  );
  const melt = el("fieldset", { className: "quality-part snow-melt" }, el("legend", { textContent: "Melt" }), el("table", { className: "snow-table" }, el("thead", {}, head), el("tbody", {}, ...body)));
  const sub = el("select", { ariaLabel: "Subcatchment receiving plowed snow" });
  sub.add(new Option("None", ""));
  for (const s of subcatchments) sub.add(new Option(s, s));
  sub.value = record.removalSubcatch || "";
  const removal = el(
    "fieldset",
    { className: "quality-part" },
    el("legend", { textContent: "Removal (plowing)" }),
    ...removalRows.map(([key, label, unit]) => el("label", { className: "prop" }, el("span", { textContent: label + (unit ? " (" + u[unit] + ")" : "") }), input("removal", key, label))),
    el("label", { className: "prop" }, el("span", { textContent: "Subcatchment receiving plowed snow" }), sub),
  );
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await onSave({ ...work, removalSubcatch: sub.value });
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  return el(
    "div",
    { className: "record-editor quality-editor" },
    el("div", { className: "quality-forms" }, melt, removal),
    el("p", { className: "hint", textContent: "Subcatchments use a snowpack by name. Checked as SWMM checks it: the minimum melt coefficient at most the maximum, fractions from 0 to 1, removal fractions adding up to at most 1." }),
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}
