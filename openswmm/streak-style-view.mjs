/**
 * The flow streak style form (interaction phase L1): a view of the StreakStyle model
 * (streak-style.mjs). Every change goes to the model at once, so the map and the legend follow while
 * the form is open.
 */
import { rampNames, rampColor } from "./depth-style.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const field = (caption, input) => el("label", { className: "prop" }, el("span", { textContent: caption }), input);
const part = (legend, ...children) => el("fieldset", { className: "quality-part" }, el("legend", { textContent: legend }), ...children);
/** A slider with its value shown: `scale` turns the stored value into the slider's, `text` labels it. */
function slider(label, value, { min, max, step, scale = 1, text }) {
  const input = el("input", { type: "range", min, max, step, value: value * scale, ariaLabel: label }),
    out = el("output", { className: "style-value", textContent: text(value) });
  return { input, out, row: el("div", { className: "style-slider" }, input, out), value: () => +input.value / scale, show: (v) => (out.textContent = text(v)) };
}

/** @param {import("./streak-style.mjs").StreakStyle} style @param {{onClose: () => void}} o */
export function streakStyleForm(style, { onClose }) {
  const st = () => style.state;
  const density = slider("Density", st().density, { min: 25, max: 400, step: 25, scale: 100, text: (v) => Math.round(v * 100) + " %" }),
    width = slider("Width", st().width, { min: 0.5, max: 4, step: 0.25, text: (v) => v + " px" }),
    trail = slider("Trail length", st().trail, { min: 0.25, max: 4, step: 0.25, text: (v) => v + " s" }),
    speed = slider("Speed", st().speed, { min: 25, max: 400, step: 25, scale: 100, text: (v) => Math.round(v * 100) + " %" });
  const mode = el("select", { ariaLabel: "Color" });
  for (const [v, name] of [["single", "One color"], ["speed", "By speed"]]) mode.add(new Option(name, v));
  mode.value = st().mode;
  const color = el("input", { type: "color", value: st().color, ariaLabel: "Streak color" });
  const ramp = el("select", { ariaLabel: "Speed ramp" });
  for (const [v, name] of Object.entries(rampNames)) ramp.add(new Option(name, v));
  ramp.value = st().ramp;
  const invert = el("input", { type: "checkbox", checked: st().invert, ariaLabel: "Invert ramp" });
  const preview = el("span", { className: "ramp-preview" });
  const singleRow = field("Color", color),
    speedRows = el("div", {}, field("Ramp", ramp), preview, el("label", { className: "check" }, invert, el("span", { textContent: "Invert" })));
  const sync = () => {
    const s = st();
    singleRow.hidden = s.mode !== "single";
    speedRows.hidden = s.mode !== "speed";
    preview.style.background = "linear-gradient(to right, " + Array.from({ length: 7 }, (_, i) => rampColor(s.ramp, i / 6, s.invert)).join(", ") + ")";
  };
  const set = (changes) => {
    style.set(changes);
    sync();
  };
  for (const [s, name] of [
    [density, "density"],
    [width, "width"],
    [trail, "trail"],
    [speed, "speed"],
  ])
    s.input.oninput = () => {
      s.show(s.value());
      set({ [name]: s.value() });
    };
  mode.onchange = () => set({ mode: mode.value });
  color.oninput = () => set({ color: color.value });
  ramp.onchange = () => set({ ramp: ramp.value });
  invert.onchange = () => set({ invert: invert.checked });
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
    { className: "record-editor quality-editor streak-style" },
    el(
      "div",
      { className: "quality-forms" },
      part("Particles", field("Density", density.row), field("Speed", speed.row)),
      part("Color", field("Color by", mode), singleRow, speedRows),
      part("Shape", field("Width", width.row), field("Trail length", trail.row)),
    ),
    el("p", {
      className: "hint",
      textContent:
        "As the desktop's streak style: density scales the particles a frame gets; by speed colors each streak by its cell's speed from 0 to twice the frame's typical speed (the legend shows the range). Light colors get a dark edge, dark colors a white one. Remembered in this browser.",
    }),
    el("div", { className: "actions end" }, reset, done),
  );
}
