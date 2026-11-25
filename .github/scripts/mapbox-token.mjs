// Deploy step: writes the public Mapbox token (MAPBOX_TOKEN) into openswmm/config.json and folds it
// into the workbench's offline cache version, so a changed token also reaches visitors' cached copies.
// The token is never printed. Without MAPBOX_TOKEN the site deploys with the basemap off.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const token = (process.env.MAPBOX_TOKEN || "").trim();
if (!token) {
  console.log("MAPBOX_TOKEN is not set: the workbench deploys with the basemap off.");
  process.exit(0);
}
if (!token.startsWith("pk.")) {
  console.error("MAPBOX_TOKEN must be a public (pk.) Mapbox token.");
  process.exit(1);
}
const config = JSON.parse(readFileSync("openswmm/config.json", "utf8"));
writeFileSync("openswmm/config.json", JSON.stringify({ ...config, mapboxPublicToken: token }));
const list = JSON.parse(readFileSync("openswmm/offline-files.json", "utf8"));
const version = createHash("sha256").update(list.version + "\n" + token).digest("hex").slice(0, 16);
writeFileSync("openswmm/offline-files.json", JSON.stringify({ ...list, version }));
writeFileSync("openswmm/vendor/offline-version.js", "self.workbenchVersion = " + JSON.stringify(version) + ";\n");
console.log("Mapbox token written; offline cache " + list.version + " -> " + version + ".");
