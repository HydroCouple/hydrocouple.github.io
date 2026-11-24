import { Solver, SplitRole, ForcingMode, ForcingTarget, EngineState } from "./vendor/engine/index.js";

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
 * Run a project to completion, until `control.check()` (awaited at every preview sample)
 * returns "stop", or until the elapsed time reaches `control.until` seconds; a stopped run still
 * ends, reports and returns its partial outputs. The model's warnings (from opening it) and the
 * engine's runtime warnings are emitted as they arrive and returned with the result (a run in a
 * checkpoint session, which refuses callbacks, emits them from its report when it ends).
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
/**
 * A model without a 2D surface runs in an engine checkpoint session, so a run that stops early
 * can save its state and a later run continue from it. The engine does not yet take 2D surfaces
 * into checkpoint sessions.
 */
export function resumable(project) {
  const text = new TextDecoder().decode(project.inputs[project.entry]);
  return !project.split && !/^\s*\[2D_(VERTICES|TRIANGLES|QUADS|MESH_FILE)\]/im.test(text);
}
/**
 * `control.resume`, the bytes of a state a stopped run saved, continues that run from its saved
 * time; it must come from the same model.
 *
 * `control.forcings` is a queue of live forcings, taken before the first step and at every preview
 * sample: `{ kind: "rain", target: gage, value }` replaces the gage's rainfall intensity,
 * `{ kind: "inflow", target: node, value }` adds a lateral inflow (both in the model's units, held
 * until cleared); `{ clear: true, kind, target }` restores the computed value. The engine takes a
 * rainfall change at the gage's next interval. Each applied forcing is logged in the result.
 */
export async function simulate(engine, project, emit = () => {}, control = {}, threads = 0, gpu = false, dir = "/project") {
  const fs = engine.FS;
  fs.mkdir(dir);
  fs.chdir(dir);
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
  let session = resumable(project),
    resumeRefusal = null;
  if (control.resume && !session)
    throw new Error("A saved run state can only continue a model without a 2D surface.");
  let surface, geometry, frame, balance, webgpu = false, peakDepth = 0;
  const report = resultDir + "/model.rpt",
    output = resultDir + "/model.out";
  // The first 200 warnings are kept; the count covers them all.
  const warnings = { count: 0, list: [] };
  const warn = (message) => {
    warnings.count++;
    if (warnings.list.length < 200) warnings.list.push(message);
    emit({ type: "warning", message });
  };
  const runtimeWarning = (code, message) => warn(String(message).trim());
  try {
    // A checkpoint session refuses external callbacks; its warnings are read from the report.
    if (!session) network.setWarningCallback(runtimeWarning);
    network.open(entry, report, output);
    // [OPTIONS] THREADS: the deck's own count stays unless the page offers a thread team.
    if (threads > 1) network.options.set("THREADS", String(threads));
    if (project.split) {
      surface = new Solver(engine);
      surface.setWarningCallback(runtimeWarning);
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
    } else if (session) {
      try {
        network.checkpoints.startSession(1); // initializes and starts, with binary output
      } catch (error) {
        // The engine qualifies each model for checkpoint sessions (pollutants, reactions, ...). A
        // refusal before initialization leaves the model OPENED: run it without save/resume.
        if (control.resume || network.state !== EngineState.OPENED) throw error;
        session = false;
        resumeRefusal = error.message || String(error);
        network.setWarningCallback(runtimeWarning);
        webgpu = gpu && useWebGpu(network);
        network.initialize();
      }
      if (control.resume) {
        fs.mkdirTree("/resume");
        fs.writeFile("/resume/state.ckpt", control.resume);
        network.checkpoints.restore("/resume/state.ckpt");
      }
    } else {
      webgpu = gpu && useWebGpu(network);
      network.initialize();
    }
    if (!session) for (const message of network.openWarnings) warn(message.trim());
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
    const forced = [];
    const applyForcings = (seconds) => {
      for (const f of (control.forcings || []).splice(0)) {
        const rain = f.kind === "rain";
        // The surface instance of a split run owns the 2D rain; the network its own runoff.
        const solvers = rain && surface ? [network, surface] : [network];
        for (const s of solvers) {
          const index = rain ? s.gages.getIndex(f.target) : s.nodes.getIndex(f.target);
          if (index < 0) throw new Error((rain ? "No rain gage " : "No node ") + f.target);
          const target = rain ? ForcingTarget.GAGE : ForcingTarget.NODE;
          s.forcing.clear(target, index); // a new value replaces the held one
          if (f.clear) continue;
          if (rain) s.forcing.gageRainfall(index, Number(f.value), ForcingMode.REPLACE, true);
          else s.forcing.nodeLatInflow(index, Number(f.value), ForcingMode.ADD, true);
        }
        const entry = { seconds, kind: f.kind, target: f.target, value: f.clear ? null : Number(f.value) };
        forced.push(entry);
        emit({ type: "forced", ...entry });
      }
    };
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
    if (!session) network.start(true);
    const start = control.resume ? network.elapsed : 0;
    function sample(seconds) {
      if (active) {
        const [u, v] = field.getVelocities();
        const depth = Float32Array.from(field.getDepths());
        for (const d of depth) if (d > peakDepth) peakDepth = d;
        emit({
          type: "frame",
          seconds,
          depth,
          u: Float32Array.from(u),
          v: Float32Array.from(v),
        });
      }
      emit({ type: "progress", seconds, total });
      last = seconds;
    }
    sample(start);
    applyForcings(start);
    const interval = Math.max(0.001, total / (count - 1));
    next = start + interval;
    let stopped = false,
      elapsed = start;
    const until = control.until > 0 && control.until < total ? control.until : 0;
    for (;;) {
      const t = network.step();
      if (!t) break;
      elapsed = t;
      if (until && t >= until) {
        // Run until: the first routing step at or past the requested time.
        sample(t);
        stopped = true;
        break;
      }
      if (t >= next) {
        sample(t);
        next = t + interval;
        if (control.check && (await control.check()) === "stop") {
          stopped = true;
          break;
        }
        applyForcings(t);
      }
    }
    if (!stopped && last < total - 1e-6) sample(total);
    // A stopped session keeps its state at this step boundary for a later run to continue.
    let saved = null;
    if (stopped && session) {
      network.checkpoints.save(resultDir + "/state.ckpt");
      saved = { path: resultDir + "/state.ckpt", seconds: elapsed };
    }
    if (active) balance = field.getMassBalance();
    network.end();
    network.report();
    if (session)
      for (const line of fs.readFile(report, { encoding: "utf8" }).split("\n"))
        if (/^\s*WARNING\b/.test(line)) warn(line.trim());
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
      warnings,
      resumable: session,
      resumeRefusal, // the engine's reason when a model without a 2D surface still cannot resume
      saved,
      forced,
      peakDepth: active ? peakDepth : null, // the deepest cell over the preview samples, m
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
function removeTree(fs, path) {
  for (const name of fs.readdir(path)) {
    if (name === "." || name === "..") continue;
    const child = path + "/" + name;
    if (fs.isDir(fs.stat(child).mode)) removeTree(fs, child);
    else fs.unlink(child);
  }
  fs.rmdir(path);
}
/**
 * Run each scenario (`{ name, project }`) in turn in one engine module, each in its own folder,
 * removed once its result is taken. `control.check` is shared: a stop ends the scenario that is
 * running and skips the rest. Emitted messages carry the scenario's index.
 */
export async function runScenarios(engine, scenarios, emit = () => {}, control = {}, threads = 0, gpu = false) {
  const results = [];
  for (const [index, scenario] of scenarios.entries()) {
    if (control.stop) break;
    emit({ type: "scenario", index, name: scenario.name, count: scenarios.length });
    const dir = "/scenario-" + index;
    try {
      const control1 = { check: control.check, forcings: [...(control.forcings || [])] };
      results.push(await simulate(engine, scenario.project, (m) => emit({ ...m, scenario: index }), control1, threads, gpu, dir));
    } finally {
      engine.FS.chdir("/");
      if (engine.FS.analyzePath(dir).exists) removeTree(engine.FS, dir);
    }
    if (results.at(-1).stopped) break;
  }
  return results;
}
