import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { LayerTree, contentOf, symbols } from "../layers.mjs";
import { sketch } from "../view.mjs";

// The desktop GUI's seed order of layer tree categories, top → bottom
// (openswmm.gui include/ui/panels/layertreecategories.h, kDefaultCategoryDisplayOrder), and the
// categories the browser has.
const desktopOrder = ["SWMM 1D Outputs", "SWMM 2D Outputs", "SWMM", "Meshes", "Time series", "Feature Layers", "Raster Layers", "Basemaps", "Tables"];

test("categories follow the desktop's seed order and the top of the tree paints last", () => {
  const layers = new LayerTree();
  const labels = layers.categories().map((c) => c.label);
  assert.deepEqual(labels, desktopOrder.filter((l) => labels.includes(l)));
  assert.deepEqual(labels, ["SWMM 2D Outputs", "SWMM", "Meshes", "Basemaps"]);
  assert.deepEqual(
    layers.categories().find((c) => c.id === "swmm").groups.map((g) => [g.label, g.rows]),
    [
      ["Nodes", ["junctions", "outfalls", "storage", "dividers"]],
      ["Links", ["conduits", "pumps", "orifices", "weirs", "outlets"]],
      ["Areas", ["subcatchments"]],
      ["Other", ["gages"]],
    ],
  );
  layers.setContent({ cells: 10, junctions: 3, conduits: 2 });
  assert.deepEqual(layers.paintOrder(), ["basemaps", "meshes", "swmm", "outputs2d"]);
});

test("kinds the model does not have are not listed; a 1D model has no surface categories", () => {
  const layers = new LayerTree();
  layers.setContent(contentOf(sketch(`[JUNCTIONS]\nJ1 0\nJ2 0\n[OUTFALLS]\nO1 0 FREE\n[CONDUITS]\nC1 J1 J2 10 0.01\nC2 J2 O1 10 0.01\n[COORDINATES]\nJ1 0 0\nJ2 10 0\nO1 20 0\n`)));
  assert.equal(layers.present("junctions"), true);
  assert.equal(layers.present("storage"), false);
  assert.equal(layers.present("areas"), false);
  assert.equal(layers.present("outputs2d"), false);
  assert.equal(layers.present("meshes"), false);
  assert.equal(layers.present("basemaps"), true);
  assert.equal(layers.count("junctions"), 2);
  assert.equal(layers.count("conduits"), 2);
  assert.deepEqual(layers.paintOrder(), ["basemaps", "swmm"]);
});

test("visibility: leaves, tri-state groups and categories, and events", () => {
  const layers = new LayerTree({ reducedMotion: true });
  layers.setContent({ cells: 4, junctions: 2, outfalls: 1, conduits: 3 });
  const events = [];
  layers.addEventListener("change", (e) => events.push(e.detail));
  assert.equal(layers.visible("streaks"), false, "streaks start off with reduced motion");
  assert.equal(layers.visible("basemap"), false, "the basemap starts off");
  assert.equal(layers.state("nodes"), "on");
  layers.setVisible("junctions", false);
  assert.equal(layers.visible("junctions"), false);
  assert.equal(layers.state("nodes"), "mixed");
  assert.equal(layers.state("swmm"), "mixed");
  layers.setVisible("swmm", true);
  assert.equal(layers.state("swmm"), "on");
  layers.setVisible("nodes", false);
  assert.equal(layers.visible("outfalls"), false);
  assert.equal(layers.visible("conduits"), true);
  // A kind the model lacks is neither drawn nor counted in a group's state.
  assert.equal(layers.visible("storage"), false);
  assert.deepEqual(events.map((e) => e.kind + ":" + e.id), ["visible:junctions", "visible:swmm", "visible:nodes"]);
  layers.setVisible("conduits", true); // no change, no event
  assert.equal(events.length, 3);
  // A disabled row (the basemap without a token) cannot be switched on.
  layers.setEnabled("basemap", false);
  layers.setVisible("basemap", true);
  assert.equal(layers.visible("basemap"), false);
});

test("moving categories keeps the basemap at the bottom; opacity is clamped", () => {
  const layers = new LayerTree();
  layers.setContent({ cells: 4, junctions: 1 });
  assert.equal(layers.canMove("outputs2d", -1), false);
  assert.equal(layers.canMove("meshes", 1), false, "the basemap below is fixed");
  assert.equal(layers.canMove("basemaps", -1), false);
  layers.move("swmm", -1);
  assert.deepEqual(layers.order, ["swmm", "outputs2d", "meshes", "basemaps"]);
  assert.deepEqual(layers.paintOrder(), ["basemaps", "meshes", "outputs2d", "swmm"]);
  layers.move("meshes", 1); // refused
  assert.deepEqual(layers.order, ["swmm", "outputs2d", "meshes", "basemaps"]);
  layers.setOpacity("swmm", 1.7);
  assert.equal(layers.opacity("swmm"), 1);
  layers.setOpacity("swmm", 0.35);
  assert.equal(layers.opacity("swmm"), 0.35);
});

test("the deck sketch lists every network kind with link vertices, polygons and gage symbols", async () => {
  const deck = await readFile(new URL("./fixtures/example1.inp", import.meta.url), "utf8");
  const s = sketch(deck);
  const n = s.network;
  // Section rows counted with awk: 11 junctions, 1 outfall, 11 conduits, 7 subcatchments, 1 gage,
  // 23 [VERTICES] rows (C9 has 10 of them).
  assert.equal(n.junctions.length, 11);
  assert.equal(n.outfalls.length, 1);
  assert.equal(n.conduits.length, 11);
  assert.equal(n.subcatchments.length, 7);
  assert.equal(n.gages.length, 1);
  assert.equal(s.links.length, 11);
  // Every link runs from its inlet node through its vertices to its outlet node.
  assert.equal(n.conduits.reduce((sum, line) => sum + line.length, 0), 2 * 11 + 23);
  assert.equal(Math.max(...n.conduits.map((line) => line.length)), 12);
  assert.ok(n.subcatchments.every((ring) => ring.length >= 3));
  const counts = contentOf(s);
  assert.equal(counts.junctions, 11);
  assert.equal(counts.cells, 0);
});

test("the Bellinge example lists its kinds and its sidecar mesh", async () => {
  const dir = new URL("../examples/bellinge/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("example.json", dir), "utf8"));
  const inputs = {};
  for (const name of manifest.files) inputs[name] = await readFile(new URL(name, dir));
  const s = sketch(new TextDecoder().decode(inputs[manifest.entry]), inputs);
  const counts = contentOf(s);
  // Counted from the deck's sections by row, independently of sketch().
  const text = new TextDecoder().decode(inputs[manifest.entry]);
  const rows = (name) => {
    const body = text.split(new RegExp("^\\[" + name + "\\]", "mi"))[1]?.split(/^\[/m)[0] || "";
    return body.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith(";")).length;
  };
  for (const [kind, section] of [
    ["junctions", "JUNCTIONS"],
    ["outfalls", "OUTFALLS"],
    ["storage", "STORAGE"],
    ["conduits", "CONDUITS"],
    ["pumps", "PUMPS"],
    ["orifices", "ORIFICES"],
    ["weirs", "WEIRS"],
    ["outlets", "OUTLETS"],
  ])
    assert.equal(counts[kind], rows(section), kind);
  assert.equal(counts.cells, 27628);
  assert.ok(counts.subcatchments > 0 && counts.subcatchments <= rows("SUBCATCHMENTS"));
  assert.equal(counts.gages, 2);
});

test("default symbols are the desktop's", () => {
  assert.deepEqual(symbols.junctions, { shape: "circle", size: 8, fill: "#0078ff" });
  assert.deepEqual(symbols.outfalls, { shape: "triangle", size: 12.5, fill: "#dc0000" });
  assert.deepEqual(symbols.conduits, { width: 1, stroke: "#3232c8" });
  assert.deepEqual(symbols.subcatchments, { fill: "#b4dcb4", outline: "#003c00", width: 1.5 });
});
