/**
 * Street and inlet editors (interaction phase E3a), SWMM 5.2's street drainage: a view of one [STREETS]
 * record (the cross-section STREET links use) and of one [INLETS] design (what [INLET_USAGE] places on
 * street links). Records of the editing session (model.mjs street, inlet).
 */
import { inletTypes, grateTypes, throatTypes, inletParts } from "./model.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const text = (v) => String(+(+v).toPrecision(8));
const unitsOf = (unitSystem) => (unitSystem === "SI" ? { length: "m", small: "mm", area: "m²", speed: "m/s" } : { length: "ft", small: "in", area: "ft²", speed: "ft/s" });
export const inletNames = { GRATE: "Grate", CURB: "Curb opening", COMBO: "Grate and curb (combination)", SLOTTED: "Slotted drain", DROP_GRATE: "Drop grate", DROP_CURB: "Drop curb", CUSTOM: "Custom (curve)" };
const grateNames = { P_BAR_50: "P-bar 50", P_BAR_50x100: "P-bar 50×100", P_BAR_30: "P-bar 30", CURVED_VANE: "Curved vane", TILT_BAR_45: "Tilt bar 45", TILT_BAR_30: "Tilt bar 30", RETICULINE: "Reticuline", GENERIC: "Generic" };
const actions = (message, onCancel, onSave, data) => {
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await onSave(data());
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  return el("div", { className: "actions end" }, cancel, save);
};
const number = (values, key, label) => {
  const input = el("input", { value: values[key], inputMode: "decimal", ariaLabel: label });
  input.oninput = () => (values[key] = input.value);
  return input;
};
const prop = (caption, input) => el("label", { className: "prop" }, el("span", { textContent: caption }), input);

/** One line for a street's card. */
export function describeStreet(r, unitSystem) {
  const u = unitsOf(unitSystem),
    p = r.params;
  return (p.sides === 1 ? "One side" : "Two sides") + ", " + text(p.tCrown) + " " + u.length + " to the crown, curb " + text(p.hCurb) + " " + u.length + ", cross slope " + text(p.sx) + " %" + (p.backWidth > 0 ? ", backing " + text(p.backWidth) + " " + u.length : "") + ".";
}

/** @param {{record: object, unitSystem: string, onSave: (data) => Promise, onCancel: () => void}} o */
export function streetEditor({ record, unitSystem, onSave, onCancel }) {
  const u = unitsOf(unitSystem),
    v = Object.fromEntries(Object.entries(record.params).map(([k, x]) => [k, text(x)]));
  const message = el("p", { className: "hint record-message", role: "status" });
  const sides = el("select", { ariaLabel: "Sides" });
  sides.add(new Option("Two sides", "2"));
  sides.add(new Option("One side", "1"));
  sides.value = String(record.params.sides);
  const part = (legend, ...rows) => el("fieldset", { className: "quality-part" }, el("legend", { textContent: legend }), ...rows);
  return el(
    "div",
    { className: "record-editor quality-editor" },
    el(
      "div",
      { className: "quality-forms" },
      part("Roadway", prop("Distance from curb to crown (" + u.length + ")", number(v, "tCrown", "Distance to the crown")), prop("Curb height (" + u.length + ")", number(v, "hCurb", "Curb height")), prop("Cross slope (%)", number(v, "sx", "Cross slope")), prop("Manning n", number(v, "nRoad", "Road Manning n")), prop("Sides", sides)),
      part("Gutter", prop("Gutter depression (" + u.small + ")", number(v, "gutterDepres", "Gutter depression")), prop("Gutter width (" + u.length + ")", number(v, "gutterWidth", "Gutter width"))),
      part("Backing (beyond the curb)", prop("Width (" + u.length + ")", number(v, "backWidth", "Backing width")), prop("Slope (%)", number(v, "backSlope", "Backing slope")), prop("Manning n", number(v, "backN", "Backing Manning n"))),
    ),
    el("p", { className: "hint", textContent: "STREET links use this cross-section; inlets on them capture its gutter flow. A backing of width 0 means none." }),
    message,
    actions(message, onCancel, onSave, () => ({ params: { ...v, sides: sides.value } })),
  );
}

/** One line for an inlet's card. */
export function describeInlet(r, unitSystem) {
  const u = unitsOf(unitSystem),
    parts = inletParts[r.type] || [];
  const bits = [inletNames[r.type]];
  if (parts.includes("grate")) bits.push(text(r.grate.length) + " × " + text(r.grate.width) + " " + u.length + " " + grateNames[r.grate.grateType] + " grate");
  if (parts.includes("curb")) bits.push(text(r.curb.length) + " " + u.length + " curb opening, " + text(r.curb.height) + " " + u.length + " high");
  if (parts.includes("slot")) bits.push(text(r.slot.length) + " × " + text(r.slot.width) + " " + u.length + " slot");
  if (parts.includes("curve")) bits.push("capture curve " + (r.curve || "(none)"));
  return bits.join(": ") + ".";
}

/** @param {{record: object, curves: string[], unitSystem: string, onSave: (data) => Promise, onCancel: () => void}} o */
export function inletEditor({ record, curves, unitSystem, onSave, onCancel }) {
  const u = unitsOf(unitSystem);
  const work = {
    grate: Object.fromEntries(Object.entries(record.grate).map(([k, x]) => [k, typeof x === "number" ? text(x) : x])),
    curb: Object.fromEntries(Object.entries(record.curb).map(([k, x]) => [k, typeof x === "number" ? text(x) : x])),
    slot: Object.fromEntries(Object.entries(record.slot).map(([k, x]) => [k, text(x)])),
  };
  const message = el("p", { className: "hint record-message", role: "status" });
  const type = el("select", { ariaLabel: "Inlet type" });
  for (const t of inletTypes) type.add(new Option(inletNames[t], t));
  type.value = record.type;
  const grateType = el("select", { ariaLabel: "Grate type" });
  for (const g of grateTypes) grateType.add(new Option(grateNames[g], g));
  grateType.value = record.grate.grateType || "P_BAR_50";
  const throat = el("select", { ariaLabel: "Throat" });
  for (const t of throatTypes) throat.add(new Option(t[0] + t.slice(1).toLowerCase(), t));
  throat.value = record.curb.throat || "HORIZONTAL";
  const curve = el("select", { ariaLabel: "Capture curve" });
  curve.add(new Option("None", ""));
  for (const c of curves) curve.add(new Option(c, c));
  curve.value = record.curve || "";
  const comment = el("input", { value: record.comment || "", ariaLabel: "Comment" });
  const generic = el("div", {}, prop("Open area (" + u.area + ")", number(work.grate, "openArea", "Open area")), prop("Splash-over velocity (" + u.speed + ")", number(work.grate, "splashVeloc", "Splash-over velocity")));
  const part = (legend, ...rows) => el("fieldset", { className: "quality-part" }, el("legend", { textContent: legend }), ...rows);
  const parts = {
    grate: part("Grate", prop("Length (" + u.length + ")", number(work.grate, "length", "Grate length")), prop("Width (" + u.length + ")", number(work.grate, "width", "Grate width")), prop("Grate type", grateType), generic),
    curb: part("Curb opening", prop("Length (" + u.length + ")", number(work.curb, "length", "Curb opening length")), prop("Height (" + u.length + ")", number(work.curb, "height", "Curb opening height")), prop("Throat", throat)),
    slot: part("Slotted drain", prop("Length (" + u.length + ")", number(work.slot, "length", "Slot length")), prop("Width (" + u.length + ")", number(work.slot, "width", "Slot width"))),
    curve: part("Custom capture", prop("Diversion or rating curve", curve)),
  };
  const forms = el("div", { className: "quality-forms" });
  const render = () => {
    generic.hidden = grateType.value !== "GENERIC";
    forms.replaceChildren(part("Inlet", prop("Type", type), prop("Comment", comment)), ...inletParts[type.value].map((k) => parts[k]));
  };
  type.onchange = render;
  grateType.onchange = render;
  render();
  return el(
    "div",
    { className: "record-editor quality-editor" },
    forms,
    el("p", { className: "hint", textContent: "An inlet design is placed on street conduits ([INLET_USAGE]); a combination inlet is a grate and a curb opening together. Checked as SWMM reads it, then by the engine." }),
    message,
    actions(message, onCancel, onSave, () => ({
      type: type.value,
      grate: { ...work.grate, grateType: grateType.value },
      curb: { ...work.curb, throat: throat.value },
      slot: work.slot,
      curve: curve.value,
      comment: comment.value,
    })),
  );
}
