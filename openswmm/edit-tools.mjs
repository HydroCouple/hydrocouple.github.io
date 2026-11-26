/**
 * Map editing tools (view): the "Add" palette beside the map tools, as the desktop's Add tools list
 * them — nodes, links and rain gages — each drawn with its map symbol. Picking one arms the map's add
 * tool (view.mjs `setTool("add", spec)`); the map then places, inserts or traces it through the
 * editing session (editor.mjs `mapEdit`).
 */
import { swatch } from "./layers-panel.mjs";

/** What can be added on the map: `type` is the engine type, `leaf` the layer row whose symbol it uses. */
export const addKinds = [
  {
    group: "Nodes",
    items: [
      { kind: "node", type: "JUNCTION", label: "Junction", noun: "junction", leaf: "junctions" },
      { kind: "node", type: "OUTFALL", label: "Outfall", noun: "outfall", leaf: "outfalls" },
      { kind: "node", type: "DIVIDER", label: "Flow divider", noun: "flow divider", leaf: "dividers" },
      { kind: "node", type: "STORAGE", label: "Storage unit", noun: "storage unit", leaf: "storage" },
      { kind: "node", type: "JUNCTION", virtual: true, label: "Virtual junction", noun: "virtual junction", leaf: "junctions" },
    ],
  },
  {
    group: "Links",
    items: [
      { kind: "link", type: "CONDUIT", label: "Conduit", noun: "conduit", leaf: "conduits" },
      { kind: "link", type: "PUMP", label: "Pump", noun: "pump", leaf: "pumps" },
      { kind: "link", type: "ORIFICE", label: "Orifice", noun: "orifice", leaf: "orifices" },
      { kind: "link", type: "WEIR", label: "Weir", noun: "weir", leaf: "weirs" },
      { kind: "link", type: "OUTLET", label: "Outlet", noun: "outlet", leaf: "outlets" },
    ],
  },
  { group: "Other", items: [{ kind: "gage", type: "GAGE", label: "Rain gage", noun: "rain gage", leaf: "gages" }] },
];

/** What a click does with an add tool armed (the desktop's status text). */
export function addHint(spec) {
  if (spec.kind === "gage") return "Click to place a rain gage. Esc ends.";
  if (spec.kind === "link")
    return "Click a node to start the " + spec.noun + ", click to add bends, click another node to end it. Backspace drops a bend; Esc ends.";
  if (spec.virtual) return "Click a conduit to insert a virtual junction at that point. Esc ends.";
  if (spec.type === "OUTFALL") return "Click to place an outfall. Outfalls end a network, so they cannot be inserted on a conduit. Esc ends.";
  return "Click to place a " + spec.noun + ", or click a conduit to split it and insert the " + spec.noun + " there. Esc ends.";
}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * Build the palette into `root` (emptied) and open it from `button`. `onPick(spec)` arms a tool;
 * the palette closes on a pick, on Escape and on a click elsewhere.
 */
export function addPalette({ root, button, onPick }) {
  const close = () => {
    root.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  root.replaceChildren(
    ...addKinds.map(({ group, items }) =>
      el(
        "div",
        { className: "add-group", role: "group", ariaLabel: group + " to add" }, // not the layer tree's "Nodes"/"Links"
        el("small", { textContent: group }),
        ...items.map((spec) => {
          const item = el("button", { type: "button", className: "add-item", role: "menuitem" }, swatch(spec.leaf), el("span", { textContent: spec.label }));
          if (spec.virtual) item.classList.add("virtual");
          item.onclick = () => {
            close();
            onPick(spec);
          };
          return item;
        }),
      ),
    ),
  );
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.onclick = () => {
    const open = root.hidden;
    root.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) root.querySelector("button")?.focus();
  };
  // Escape closes the palette only (captured before the map's own Escape handling).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || root.hidden) return;
      e.stopPropagation();
      close();
      button.focus();
    },
    true,
  );
  document.addEventListener("pointerdown", (e) => {
    if (!root.hidden && !root.contains(e.target) && !button.contains(e.target)) close();
  });
  return { close };
}
