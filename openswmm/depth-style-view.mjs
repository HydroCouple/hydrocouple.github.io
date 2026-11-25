/**
 * The water depth style form (interaction phase V4a): a view of the DepthStyle model
 * (depth-style.mjs). Every change goes to the model at once, so the map and the legend follow while
 * the form is open.
 */
import { rampNames, methodNames, rampColor } from "./depth-style.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
function select(entries, value, label) {
  const s = el("select", { ariaLabel: label });
  for (const [v, name] of entries) s.add(new Option(name, v));
  s.value = value;
  return s;
}
const field = (caption, input) => el("label", { className: "prop" }, el("span", { textContent: caption }), input);
const part = (legend, ...children) => el("fieldset", { className: "quality-part" }, el("legend", { textContent: legend }), ...children);

/**
 * @param {import("./depth-style.mjs").DepthStyle} style
 * @param {{dry: number, onClose: () => void}} o the model's dry depth (m), for the hint
 */
export function depthStyleForm(style, { dry, onClose }) {
  const unit = "m"; // 2D depths are in meters whatever the deck's units
  const st = () => style.state;
  const display = select([["cells", "Cell colors"], ["bands", "Filled contours"]], st().display, "Display");
  const method = select(Object.entries(methodNames), st().method, "Classes");
  const classes = el("input", { type: "number", min: 2, max: 12, step: 1, value: st().classes, ariaLabel: "Number of classes" });
  const manual = el("input", { value: st().manual.join(", "), ariaLabel: "Class breaks", placeholder: "0.1, 0.3, 0.5" });
  const ramp = select(Object.entries(rampNames), st().ramp, "Color ramp");
  const invert = el("input", { type: "checkbox", checked: st().invert, ariaLabel: "Invert colors" });
  const preview = el("span", { className: "ramp-preview" });
  const range = select([["frame", "Each frame's range"], ["run", "Whole run"], ["fixed", "Fixed"]], st().range, "Range");
  const min = el("input", { inputMode: "decimal", value: st().min, ariaLabel: "Range minimum" });
  const max = el("input", { inputMode: "decimal", value: st().max, ariaLabel: "Range maximum" });
  const lines = el("input", { type: "checkbox", checked: st().lines, ariaLabel: "Contour lines" });
  const levelMode = select([["count", "Number of levels"], ["interval", "Interval from a base"]], st().levelMode, "Contour levels");
  const levelCount = el("input", { type: "number", min: 1, max: 50, step: 1, value: st().levelCount, ariaLabel: "Number of contour levels" });
  const interval = el("input", { inputMode: "decimal", value: st().interval, ariaLabel: "Contour interval" });
  const base = el("input", { inputMode: "decimal", value: st().base, ariaLabel: "Contour base" });
  const indexEvery = el("input", { type: "number", min: 0, max: 50, step: 1, value: st().indexEvery, ariaLabel: "Index contour every" });
  const labels = el("input", { type: "checkbox", checked: st().labels, ariaLabel: "Contour labels" });
  const hideBelow = el("input", { inputMode: "decimal", value: st().hideBelow ?? "", placeholder: String(dry), ariaLabel: "Hide water no deeper than" });

  const rows = {
    classes: field("Number of classes", classes),
    manual: field("Class breaks (" + unit + ")", manual),
    fixed: el("div", { className: "pair" }, field("Minimum (" + unit + ")", min), field("Maximum (" + unit + ")", max)),
    count: field("Number of levels", levelCount),
    interval: el("div", { className: "pair" }, field("Interval (" + unit + ")", interval), field("Base (" + unit + ")", base)),
    levels: el("div", {}),
  };
  const sync = () => {
    const s = st();
    rows.classes.hidden = s.method === "continuous" || s.method === "manual";
    rows.manual.hidden = s.method !== "manual";
    rows.fixed.hidden = s.range !== "fixed";
    rows.levels.hidden = !s.lines;
    rows.count.hidden = s.levelMode !== "count";
    rows.interval.hidden = s.levelMode !== "interval";
    preview.style.background = "linear-gradient(to right, " + Array.from({ length: 7 }, (_, i) => rampColor(s.ramp, i / 6, s.invert)).join(", ") + ")";
  };
  const set = (changes) => {
    style.set(changes);
    sync();
  };
  display.onchange = () => set({ display: display.value });
  method.onchange = () => set({ method: method.value });
  classes.oninput = () => classes.value && set({ classes: +classes.value });
  manual.onchange = () => set({ manual: manual.value.split(/[\s,;]+/).filter(Boolean).map(Number) });
  ramp.onchange = () => set({ ramp: ramp.value });
  invert.onchange = () => set({ invert: invert.checked });
  range.onchange = () => set({ range: range.value });
  min.onchange = () => set({ min: +min.value });
  max.onchange = () => set({ max: +max.value });
  lines.onchange = () => set({ lines: lines.checked });
  levelMode.onchange = () => set({ levelMode: levelMode.value });
  levelCount.oninput = () => levelCount.value && set({ levelCount: +levelCount.value });
  interval.onchange = () => set({ interval: +interval.value });
  base.onchange = () => set({ base: +base.value });
  indexEvery.oninput = () => indexEvery.value !== "" && set({ indexEvery: +indexEvery.value });
  labels.onchange = () => set({ labels: labels.checked });
  hideBelow.onchange = () => set({ hideBelow: hideBelow.value.trim() === "" ? null : +hideBelow.value });
  rows.levels.append(field("Levels", levelMode), rows.count, rows.interval, field("Index contour every (0: none)", indexEvery), el("label", { className: "check" }, labels, el("span", { textContent: "Label the lines" })));

  const reset = el("button", { type: "button", textContent: "Reset" });
  reset.onclick = () => {
    style.reset();
    onClose();
  };
  const done = el("button", { type: "button", className: "primary", textContent: "Done" });
  done.onclick = onClose;
  sync();
  return el(
    "div",
    { className: "record-editor quality-editor depth-style" },
    el(
      "div",
      { className: "quality-forms" },
      part("Fill", field("Display", display), field("Classes", method), rows.classes, rows.manual, field("Hide water no deeper than (" + unit + ")", hideBelow)),
      part("Colors", field("Color ramp", ramp), preview, el("label", { className: "check" }, invert, el("span", { textContent: "Invert" })), field("Range", range), rows.fixed),
      part("Contour lines", el("label", { className: "check" }, lines, el("span", { textContent: "Draw contour lines" })), rows.levels),
    ),
    el("p", {
      className: "hint",
      textContent:
        "Water no deeper than the threshold is not drawn and the streaks keep to the water shown; left blank, the threshold is the model's dry depth (DRY_DEPTH, " + dry + " m), and it clears when another model opens. Filled contours interpolate the cells' depths to the mesh vertices. Changes show on the map at once.",
    }),
    el("div", { className: "actions end" }, reset, done),
  );
}
