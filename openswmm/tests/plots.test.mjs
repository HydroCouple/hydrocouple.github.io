// Time series plots (interaction phase V2): the plot model, its helpers, and the series reader on a
// real run's binary output.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { PlotModel, maxSeries, toCsv, niceTicks, unitLabel, seriesName, elapsed } from "../plots.mjs";
import { readSeries, readHydrograph } from "../series.mjs";
import { simulate } from "../simulation.mjs";

const node = (id) => ({ kind: "node", id, type: "junction" });

test("series keep their color slot for life; a ninth is refused; rows group by kind and variable", () => {
  const m = new PlotModel();
  const events = [];
  m.addEventListener("change", (e) => events.push(e.detail.kind));
  assert.equal(m.add([node("J1"), node("J2")], "DEPTH").added.length, 2);
  assert.equal(m.add([node("J1")], "DEPTH").added.length, 0, "already plotted");
  m.add([{ kind: "link", id: "C1" }], "FLOW");
  m.add([node("J1")], "HEAD");
  assert.deepEqual(m.series.map((s) => s.slot), [0, 1, 2, 3]);
  m.remove("node:J2:DEPTH");
  assert.deepEqual(m.series.map((s) => [s.key, s.slot]), [["node:J1:DEPTH", 0], ["link:C1:FLOW", 2], ["node:J1:HEAD", 3]], "others keep their colors");
  assert.equal(m.add([node("J9")], "DEPTH").added[0].slot, 1, "the freed slot is reused");
  assert.deepEqual(m.rows.map((r) => [r.kind, r.variable, r.series.length, r.unit]), [["node", "DEPTH", 2, "length"], ["link", "FLOW", 1, "flow"], ["node", "HEAD", 1, "length"]]);
  const many = Array.from({ length: 10 }, (_, i) => node("N" + i));
  const { added, refused } = m.add(many, "VOLUME");
  assert.equal(m.series.length, maxSeries);
  assert.equal(added.length, maxSeries - 4);
  assert.equal(refused, 10 - added.length);
  m.setData("nope", { seconds: [0], values: [1] });
  assert.equal(m.data.size, 0, "data only for plotted series");
  m.setData("node:J1:DEPTH", { seconds: [0, 60], values: [0, 1] });
  m.invalidate();
  assert.equal(m.data.size, 0);
  m.clear();
  assert.equal(m.series.length, 0);
  assert.deepEqual(events.slice(0, 3), ["series", "series", "series"]);
});

test("names, units, elapsed time, ticks and CSV", () => {
  assert.equal(seriesName({ kind: "node", id: "J1", variable: "DEPTH" }), "J1 depth");
  assert.equal(seriesName({ kind: "system", id: "", variable: "RUNOFF" }), "System runoff");
  assert.equal(seriesName({ kind: "cell", id: "12", variable: "speed" }), "Cell 12 speed");
  assert.equal(unitLabel("flow", "SI", "LPS"), "LPS");
  assert.equal(unitLabel("length", "US"), "ft");
  assert.equal(unitLabel("rainrate", "SI"), "mm/hr");
  assert.equal(elapsed(3725), "1:02:05");
  assert.deepEqual(niceTicks(0, 1), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(niceTicks(3, 17, 4), [0, 5, 10, 15, 20]);
  assert.deepEqual(niceTicks(5, 5), [4.5, 4.75, 5, 5.25, 5.5], "a flat series gets a range around its value");
  const m = new PlotModel();
  m.add([node("J1"), { kind: "link", id: "C,1" }], "DEPTH");
  m.setData("node:J1:DEPTH", { seconds: [0, 300], values: [0.5, 1.25] });
  m.setData("link:C,1:DEPTH", { seconds: [300, 600], values: [2, 3] });
  assert.equal(toCsv(m, () => "m"), 'Elapsed (h:mm:ss),J1 depth (m),"C,1 depth (m)"\n0:00:00,0.5,\n0:05:00,1.25,2\n0:10:00,,3\n');
});

test("series read from a run's binary output: nodes, links, system; an unknown object is reported", async () => {
  const text = await readFile(new URL("../examples/network.inp", import.meta.url));
  const project = { name: "n", entry: "network.inp", inputs: { "network.inp": new Uint8Array(text) }, anchor: null, split: false };
  const run = await simulate(await create(), project);
  const out = run.files[Object.keys(run.files).find((p) => p.endsWith("/model.out"))];
  const module = await create();
  const r = readSeries(module, out, [
    { key: "a", kind: "node", id: "J1", variable: "DEPTH" },
    { key: "b", kind: "link", id: "C1", variable: "FLOW" },
    { key: "c", kind: "system", id: "", variable: "RUNOFF" },
    { key: "d", kind: "node", id: "NOPE", variable: "DEPTH" },
  ]);
  assert.ok(r.seconds.length > 10);
  assert.ok(r.seconds.every((t, i) => i === 0 || t > r.seconds[i - 1]), "times increase");
  for (const s of r.series.slice(0, 3)) assert.equal(s.values.length, r.seconds.length, s.key);
  assert.match(r.series[3].error, /NOPE|not found|unknown/i);
  // The same depth series the old hydrograph reader returns.
  const old = readHydrograph(await create(), out, { kind: "node", id: "J1" });
  assert.deepEqual(r.series[0].values, Array.from(old.values));
  assert.ok(r.series[1].values.some((v) => v > 0), "C1 carries flow");
  assert.equal(r.flowUnits, "CFS");
});
