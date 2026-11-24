/**
 * Workbench panels. `PanelLayout` is the model: which panels are open and how wide the side panels
 * are, remembered in this browser. `panelChrome` is the view: it shows the panels as the layout says,
 * and its splitters, collapse buttons, toolbar toggles and rail button send changes to the layout.
 */
export const widths = { min: 200, max: 640, left: 272, right: 300 };
const sides = ["left", "bottom", "right"];

export class PanelLayout extends EventTarget {
  /** @param {{storage?: Storage, key?: string}} [o] where the layout is remembered */
  constructor({ storage, key = "openswmm.panels" } = {}) {
    super();
    this.key = key;
    try {
      this.storage = storage ?? globalThis.localStorage;
    } catch {
      this.storage = null; // storage blocked: the layout lasts for this page only
    }
    this.state = { left: true, bottom: true, right: true, leftWidth: widths.left, rightWidth: widths.right };
    try {
      const saved = JSON.parse(this.storage?.getItem(key) || "{}");
      for (const side of sides) if (typeof saved[side] === "boolean") this.state[side] = saved[side];
      for (const side of ["left", "right"])
        if (Number.isFinite(saved[side + "Width"])) this.state[side + "Width"] = clamp(saved[side + "Width"]);
    } catch {}
  }
  isOpen(side) {
    return this.state[side];
  }
  setOpen(side, open) {
    if (this.state[side] === !!open) return;
    this.state[side] = !!open;
    this.save(side);
  }
  toggle(side) {
    this.setOpen(side, !this.state[side]);
  }
  width(side) {
    return this.state[side + "Width"];
  }
  /** A side panel's width in CSS pixels, kept within `widths.min` … `widths.max`. */
  setWidth(side, px) {
    const w = clamp(px);
    if (this.state[side + "Width"] === w) return;
    this.state[side + "Width"] = w;
    this.save(side);
  }
  resetWidth(side) {
    this.setWidth(side, widths[side]);
  }
  save(side) {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.state));
    } catch {}
    this.dispatchEvent(new CustomEvent("change", { detail: { side } }));
  }
}
function clamp(px) {
  return Math.round(Math.min(widths.max, Math.max(widths.min, Number(px))));
}

const $ = (id) => document.getElementById(id);
const label = { left: "layers panel", right: "inspector" };

/** Show the panels as `layout` says and wire every control that changes it. */
export function panelChrome(layout) {
  const separators = {};
  for (const side of ["left", "right"]) {
    const panel = $(side);
    // Collapse button in the panel's header.
    const collapse = document.createElement("button");
    Object.assign(collapse, { type: "button", className: "tb icon ghost panel-collapse " + side });
    collapse.setAttribute("aria-label", "Collapse " + label[side]);
    collapse.innerHTML = '<svg aria-hidden="true"><use href="#i-chevron" /></svg>';
    collapse.onclick = () => layout.setOpen(side, false);
    panel.querySelector(".panel-h").append(collapse);
    // Splitter on the panel's inner edge: drag, arrow keys, Home/End, double-click to reset.
    const bar = document.createElement("div");
    Object.assign(bar, { className: "splitter " + side, tabIndex: 0 });
    bar.setAttribute("role", "separator");
    bar.setAttribute("aria-orientation", "vertical");
    bar.setAttribute("aria-controls", side);
    bar.setAttribute("aria-label", "Resize " + label[side]);
    bar.setAttribute("aria-valuemin", String(widths.min));
    bar.setAttribute("aria-valuemax", String(widths.max));
    // Wider is toward the map: right for the left panel, left for the right panel.
    const grow = side === "left" ? 1 : -1;
    bar.onpointerdown = (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const x0 = e.clientX,
        w0 = layout.width(side);
      bar.classList.add("dragging");
      bar.onpointermove = (m) => layout.setWidth(side, w0 + grow * (m.clientX - x0));
      bar.onpointerup = bar.onpointercancel = () => {
        bar.onpointermove = bar.onpointerup = bar.onpointercancel = null;
        bar.classList.remove("dragging");
      };
    };
    bar.ondblclick = () => layout.resetWidth(side);
    bar.onkeydown = (e) => {
      const step = e.shiftKey ? 64 : 16;
      const key = {
        ArrowRight: layout.width(side) + grow * step,
        ArrowLeft: layout.width(side) - grow * step,
        Home: widths.min,
        End: widths.max,
      }[e.key];
      if (key === undefined) return;
      e.preventDefault();
      layout.setWidth(side, key);
    };
    if (side === "left") panel.after(bar);
    else panel.before(bar);
    separators[side] = bar;
  }
  for (const side of sides) $("toggle" + side).onclick = () => layout.toggle(side);
  $("raillayers").onclick = () => layout.toggle("left");

  function show() {
    for (const side of sides) {
      const open = layout.isOpen(side);
      $(side).hidden = !open;
      const b = $("toggle" + side);
      b.classList.toggle("on", open);
      b.setAttribute("aria-pressed", String(open));
      if (separators[side]) {
        separators[side].hidden = !open;
        $(side).style.width = layout.width(side) + "px";
        separators[side].setAttribute("aria-valuenow", String(layout.width(side)));
      }
    }
    $("raillayers").classList.toggle("on", layout.isOpen("left"));
  }
  layout.addEventListener("change", show);
  show();
}
