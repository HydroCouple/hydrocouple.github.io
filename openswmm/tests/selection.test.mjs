// Selection model and picking (interaction phase V1): the shared selection the map, the inspector
// and the plots observe, and the screen-space hit tests the map view uses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SelectionModel, modeFor, describeSelection, pickAt, pickInRect, pickInPolygon, inside } from "../selection.mjs";

const J1 = { kind: "node", id: "J1", type: "junction" },
  J2 = { kind: "node", id: "J2", type: "junction" },
  C1 = { kind: "link", id: "C1", type: "conduit" },
  S1 = { kind: "subcatchment", id: "S1" };

test("replace, add, toggle and subtract follow the desktop's modifiers; the last added is primary", () => {
  assert.equal(modeFor({}), "replace");
  assert.equal(modeFor({ shiftKey: true }), "add");
  assert.equal(modeFor({ ctrlKey: true }), "toggle");
  assert.equal(modeFor({ metaKey: true }), "toggle");
  assert.equal(modeFor({ altKey: true, shiftKey: true }), "subtract");
  const s = new SelectionModel();
  const events = [];
  s.addEventListener("change", (e) => events.push(e.detail));
  s.apply([J1], "replace", "map");
  s.apply([C1, J1], "add", "map"); // J1 moves to the end: it was picked again
  assert.deepEqual(s.items.map((i) => i.id), ["C1", "J1"]);
  assert.equal(s.primary.id, "J1");
  s.apply([J1, J2], "toggle");
  assert.deepEqual(s.items.map((i) => i.id), ["C1", "J2"]);
  s.apply([C1], "subtract");
  assert.deepEqual(s.items.map((i) => i.id), ["J2"]);
  assert.equal(s.apply([J2], "replace"), false, "no change, no event");
  s.clear("inspector");
  assert.equal(s.count, 0);
  assert.equal(events.length, 5);
  assert.deepEqual(events[0], { items: [J1], added: [J1], removed: [], source: "map" });
  assert.deepEqual(events[4].removed.map((i) => i.id), ["J2"]);
  assert.equal(events[4].source, "inspector");
  assert.ok(new SelectionModel().apply([{ kind: "cell", id: 7 }]) && true);
});

test("a selection is described in one line", () => {
  assert.equal(describeSelection([]), "");
  assert.equal(describeSelection([J1]), "J1 · junction");
  assert.equal(describeSelection([{ kind: "cell", id: "12" }]), "Cell 12");
  assert.equal(describeSelection([J1, J2, C1]), "3 selected · 2 nodes, 1 link");
});

// A scene in screen pixels: two nodes, a link between them, a subcatchment, cells.
const scene = {
  points: [
    { kind: "gage", id: "RG", x: 200, y: 200, r: 5 },
    { kind: "node", id: "J1", type: "junction", x: 10, y: 10, r: 4 },
    { kind: "node", id: "J2", type: "junction", x: 110, y: 10, r: 4 },
  ],
  lines: [{ kind: "link", id: "C1", type: "conduit", pts: [[10, 10], [60, 40], [110, 10]] }],
  areas: [{ kind: "subcatchment", id: "S1", ring: [[0, 50], [100, 50], [100, 150], [0, 150]], cx: 50, cy: 100 }],
  cellAt: (x, y) => (x > 120 && x < 180 && y > 60 && y < 140 ? 0 : undefined),
};

test("a click picks the marker, then the link, then the area, then the cell under it", () => {
  assert.deepEqual(pickAt(scene, 12, 12), { kind: "node", id: "J1", type: "junction" });
  assert.deepEqual(pickAt(scene, 36, 26), { kind: "link", id: "C1", type: "conduit" }, "on the first segment");
  assert.deepEqual(pickAt(scene, 60, 45), { kind: "link", id: "C1", type: "conduit" }, "within the tolerance (5 px)");
  assert.equal(pickAt(scene, 60, 47.5), null, "outside it (7.5 px)");
  assert.deepEqual(pickAt(scene, 50, 120), { kind: "subcatchment", id: "S1" });
  assert.deepEqual(pickAt(scene, 150, 100), { kind: "cell", id: "0" });
  assert.equal(pickAt(scene, 400, 400), null);
});

test("box and lasso take points inside, links with a vertex inside and areas by their centroid, never cells", () => {
  assert.deepEqual(pickInRect(scene, [0, 0, 70, 60]).map((i) => i.id), ["J1", "C1"]);
  assert.deepEqual(pickInRect(scene, [400, 400, 0, 0]).map((i) => i.id).sort(), ["C1", "J1", "J2", "RG", "S1"]);
  const lasso = [[-5, -5], [130, -5], [130, 30], [-5, 30]];
  assert.deepEqual(pickInPolygon(scene, lasso).map((i) => i.id), ["J1", "J2", "C1"]);
  assert.deepEqual(pickInPolygon(scene, [[0, 0], [1, 1]]), [], "a lasso needs three points");
  assert.equal(inside([[0, 0], [10, 0], [10, 10], [0, 10]], 5, 5), true);
  assert.equal(inside([[0, 0], [10, 0], [10, 10], [0, 10]], 15, 5), false);
});
