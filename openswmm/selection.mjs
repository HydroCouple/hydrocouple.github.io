/**
 * Selection (interaction phase V1): the shared selection model the map, the inspector and (later)
 * the plots observe, as the desktop GUI's SelectionManager, and pure picking functions over a
 * screen-space scene the map view builds.
 *
 * An item is `{kind, id, type?}`: kind is node, link, subcatchment, gage or cell (a cell's id is its
 * index as text); `type` (junction, conduit, …) is for display only. Items are equal by kind and id.
 */
const key = (item) => item.kind + ":" + item.id;

/** The selection mode a pointer event's modifiers ask for (as the desktop: Shift adds, Ctrl/Cmd toggles, Alt subtracts). */
export function modeFor(e = {}) {
  if (e.altKey) return "subtract";
  if (e.ctrlKey || e.metaKey) return "toggle";
  if (e.shiftKey) return "add";
  return "replace";
}

export class SelectionModel extends EventTarget {
  constructor() {
    super();
    this.list = [];
  }
  /** The selected items, oldest first. */
  get items() {
    return this.list.slice();
  }
  get count() {
    return this.list.length;
  }
  /** The item the inspector shows: the one added last. */
  get primary() {
    return this.list[this.list.length - 1] ?? null;
  }
  has(kind, id) {
    return this.list.some((i) => i.kind === kind && i.id === String(id));
  }
  /**
   * Change the selection. mode: replace (default), add, toggle or subtract. `source` names who asked
   * (map, inspector, …) so a view can skip its own changes. Fires `change` only when it changed.
   */
  apply(items, mode = "replace", source = "") {
    const given = [];
    const seen = new Set();
    for (const item of items || []) {
      const it = { ...item, id: String(item.id) };
      if (!seen.has(key(it))) {
        seen.add(key(it));
        given.push(it);
      }
    }
    let next;
    if (mode === "add") next = [...this.list.filter((i) => !seen.has(key(i))), ...given];
    else if (mode === "subtract") next = this.list.filter((i) => !seen.has(key(i)));
    else if (mode === "toggle") {
      const now = new Set(this.list.map(key));
      next = [...this.list.filter((i) => !seen.has(key(i))), ...given.filter((i) => !now.has(key(i)))];
    } else next = given;
    const before = new Set(this.list.map(key)),
      after = new Set(next.map(key));
    const added = next.filter((i) => !before.has(key(i))),
      removed = this.list.filter((i) => !after.has(key(i)));
    const sameOrder = next.length === this.list.length && next.every((i, n) => key(i) === key(this.list[n]));
    if (sameOrder) return false;
    this.list = next;
    this.dispatchEvent(new CustomEvent("change", { detail: { items: this.items, added, removed, source } }));
    return true;
  }
  set(items, source = "") {
    return this.apply(items, "replace", source);
  }
  clear(source = "") {
    return this.apply([], "replace", source);
  }
}

/** One line describing a selection: "J12 · junction", "5 selected · 3 nodes, 2 links". */
export function describeSelection(items) {
  if (!items.length) return "";
  if (items.length === 1) {
    const i = items[0];
    return i.kind === "cell" ? "Cell " + i.id : i.id + " · " + (i.type || i.kind);
  }
  const counts = {};
  for (const i of items) counts[i.kind] = (counts[i.kind] || 0) + 1;
  const plural = { node: "nodes", link: "links", subcatchment: "subcatchments", gage: "rain gages", cell: "cells" };
  const single = { node: "node", link: "link", subcatchment: "subcatchment", gage: "rain gage", cell: "cell" };
  return (
    items.length +
    " selected · " +
    Object.entries(counts)
      .map(([k, n]) => n + " " + (n === 1 ? single[k] : plural[k]))
      .join(", ")
  );
}

// ---- Picking over a screen-space scene ---------------------------------------------------------
// scene = {
//   points: [{kind, id, type, x, y, r}]          gages first, then nodes (hit priority)
//   lines:  [{kind, id, type, pts: [[x, y], …]}]  links
//   areas:  [{kind, id, type, ring: [[x, y], …], cx, cy}]  subcatchments
//   cellAt: (x, y) => index | undefined           2D cell under a point (click)
// }
// Box and lasso select network objects only; 2D cells are picked one at a time (the desktop keeps
// cell picking in a tool of its own).

/** Whether (x, y) lies inside a polygon (even-odd rule). */
export function inside(ring, x, y) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function segmentDistance([ax, ay], [bx, by], x, y) {
  const dx = bx - ax,
    dy = by - ay,
    len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}
const item = ({ kind, id, type }) => (type ? { kind, id: String(id), type } : { kind, id: String(id) });

/** The object under a screen point: a gage or node marker, else a link within `tol` px, else a subcatchment, else a 2D cell; null for none. */
export function pickAt(scene, x, y, tol = 6) {
  let best = null,
    bestD = Infinity;
  for (const p of scene.points || []) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= Math.max(p.r || 0, tol) && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best) return item(best);
  for (const l of scene.lines || [])
    for (let i = 1; i < l.pts.length; i++) {
      const d = segmentDistance(l.pts[i - 1], l.pts[i], x, y);
      if (d <= tol && d < bestD) {
        best = l;
        bestD = d;
      }
    }
  if (best) return item(best);
  // The last area drawn is on top.
  const areas = scene.areas || [];
  for (let i = areas.length - 1; i >= 0; i--) if (inside(areas[i].ring, x, y)) return item(areas[i]);
  const cell = scene.cellAt?.(x, y);
  return cell === undefined || cell < 0 ? null : { kind: "cell", id: String(cell) };
}

function pickWhere(scene, within) {
  const out = [];
  for (const p of scene.points || []) if (within(p.x, p.y)) out.push(item(p));
  for (const l of scene.lines || []) if (l.pts.some(([x, y]) => within(x, y))) out.push(item(l));
  for (const a of scene.areas || []) if (within(a.cx, a.cy)) out.push(item(a));
  return out;
}
/** Objects in a screen rectangle [x0, y0, x1, y1]: points inside, links with a vertex inside, areas whose centroid is inside. */
export function pickInRect(scene, [x0, y0, x1, y1]) {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0],
    [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
  return pickWhere(scene, (x, y) => x >= l && x <= r && y >= t && y <= b);
}
/** Objects in a screen polygon (lasso), by the same rules as pickInRect. */
export function pickInPolygon(scene, ring) {
  if (ring.length < 3) return [];
  return pickWhere(scene, (x, y) => inside(ring, x, y));
}
