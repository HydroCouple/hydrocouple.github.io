import { Solver, SplitRole } from "./vendor/engine/index.js";

export function localPath(path) {
  if (
    typeof path !== "string" ||
    /[\\:\x00-\x1f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid project path: " + path);
  return path;
}
function walk(fs, dir = ".") {
  return fs
    .readdir(dir)
    .filter((n) => n !== "." && n !== "..")
    .flatMap((n) => {
      const path = dir === "." ? n : dir + "/" + n;
      return fs.isDir(fs.stat(path).mode) ? walk(fs, path) : [path];
    });
}
/**
 * Run a project to completion, or until `control.check()` (awaited at every preview sample)
 * returns "stop"; a stopped run still ends, reports and returns its partial outputs.
 */
/**
 * The WebGPU 2D marcher (opt-in, experimental) runs the model's own momentum equation (local
 * inertial, diffusive wave or full SWE at either order), so a GPU run sets only the backend, for
 * this run. A model outside its scope stays on the CPU marcher, and the report says why. Returns
 * false when this engine build has no WebGPU.
 */
function useWebGpu(solver) {
  try {
    solver.options.ext.set("BACKEND", "WEBGPU");
    return true;
  } catch {
    return false;
  }
}
export async function simulate(engine, project, emit = () => {}, control = {}, threads = 0, gpu = false) {
  const fs = engine.FS;
  fs.mkdir("/project");
  fs.chdir("/project");
  const entry = localPath(project.entry);
  for (const [name, data] of Object.entries(project.inputs)) {
    localPath(name);
    if (name.includes("/")) fs.mkdirTree(name.slice(0, name.lastIndexOf("/")));
    fs.writeFile(name, data);
  }
  if (!fs.analyzePath(entry).exists)
    throw new Error("Missing model entry " + entry);
  // OUT/RPT names belong to this run, even if the input has same-named sidecars.
  let resultDir = "run";
  while (fs.analyzePath(resultDir).exists) resultDir += "-new";
  fs.mkdir(resultDir);
  const network = new Solver(engine);
  let surface, geometry, frame, balance, webgpu = false;
  const report = resultDir + "/model.rpt",
    output = resultDir + "/model.out";
  try {
    network.open(entry, report, output);
    // [OPTIONS] THREADS: the deck's own count stays unless the page offers a thread team.
    if (threads > 1) network.options.set("THREADS", String(threads));
    if (project.split) {
      surface = new Solver(engine);
      surface.open(entry, resultDir + "/surface.rpt", "");
      if (threads > 1) surface.options.set("THREADS", String(threads));
      webgpu = gpu && useWebGpu(surface);
      network.split.validateInput();
      network.split.configure(SplitRole.NETWORK);
      surface.split.configure(SplitRole.SURFACE);
      surface.initialize();
      frame = surface.split.geometry();
      network.initialize();
      network.split.applyGeometry(frame);
      network.split.setCallback((phase, request) =>
        surface.split.evaluate(phase, request),
      );
      surface.start(false);
    } else {
      webgpu = gpu && useWebGpu(network);
      network.initialize();
    }
    const field = (surface || network).surface2d;
    const active = field.isActive;
    if (gpu && !webgpu)
      emit({ type: "status", message: "This engine build has no WebGPU 2D solver; running on the CPU." });
    else if (webgpu && active) {
      const solver2d = field.runStats.backend;
      emit(
        solver2d === "webgpu"
          ? { type: "backend", backend: "GPU · WebGPU 2D" + (threads > 1 ? " · " + threads + " CPU threads" : "") }
          : { type: "status", message: "WebGPU did not take this model (" + solver2d + "); the report says why." },
      );
    }
    const total = (network.endDatetime - network.startDatetime) / 1000;
    const cells = active ? field.nCells : 0;
    // Bound preview storage; native output retains its configured reporting interval.
    const count = Math.max(
      2,
      Math.min(180, Math.floor(2000000 / Math.max(1, cells))),
    );
    let next = 0,
      last = -1;
    if (active) {
      const { x, y } = field.getVertexCoords();
      geometry = {
        x,
        y,
        cells: Array.from({ length: cells }, (_, i) =>
          field.getCellVertices(i),
        ),
      };
    }
    emit({ type: "geometry", geometry });
    network.start(true);
    function sample(seconds) {
      if (active) {
        const [u, v] = field.getVelocities();
        emit({
          type: "frame",
          seconds,
          depth: Float32Array.from(field.getDepths()),
          u: Float32Array.from(u),
          v: Float32Array.from(v),
        });
      }
      emit({ type: "progress", seconds, total });
      last = seconds;
    }
    sample(0);
    const interval = Math.max(0.001, total / (count - 1));
    next = interval;
    let stopped = false,
      elapsed = 0;
    for (;;) {
      const t = network.step();
      if (!t) break;
      elapsed = t;
      if (t >= next) {
        sample(t);
        next = t + interval;
        if (control.check && (await control.check()) === "stop") {
          stopped = true;
          break;
        }
      }
    }
    if (!stopped && last < total - 1e-6) sample(total);
    if (active) balance = field.getMassBalance();
    network.end();
    network.report();
    network.close();
    frame?.close();
    frame = null;
    surface?.destroy();
    surface = null;
    const files = Object.create(null);
    for (const path of walk(fs)) {
      const bytes = fs.readFile(path);
      const input = project.inputs[path];
      if (
        !input ||
        bytes.length !== input.length ||
        !bytes.every((b, i) => b === input[i])
      )
        files[path] = bytes;
    }
    return {
      files,
      balance,
      report,
      seconds: stopped ? elapsed : total,
      cells,
      stopped,
    };
  } catch (error) {
    let details = "";
    if (fs.analyzePath(report).exists)
      details = fs.readFile(report, { encoding: "utf8" }).slice(-3500);
    throw new Error(
      [error.message || String(error), details].filter(Boolean).join("\n"),
    );
  } finally {
    frame?.close();
    surface?.destroy();
    network.destroy();
  }
}
