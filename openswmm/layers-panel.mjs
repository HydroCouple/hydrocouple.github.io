/**
 * Layers panel (view): the layer tree as the desktop GUI shows it, built once from the LayerTree model
 * (layers.mjs) and updated from its `change` events. Checkboxes, the move buttons and the opacity
 * sliders send their changes to the model; nothing here draws the map.
 */
import { symbols, markerOutline } from "./layers.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const svgNS = "http://www.w3.org/2000/svg";
/** A 14 px swatch: the kind's marker, line or area symbol; CSS swatches for the surface rows. */
export function swatch(leaf) {
  const css = leaf.startsWith("bm-") ? "map" : { depth: "ramp", streaks: "streak", meshfill: "meshfill", edges: "mesh", basemap: "map", buildings: "buildings", labels: "label" }[leaf];
  if (css) return el("span", { className: "sw " + css, ariaHidden: "true" }); // decoration: not part of a row's name
  const s = symbols[leaf];
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("class", "sw");
  svg.setAttribute("aria-hidden", "true");
  const shape = (name, attrs) => {
    const node = document.createElementNS(svgNS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  };
  if (s.stroke) shape("path", { d: "M1 7h12", stroke: s.stroke, "stroke-width": Math.max(1.5, s.width) });
  else if (s.outline) shape("rect", { x: 1.5, y: 2.5, width: 11, height: 9, fill: s.fill, stroke: s.outline, "stroke-width": 1.5 });
  else {
    const r = Math.min(6, s.size / 2),
      common = { fill: s.fill, stroke: markerOutline.stroke, "stroke-width": markerOutline.width };
    if (s.shape === "circle") shape("circle", { cx: 7, cy: 7, r, ...common });
    else if (s.shape === "square") shape("rect", { x: 7 - r, y: 7 - r, width: 2 * r, height: 2 * r, ...common });
    else if (s.shape === "triangle") shape("path", { d: `M7 ${7 - r}L${7 + r} ${7 + r * 0.8}H${7 - r}Z`, ...common });
    else shape("path", { d: `M7 ${7 - r}L${7 + r} 7L7 ${7 + r}L${7 - r} 7Z`, ...common });
  }
  return svg;
}

/**
 * @param {HTMLElement} root the container (emptied)
 * @param {import("./layers.mjs").LayerTree} layers
 */
/**
 * @param {{onStyle?: (leaf: string) => void, onAddBasemap?: () => void}} [o] `onStyle` opens a layer's
 * style (the water depth); `onAddBasemap` opens the basemap picker
 */
export function layersPanel(root, layers, { onStyle, onAddBasemap } = {}) {
  const checks = new Map(), // id → checkbox (leaves, groups, categories)
    rows = new Map(), // leaf → row element
    groupBoxes = new Map(), // group id → element
    sections = new Map(), // category id → section
    moves = new Map(), // category id → [up, down]
    counts = new Map(), // leaf → count element
    sliders = new Map();
  const checkbox = (id, extra = {}) => {
    const box = el("input", { type: "checkbox", ...extra });
    box.onchange = () => layers.setVisible(id, box.checked);
    checks.set(id, box);
    return box;
  };
  let note, scale, legendRow, ramp, classes, bmRows, streakLegend, streakRamp, streakScale;
  /** One leaf's row (and, for some leaves, what follows it) appended to `host`. */
  function leafRow(leaf, host, nested) {
    const count = el("small", { className: "layer-count" });
    counts.set(leaf, count);
    const row = el(
      "div",
      { className: "layer-row" + (nested ? " nested" : "") },
      el("label", { className: "check" }, checkbox(leaf, leaf === "basemap" ? { id: "basemap" } : {}), swatch(leaf), el("span", { textContent: layers.label(leaf) })),
      count,
    );
    rows.set(leaf, row);
    host.append(row);
    if ((leaf === "depth" || leaf === "streaks") && onStyle) {
      const style = el("button", { type: "button", className: "tb ghost layer-style", textContent: "Style…", ariaLabel: layers.label(leaf) + " style" });
      style.onclick = () => onStyle(leaf);
      row.append(style);
    }
    if (leaf === "streaks") {
      // Colored by speed: the ramp and its range.
      streakRamp = el("span", { className: "ramp" });
      streakScale = el("span", { className: "scale" });
      streakLegend = el("div", { className: "layer-legend" }, streakRamp, streakScale);
      host.append(streakLegend);
    }
    if (leaf === "depth") {
      scale = el("span", { id: "scale" });
      ramp = el("span", { className: "ramp" });
      classes = el("ul", { className: "layer-classes", ariaLabel: "Water depth classes" });
      legendRow = el("div", { className: "layer-legend" }, ramp, classes, scale);
      host.append(legendRow);
    }
    if (leaf.startsWith("bm-")) {
      // A stacked raster basemap: its order among the rasters, its own opacity, remove.
      const name = layers.label(leaf),
        b = layers.basemapRow(leaf);
      const tool = (label, icon, onclick, cls = "") => {
        const t = el("button", { type: "button", className: "tb icon ghost " + cls, ariaLabel: label, title: label });
        t.innerHTML = '<svg aria-hidden="true"><use href="#' + icon + '" /></svg>';
        t.onclick = onclick;
        return t;
      };
      const up = tool("Move " + name + " up", "i-chevron", () => layers.moveBasemap(leaf, -1), "layer-move up"),
        down = tool("Move " + name + " down", "i-chevron", () => layers.moveBasemap(leaf, 1), "layer-move");
      up.disabled = !layers.canMoveBasemap(leaf, -1);
      down.disabled = !layers.canMoveBasemap(leaf, 1);
      const opacity = el("input", { type: "range", min: 0, max: 100, step: 5, value: Math.round(b.opacity * 100), ariaLabel: name + " opacity" });
      opacity.oninput = () => layers.setBasemapOpacity(leaf, opacity.value / 100);
      host.append(el("div", { className: "layer-bm" }, up, down, opacity, tool("Remove " + name, "i-close", () => layers.removeBasemap(leaf))));
    }
  }
  for (const cat of layers.categories()) {
    const head = el(
      "div",
      { className: "layer-head" },
      el("label", { className: "check" }, checkbox(cat.id), el("b", { textContent: cat.label })),
    );
    if (!cat.fixed) {
      const button = (delta, text) => {
        const b = el("button", { type: "button", className: "tb icon ghost layer-move" + (delta < 0 ? " up" : "") });
        b.setAttribute("aria-label", "Move " + cat.label + " " + text);
        b.innerHTML = '<svg aria-hidden="true"><use href="#i-chevron" /></svg>';
        b.onclick = () => layers.move(cat.id, delta);
        return b;
      };
      const up = button(-1, "up"),
        down = button(1, "down");
      moves.set(cat.id, [up, down]);
      head.append(el("span", { className: "spacer" }), up, down);
    }
    const section = el("section", { className: "sect layer-cat" }, head);
    section.dataset.cat = cat.id;
    for (const group of cat.groups) {
      const box = el("div", { className: "layer-group" });
      if (group.label)
        box.append(
          el("label", { className: "check layer-sub" }, checkbox(group.id), el("span", { textContent: group.label })),
        );
      if (cat.id === "basemaps") {
        // The basemap stack is rebuilt when it changes (rows come and go); what follows it stays.
        bmRows = el("div", { className: "layer-bmrows" });
        box.append(bmRows);
        for (const leaf of layers.leaves("basemaps")) leafRow(leaf, bmRows, false);
        const add = el("button", { type: "button", className: "tb ghost wide", id: "addbasemap" });
        add.innerHTML = '<svg aria-hidden="true"><use href="#i-plus" /></svg>Add basemap…';
        add.onclick = () => onAddBasemap?.();
        note = el("small", { id: "mapstatus" });
        const locate = el("button", { type: "button", id: "locate", className: "tb ghost wide" });
        locate.innerHTML = '<svg aria-hidden="true"><use href="#i-pin" /></svg>Set map reference';
        box.append(add, note, locate);
      } else for (const leaf of group.rows) leafRow(leaf, box, !!group.label);
      if (group.id) groupBoxes.set(group.id, box);
      section.append(box);
    }
    const slider = el("input", { type: "range", min: 0, max: 100, step: 5, value: 100 });
    slider.setAttribute("aria-label", cat.label + " opacity");
    slider.oninput = () => layers.setOpacity(cat.id, slider.value / 100);
    sliders.set(cat.id, slider);
    section.append(el("label", { className: "layer-opacity" }, el("span", { textContent: "Opacity" }), slider));
    sections.set(cat.id, section);
  }
  root.replaceChildren(...sections.values());

  const fmt = (n) => n.toLocaleString();
  function update() {
    root.append(...layers.order.map((id) => sections.get(id))); // tree order
    for (const cat of layers.categories()) {
      sections.get(cat.id).hidden = !layers.present(cat.id);
      const [up, down] = moves.get(cat.id) || [];
      if (up) {
        up.disabled = !layers.canMove(cat.id, -1);
        down.disabled = !layers.canMove(cat.id, 1);
      }
      sliders.get(cat.id).value = Math.round(layers.opacity(cat.id) * 100);
      for (const group of cat.groups) if (group.id) groupBoxes.get(group.id).hidden = !layers.present(group.id);
    }
    for (const [id, box] of checks) {
      if (rows.has(id)) {
        rows.get(id).hidden = !layers.present(id);
        box.checked = !!layers.on[id];
        box.indeterminate = false;
        box.disabled = !layers.enabled(id);
        const n = layers.count(id);
        counts.get(id).textContent = n === null ? "" : fmt(n);
      } else {
        const s = layers.state(id);
        box.checked = s === "on";
        box.indeterminate = s === "mixed";
      }
    }
    note.textContent = layers.note("basemap");
    const sl = layers.legend("streaks");
    if (streakLegend) {
      streakLegend.hidden = !layers.visible("streaks") || !sl?.ramp;
      if (sl?.ramp) {
        streakRamp.style.background = "linear-gradient(to right, " + sl.ramp.join(", ") + ")";
        streakScale.textContent = "0 — " + String(+sl.max.toPrecision(3)) + " " + sl.unit;
      }
      const sw = rows.get("streaks")?.querySelector(".sw");
      if (sw) sw.style.background = sl?.color || "";
    }
    const legend = layers.legend("depth");
    legendRow.hidden = !layers.visible("depth") || !legend;
    if (legend) {
      const v = (x) => String(+x.toPrecision(3));
      // Classes: a swatch and its range each; a continuous ramp: the gradient and its range; or a note
      // that no water is deeper than the threshold.
      ramp.hidden = !!legend.classes || !!legend.empty;
      if (legend.ramp) ramp.style.background = "linear-gradient(to right, " + legend.ramp.join(", ") + ")";
      classes.replaceChildren(
        ...(legend.classes || []).map((k) => {
          const sw = el("span", { className: "sw" });
          sw.style.background = k.color;
          return el("li", {}, sw, el("span", { textContent: v(k.from) + (k.last ? "+" : " – " + v(k.to)) + " " + legend.unit }));
        }),
      );
      scale.hidden = !!legend.classes;
      scale.textContent = legend.empty ? "No water deeper than " + v(legend.min) + " " + legend.unit : v(legend.min) + " — " + v(legend.max) + " " + legend.unit;
    }
  }
  layers.addEventListener("change", ({ detail }) => {
    if (detail.kind === "basemaps") {
      for (const leaf of [...rows.keys()]) if (leaf === "buildings" || leaf === "basemap" || leaf.startsWith("bm-")) [rows, checks, counts].forEach((m) => m.delete(leaf));
      bmRows.replaceChildren();
      for (const leaf of layers.leaves("basemaps")) leafRow(leaf, bmRows, false);
    }
    update();
  });
  update();
}
