// Profiles (interaction phase V3): the deck's network, routing, the pipe profile's geometry (offsets in
// both LINK_OFFSETS modes, a node's rim when its full depth is 0), terrain sampling, the ProfileSet model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { networkOf, route, pipeProfile, peakIndex, lineSamples, atSamples, ProfileSet } from "../profiles.mjs";

const deck = (offsets, c1) => `
[OPTIONS]
FLOW_UNITS CMS
LINK_OFFSETS ${offsets}
[JUNCTIONS]
;;Name Elev MaxDepth
J1 10 3
J2 9 0
J3 8 2.5
J9 5 1
[OUTFALLS]
O1 7 FREE
[CONDUITS]
C1 J1 J2 100 0.013 ${c1}
C2 J2 J3 120 0.013 0.1 0
C3 J3 O1 80 0.013 0 0
C4 J1 J3 500 0.013 0 0
[WEIRS]
W1 J2 O1 TRANSVERSE 0.5 1.84
[XSECTIONS]
C1 CIRCULAR 1 0 0 0 1
C2 CIRCULAR 0.8 0 0 0 1
C3 CIRCULAR 1.2 0 0 0 1
C4 CIRCULAR 0.5 0 0 0 1
W1 RECT_OPEN 0.4 2 0 0
[COORDINATES]
J1 0 0
J2 100 0
J3 220 0
O1 300 50
J9 900 900
[VERTICES]
C2 160 10
`;

test("the deck's network: nodes, links, offsets mode and unit", () => {
  const net = networkOf(deck("DEPTH", "0 0.2"));
  assert.equal(net.nodes.size, 5);
  assert.equal(net.links.length, 5);
  assert.equal(net.offsets, "DEPTH");
  assert.equal(net.unit, "m");
  assert.equal(net.nodes.get("J2").maxDepth, 0);
  assert.deepEqual(net.links.find((l) => l.id === "C2").vertices, [[160, 10]]);
  assert.equal(net.links.find((l) => l.id === "W1").height, 0.4);
  assert.equal(networkOf("[OPTIONS]\nFLOW_UNITS GPM\n").unit, "ft");
});

test("routing takes the shortest path either way along links, through waypoints", () => {
  const net = networkOf(deck("DEPTH", "0 0.2"));
  const p = route(net, ["J1", "O1"]);
  assert.deepEqual(p.nodes, ["J1", "J2", "J3", "O1"], "100 + 120 + 80 beats C4 (500) and the weir (100 + 206)");
  assert.deepEqual(p.links.map((l) => l.id), ["C1", "C2", "C3"]);
  const back = route(net, ["O1", "J1"]);
  assert.deepEqual(back.links.map((l) => l.reversed), [true, true, true]);
  assert.deepEqual(route(net, ["J1", "J2", "O1"]).nodes, ["J1", "J2", "J3", "O1"]);
  assert.match(route(net, ["J1", "J9"]).error, /No connected path from J1 to J9/);
  assert.match(route(net, ["J1", "J1"]).error, /two different nodes/);
});

test("a pipe profile: distances, bottoms from offsets, rims, the map line", () => {
  const net = networkOf(deck("DEPTH", "0 0.2"));
  const p = pipeProfile(net, route(net, ["J1", "O1"]));
  assert.deepEqual(p.stations.map((s) => s.d), [0, 100, 220, 300]);
  const [c1, c2, c3] = p.segments;
  assert.deepEqual([c1.bottom0, c1.bottom1, c1.height], [10, 9.2, 1], "DEPTH offsets add to the node inverts");
  assert.deepEqual([c2.bottom0, c2.bottom1], [9.1, 8]);
  const rim = Object.fromEntries(p.stations.map((s) => [s.id, s.rim]));
  assert.equal(rim.J1, 13);
  assert.equal(rim.J2, 10.2, "full depth 0: the highest crown at the node (C1's 9.2 + 1)");
  assert.equal(rim.O1, 8.2, "an outfall reaches its crown");
  assert.deepEqual(p.mapLine, [[0, 0], [100, 0], [160, 10], [220, 0], [300, 50]]);
  // Reversed travel takes each link's offsets from the other end.
  const r = pipeProfile(net, route(net, ["J3", "J1"]));
  assert.deepEqual([r.segments[0].bottom0, r.segments[0].bottom1], [8, 9.1]);
  assert.deepEqual(r.mapLine, [[220, 0], [160, 10], [100, 0], [0, 0]]);
  // ELEVATION offsets are elevations; "*" is the node's invert.
  const e = networkOf(deck("ELEVATION", "* 9.5"));
  const s = pipeProfile(e, route(e, ["J1", "J2"])).segments[0];
  assert.deepEqual([s.bottom0, s.bottom1], [10, 9.5]);
});

test("a profile opens at the time the path holds the most water", () => {
  const stations = [
    { id: "A", invert: 10 },
    { id: "B", invert: 9 },
  ];
  const heads = new Map([
    ["A", [10, 10.5, 11.2, 10.4]],
    ["B", [9, 9.8, 9.6, 9.2]],
  ]);
  assert.equal(peakIndex(stations, heads, 4), 2);
});

test("terrain samples interpolate a vertex field exactly (a linear field) and are NaN off the mesh", () => {
  // The unit square as two triangles, scaled 10 m; z = x + 2y.
  const geo = { x: [0, 10, 10, 0], y: [0, 0, 10, 10], cells: [[0, 1, 2], [0, 2, 3]] };
  const inside = (c, x, y) => {
    const [a, b, d] = geo.cells[c];
    const s = (p, q, x, y) => (geo.x[q] - geo.x[p]) * (y - geo.y[p]) - (geo.y[q] - geo.y[p]) * (x - geo.x[p]);
    const v = [s(a, b, x, y), s(b, d, x, y), s(d, a, x, y)];
    return v.every((t) => t >= -1e-9) || v.every((t) => t <= 1e-9);
  };
  const locate = (x, y) => [0, 1].find((c) => inside(c, x, y));
  const { samples, length } = lineSamples(geo, locate, [[1, 1], [9, 5], [14, 5]], 41);
  assert.equal(samples.length, 41);
  assert.ok(Math.abs(length - (Math.hypot(8, 4) + 5)) < 1e-9);
  const z = atSamples(samples, geo.x.map((x, k) => x + 2 * geo.y[k]));
  samples.forEach((s, i) => {
    if (s.x <= 10) assert.ok(Math.abs(z[i] - (s.x + 2 * s.y)) < 1e-9, "exact at " + s.x + "," + s.y);
    else assert.ok(Number.isNaN(z[i]), "off the mesh");
  });
  assert.equal(samples[0].d, 0);
  assert.ok(Math.abs(samples[40].d - length) < 1e-9);
});

test("ProfileSet: tabs open, show, close; data and time per profile", () => {
  const set = new ProfileSet();
  const events = [];
  set.addEventListener("change", ({ detail }) => events.push(detail.kind));
  const a = set.add({ kind: "pipe", title: "J1 → O1" });
  const b = set.add({ kind: "terrain", title: "Line 1" });
  assert.equal(set.active, b, "a new profile is shown");
  set.setActive("series");
  assert.equal(set.active, "series");
  set.setActive("nope");
  assert.equal(set.active, "series");
  set.setActive(a);
  set.setData(a, { seconds: [0, 60] });
  set.setIndex(a, 1);
  assert.equal(set.get(a).index, 1);
  set.remove(a);
  assert.equal(set.active, b, "closing the shown tab shows a neighbor");
  set.remove(b);
  assert.equal(set.active, "series");
  assert.deepEqual(events, ["profiles", "profiles", "active", "active", "data", "time", "profiles", "profiles"]);
});
