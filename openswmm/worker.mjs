import { readHydrograph, readSeries } from "./series.mjs";
import { simulate, runScenarios } from "./simulation.mjs";
import { buildSurface } from "./surface.mjs";
import { getTerrain } from "./terrain.mjs";
// Run control: the stepping loop yields at every preview sample so these messages get through.
const control = { paused: false, stop: false, resume: null, forcings: [] };
control.check = async () => {
  await new Promise((r) => setTimeout(r, 0));
  while (control.paused && !control.stop)
    await new Promise((r) => (control.resume = r));
  return control.stop ? "stop" : "continue";
};
self.onmessage = async ({ data }) => {
  if (data.type === "force") {
    // Taken by the run at its next preview sample.
    control.forcings.push(data.forcing);
    return;
  }
  if (data.type === "pause" || data.type === "resume" || data.type === "stop") {
    control.paused = data.type === "pause";
    if (data.type === "stop") control.stop = true;
    if (!control.paused) control.resume?.();
    postMessage({ type: "control", state: data.type });
    return;
  }
  try {
    if (data.type === "plot-series") {
      const { default: create } =
        await import("./vendor/engine/openswmm_engine.js");
      postMessage({ type: "plot-series", result: readSeries(await create(), data.bytes, data.requests) });
      return;
    }
    if (data.type === "series-many") {
      // One module reads the same series from each scenario's output in turn.
      const { default: create } =
        await import("./vendor/engine/openswmm_engine.js");
      const module = await create();
      postMessage({
        type: "series-many",
        results: data.list.map((bytes) => (bytes ? readHydrograph(module, bytes, data.selection) : null)),
      });
      return;
    }
    if (data.type === "build") {
      const { default: create } = await import("./vendor/mesh/meshkit.mjs");
      const terrain = await getTerrain(
        data.options,
        (message) => postMessage({ type: "status", message }),
        data.apiKey,
      );
      postMessage({
        type: "status",
        message: "Triangulating terrain with MeshKit…",
      });
      const project = buildSurface(await create(), data.options, terrain);
      postMessage({ type: "built", project });
      return;
    }
    let create, engine, backend;
    // Threads need SharedArrayBuffer, which only a crossOriginIsolated page grants to its workers.
    // Measured 2026-11-22 (20k-cell 2D study): 1 → 4 threads 2.2× faster, 6 no better, 8 collapsed
    // unless the OpenMP team stops spinning; the 1D FV solver's fine-grained regions only lose
    // to WebAssembly's fork/join cost, so they stay serial and the 2D marcher takes the team.
    const threads =
      data.threads && typeof SharedArrayBuffer !== "undefined"
        ? Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1))
        : 0;
    if (threads > 1) {
      try {
        ({ default: create } =
          await import("./vendor/threads/openswmm_engine.js"));
        engine = await create({
          preRun: [
            (m) =>
              Object.assign(m.ENV, {
                KMP_BLOCKTIME: "0",
                OPENSWMM_FV_OMP_MIN_FACES: "1000000000",
                OPENSWMM_FV_OMP_MIN_CELLS: "1000000000",
                OPENSWMM_FV_OMP_MIN_NODES: "1000000000",
              }),
          ],
        });
        backend = "CPU · WASM SIMD · " + threads + " threads";
      } catch (error) {
        postMessage({
          type: "status",
          message: "Multi-threaded solver unavailable. Loading the SIMD solver…",
        });
      }
    }
    if (!engine && data.simd) {
      try {
        ({ default: create } =
          await import("./vendor/simd/openswmm_engine.js"));
        engine = await create();
        backend = "CPU · WASM SIMD";
      } catch (error) {
        postMessage({
          type: "status",
          message: "SIMD unavailable. Loading the portable solver…",
        });
      }
    }
    if (!engine) backend = "CPU · WASM";
    if (!engine) {
      ({ default: create } =
        await import("./vendor/engine/openswmm_engine.js"));
      engine = await create();
    }
    postMessage({ type: "backend", backend });
    control.until = Number(data.until) || 0; // seconds; 0 runs to the end
    control.resume = data.resume || null; // the state a stopped run saved, to continue it
    control.forcings.push(...(data.forcings || [])); // forcings set before the run
    const team = backend.includes("threads") ? threads : 0;
    // The WebGPU 2D marcher ships in the threads build only.
    const gpu = !!data.webgpu && backend.includes("threads");
    if (data.type === "scenarios") {
      const results = await runScenarios(engine, data.scenarios, (message) => {
        if (message.type !== "frame") postMessage(message); // no playback for a sweep
      }, control, team, gpu);
      // What the comparison needs from each run: its summary, report and binary output.
      const out = (r) => Object.keys(r.files).find((p) => p.endsWith("/model.out"));
      postMessage({
        type: "scenarios-done",
        backend,
        results: results.map((r) => ({
          seconds: r.seconds,
          stopped: r.stopped,
          balance: r.balance,
          peakDepth: r.peakDepth,
          warnings: r.warnings.count,
          report: r.files[r.report],
          out: r.files[out(r)] || null,
        })),
      });
      return;
    }
    const result = await simulate(engine, data.project, (message) => postMessage(message), control, team, gpu);
    postMessage({ type: "done", result, backend });
  } catch (error) {
    postMessage({ type: "error", message: error.message || String(error) });
  }
};
