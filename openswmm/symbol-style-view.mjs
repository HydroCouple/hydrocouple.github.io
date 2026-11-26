/**
 * A layer's symbol form (interaction phase L2): a view of the SymbolStyle model (symbol-style.mjs) for
 * one leaf — a node kind's or rain gage's marker, a link kind's line and flow arrows, the subcatchment
 * area, ID labels, the mesh fill or edges. Every change goes to the model at once, so the map, the 3D
 * view and the layer swatches follow while the form is open.
 */
import { markerKinds, lineKinds, markerShapes, elevationRamps, elevationColor, symbolDefaults } from "./symbol-style.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const field = (caption, input) => el("label", { className: "prop" }, el("span", { textContent: caption }), input);
const part = (legend, ...children) => el("fieldset", { className: "quality-part" }, el("legend", { textContent: legend }), ...children);

/**
 * @param {import("./symbol-style.mjs").SymbolStyle} style
 * @param {string} leaf the layer row (junctions, conduits, subcatchments, meshfill, edges, …)
 * @param {{label: string, onClose: () => void, elevations?: [number, number] | null}} o `label` names
 *   the layer in the controls' accessible names; `elevations` is the mesh's bed range, when known
 */
export function symbolStyleForm(style, leaf, { label, onClose, elevations = null }) {
  const st = () => style.state[leaf];
  const set = (changes) => {
    style.set(leaf, changes);
    sync();
  };
  const syncs = [];
  const sync = () => syncs.forEach((f) => f());
  const name = (what) => label + " " + what;
  /** A slider with its value shown; `scale` turns the stored value into the slider's. */
  const slider = (key, what, { min, max, step, scale = 1, text }) => {
    const input = el("input", { type: "range", min, max, step, value: st()[key] * scale, ariaLabel: name(what) }),
      out = el("output", { className: "style-value", textContent: text(st()[key]) });
    input.oninput = () => {
      out.textContent = text(+input.value / scale);
      set({ [key]: +input.value / scale });
    };
    syncs.push(() => {
      input.value = st()[key] * scale;
      out.textContent = text(st()[key]);
    });
    return field(what[0].toUpperCase() + what.slice(1), el("div", { className: "style-slider" }, input, out));
  };
  const color = (key, what) => {
    const input = el("input", { type: "color", value: st()[key], ariaLabel: name(what) });
    input.oninput = () => set({ [key]: input.value });
    syncs.push(() => (input.value = st()[key]));
    return field(what[0].toUpperCase() + what.slice(1), input);
  };
  const check = (key, what, caption) => {
    const input = el("input", { type: "checkbox", checked: st()[key], ariaLabel: name(what) });
    input.onchange = () => set({ [key]: input.checked });
    syncs.push(() => (input.checked = st()[key]));
    return el("label", { className: "check" }, input, el("span", { textContent: caption }));
  };
  const choice = (key, what, options) => {
    const input = el("select", { ariaLabel: name(what) });
    for (const [v, text] of Object.entries(options)) input.add(new Option(text, v));
    input.value = st()[key];
    input.onchange = () => set({ [key]: input.value });
    syncs.push(() => (input.value = st()[key]));
    return field(what[0].toUpperCase() + what.slice(1), input);
  };
  /** Rows shown only while `on()` holds. */
  const when = (on, ...rows) => {
    const box = el("div", {}, ...rows);
    syncs.push(() => (box.hidden = !on()));
    return box;
  };
  const px = (v) => v + " px",
    pct = (v) => Math.round(v * 100) + " %";
  const labels = () =>
    part(
      "Labels",
      check("labels", "ID labels", "Show IDs"),
      when(() => st().labels, color("labelColor", "label color"), slider("labelSize", "label size", { min: 8, max: 24, step: 1, text: px })),
    );
  const parts = [];
  let hint;
  if (markerKinds.includes(leaf)) {
    parts.push(
      part("Marker", choice("shape", "shape", markerShapes), slider("size", "size", { min: 2, max: 30, step: 0.5, text: px }), color("fill", "fill color")),
      part("Outline", color("outline", "outline color"), slider("outlineWidth", "outline width", { min: 0, max: 4, step: 0.25, text: px })),
      labels(),
    );
    hint = "As the desktop's node symbol: shape, size, fill and outline; IDs beside each marker.";
  } else if (lineKinds.includes(leaf)) {
    parts.push(
      part("Line", color("color", "line color"), slider("width", "width", { min: 0.5, max: 10, step: 0.25, text: px })),
      part(
        "Flow arrows",
        check("arrows", "flow arrows", "Show flow direction"),
        when(
          () => st().arrows,
          slider("arrowLength", "arrow length", { min: 4, max: 40, step: 1, text: px }),
          slider("arrowWidth", "arrow width", { min: 2, max: 30, step: 1, text: px }),
          color("arrowColor", "arrow color"),
        ),
      ),
      labels(),
    );
    hint = "As the desktop's link symbol: the arrow sits halfway along each link and points from its inlet node to its outlet node; links shorter on screen than twice the arrow show none.";
  } else if (leaf === "subcatchments") {
    parts.push(
      part("Area", color("fill", "fill color"), slider("fillOpacity", "fill opacity", { min: 0, max: 100, step: 5, scale: 100, text: pct })),
      part("Outline", color("outline", "outline color"), slider("outlineWidth", "outline width", { min: 0, max: 6, step: 0.25, text: px })),
      labels(),
    );
    hint = "As the desktop's subcatchment symbol; IDs at the middle of each area.";
  } else if (leaf === "meshfill") {
    const preview = el("span", { className: "ramp-preview" });
    syncs.push(() => (preview.style.background = "linear-gradient(to right, " + Array.from({ length: 7 }, (_, i) => elevationColor(st().ramp, i / 6, st().invert)).join(", ") + ")"));
    const range = elevations ? el("p", { className: "hint", textContent: "Bed elevation " + elevations.map((v) => +v.toPrecision(4)).join(" — ") + " (lowest to highest cell)." }) : el("p", { className: "hint", textContent: "Elevations show once a mesh with vertex elevations is on the map." });
    parts.push(
      part(
        "Fill",
        choice("mode", "fill by", { single: "One color", elevation: "Bed elevation" }),
        when(() => st().mode === "single", color("color", "fill color"), slider("opacity", "fill opacity", { min: 0, max: 100, step: 2, scale: 100, text: pct })),
        when(() => st().mode === "elevation", choice("ramp", "elevation ramp", elevationRamps), preview, check("invert", "invert ramp", "Invert"), range),
      ),
    );
    hint = "By bed elevation is the desktop's Terrain Fill: each cell takes its vertices' mean elevation on the ramp.";
  } else {
    parts.push(part("Edges", color("color", "edge color"), slider("opacity", "edge opacity", { min: 0, max: 100, step: 5, scale: 100, text: pct }), slider("width", "edge width", { min: 0.25, max: 3, step: 0.25, text: px })));
    hint = "The mesh's cell edges.";
  }
  const reset = el("button", { type: "button", textContent: "Reset" });
  reset.onclick = () => {
    style.reset(leaf);
    sync();
  };
  const done = el("button", { type: "button", className: "primary", textContent: "Done" });
  done.onclick = onClose;
  sync();
  return el(
    "div",
    { className: "record-editor quality-editor symbol-style" },
    el("div", { className: "quality-forms" }, ...parts),
    el("p", { className: "hint", textContent: hint + " Reset brings back the " + (leaf in symbolDefaults && leaf !== "meshfill" && leaf !== "edges" ? "desktop's" : "default") + " symbol. Remembered in this browser." }),
    el("div", { className: "actions end" }, reset, done),
  );
}
