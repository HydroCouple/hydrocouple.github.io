// Symbols of the map's layers (interaction phase L2): the desktop's defaults, values kept in range,
// remembered in this browser (only what differs), change events, reset; marker outlines and the
// elevation ramps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SymbolStyle, symbolDefaults, styledLeaves, markerPoints, elevationColor } from "../symbol-style.mjs";
import { symbols, markerOutline } from "../layers.mjs";

/** A Storage stand-in. */
const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), raw: m };
};

test("defaults: the desktop's symbols, link arrows on, mesh as the browser drew it", () => {
  const s = new SymbolStyle({ storage: null });
  assert.deepEqual(styledLeaves.length, 13);
  assert.deepEqual(s.of("junctions"), { shape: "circle", size: 8, fill: "#0078ff", outline: markerOutline.stroke, outlineWidth: 1, labels: false, labelColor: "#000000", labelSize: 11 });
  assert.deepEqual(s.of("outfalls").shape, symbols.outfalls.shape);
  assert.deepEqual(s.of("conduits"), { color: "#3232c8", width: 1, arrows: true, arrowLength: 16, arrowWidth: 8, arrowColor: "#222222", labels: false, labelColor: "#000000", labelSize: 11 });
  assert.equal(s.of("pumps").width, symbols.pumps.width);
  assert.deepEqual(s.of("subcatchments"), { fill: "#b4dcb4", fillOpacity: 1, outline: "#003c00", outlineWidth: 1.5, labels: false, labelColor: "#000000", labelSize: 11 });
  assert.deepEqual(s.of("meshfill"), { mode: "single", color: "#4a6480", opacity: 0.12, ramp: "terrain", invert: false });
  assert.deepEqual(s.of("edges"), { color: "#2f5d86", opacity: 0.6, width: 0.75 });
});

test("values out of range are brought into it; unknown values fall back", () => {
  const s = new SymbolStyle({ storage: null });
  s.set("junctions", { size: 99, shape: "blob", fill: "red", outlineWidth: -1, labelSize: 3 });
  assert.deepEqual([s.of("junctions").size, s.of("junctions").shape, s.of("junctions").fill, s.of("junctions").outlineWidth, s.of("junctions").labelSize], [30, "circle", "#0078ff", 0, 8]);
  s.set("conduits", { width: 0, arrowLength: 100, color: "#ABCDEF" });
  assert.deepEqual([s.of("conduits").width, s.of("conduits").arrowLength, s.of("conduits").color], [0.5, 40, "#abcdef"]);
  s.set("meshfill", { mode: "contour", ramp: "rainbow", opacity: 2 });
  assert.deepEqual([s.of("meshfill").mode, s.of("meshfill").ramp, s.of("meshfill").opacity], ["single", "terrain", 1]);
  s.set("edges", { width: 10 });
  assert.equal(s.of("edges").width, 3);
  assert.throws(() => s.set("streaks", { width: 1 }), /No symbol for streaks/);
  // of() is a copy: changing it changes nothing.
  s.of("weirs").color = "#000000";
  assert.equal(s.of("weirs").color, symbols.weirs.stroke);
});

test("remembered in this browser (only what differs from the defaults), events, reset", () => {
  const storage = memory();
  const s = new SymbolStyle({ storage });
  const events = [];
  s.addEventListener("change", (e) => events.push(e.detail.leaf));
  s.set("junctions", { fill: "#ff0000", labels: true });
  s.set("junctions", { fill: "#ff0000" }); // no change, no event
  s.set("meshfill", { mode: "elevation" });
  assert.deepEqual(events, ["junctions", "meshfill"]);
  assert.deepEqual(JSON.parse(storage.raw.get("openswmm.symbolStyle")), { junctions: { fill: "#ff0000", labels: true }, meshfill: { mode: "elevation" } });
  const again = new SymbolStyle({ storage });
  assert.equal(again.of("junctions").fill, "#ff0000");
  assert.equal(again.of("junctions").size, 8);
  assert.equal(again.of("meshfill").mode, "elevation");
  s.reset("junctions");
  assert.deepEqual(s.of("junctions"), symbolDefaults.junctions);
  assert.deepEqual(JSON.parse(storage.raw.get("openswmm.symbolStyle")), { meshfill: { mode: "elevation" } });
  // A broken entry is ignored.
  storage.setItem("openswmm.symbolStyle", "{not json");
  assert.deepEqual(new SymbolStyle({ storage }).of("meshfill"), symbolDefaults.meshfill);
});

test("marker outlines and elevation ramps", () => {
  assert.equal(markerPoints("circle", 4), null);
  assert.deepEqual(markerPoints("triangle", 5), [[0, -5], [5, 4], [-5, 4]]);
  assert.equal(markerPoints("star", 5).length, 10);
  assert.equal(markerPoints("cross", 5).length, 12);
  for (const shape of ["square", "diamond", "star", "cross"]) for (const [x, y] of markerPoints(shape, 5)) assert.ok(Math.abs(x) <= 5 + 1e-9 && Math.abs(y) <= 5 + 1e-9, shape);
  // The desktop's Terrain stops, and inverted.
  assert.equal(elevationColor("terrain", 0), "rgb(26,61,107)");
  assert.equal(elevationColor("terrain", 0.5), "rgb(200,217,78)");
  assert.equal(elevationColor("terrain", 1), "rgb(240,240,232)");
  assert.equal(elevationColor("terrain", 0, true), "rgb(240,240,232)");
  assert.equal(elevationColor("terrain", 0.1), "rgb(36,100,97)"); // halfway between the first two stops
  assert.match(elevationColor("viridis", 0), /^rgb\(68,1,84\)$/);
});
