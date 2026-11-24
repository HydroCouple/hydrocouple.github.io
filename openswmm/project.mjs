const text = new TextEncoder();
function validPath(name) {
  if (
    typeof name !== "string" ||
    /[\\:\x00-\x1f]/.test(name) ||
    name.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("Invalid archive path");
  return name;
}
async function zipLibrary() {
  const bundle = await import("./vendor/zip/jszip.min.js");
  return bundle.default || globalThis.JSZip;
}
export async function pack(project, run) {
  const Zip = await zipLibrary(),
    zip = new Zip();
  const meta = {
    format: "openswmm-workbench",
    version: 1,
    name: project.name,
    entry: project.entry,
    anchor: project.anchor,
    split: project.split,
    inputs: Object.keys(project.inputs),
  };
  for (const [name, data] of Object.entries(project.inputs))
    zip.file("inputs/" + validPath(name), data);
  if (run) {
    const { frames, geometry, files, ...summary } = run;
    meta.run = {
      ...summary,
      outputs: Object.keys(files),
      times: frames.map((f) => f.seconds),
    };
    for (const [name, data] of Object.entries(files))
      zip.file("outputs/" + validPath(name), data);
    if (geometry)
      zip.file(
        "results/geometry.json",
        JSON.stringify({
          x: Array.from(geometry.x),
          y: Array.from(geometry.y),
          cells: geometry.cells,
          links: geometry.links,
        }),
      );
    meta.run.geometry = Boolean(geometry);
    frames.forEach((f, i) => {
      for (const name of ["depth", "u", "v"])
        zip.file(
          "results/" + i + "-" + name + ".bin",
          new Uint8Array(
            f[name].buffer,
            f[name].byteOffset,
            f[name].byteLength,
          ),
        );
    });
  }
  zip.file("project.json", text.encode(JSON.stringify(meta, null, 2)));
  return zip.generateAsync({ type: "blob" });
}
export async function unpack(file) {
  const Zip = await zipLibrary(),
    zip = await Zip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (
    entries.length > 4000 ||
    entries.reduce((s, f) => s + (f._data?.uncompressedSize || 0), 0) >
      384 * 1024 * 1024
  )
    throw new Error("Project archive exceeds the import budget.");
  const read = async (path, format = "uint8array") => {
    const entry = zip.file(path);
    if (!entry) throw new Error("Project file is missing: " + path);
    return entry.async(format);
  };
  const meta = JSON.parse(await read("project.json", "string"));
  if (
    meta.format !== "openswmm-workbench" ||
    meta.version !== 1 ||
    !Array.isArray(meta.inputs)
  )
    throw new Error("Unsupported project archive");
  const inputs = Object.create(null);
  for (const name of meta.inputs)
    inputs[validPath(name)] = await read("inputs/" + name);
  if (!Object.hasOwn(inputs, validPath(meta.entry)))
    throw new Error("Missing project model");
  const { name, entry, anchor, split } = meta;
  const project = { name, entry, anchor, split, inputs };
  if (!meta.run) return { project, run: null };
  const { outputs, times, geometry: hasGeometry, ...summary } = meta.run;
  if (!Array.isArray(times) || times.length > 2000)
    throw new Error("Invalid playback index");
  const geometry = hasGeometry
    ? JSON.parse(await read("results/geometry.json", "string"))
    : null;
  const cells = geometry?.cells?.length || 0;
  if (
    geometry &&
    (geometry.x.length !== geometry.y.length ||
      geometry.cells.some(
        (c) =>
          c.length < 3 ||
          c.length > 4 ||
          c.some(
            (v) => !Number.isInteger(v) || v < 0 || v >= geometry.x.length,
          ),
      ))
  )
    throw new Error("Invalid mesh in project archive");
  const frames = [],
    files = Object.create(null);
  for (const name of outputs)
    files[validPath(name)] = await read("outputs/" + name);
  for (const [i, seconds] of times.entries()) {
    const frame = { seconds };
    for (const key of ["u", "v", "depth"]) {
      frame[key] = new Float32Array(
        await read("results/" + i + "-" + key + ".bin", "arraybuffer"),
      );
      if (frame[key].length !== cells)
        throw new Error("Playback frame does not match mesh");
    }
    frames.push(frame);
  }
  return { project, run: { ...summary, geometry, files, frames } };
}
let dbPromise;
async function database() {
  if (!dbPromise)
    dbPromise = new Promise((ok, no) => {
      const req = indexedDB.open("openswmm-workbench", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("workspace");
      req.onsuccess = () => ok(req.result);
      req.onerror = () => no(req.error);
    });
  return dbPromise;
}
export async function restore() {
  const db = await database();
  return new Promise((ok, no) => {
    const r = db.transaction("workspace").objectStore("workspace").get("last");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
export async function save(project, run) {
  const db = await database();
  return new Promise((ok, no) => {
    const tx = db.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put({ project, run }, "last");
    tx.oncomplete = ok;
    tx.onabort = () => no(tx.error);
    tx.onerror = () => no(tx.error);
  });
}
