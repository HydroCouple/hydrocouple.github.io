// Water depth styling (interaction phase V4a): class breaks, ramps, levels, and the contour band and
// line geometry on mesh triangles, checked against areas and interpolated values.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classBreaks, contourLevels, triangles, vertexValues, contourBands, isolines, chainSegments, rampColor, DepthStyle } from "../depth-style.mjs";

// A deterministic pseudo-random sequence.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const at = (xy, [a, b, t]) => [xy[a][0] + t * (xy[b][0] - xy[a][0]), xy[a][1] + t * (xy[b][1] - xy[a][1])];
const valueAt = (vals, [a, b, t]) => vals[a] + t * (vals[b] - vals[a]);
const area = (pts) => Math.abs(pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y; }, 0)) / 2;

test("filled bands tile each triangle exactly and every band point lies inside its band", () => {
  for (let trial = 0; trial < 300; trial++) {
    const xy = [[rand() * 10, rand() * 10], [rand() * 10, rand() * 10], [rand() * 10, rand() * 10]];
    const vals = [rand() * 3, rand() * 3, rand() * 3];
    const tris = Int32Array.from([0, 1, 2]);
    const breaks = [0, 0.4, 0.9, 1.3, 2.2];
    const bands = contourBands(tris, vals, breaks);
    const total = bands.flat().reduce((s, poly) => s + area(poly.map((p) => at(xy, p))), 0);
    assert.ok(Math.abs(total - area(xy)) < 1e-9 * Math.max(1, area(xy)), "areas add up (trial " + trial + ")");
    bands.forEach((polys, k) => {
      const last = k === bands.length - 1;
      for (const poly of polys)
        for (const p of poly) {
          const v = valueAt(vals, p);
          assert.ok(v >= breaks[k] - 1e-9 && (last || v <= breaks[k + 1] + 1e-9), "band " + k + " value " + v);
        }
    });
  }
});

test("values below the first break are not drawn; above the last they take the top band", () => {
  const tris = Int32Array.from([0, 1, 2]);
  const xy = [[0, 0], [1, 0], [0, 1]];
  const low = contourBands(tris, [0, 0, 0], [0.001, 1, 2]);
  assert.equal(low.flat().length, 0, "a dry triangle draws nothing");
  const high = contourBands(tris, [5, 6, 7], [0, 1, 2]);
  assert.equal(high[0].length, 0);
  assert.equal(high[1].length, 1, "all in the top band");
  assert.ok(Math.abs(area(high[1][0].map((p) => at(xy, p))) - 0.5) < 1e-12);
});

test("contour lines cross triangle edges at their level", () => {
  const tris = Int32Array.from([0, 1, 2, 0, 2, 3]);
  const vals = [0, 1, 2, 1];
  const [one, half] = isolines(tris, vals, [1.5, 0.5]);
  assert.equal(one.length, 2, "1.5 crosses both triangles");
  for (const seg of [...one, ...half]) for (const p of seg) assert.ok([1.5, 0.5].some((l) => Math.abs(valueAt(vals, p) - l) < 1e-12));
});

test("class breaks: equal, quantile, natural breaks, manual", () => {
  assert.deepEqual(classBreaks([], "equal", 4, 0, 2), [0, 0.5, 1, 1.5, 2]);
  const v = Array.from({ length: 100 }, (_, i) => i / 100);
  assert.deepEqual(classBreaks(v, "quantile", 4, 0, 1), [0, 0.25, 0.5, 0.75, 1]);
  // Three clusters: natural breaks fall in the gaps.
  const clusters = [...Array(30).fill(0).map((_, i) => 0.1 + i * 0.001), ...Array(30).fill(0).map((_, i) => 0.5 + i * 0.001), ...Array(30).fill(0).map((_, i) => 0.9 + i * 0.001)];
  const j = classBreaks(clusters, "jenks", 3, 0, 1);
  assert.equal(j.length, 4);
  assert.ok(j[1] >= 0.129 && j[1] < 0.5 && j[2] >= 0.529 && j[2] < 0.9, "gaps: " + j);
  assert.deepEqual(classBreaks([], "manual", 5, 0, 1, [0.5, 0.2, 7, -1]), [0, 0.2, 0.5, 1], "kept inside the range, sorted");
});

test("contour levels by count or by interval from a base", () => {
  assert.deepEqual(contourLevels(0, 1, { mode: "count", count: 3 }), [0.25, 0.5, 0.75]);
  assert.deepEqual(contourLevels(0, 1, { mode: "interval", interval: 0.25, base: 0 }), [0.25, 0.5, 0.75]);
  assert.deepEqual(contourLevels(0.05, 0.62, { mode: "interval", interval: 0.2, base: 0.1 }), [0.1, 0.3, 0.5]);
  assert.deepEqual(contourLevels(1, 1, {}), []);
});

test("mesh triangles and vertex values", () => {
  assert.deepEqual(Array.from(triangles([[0, 1, 2], [0, 2, 3, 4]])), [0, 1, 2, 0, 2, 3, 0, 3, 4]);
  assert.deepEqual(Array.from(vertexValues([[0, 1, 2], [1, 2, 3]], [2, 4], 5)), [2, 3, 3, 4, 0]);
});

test("ramps and the style model (kept in range, remembered)", () => {
  assert.equal(rampColor("blues", 0), "rgb(205,226,251)");
  assert.equal(rampColor("blues", 1), "rgb(13,54,107)");
  assert.equal(rampColor("blues", 1, true), "rgb(205,226,251)");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const s = new DepthStyle({ storage });
  let events = 0;
  s.addEventListener("change", () => events++);
  s.set({ display: "bands", method: "jenks", classes: 40, ramp: "nope", min: 2, max: 1 });
  assert.equal(s.get("display"), "bands");
  assert.equal(s.get("classes"), 12, "at most 12 classes");
  assert.equal(s.get("ramp"), "blues");
  assert.ok(s.get("max") > s.get("min"));
  s.set({ display: "bands" });
  assert.equal(events, 1, "no event without a change");
  assert.equal(new DepthStyle({ storage }).get("method"), "jenks", "remembered");
});
test("the hide-water threshold: blank, negative or not a number means the model's dry depth", () => {
  const s = new DepthStyle({ storage: null });
  assert.equal(s.get("hideBelow"), null, "the model's DRY_DEPTH by default");
  for (const [value, kept] of [[0.005, 0.005], ["0.01", 0.01], [0, 0], ["", null], [-1, null], ["abc", null], [Infinity, null], [null, null]]) {
    s.set({ hideBelow: value });
    assert.equal(s.get("hideBelow"), kept, String(value));
  }
  s.set({ hideBelow: 0.02 });
  s.reset();
  assert.equal(s.get("hideBelow"), null, "Reset returns to the model's dry depth");
});

test("contour segments chain into polylines: a ring around a peak closes, a ridge line stays open", () => {
  // A hexagon fan: center vertex 0 high, rim vertices 1..6 low → one closed ring at level 0.5.
  const tris = Int32Array.from([1, 2, 3, 4, 5, 6].flatMap((k) => [0, k, (k % 6) + 1]));
  const ring = isolines(tris, [1, 0, 0, 0, 0, 0, 0], [0.5])[0];
  assert.equal(ring.length, 6);
  const chains = chainSegments(ring);
  assert.equal(chains.length, 1, "one polyline");
  const key = ([a, b]) => [a, b].sort((x, y) => x - y).join(",");
  assert.equal(chains[0].length, 7, "six segments, seven points");
  assert.equal(key(chains[0][0]), key(chains[0][6]), "closed: ends on the edge it starts on");
  // Shuffled segments chain the same way.
  assert.equal(chainSegments([ring[3], ring[0], ring[5], ring[1], ring[4], ring[2]])[0].length, 7);
  // An open line: a strip of two triangles crossed once by a level → one 3-point polyline.
  const strip = Int32Array.from([0, 1, 2, 1, 3, 2]);
  const open = chainSegments(isolines(strip, [0, 1, 0, 1], [0.5])[0]);
  assert.equal(open.length, 1);
  assert.equal(open[0].length, 3);
  assert.notEqual(key(open[0][0]), key(open[0][2]), "open: different end edges");
});
