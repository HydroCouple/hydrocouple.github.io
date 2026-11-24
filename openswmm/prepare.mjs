// Assemble model runtimes under this static Pages app. Run after building MeshKit.
// node prepare.mjs --engine <engine package root> --mesh <MeshKit repo> --jszip <JSZip package> [--simd <SIMD dist>]
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const root = new URL(".", import.meta.url).pathname;
const { values: args } = parseArgs({
  options: {
    engine: { type: "string" },
    mesh: { type: "string" },
    jszip: { type: "string" },
    simd: { type: "string" },
    // Multi-threaded engine (OPENSWMM_WASM_THREADS=ON build): used when the page is crossOriginIsolated.
    threads: { type: "string" },
    // Engine catalog defaults (python/openswmm/engine/catalog_defaults.json) until the WASM package ships them.
    "catalog-defaults": { type: "string" },
  },
});
const fail = (message) => {
  console.error("prepare.mjs: " + message);
  process.exit(2);
};
for (const key of ["engine", "mesh", "jszip"])
  if (!args[key]) fail("--" + key + " is required");
const engine = resolve(args.engine),
  mesh = resolve(args.mesh),
  jszip = resolve(args.jszip);
const token = (process.env.MAPBOX_PUBLIC_TOKEN || "").trim();
if (token && !/^pk\.[A-Za-z0-9_.-]+$/.test(token))
  fail("MAPBOX_PUBLIC_TOKEN must be a public pk. token");

async function stage(files, target) {
  const dest = join(root, "vendor", target);
  await mkdir(dest, { recursive: true });
  for (const file of files) await copyFile(file, join(dest, basename(file)));
}
const site = join(root, "..");
await stage(
  [
    join(site, "img/hydrocouple.png"),
    join(site, "fonts/inter-latin.woff2"),
    join(site, "fonts/sora-latin.woff2"),
    join(site, "fonts/inter-OFL.txt"),
    join(site, "fonts/sora-OFL.txt"),
  ],
  "brand",
);
const { version } = JSON.parse(await readFile(join(engine, "package.json"), "utf8"));
if (version !== "6.0.0-alpha.4.dev.2")
  fail("Expected OpenSWMM WASM 6.0.0-alpha.4.dev.2");
const engineScripts = (await readdir(join(engine, "dist")))
  .filter((name) => name.endsWith(".js"))
  .sort()
  .map((name) => join(engine, "dist", name));
await stage(
  [
    ...engineScripts,
    join(engine, "dist/openswmm_engine.wasm"),
    join(engine, "LICENSE"),
    join(engine, "NOTICE"),
  ],
  "engine",
);
const defaults = args["catalog-defaults"]
  ? resolve(args["catalog-defaults"])
  : join(engine, "dist/catalog_defaults.json");
if (existsSync(defaults))
  await copyFile(defaults, join(root, "vendor/engine/catalog_defaults.json"));
else await rm(join(root, "vendor/engine/catalog_defaults.json"), { force: true });
await stage(
  [
    join(mesh, "wasm/dist/meshkit.mjs"),
    join(mesh, "wasm/dist/meshkit.wasm"),
    join(mesh, "LICENSE"),
    join(mesh, "NOTICE"),
  ],
  "mesh",
);
await stage([join(mesh, "vendor/predicates/LICENSE")], "mesh/predicates");
await stage(
  [join(jszip, "dist/jszip.min.js"), join(jszip, "LICENSE.markdown")],
  "zip",
);
if (args.simd)
  await stage(
    [
      join(resolve(args.simd), "openswmm_engine.js"),
      join(resolve(args.simd), "openswmm_engine.wasm"),
    ],
    "simd",
  );
else await rm(join(root, "vendor/simd"), { recursive: true, force: true });
if (args.threads)
  await stage(
    [
      join(resolve(args.threads), "openswmm_engine.js"),
      join(resolve(args.threads), "openswmm_engine.wasm"),
    ],
    "threads",
  );
else await rm(join(root, "vendor/threads"), { recursive: true, force: true });
// A threads build with the WebGPU 2D marcher (OPENSWMM_WASM_WEBGPU=ON) carries the WebGPU glue;
// the workbench then offers it as an opt-in run setting.
const webgpu =
  !!args.threads &&
  (await readFile(join(resolve(args.threads), "openswmm_engine.js"), "utf8")).includes(
    "wgpuInstanceRequestAdapter",
  );
await writeFile(
  join(root, "config.json"),
  JSON.stringify({
    mapboxPublicToken: token,
    simd: !!args.simd,
    threads: !!args.threads,
    webgpu,
    engineVersion: version,
  }),
);

// Offline cache list and version: every served app file except the service worker and tests.
const served = new Set([".html", ".css", ".js", ".mjs", ".inp", ".wasm", ".woff2", ".png", ".json"]);
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter((d) => d.isFile())
  .map((d) => relative(root, join(d.parentPath, d.name)).split(sep).join("/"))
  .filter((path) => {
    const name = path.split("/").pop(),
      ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
    return (
      (served.has(ext) || name === "config.json") &&
      name !== "sw.js" &&
      name !== "offline-files.json" &&
      name !== "offline-version.js" &&
      name !== "prepare.mjs" &&
      !path.split("/").includes("tests")
    );
  })
  .sort();
const digest = createHash("sha256");
for (const path of files) {
  digest.update(path);
  digest.update(await readFile(join(root, path)));
}
const cacheVersion = digest.digest("hex").slice(0, 16);
await writeFile(
  join(root, "offline-files.json"),
  JSON.stringify({ version: cacheVersion, files }),
);
// An updated worker script triggers the browser to install the new asset list.
await writeFile(
  join(root, "vendor/offline-version.js"),
  "self.workbenchVersion = " + JSON.stringify(cacheVersion) + ";\n",
);
console.log("Staged", files.length, "offline files · cache", cacheVersion);
