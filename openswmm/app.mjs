import { attachNetwork, networkInfo } from "./coupling.mjs";
import { lonLat, domainFromGeoJSON, linesFromGeoJSON } from "./surface.mjs";
import { sketch, ModelView } from "./view.mjs";
import { pack, unpack, save, restore } from "./project.mjs";
import { Editor } from "./editor.mjs";
const $ = (id) => document.getElementById(id),
  decoder = new TextDecoder(),
  encoder = new TextEncoder();
const topoKey = "openswmm.opentopographyKey";
let config = {},
  project,
  run,
  job,
  playTimer,
  loadId = 0,
  preview = {};
const status = (s) => {
  $("status").textContent = s;
};
try {
  const r = await fetch("./config.json");
  if (r.ok) config = await r.json();
} catch {}
const view = new ModelView(config.mapboxPublicToken);
const editor = new Editor({
  onApply(bytes, count) {
    install({ ...project, inputs: { ...project.inputs, [project.entry]: bytes } });
    persist();
    status(
      count + " edit" + (count > 1 ? "s" : "") + " applied · " + project.entry + " rewritten by the engine.",
    );
  },
});
view.onSelect = (index) => {
  if (index >= 0) editor.selectCell(index);
};
if (!config.mapboxPublicToken) {
  $("basemap").disabled = true;
  $("mapstatus").textContent = "Local coordinates · basemap token unconfigured";
}
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .catch(() => {});
const clock = (s) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  $("play").classList.remove("playing");
  $("play").setAttribute("aria-label", "Play");
}
function setFrame(i, frames = run?.frames || []) {
  const f = frames[i];
  view.setFrame(f);
  $("time").value = i;
  $("clock").value = clock(f?.seconds || 0);
  $("step").value = frames.length ? i + 1 + " / " + frames.length : "—";
}
function feedback(error) {
  status(error.message || String(error));
}
function persist() {
  save(project, run).catch(() =>
    status(
      "Device storage unavailable or full. Export the project to retain this revision.",
    ),
  );
}
function dialog(title, node) {
  $("dialogtitle").textContent = title;
  $("content").replaceChildren(node);
  if (!$("dialog").open) $("dialog").showModal();
}
$("close").onclick = () => $("dialog").close();
function finishUI() {
  $("series").disabled =
    !run || !Object.keys(run.files).some((p) => p.endsWith("/model.out"));
  $("report").disabled = !run?.files[run.report];
  const frames = run?.frames || [];
  $("time").max = Math.max(0, frames.length - 1);
  $("time").disabled = frames.length < 2;
  for (const id of ["play", "first", "last"])
    $(id).disabled = frames.length < 2;
  $("insprunbackend").textContent = run?.backend || "—";
  $("inspengine").textContent = run?.engine || "—";
  $("inspframes").textContent = frames.length || "—";
  $("inspoutputs").textContent = run ? Object.keys(run.files).length : "—";
  const b = run?.balance;
  const fmt = (n) =>
    Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  $("cells").textContent = run?.cells ?? preview.cells?.length ?? "—";
  $("volume").textContent = b ? fmt(b.rainfallIn) + " m³" : "—";
  $("exchange").textContent = b
    ? fmt(b.coupling1dTo2dIn) + " / " + fmt(b.coupling2dTo1dOut) + " m³"
    : "—";
  $("backend").textContent = run?.backend || "Local solver";
  if (frames.length) setFrame(frames.length - 1);
  else {
    view.setFrame(null);
    $("clock").value = clock(run?.seconds || 0);
  }
}
function install(p, r = null) {
  if (!p?.inputs?.[p.entry]) throw new Error("Missing model input");
  project = p;
  run = r;
  stopPlay();
  $("modelname").textContent = p.entry;
  $("viewtitle").textContent = p.name;
  $("split").checked = !!p.split;
  preview = sketch(decoder.decode(p.inputs[p.entry]));
  $("inspentry").textContent = p.entry;
  $("inspinputs").textContent = Object.keys(p.inputs).length;
  $("inspcells").textContent = preview.cells.length || "—";
  $("insplinks").textContent = preview.links.length || "—";
  $("inspanchor").textContent = p.anchor
    ? p.anchor.lat.toFixed(5) + ", " + p.anchor.lon.toFixed(5)
    : "Local coordinates";
  $("inspsplit").textContent = p.split
    ? "Separate 1D and 2D instances"
    : "Single engine instance";
  $("viewstatus").textContent = p.name;
  $("wrecent").textContent =
    p.entry +
    " · " +
    (preview.cells.length ? preview.cells.length + " surface cells" : "1D network") +
    (r ? " · results saved" : " · not run") +
    ". The latest successful workspace is kept in this browser.";
  if (!p.anchor) {
    $("basemap").checked = false;
    view.basemap(false);
  }
  view.geometry(r?.geometry || preview, p.anchor);
  finishUI();
  status(r ? "Reopened local results." : "Ready to run.");
  editor.load(p);
}
function busy(on) {
  view.still = on; // no streak animation while a job runs
  for (const id of [
    "example",
    "open",
    "study",
    "edit",
    "run",
    "archive",
    "split",
    "compute",
    "files",
    "locate",
    "attach",
  ])
    $(id).disabled = on;
  for (const b of document.querySelectorAll("#welcome .act, #welcome .ex"))
    b.disabled = on;
  $("stop").hidden = !on;
  $("run").hidden = on;
  if (!on) {
    $("pause").hidden = true;
    $("stop").disabled = false;
    $("stop").textContent = "Stop job";
  }
  editor.setBusy(on);
}
let paused = false;
function setPaused(on) {
  paused = on;
  $("pause").replaceChildren();
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", on ? "#i-play" : "#i-pause");
  icon.append(use);
  $("pause").append(icon, on ? "Resume" : "Pause");
}
function launch(data) {
  if (job) return;
  stopPlay();
  busy(true);
  // One engine at a time: the editing instance is dropped while a job owns the memory.
  editor.suspend();
  const worker = (job = new Worker("./worker.mjs", { type: "module" }));
  let geometry,
    backend,
    frames = [];
  function end() {
    clearTimeout(stopTimer);
    worker.terminate();
    job = null;
    busy(false);
  }
  function recover(message) {
    end();
    if (project) install(project, run);
    status(message);
  }
  worker.onerror = (e) =>
    recover(
      e.message ||
        "Worker failed to start. Check that the runtime assets are installed.",
    );
  worker.onmessage = ({ data: m }) => {
    if (job !== worker) return;
    switch (m.type) {
      case "error":
        recover(m.message);
        break;
      case "status":
        status(m.message);
        break;
      case "control":
        if (m.state === "pause") status("Paused at " + $("clock").value + " · Resume or stop the run.");
        else if (m.state === "stop") status("Stopping after the current report step…");
        break;
      case "backend":
        backend = m.backend;
        $("backend").textContent = backend;
        break;
      case "geometry":
        geometry = m.geometry
          ? { ...m.geometry, links: preview.links }
          : preview;
        view.geometry(geometry, project.anchor);
        $("cells").textContent = geometry.cells.length;
        $("time").disabled = true;
        $("play").disabled = true;
        break;
      case "frame":
        frames.push(m);
        view.setFrame(m);
        break;
      case "progress":
        $("clock").value = clock(m.seconds);
        status("Running · " + clock(m.seconds) + " of " + clock(m.total));
        break;
      case "built": {
        end();
        install(m.project);
        persist();
        let summary = "";
        try {
          const r = JSON.parse(decoder.decode(m.project.inputs["mesh-report.json"]));
          summary =
            " · " +
            r.cells.toLocaleString() +
            " cells · " +
            r.vertices.toLocaleString() +
            " vertices" +
            (r.constraintLines ? " · " + r.constraintLines + " constraint lines" : "") +
            (r.constraintAuditPassed ? " · constraints verified" : " · constraint audit failed") +
            (r.sizeConflicts + r.transitionConflicts + r.edgeConflicts
              ? " · " + (r.sizeConflicts + r.transitionConflicts + r.edgeConflicts) + " size exceptions"
              : "");
        } catch {}
        status("Mesh generated" + summary + ". Review the domain and run the model.");
        break;
      }
      case "done":
        end();
        run = {
          ...m.result,
          backend,
          geometry,
          frames,
          engine: config.engineVersion,
        };
        finishUI();
        persist();
        status(
          (run.stopped ? "Run stopped at " + clock(run.seconds) : "Run complete") +
            " · " +
            Object.keys(run.files).length +
            " local output files",
        );
        editor.load(project); // the run worker is gone; the editing engine may come back
        break;
    }
  };
  status(
    data.type === "build" ? "Preparing terrain…" : "Starting local solver…",
  );
  setPaused(false);
  $("pause").hidden = data.type !== "run";
  worker.postMessage(data);
}
$("run").onclick = () =>
  launch({
    type: "run",
    project,
    simd: !!config.simd && $("compute").value === "auto",
    threads: !!config.threads && $("compute").value !== "cpu" && crossOriginIsolated,
    webgpu: $("compute").value === "webgpu",
  });
$("pause").onclick = () => {
  if (!job) return;
  setPaused(!paused);
  job.postMessage({ type: paused ? "pause" : "resume" });
};
let stopTimer;
$("stop").onclick = () => {
  if (!job) return;
  const kill = () => {
    clearTimeout(stopTimer);
    job?.terminate();
    job = null;
    busy(false);
    install(project, run);
    status("Job stopped. Previous saved results retained.");
  };
  if (!$("pause").hidden && !$("stop").disabled) {
    // A run stops at its next report step and keeps its outputs; a second click kills it.
    $("stop").disabled = true;
    $("stop").textContent = "Stopping…";
    job.postMessage({ type: "stop" });
    stopTimer = setTimeout(() => {
      $("stop").disabled = false;
      $("stop").textContent = "Kill job";
    }, 8000);
    return;
  }
  kill();
};
$("split").onchange = () => {
  install({ ...project, split: $("split").checked });
  persist();
};
$("time").oninput = () => {
  stopPlay();
  setFrame(+$("time").value);
};
$("play").onclick = () => {
  if (playTimer) {
    stopPlay();
    return;
  }
  if (+$("time").value >= run.frames.length - 1) setFrame(0);
  $("play").classList.add("playing");
  $("play").setAttribute("aria-label", "Pause");
  playTimer = setInterval(() => {
    const i = +$("time").value + 1;
    if (i >= run.frames.length) stopPlay();
    else setFrame(i);
  }, 130);
};
async function example(key) {
  const id = ++loadId,
    r = await fetch("./examples/" + key + ".inp");
  if (!r.ok) throw new Error("Example unavailable");
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (id !== loadId || job) return;
  const entry = key + ".inp";
  install({
    name: $("example").selectedOptions[0].text,
    entry,
    inputs: { [entry]: bytes },
    split: key === "split",
    anchor: null,
  });
}
$("example").onchange = () =>
  example($("example").value).then(persist).catch(feedback);
$("open").onclick = () => $("input").click();
$("input").onchange = async () => {
  try {
    const files = Array.from($("input").files);
    if (!files.length) return;
    const id = ++loadId;
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      const value = await unpack(files[0]);
      if (id !== loadId || job) return;
      install(value.project, value.run);
    } else {
      const decks = files.filter((f) => /\.inp$/i.test(f.name));
      if (decks.length !== 1)
        throw new Error(
          "Select one INP and its sidecar files together, or open an exported project ZIP.",
        );
      const inputs = Object.create(null);
      for (const file of files)
        inputs[file.name] = new Uint8Array(await file.arrayBuffer());
      if (id !== loadId || job) return;
      install({
        name: decks[0].name,
        entry: decks[0].name,
        inputs,
        anchor: null,
        split: false,
      });
    }
    persist();
  } catch (e) {
    feedback(e);
  } finally {
    $("input").value = "";
  }
};
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$("archive").onclick = async () => {
  try {
    download(
      await pack(project, run),
      project.entry.replace(/\.inp$/i, "") + ".openswmm.zip",
    );
  } catch (e) {
    feedback(e);
  }
};
$("files").onclick = () => {
  const list = document.createElement("div");
  for (const [title, files] of [
    ["Inputs", project.inputs],
    ["Outputs", run?.files || {}],
  ]) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    list.append(heading);
    const ul = document.createElement("ul");
    list.append(ul);
    for (const [path, bytes] of Object.entries(files)) {
      const li = document.createElement("li"),
        a = document.createElement("button");
      a.textContent = path + " · " + bytes.byteLength.toLocaleString() + " B";
      a.onclick = () => download(new Blob([bytes]), path.split("/").pop());
      li.append(a);
      ul.append(li);
    }
  }
  dialog("Local files", list);
};
$("edit").onclick = () => {
  const box = document.createElement("div"),
    area = document.createElement("textarea"),
    apply = document.createElement("button");
  area.setAttribute("aria-label", "SWMM input deck");
  area.value = decoder.decode(project.inputs[project.entry]);
  area.spellcheck = false;
  apply.textContent = "Apply input changes";
  apply.onclick = () => {
    install({
      ...project,
      inputs: {
        ...project.inputs,
        [project.entry]: encoder.encode(area.value),
      },
    });
    persist();
    $("dialog").close();
  };
  box.append(area, apply);
  dialog("Edit " + project.entry, box);
};
$("attach").onclick = () => {
  if (!preview.cells?.length || preview.links?.length) {
    status("Open or generate an uncoupled surface first.");
    return;
  }
  const form = document.createElement("form");
  form.innerHTML =
    '<p>Use a metric network and terrain in the same local coordinate frame and vertical datum. The combined model uses the network clock. Its rain gages can optionally drive the surface. The original surface storm is retained in the project archive.</p><label>1D INP and companion files<input name="files" type="file" multiple required></label><div class="fields"><label>Network node<select name="node" required></select></label><label>Surface cell index<input name="cell" type="number" min="0" required></label></div><div class="fields"><label>Opening area (m²)<input name="area" type="number" step="any" min="0.000001" value="1" required></label><label>Discharge coefficient<input name="cd" type="number" step="any" min="0.000001" value="0.65" required></label></div><label class="check"><input name="rain" type="checkbox">Apply network system rainfall to surface</label><small>Check for overlapping catchment runoff before applying rain to both domains.</small><p role="status"></p><button class="primary wide">Create coupled model</button>';
  const f = form.elements;
  f.cell.max = preview.cells.length - 1;
  f.cell.value = Math.max(0, view.selected ?? 0);
  let files,
    entry,
    revision = 0;
  f.files.onchange = async () => {
    const id = ++revision;
    files = null;
    f.node.replaceChildren();
    try {
      const all = Array.from(f.files.files),
        decks = all.filter((x) => /\.inp$/i.test(x.name));
      if (decks.length !== 1)
        throw new Error("Choose one network INP with its sidecars.");
      const input = Object.create(null);
      for (const file of all)
        input[file.name] = new Uint8Array(await file.arrayBuffer());
      if (id !== revision) return;
      entry = decks[0].name;
      const info = networkInfo(input[entry]);
      for (const node of info.nodes) f.node.add(new Option(node, node));
      if (!info.nodes.length)
        throw new Error("The network has no junction or storage node.");
      files = input;
      f.rain.checked = false;
      f.rain.disabled = !info.hasRain;
      form.querySelector("[role=status]").textContent = "";
    } catch (e) {
      if (id === revision)
        form.querySelector("[role=status]").textContent = e.message;
    }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    try {
      if (!files) throw new Error("Choose a compatible 1D network.");
      const p = attachNetwork(project, files, entry, {
        cell: +f.cell.value,
        node: f.node.value,
        area: +f.area.value,
        cd: +f.cd.value,
        rain: f.rain.checked,
      });
      install(p);
      persist();
      $("dialog").close();
    } catch (e) {
      form.querySelector("[role=status]").textContent = e.message;
    }
  };
  dialog("Connect a 1D network", form);
};
$("locate").onclick = () => {
  const form = document.createElement("form");
  form.innerHTML =
    '<p>Place the southwest corner of this model on the map. Use this local approximation for small models with east/north axes.</p><div class="fields"><label>Latitude<input name="lat" type="number" min="-80" max="80" step="any" required></label><label>Longitude<input name="lon" type="number" min="-180" max="180" step="any" required></label></div><button class="primary wide">Apply reference</button>';
  const [x, y] = view.bounds;
  const old = project.anchor;
  if (old) {
    const p = lonLat(old, x, y);
    form.elements.lat.value = p[1];
    form.elements.lon.value = p[0];
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    const anchor = {
      lat: +form.elements.lat.value,
      lon: +form.elements.lon.value,
      x,
      y,
    };
    install({ ...project, anchor }, run);
    persist();
    $("dialog").close();
  };
  dialog("Map reference", form);
};
let chartWorker;
$("dialog").addEventListener("close", () => {
  if (!chartWorker) return;
  chartWorker.terminate();
  chartWorker = null;
  if (!job) editor.load(project);
});
$("series").onclick = () => {
  const box = document.createElement("div"),
    select = document.createElement("select"),
    plot = document.createElement("canvas"),
    note = document.createElement("p"),
    csv = document.createElement("button");
  select.setAttribute("aria-label", "Node depth or link discharge");
  plot.width = 570;
  plot.height = 210;
  plot.style.width = "100%";
  csv.textContent = "Export CSV";
  box.append(select, plot, note, csv);
  dialog("Network hydrograph", box);
  editor.suspend("Editing resumes when the hydrograph closes.");
  const output = Object.keys(run.files).find((p) => p.endsWith("/model.out"));
  const query = (selection) => {
    chartWorker?.terminate();
    chartWorker = new Worker("./worker.mjs", { type: "module" });
    csv.disabled = true;
    note.textContent = "Reading local binary output…";
    chartWorker.onerror = (e) => {
      note.textContent = e.message;
    };
    chartWorker.onmessage = ({ data }) => {
      chartWorker.terminate();
      chartWorker = null;
      if (data.type === "error") {
        note.textContent = data.message;
        return;
      }
      const { nodes, links, kind, id, unit, times, values } = data.result;
      if (!values.length) {
        note.textContent = "No network time series in this result.";
        return;
      }
      if (!select.options.length) {
        for (const [group, ids] of [
          ["node", nodes],
          ["link", links],
        ])
          for (const key of ids) {
            select.add(
              new Option(
                (group === "node" ? "Depth" : "Discharge") + " · " + key,
                JSON.stringify({ kind: group, id: key }),
              ),
            );
          }
      }
      const ctx = plot.getContext("2d"),
        lo = values.reduce((a, b) => Math.min(a, b), Infinity),
        hi = values.reduce((a, b) => Math.max(a, b), -Infinity);
      ctx.clearRect(0, 0, plot.width, plot.height);
      ctx.strokeStyle = "#0071bf";
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = 10 + (i * 550) / Math.max(1, values.length - 1),
          y = 195 - (180 * (v - lo)) / (hi - lo || 1);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      note.textContent =
        times[0].slice(0, 19) +
        " to " +
        times.at(-1).slice(0, 19) +
        " · " +
        lo.toPrecision(4) +
        " to " +
        hi.toPrecision(4) +
        " " +
        unit;
      csv.disabled = false;
      csv.onclick = () =>
        download(
          new Blob([
            "model_time," +
              (kind === "node" ? "depth" : "flow") +
              " (" +
              unit +
              ")\n" +
              times.map((t, i) => t.slice(0, 19) + "," + values[i]).join("\n"),
          ]),
          id + "-series.csv",
        );
    };
    chartWorker.postMessage({
      type: "series",
      bytes: run.files[output],
      selection,
    });
  };
  select.onchange = () => query(JSON.parse(select.value));
  query();
};
$("report").onclick = () => {
  const pre = document.createElement("pre");
  pre.textContent = decoder.decode(run.files[run.report]);
  dialog("Run report", pre);
};
$("basemap").onchange = async () => {
  try {
    await view.basemap($("basemap").checked);
  } catch (e) {
    $("basemap").checked = false;
    $("mapstatus").textContent = e.message;
  }
};
$("study").onclick = () => {
  const form = $("studyform").content.cloneNode(true).querySelector("form"),
    fields = form.elements;
  const note = form.querySelector("#study-note");
  fields.storm.onchange = () => {
    const fixed = /^(scs|nrcs)-/.test(fields.storm.value);
    if (fixed) fields.minutes.value = 1440;
    fields.minutes.readOnly = fixed;
  };
  fields.source.onchange = () => {
    const source = fields.source.value;
    form.querySelector("#gridlabel").hidden = source !== "local";
    form.querySelector("#tileslabel").hidden = source !== "tiles";
    form.querySelector("#skadinote").hidden = source !== "skadi";
    form.querySelector("#opentopolabel").hidden = source !== "opentopo";
    fields.apikey.required = source === "opentopo";
  };
  // The OpenTopography key stays in this browser; it is never part of a project or its exports.
  try {
    fields.apikey.value = localStorage.getItem(topoKey) || "";
  } catch {}
  let domain = null;
  fields.polygon.onchange = async () => {
    try {
      const file = fields.polygon.files[0];
      domain = file ? domainFromGeoJSON(JSON.parse(await file.text())) : null;
      if (domain) {
        for (const k of ["lon", "lat", "size"]) fields[k].value = domain[k];
        fields.boundary.value = "walls";
      }
      for (const k of ["lon", "lat", "size"]) fields[k].readOnly = !!domain;
      pick.disabled = !!domain || !view.token;
    } catch (e) {
      fields.polygon.value = "";
      domain = null;
      for (const k of ["lon", "lat", "size"]) fields[k].readOnly = false;
      note.textContent = e.message;
    }
  };
  let lines = null;
  fields.lines.onchange = async () => {
    try {
      const file = fields.lines.files[0];
      lines = file ? linesFromGeoJSON(JSON.parse(await file.text())) : null;
      note.textContent = lines ? lines.length + " constraint line(s) loaded." : "";
    } catch (e) {
      fields.lines.value = "";
      lines = null;
      note.textContent = e.message;
    }
  };
  const pick = form.querySelector("#pick");
  pick.disabled = !view.token;
  pick.onclick = async () => {
    try {
      // Use a provisional geographic reference for picking without drawing existing local geometry.
      $("dialog").close();
      view.geometry(
        { x: [], y: [], cells: [] },
        { lat: +fields.lat.value, lon: +fields.lon.value },
      );
      $("basemap").checked = true;
      await view.basemap(true);
      const restoreView = () => {
        view.onPick = null;
        document.removeEventListener("keydown", cancel);
        $("basemap").checked = false;
        view.basemap(false);
        view.geometry(run?.geometry || preview, project.anchor);
        busy(false);
        dialog("New surface study", form);
      };
      const cancel = (e) => {
        if (e.key === "Escape") restoreView();
      };
      document.addEventListener("keydown", cancel);
      view.onPick = (coordinates) => {
        fields.lat.value = coordinates.lat.toFixed(6);
        fields.lon.value = coordinates.lng.toFixed(6);
        restoreView();
      };
      busy(true);
      $("stop").hidden = true;
      status("Select the southwest corner. Escape cancels.");
    } catch (e) {
      $("basemap").checked = false;
      await view.basemap(false);
      view.geometry(run?.geometry || preview, project.anchor);
      dialog("New surface study", form);
      feedback(e);
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const options = Object.fromEntries(new FormData(form));
      for (const key of [
        "lat",
        "lon",
        "size",
        "cell",
        "minutes",
        "depth",
        "roughness",
        "slope",
      ])
        options[key] = Number(options[key]);
      delete options.grid;
      delete options.polygon;
      delete options.tiles;
      delete options.apikey;
      delete options.lines;
      options.mesh = {
        minimumAngleDegrees: Number(options.angle),
        smoothingPasses: Number(options.smoothing),
        minimumTarget: Number(options.mincell),
        strictSizing: options.strict === "on",
      };
      for (const key of ["angle", "smoothing", "mincell", "strict"]) delete options[key];
      if (lines) options.lines = lines;
      if (options.source !== "opentopo") delete options.demtype;
      if (domain) Object.assign(options, domain);
      if (options.source === "tiles") {
        options.tiles = {};
        for (const file of fields.tiles.files)
          options.tiles[file.name] = new Uint8Array(await file.arrayBuffer());
      }
      let apiKey;
      if (options.source === "opentopo") {
        apiKey = fields.apikey.value.trim();
        try {
          localStorage.setItem(topoKey, apiKey);
        } catch {}
      }
      if (options.source === "local") {
        const file = fields.grid.files[0];
        if (!file) throw new Error("Select a local elevation grid.");
        options.grid = JSON.parse(await file.text());
      }
      $("dialog").close();
      launch({ type: "build", options, apiKey });
    } catch (error) {
      feedback(error);
    }
  };
  dialog("New surface study", form);
};
$("first").onclick = () => {
  stopPlay();
  setFrame(0);
};
$("last").onclick = () => {
  stopPlay();
  setFrame(run.frames.length - 1);
};

// Panels: the three toggles and the rail remember their state in this browser.
const panelKey = "openswmm.panels";
const panels = { left: true, bottom: true, right: true };
try {
  Object.assign(panels, JSON.parse(localStorage.getItem(panelKey) || "{}"));
} catch {}
function showPanels() {
  for (const side of ["left", "bottom", "right"]) {
    $(side).hidden = !panels[side];
    const b = $("toggle" + side);
    b.classList.toggle("on", panels[side]);
    b.setAttribute("aria-pressed", String(panels[side]));
  }
  $("raillayers").classList.toggle("on", panels.left);
  view.draw();
}
function togglePanel(side) {
  panels[side] = !panels[side];
  try {
    localStorage.setItem(panelKey, JSON.stringify(panels));
  } catch {}
  showPanels();
}
for (const side of ["left", "bottom", "right"])
  $("toggle" + side).onclick = () => togglePanel(side);
$("raillayers").onclick = () => togglePanel("left");
showPanels();

// Popover menus sit under the button that opened them.
for (const [button, pop] of [
  ["filemenu", "filepop"],
  ["settingsmenu", "settingspop"],
]) {
  const menu = $(pop);
  menu.addEventListener("beforetoggle", (e) => {
    if (e.newState !== "open") return;
    const r = $(button).getBoundingClientRect();
    menu.style.left =
      Math.max(8, Math.min(r.left, innerWidth - 260)) + "px";
    menu.style.top = r.bottom + 6 + "px";
  });
}
const closeMenus = () => {
  for (const id of ["filepop", "settingspop"]) $(id).hidePopover?.();
};
$("open").addEventListener("click", closeMenus);

// Welcome: first visit, or whenever asked for.
const welcomeKey = "openswmm.welcome";
function showWelcome() {
  closeMenus();
  if (!$("welcome").open) $("welcome").showModal();
}
$("welcomebtn").onclick = showWelcome;
$("wclose").onclick = () => $("welcome").close();
$("wstartup").onchange = () => {
  try {
    localStorage.setItem(
      welcomeKey,
      $("wstartup").checked ? "always" : "never",
    );
  } catch {}
};
for (const [id, target] of [
  ["wopen", "open"],
  ["wstudy", "study"],
  ["wattach", "attach"],
])
  $(id).onclick = () => {
    $("welcome").close();
    $(target).click();
  };
for (const card of document.querySelectorAll("#welcome .ex"))
  card.onclick = () => {
    if (job) return;
    const key = card.dataset.example;
    $("example").value = key;
    $("welcome").close();
    example(key).then(persist).catch(feedback);
  };

// Help and keyboard shortcuts.
function showShortcuts() {
  dialog(
    "Keyboard shortcuts",
    $("shortcuts").content.cloneNode(true),
  );
}
$("help").onclick = showShortcuts;
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === "Enter" && e.shiftKey && !typing) {
    if (!$("run").hidden && !$("run").disabled) {
      e.preventDefault();
      $("run").click();
    }
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
    if (!$("open").disabled) {
      e.preventDefault();
      $("open").click();
    }
  } else if (e.key === "?" && !typing) {
    e.preventDefault();
    showShortcuts();
  } else if (e.key === " " && !typing && !$("play").disabled) {
    if (document.activeElement?.tagName === "BUTTON") return;
    e.preventDefault();
    $("play").click();
  }
});

if (config.engineVersion) {
  $("engine").textContent = "OpenSWMM engine " + config.engineVersion;
  $("wengine").textContent = config.engineVersion;
}
if ("serviceWorker" in navigator)
  navigator.serviceWorker.ready.then(() => {
    $("offline").hidden = false;
    // The worker adds COOP/COEP to its responses; the page is isolated from the next load on.
    if (config.threads && !crossOriginIsolated)
      $("offline").textContent =
        "● Offline ready · reload for " + (navigator.hardwareConcurrency || 1) + " cores";
  });
if (crossOriginIsolated && config.threads)
  $("backend").textContent = "Local solver · " + (navigator.hardwareConcurrency || 1) + " cores";
// Opt-in until its precision policy is decided: never chosen automatically.
if (crossOriginIsolated && config.webgpu && "gpu" in navigator)
  $("compute").append(new Option("GPU · WebGPU 2D (experimental)", "webgpu"));

busy(true);
$("stop").hidden = true;
let saved = null;
try {
  saved = await restore().catch(() => null);
  if (saved) install(saved.project, saved.run);
  else await example("surface");
} catch (e) {
  try {
    await example("surface");
  } catch (second) {
    feedback(second);
  }
}
busy(false);
let welcomePref = null;
try {
  welcomePref = localStorage.getItem(welcomeKey);
} catch {}
$("wstartup").checked = welcomePref === "always";
if (welcomePref === "always" || (welcomePref !== "never" && !saved))
  showWelcome();
