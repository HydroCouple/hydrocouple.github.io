import { readHydrograph } from "./series.mjs";
import { simulate } from "./simulation.mjs";
import { buildSurface } from "./surface.mjs";
import { getTerrain } from "./terrain.mjs";
// Run control: the stepping loop yields at every preview sample so these messages get through.
const control = { paused: false, stop: false, resume: null };
control.check = async () => {
  await new Promise((r) => setTimeout(r, 0));
  while (control.paused && !control.stop)
    await new Promise((r) => (control.resume = r));
  return control.stop ? "stop" : "continue";
};
self.onmessage = async ({ data }) => {
  if (data.type === "pause" || data.type === "resume" || data.type === "stop") {
    control.paused = data.type === "pause";
    if (data.type === "stop") control.stop = true;
    if (!control.paused) control.resume?.();
    postMessage({ type: "control", state: data.type });
    return;
  }
  try {
    if (data.type === "series") {
      const { default: create } =
        await import("./vendor/engine/openswmm_engine.js");
      postMessage({
        type: "series",
        result: readHydrograph(await create(), data.bytes, data.selection),
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
    const result = await simulate(
      engine,
      data.project,
      (message) => postMessage(message),
      control,
      backend.includes("threads") ? threads : 0,
      // The WebGPU 2D marcher ships in the threads build only.
      !!data.webgpu && backend.includes("threads"),
    );
    postMessage({ type: "done", result, backend });
  } catch (error) {
    postMessage({ type: "error", message: error.message || String(error) });
  }
};
