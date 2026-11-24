import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import createMesh from "../vendor/mesh/meshkit.mjs";
import { simulate, resumable, runScenarios } from "../simulation.mjs";
import { buildSurface, rainfall } from "../surface.mjs";
import { distributions } from "../distributions.mjs";
import { gzipSync } from "node:zlib";
import { getTerrain, tileName } from "../terrain.mjs";
import { pack, unpack } from "../project.mjs";

/** Uncompressed little-endian Float32 GeoTIFF (one strip) with pixel-centered values. */
function geotiff({ width, height, x0, y0, sx, sy }, value) {
  const tags = [
    [256, 4, width], [257, 4, height], [258, 3, 32], [259, 3, 1],
    [262, 3, 1], [273, 4, 0], [277, 3, 1], [278, 4, height],
    [279, 4, width * height * 4], [339, 3, 3], [33550, 12, 3], [33922, 12, 6],
  ];
  const ifd = 8,
    scale = ifd + 2 + 12 * tags.length + 4,
    tie = scale + 24,
    data = tie + 48;
  const view = new DataView(new ArrayBuffer(data + width * height * 4));
  view.setUint16(0, 0x4949);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd, true);
  view.setUint16(ifd, tags.length, true);
  tags.forEach(([tag, type, v], i) => {
    const at = ifd + 2 + 12 * i;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, type === 12 ? v : 1, true);
    if (tag === 273) view.setUint32(at + 8, data, true);
    else if (type === 12) view.setUint32(at + 8, tag === 33550 ? scale : tie, true);
    else if (type === 3) view.setUint16(at + 8, v, true);
    else view.setUint32(at + 8, v, true);
  });
  [sx, sy, 0].forEach((d, k) => view.setFloat64(scale + 8 * k, d, true));
  [0, 0, 0, x0, y0, 0].forEach((d, k) => view.setFloat64(tie + 8 * k, d, true));
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++)
      view.setFloat32(
        data + 4 * (r * width + c),
        value(x0 + (c + 0.5) * sx, y0 - (r + 0.5) * sy),
        true,
      );
  return new Uint8Array(view.buffer);
}
/** Answer a 3DEP exportImage request, shifting the extent as the service may. */
function usgsResponse(url, value) {
  const q = new URL(url).searchParams;
  assert.match(url, /ImageServer\/exportImage\?/);
  const [west, , east, north] = q.get("bbox").split(",").map(Number);
  const [width, height] = q.get("size").split(",").map(Number);
  const sx = (east - west) / width;
  const tif = geotiff({ width, height: height + 2, x0: west, y0: north + 0.7 * sx, sx, sy: sx }, value);
  return new Response(tif, { headers: { "content-type": "image/tiff" } });
}

test("standalone, integrated and independent solver cases run with both builds", async () => {
  const config = JSON.parse(
    await readFile(new URL("../config.json", import.meta.url)),
  );
  for (const key of ["surface", "coupled", "split"]) {
    const entry = key + ".inp",
      inputs = {
        [entry]: await readFile(
          new URL("../examples/" + entry, import.meta.url),
        ),
      };
    const project = { name: key, entry, inputs, split: key === "split" };
    let reference;
    const factories = [create];
    if (config.simd)
      factories.push(
        (await import("../vendor/simd/openswmm_engine.js")).default,
      );
    for (const factory of factories) {
      let geometry;
      const frames = [];
      const result = await simulate(await factory(), project, (m) => {
        if (m.type === "geometry") geometry = m.geometry;
        if (m.type === "frame") frames.push(m);
      });
      assert.ok(result.files[result.report].length);
      assert.ok(frames.length >= 2 && frames.at(-1).u.length === result.cells);
      if (key === "surface")
        assert.ok(Math.abs(result.balance.rainfallIn - 250) < 1e-6);
      // The pan drains through the junction. It no longer also spills back: since engine
      // 3bdd6e2c, COUPLING_EQUALIZE DEFAULT caps every junction exchange, which stops the
      // rim-full orifice from draining and spilling in turn.
      if (key === "coupled") assert.ok(result.balance.coupling2dTo1dOut > 0);
      if (reference) {
        for (const key of Object.keys(result.balance))
          assert.ok(
            Math.abs(result.balance[key] - reference.balance[key]) <
              1e-8 * Math.max(1, Math.abs(reference.balance[key])),
            key,
          );
      }
      reference = result;
      const { run, project: reopened } = await unpack(
        await pack(project, { ...result, frames, geometry }),
      );
      assert.deepEqual(run.frames.at(-1).depth, frames.at(-1).depth);
      assert.deepEqual([...reopened.inputs[entry]], [...inputs[entry]]);
      assert.deepEqual(Object.keys(run.files), Object.keys(result.files));
    }
  }
});
test("MeshKit geometry and the generated gage route the chosen volume", async () => {
  const options = {
    size: 100,
    cell: 20,
    lat: 40,
    lon: -110,
    source: "plane",
    slope: 0.01,
    roughness: 0.03,
    boundary: "south",
    storm: "triangular",
    minutes: 30,
    depth: 25,
  };
  const project = buildSurface(
    await createMesh(),
    options,
    await getTerrain(options, () => {}),
  );
  const result = await simulate(await create(), project);
  assert.ok(result.cells > 2);
  assert.ok(Math.abs(result.balance.rainfallIn - 250) < 1e-4);
  assert.ok(result.files["surface.h5"].length > 100);
});
test("constraint lines become mesh edges and mesh options reach the report", async () => {
  const { linesFromGeoJSON, lonLat } = await import("../surface.mjs");
  const anchor = { lat: 40, lon: -110 };
  const lines = linesFromGeoJSON({
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "LineString", coordinates: [lonLat(anchor, 10, 50), lonLat(anchor, 90, 50)] } },
      { type: "Feature", geometry: { type: "MultiLineString", coordinates: [[lonLat(anchor, 50, 10), lonLat(anchor, 50, 40)]] } },
    ],
  });
  assert.equal(lines.length, 2);
  const options = {
    size: 100, cell: 20, lat: 40, lon: -110, source: "plane", slope: 0.01, roughness: 0.03,
    boundary: "south", storm: "triangular", minutes: 30, depth: 25,
    lines, mesh: { minimumAngleDegrees: 25, smoothingPasses: 1, minimumTarget: 0, strictSizing: true },
  };
  const terrain = await getTerrain(options, () => {});
  const withLines = buildSurface(await createMesh(), options, terrain);
  const plain = buildSurface(await createMesh(), { ...options, lines: undefined }, terrain);
  const report = JSON.parse(new TextDecoder().decode(withLines.inputs["mesh-report.json"]));
  assert.equal(report.constraintLines, 2);
  assert.ok(report.constraintAuditPassed);
  assert.equal(report.resolvedOptions.minimumAngleDegrees, 25);
  assert.equal(report.resolvedOptions.smoothingPasses, 1);
  assert.ok(report.constraintSegments > JSON.parse(new TextDecoder().decode(plain.inputs["mesh-report.json"])).constraintSegments);
  // a mesh vertex sits on each line end: (10, 50) is the first constraint point
  const inp = new TextDecoder().decode(withLines.inputs["surface.inp"]);
  const vertexRows = inp.split("[2D_VERTICES]")[1].split("[2D_TRIANGLES]")[0].trim().split("\n");
  assert.ok(
    vertexRows.some((row) => {
      const [x, y] = row.split(" ").map(Number);
      return Math.abs(x - 10) < 1e-6 && Math.abs(y - 50) < 1e-6;
    }),
    "no vertex at the constraint line end",
  );
  assert.throws(() => linesFromGeoJSON({ type: "Point", coordinates: [0, 0] }), /LineString/);
  const result = await simulate(await create(), withLines);
  assert.ok(Math.abs(result.balance.rainfallIn - 250) < 1e-4);
});

test("the model session edits through the catalog and the engine-written deck runs", async () => {
  const { ModelSession } = await import("../model.mjs");
  const bytes = await readFile(new URL("../examples/coupled.inp", import.meta.url));
  const project = { name: "c", entry: "coupled.inp", inputs: { "coupled.inp": new Uint8Array(bytes) }, anchor: null, split: false };
  const session = new ModelSession(await create());
  const summary = session.open(project);
  assert.ok(summary.objects.node.some((n) => n.id === "J1" && n.type === "JUNCTION"));
  assert.ok(summary.objects.link.some((l) => l.id === "C1" && l.from === "J1"));
  assert.equal(summary.unitSystem, "SI");
  const rows = session.fields("node", "J1");
  const invert = rows.find((r) => r.path === "node.invert_elev");
  assert.equal(invert.unit, "m");
  assert.ok(!rows.some((r) => r.path.startsWith("node.storage.")), "junction shows no storage fields");
  assert.ok(session.fields("node", "ST1").some((r) => r.path.startsWith("node.storage.")), "storage shows its view");
  // Climate values are edited in the climate dialog, not as model rows.
  assert.ok(!session.fields("model", null).some((r) => r.path.startsWith("climate.")));
  assert.equal(session.climate().kind, "climate");
  const options = session.fields("options", null);
  assert.equal(options.find((r) => r.path === "options.FLOW_UNITS").value, "CMS");
  assert.deepEqual(options.find((r) => r.path === "options.FLOW_ROUTING").choices.slice(0, 3), ["STEADY", "KINWAVE", "DYNWAVE"]);
  assert.equal(session.set("options.ROUTING_STEP", null, "10"), "10");
  assert.throws(() => session.set("options.FLOW_UNITS", null, "BOGUS"), /Invalid parameter/);
  assert.throws(() => session.set("options.NOT_A_KEY", null, "1"), /Unknown option/);
  assert.equal(session.set("node.invert_elev", "J1", "123.456"), 123.456);
  assert.throws(() => session.set("node.invert_elev", "J1", "abc"), /Enter a number/);
  // 2D cells: values come from the deck text, setters go through Surface2D before initialize
  assert.equal(summary.cells, 8);
  const cell = session.fields("cell", 0);
  assert.equal(cell.find((r) => r.path === "cell.mannings").value, 0.018);
  assert.equal(cell.find((r) => r.path === "cell.mannings").unit, "Manning's n");
  assert.equal(session.set("cell.mannings", 0, "0.05"), 0.05);
  assert.equal(session.setAll("cell.init_depth", 0.1), 8);
  assert.throws(() => session.fields("cell", 99), /No surface cell/);
  const written = session.write();
  session.close();
  const text = new TextDecoder().decode(written);
  assert.match(text, /^J1\s+123\.456/m);
  assert.match(text, /^ROUTING_STEP\s+0:00:10/m);
  const triangles = text.split("[2D_TRIANGLES]")[1].split("\n[")[0].trim().split("\n").filter((l) => !l.startsWith(";"));
  assert.equal(triangles.length, 8);
  const columns = triangles.map((row) => row.trim().split(/\s+/).map(Number));
  assert.deepEqual(columns[0].slice(0, 3), [0, 1, 4]);
  assert.ok(Math.abs(columns[0][3] - 0.05) < 1e-12, "cell 0 Manning n written");
  assert.ok(columns.every((c) => Math.abs(c[4] - 0.1) < 1e-12), "every cell carries the bulk initial depth");
  const result = await simulate(await create(), { ...project, inputs: { "coupled.inp": written } });
  assert.equal(result.cells, 8);
});

test("a run pauses and stops between report steps and keeps its partial outputs", async () => {
  const bytes = new Uint8Array(await readFile(new URL("../examples/surface.inp", import.meta.url)));
  const project = { name: "s", entry: "surface.inp", inputs: { "surface.inp": bytes }, anchor: null, split: false };
  let checks = 0, paused = 0;
  const control = {
    async check() {
      checks++;
      if (checks === 1) {
        await new Promise((r) => setTimeout(r, 20)); // a pause: the loop waits here
        paused++;
      }
      return checks >= 3 ? "stop" : "continue";
    },
  };
  const result = await simulate(await create(), project, () => {}, control);
  assert.equal(paused, 1);
  assert.ok(result.stopped);
  assert.ok(result.seconds > 0 && result.seconds < 7200, "stopped before the 2 h end: " + result.seconds);
  assert.ok(Object.keys(result.files).some((p) => p.endsWith("/model.rpt")), "the report was still written");
  const full = await simulate(await create(), project);
  assert.equal(full.stopped, false);
  assert.equal(full.seconds, 7200);
});

/** The project of one bundled example deck. */
async function exampleProject(name, transform = (text) => text) {
  const text = transform(await readFile(new URL(`../examples/${name}.inp`, import.meta.url), "utf8"));
  return { name, entry: name + ".inp", inputs: { [name + ".inp"]: new TextEncoder().encode(text) }, anchor: null, split: false };
}
const outOf = (result) => result.files[Object.keys(result.files).find((p) => p.endsWith("/model.out"))];

test("pausing between steps leaves the results byte-identical", async () => {
  for (const name of ["surface", "coupled"]) {
    const project = await exampleProject(name);
    let pauses = 0;
    const paused = await simulate(await create(), project, () => {}, {
      async check() {
        pauses++;
        await new Promise((r) => setTimeout(r, 2)); // the worker waits here while paused
        return "continue";
      },
    });
    const straight = await simulate(await create(), project);
    assert.ok(pauses > 10, name + ": the run paused " + pauses + " times");
    assert.deepEqual(outOf(paused), outOf(straight), name + ": .out differs after pauses");
  }
});

test("a run stops at the requested elapsed time and keeps its outputs", async () => {
  const project = await exampleProject("coupled");
  const result = await simulate(await create(), project, () => {}, { until: 1800 });
  assert.ok(result.stopped);
  assert.ok(result.seconds >= 1800 && result.seconds < 1800 + 60, "stopped at " + result.seconds);
  assert.ok(outOf(result)?.length > 0, "the partial .out was written");
  assert.ok(Object.keys(result.files).some((p) => p.endsWith("/model.rpt")));
});

test("the model's warnings reach the run as they arrive and with its result", async () => {
  // J2 raised to J1's invert: conduit C1 is flat, and the engine warns that it used a minimum drop.
  const project = await exampleProject("network", (text) =>
    text.replace(/^(J2\s+)\S+/m, (m, a) => a + text.match(/^J1\s+(\S+)/m)[1]),
  );
  const streamed = [];
  const result = await simulate(await create(), project, (m) => m.type === "warning" && streamed.push(m.message));
  assert.ok(result.warnings.count >= 1);
  assert.equal(result.warnings.count, streamed.length);
  assert.ok(result.warnings.list.some((w) => /minimum elevation drop used for Conduit C1/.test(w)), result.warnings.list.join("; "));
});

test("a model the engine will not checkpoint still runs without save/resume and says why", async () => {
  // EPA Example 1 (tests/fixtures): pollutants keep it out of engine checkpoint sessions.
  const text = await readFile(new URL("./fixtures/example1.inp", import.meta.url));
  const project = { name: "e1", entry: "example1.inp", inputs: { "example1.inp": new Uint8Array(text) }, anchor: null, split: false };
  const stopped = await simulate(await create(), project, () => {}, { until: 1800 });
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.resumable, false);
  assert.match(stopped.resumeRefusal, /checkpoint sessions require/);
  assert.equal(stopped.saved, null);
  const full = await simulate(await create(), project);
  assert.equal(full.stopped, false);
  assert.ok(outOf(full).length > 0);
});

test("a model the engine refuses after initializing a checkpoint session still runs", async () => {
  // The engine checks climate sources after it initializes a session and then closes itself; the
  // run opens the deck again and runs it without save/resume (fixtures/climate.inp with
  // evaporation from a time series).
  const text = (await readFile(new URL("./fixtures/climate.inp", import.meta.url), "utf8")).replace(/^MONTHLY\s+0\.10 .*$/m, "TIMESERIES TS1");
  const project = { name: "c", entry: "climate.inp", inputs: { "climate.inp": new TextEncoder().encode(text) }, anchor: null, split: false };
  const run = await simulate(await create(), project);
  assert.equal(run.stopped, false);
  assert.equal(run.resumable, false);
  assert.match(run.resumeRefusal, /in-memory climate sources/);
  assert.ok(outOf(run).length > 0);
});

test("a 1D run stopped early saves its state and a later run continues it to the same results", async () => {
  const project = await exampleProject("network");
  assert.ok(resumable(project));
  const first = await simulate(await create(), project, () => {}, { until: 3600 });
  assert.ok(first.stopped && first.saved, "the stopped run saved its state");
  assert.ok(first.files[first.saved.path]?.length > 0);
  const progress = [];
  const rest = await simulate(await create(), project, (m) => m.type === "progress" && progress.push(m.seconds), {
    resume: first.files[first.saved.path],
  });
  const straight = await simulate(await create(), project);
  assert.equal(rest.stopped, false);
  assert.equal(rest.seconds, straight.seconds);
  assert.ok(progress[0] >= 3600, "the resumed run starts at its saved time: " + progress[0]);
  assert.deepEqual(outOf(rest), outOf(straight), "the resumed run's .out differs from an uninterrupted run");
  // A model with a 2D surface stops without a saved state, and says why it cannot continue.
  const surface = await exampleProject("surface");
  assert.equal(resumable(surface), false);
  const stopped = await simulate(await create(), surface, () => {}, { until: 1800 });
  assert.ok(stopped.stopped && !stopped.saved && !stopped.resumable);
  await assert.rejects(simulate(await create(), surface, () => {}, { resume: first.files[first.saved.path] }), /without a 2D surface/);
});

test("live forcings change the run as booked and are logged with it", async () => {
  // A rain override of 0 at the gage, set before the run, leaves the surface dry of rain.
  const surface = await exampleProject("surface");
  const dry = await simulate(await create(), surface, () => {}, {
    forcings: [{ kind: "rain", target: "RG1", value: 0 }],
  });
  assert.equal(dry.balance.rainfallIn, 0);
  assert.deepEqual(dry.forced, [{ seconds: 0, kind: "rain", target: "RG1", value: 0 }]);
  // An inflow added at J1 mid-run, then cleared: logged at the samples that took them, and the
  // network's external inflow is the added rate over that span.
  const network = await exampleProject("network");
  const control = { forcings: [], checks: 0 };
  control.check = async () => {
    control.checks++;
    if (control.checks === 3) control.forcings.push({ kind: "inflow", target: "J1", value: 0.5 });
    if (control.checks === 9) control.forcings.push({ kind: "inflow", target: "J1", clear: true });
    return "continue";
  };
  const fed = await simulate(await create(), network, () => {}, control);
  assert.equal(fed.forced.length, 2);
  const [on, off] = fed.forced;
  assert.ok(on.seconds > 0 && off.seconds > on.seconds && off.value === null);
  const rpt = new TextDecoder().decode(fed.files[fed.report]);
  const external = Number(rpt.match(/External Inflow[ .]*\s+([-0-9.]+)/)[1]); // acre-ft (CFS model)
  const expected = (0.5 * (off.seconds - on.seconds)) / 43560;
  assert.ok(Math.abs(external - expected) <= 0.002 + 0.05 * expected, `external ${external} vs ${expected}`);
});

test("a scenario sweep in one engine module reproduces three separate runs byte for byte", async () => {
  const scenarios = [
    { name: "Base", project: await exampleProject("coupled") },
    // The storm's 5 mm/h intensity raised to 7.5 mm/h.
    { name: "Heavier storm", project: await exampleProject("coupled", (t) => t.replace(/^(RAIN_TS\s.*\s)5\.0$/gm, "$17.5")) },
    { name: "Rougher pipes", project: await exampleProject("coupled", (t) => t.replace(/^(C\d\s+\S+\s+\S+\s+\d+\s+)0\.013/gm, "$10.020")) },
  ];
  const seen = [];
  const swept = await runScenarios(await create(), scenarios, (m) => m.type === "scenario" && seen.push(m.name));
  assert.deepEqual(seen, ["Base", "Heavier storm", "Rougher pipes"]);
  assert.equal(swept.length, 3);
  for (const [k, s] of scenarios.entries()) {
    const alone = await simulate(await create(), s.project);
    assert.deepEqual(outOf(swept[k]), outOf(alone), s.name + ": the sweep's .out differs from a separate run");
  }
  assert.ok(swept[1].balance.rainfallIn > 1.4 * swept[0].balance.rainfallIn, "the heavier storm rains more");
  assert.notDeepEqual(outOf(swept[2]), outOf(swept[0]), "rougher pipes change the network results");
  assert.ok(swept[0].peakDepth > 0);
});

test("published storm knots conserve depth and protect native duration", () => {
  for (const method of Object.keys(distributions)) {
    const rows = rainfall(method, 125, 1440);
    assert.ok(rows.every((r) => r.intensity >= 0));
    assert.ok(
      Math.abs(rows.reduce((s, r) => s + r.intensity / 12, 0) - 125) < 1e-8,
    );
  }
  assert.throws(() => rainfall("scs-ii", 100, 60), /24 hours/);
  assert.equal(tileName(-0.2, -0.1), "S01W001");
});
test("attach a metric network, preserve both input decks and read its saved hydrograph", async () => {
  const { attachNetwork } = await import("../coupling.mjs");
  const { readHydrograph } = await import("../series.mjs");
  const text = await readFile(
    new URL("../examples/split.inp", import.meta.url),
    "utf8",
  );
  const network = new TextEncoder().encode(
    text.split("[2D_OPTIONS]")[0] + "\n[REPORT]\nNODES ALL\nLINKS ALL\n",
  );
  const entry = "surface.inp",
    original = await readFile(
      new URL("../examples/surface.inp", import.meta.url),
    );
  const p = attachNetwork(
    { entry, inputs: { [entry]: original } },
    { "pipes.inp": network },
    "pipes.inp",
    { cell: 0, node: "J", cd: 0.6, area: 1, rain: false },
  );
  assert.equal(p.inputs["original-surface/surface.inp"], original);
  assert.equal(p.inputs["pipes.inp"], network);
  const mod = await create(),
    result = await simulate(mod, p);
  const series = readHydrograph(mod, result.files["run/model.out"]);
  assert.equal(series.id, "J");
  assert.equal(series.unit, "m");
  assert.equal(series.times.length, series.values.length);
  const plain = await simulate(await create(), {
    entry: "pipes.inp",
    inputs: { "pipes.inp": network },
  });
  assert.equal(plain.cells, 0);
  assert.ok(plain.files[plain.report].length);
});

test("polygon holes exclude area and USGS samples retain their spatial order", async (t) => {
  const { domainFromGeoJSON, lonLat } = await import("../surface.mjs");
  const anchor = { lat: 40, lon: -110 };
  const ring = (points) => points.map((p) => lonLat(anchor, ...p));
  const area = domainFromGeoJSON({
    type: "Polygon",
    coordinates: [
      ring([
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
        [0, 0],
      ]),
      ring([
        [40, 40],
        [60, 40],
        [60, 60],
        [40, 60],
        [40, 40],
      ]),
    ],
  });
  const options = {
    ...area,
    cell: 25,
    source: "usgs",
    storm: "uniform",
    depth: 25,
    minutes: 30,
    roughness: 0.03,
    slope: 0.01,
    boundary: "walls",
  };
  t.mock.method(globalThis, "fetch", async (url) =>
    usgsResponse(url, (lon, lat) => lat * 10),
  );
  const terrain = await getTerrain(options, () => {});
  assert.ok(terrain.raster.heights.at(-1) > terrain.raster.heights[0]);
  assert.ok(Object.keys(terrain.assets).length);
  const result = await simulate(
    await create(),
    buildSurface(await createMesh(), options, terrain),
  );
  assert.ok(Math.abs(result.balance.rainfallIn - 240) < 1e-5);
});

test("3DEP acquisition retries dropped connections and server errors, not client errors", async (t) => {
  const options = { lat: 40, lon: -110, size: 100, cell: 25, source: "usgs" };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    if (calls === 1) throw new TypeError("Failed to fetch");
    if (calls === 2) return new Response("busy", { status: 503 });
    return usgsResponse(url, () => 5);
  });
  const terrain = await getTerrain(options, () => {});
  assert.equal(calls, 3); // one 3DEP request, retried twice
  assert.ok(terrain.raster.heights.every((z) => z === 5));
  calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("missing", { status: 404 });
  });
  await assert.rejects(getTerrain(options, () => {}), /HTTP 404/);
  assert.equal(calls, 1);
});

test("a sparse 3DEP block is missing data, not elevation", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const tif = new Uint8Array(await usgsResponse(url, () => 7).arrayBuffer());
    new DataView(tif.buffer).setUint32(8 + 2 + 12 * 8 + 8, 0, true); // strip byte count 0
    return new Response(tif);
  });
  const options = { lat: 40, lon: -110, size: 100, cell: 25, source: "usgs" };
  await assert.rejects(getTerrain(options, () => {}), /coverage is incomplete/);
});

test("Terrain Tiles decode gzipped 1-arc-second HGT rows from north to south", async (t) => {
  const raw = Buffer.alloc(3601 * 3601 * 2);
  for (let row = 0; row < 3601; row++)
    for (let col = 0; col < 3601; col++)
      raw.writeInt16BE(3600 - row, 2 * (row * 3601 + col));
  const gz = gzipSync(raw);
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    seen.push(url);
    return new Response(gz);
  });
  const { lonLat } = await import("../surface.mjs");
  const options = { lat: 40.2, lon: -109.8, size: 300, cell: 30, source: "skadi" };
  const terrain = await getTerrain(options, () => {});
  assert.deepEqual(seen, [
    "https://s3.amazonaws.com/elevation-tiles-prod/skadi/N40/N40W110.hgt.gz",
  ]);
  const n = terrain.raster.columns;
  terrain.raster.heights.forEach((z, i) => {
    const [, lat] = lonLat(options, (i % n) * terrain.raster.dx, Math.floor(i / n) * terrain.raster.dy);
    assert.ok(Math.abs(z - (lat - 40) * 3600) < 1e-6);
  });
  assert.equal(terrain.assets["terrain/N40W110.hgt.gz"].length, gz.length);
  assert.match(terrain.source, /Terrain Tiles/);
});

test("OpenTopography grids are sampled and the API key never enters the project", async (t) => {
  const key = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  t.mock.method(globalThis, "fetch", async (url) => {
    const q = new URL(url).searchParams;
    if (q.get("API_Key") !== key) return new Response("Unauthorized", { status: 401 });
    assert.equal(q.get("demtype"), "COP30");
    assert.equal(q.get("outputFormat"), "AAIGrid");
    const cell = 1 / 3600,
      west = +q.get("west"),
      south = +q.get("south");
    const ncols = Math.ceil((+q.get("east") - west) / cell),
      nrows = Math.ceil((+q.get("north") - south) / cell);
    const rows = Array.from({ length: nrows }, (_, r) =>
      Array.from({ length: ncols }, () => (10 * (south + (nrows - r - 0.5) * cell)).toFixed(6)).join(" "),
    );
    return new Response(
      [`ncols ${ncols}`, `nrows ${nrows}`, `xllcorner ${west}`, `yllcorner ${south}`, `cellsize ${cell}`, "NODATA_value -9999", ...rows].join("\n"),
    );
  });
  const options = {
    lat: 40, lon: -110, size: 200, cell: 25, source: "opentopo", demtype: "COP30",
    storm: "uniform", depth: 10, minutes: 30, roughness: 0.03, slope: 0.01, boundary: "walls",
  };
  await assert.rejects(getTerrain(options, () => {}, "wrong"), /rejected the API key/);
  const terrain = await getTerrain(options, () => {}, key);
  assert.ok(terrain.raster.heights.at(-1) > terrain.raster.heights[0]);
  assert.ok(Math.abs(terrain.raster.heights[0] - 400) < 1e-3);
  const project = buildSurface(await createMesh(), options, terrain);
  const text = new TextDecoder();
  for (const [name, bytes] of Object.entries(project.inputs))
    assert.ok(!text.decode(bytes).includes(key), name + " contains the key");
  assert.ok(project.inputs["terrain/opentopography-COP30.asc"]);
});

test("3DEP heights use the returned GeoTIFF georeference, not the requested extent", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    usgsResponse(url, (lon, lat) => (lat - 40) * 1e6),
  );
  const { lonLat } = await import("../surface.mjs");
  const options = { lat: 40, lon: -110, size: 100, cell: 25, source: "usgs" };
  const terrain = await getTerrain(options, () => {});
  const n = terrain.raster.columns;
  terrain.raster.heights.forEach((z, i) => {
    const [, lat] = lonLat(options, (i % n) * terrain.raster.dx, Math.floor(i / n) * terrain.raster.dy);
    assert.ok(Math.abs(z - (lat - 40) * 1e6) < 0.01, `node ${i}: ${z}`);
  });
});
