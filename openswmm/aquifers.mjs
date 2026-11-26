/**
 * Aquifer editor (interaction phase E3a): a view of one [AQUIFERS] record (model.mjs aquifer) — the 12
 * parameters grouped as the desktop's Aquifers dialog (soil, conductivity, evaporation, elevations
 * and losses) with its labels and help, and the monthly pattern that adjusts upper evaporation.
 */
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const text = (v) => String(+(+v).toPrecision(8));
/** [key, label, unit kind, help] in the desktop dialog's groups. */
const groups = [
  ["Soil", [
    ["porosity", "Porosity", null, "Volume of voids / total soil volume (volumetric fraction)."],
    ["wiltingPoint", "Wilting point", null, "Soil moisture content at which plants cannot survive (volumetric fraction)."],
    ["fieldCapacity", "Field capacity", null, "Soil moisture content after all free water has drained off (volumetric fraction)."],
  ]],
  ["Conductivity", [
    ["conductivity", "Conductivity", "rate", "Saturated hydraulic conductivity of the soil."],
    ["conductSlope", "Conductivity slope", null, "Average slope of log(conductivity) versus soil moisture deficit (dimensionless)."],
    ["tensionSlope", "Tension slope", "depth", "Average slope of soil tension versus soil moisture content."],
  ]],
  ["Evaporation", [
    ["upperEvapFrac", "Upper evaporation fraction", null, "Fraction of total evaporation available for evapotranspiration in the upper unsaturated zone."],
    ["lowerEvapDepth", "Lower evaporation depth", "length", "Maximum depth into the lower saturated zone over which evapotranspiration can occur."],
  ]],
  ["Elevations and losses", [
    ["lowerLossCoeff", "Lower groundwater loss rate", "rate", "Rate of percolation from the saturated zone to deep groundwater when the water table is at the ground surface."],
    ["bottomElev", "Bottom elevation", "length", "Elevation of the bottom of the aquifer."],
    ["waterTableElev", "Water table elevation", "length", "Elevation of the water table at the start of the simulation."],
    ["upperMoisture", "Unsaturated zone moisture", null, "Moisture content of the upper zone at the start (volumetric fraction; between the wilting point and porosity)."],
  ]],
];
const unitsOf = (unitSystem) => (unitSystem === "SI" ? { rate: "mm/hr", depth: "mm", length: "m" } : { rate: "in/hr", depth: "in", length: "ft" });

/** One line for the aquifer's card. */
export function describeAquifer(r, unitSystem) {
  const u = unitsOf(unitSystem),
    p = r.params;
  return "Porosity " + text(p.porosity) + ", conductivity " + text(p.conductivity) + " " + u.rate + ", water table " + text(p.waterTableElev) + " " + u.length + " over a bottom at " + text(p.bottomElev) + " " + u.length + (r.evapPattern ? "; evaporation pattern " + r.evapPattern : "") + ".";
}

/** @param {{record: object, patterns: string[], unitSystem: string, onSave: (data) => Promise, onCancel: () => void}} o */
export function aquiferEditor({ record, patterns, unitSystem, onSave, onCancel }) {
  const u = unitsOf(unitSystem),
    values = Object.fromEntries(Object.entries(record.params).map(([k, v]) => [k, text(v)]));
  const message = el("p", { className: "hint record-message", role: "status" });
  const parts = groups.map(([legend, fields]) =>
    el(
      "fieldset",
      { className: "quality-part" },
      el("legend", { textContent: legend }),
      ...fields.map(([key, label, unit, help]) => {
        const input = el("input", { value: values[key], inputMode: "decimal", ariaLabel: label, title: help });
        input.oninput = () => (values[key] = input.value);
        return el("label", { className: "prop", title: help }, el("span", { textContent: label + (unit ? " (" + u[unit] + ")" : "") }), input);
      }),
    ),
  );
  const pattern = el("select", { ariaLabel: "Evaporation pattern" });
  pattern.add(new Option("None", ""));
  for (const p of patterns) pattern.add(new Option(p, p));
  pattern.value = record.evapPattern || "";
  parts[2].append(el("label", { className: "prop", title: "Optional monthly pattern of adjustments to the upper evaporation fraction." }, el("span", { textContent: "Evaporation pattern (monthly)" }), pattern));
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await onSave({ params: values, evapPattern: pattern.value });
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  return el(
    "div",
    { className: "record-editor quality-editor" },
    el("div", { className: "quality-forms" }, ...parts),
    el("p", { className: "hint", textContent: "Subcatchments use an aquifer through their groundwater settings. Values are checked as SWMM checks them: field capacity below porosity, the wilting point below field capacity, the water table not below the bottom." }),
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}
