/**
 * Model placement (model layer, no DOM): where a model's coordinates sit on the globe.
 *
 * A model with a coordinate reference system (`[OPTIONS] CRS`: an EPSG code, WKT or a PROJ string)
 * is transformed with proj4js and the EPSG table bundled by prepare.mjs; a model without one may
 * carry a hand-placed anchor, an equirectangular approximation around a corner of the model.
 * Nothing here asks a service: the definitions ship with the app and work offline.
 */
import { earthRadius, lonLat } from "./surface.mjs";

let library, table;
/** proj4js is a UMD file: the CommonJS default export under Node, a global in a browser module. */
const proj4Library = () =>
  (library ??= import("./vendor/proj4/proj4.js").then((m) => m.default || globalThis.proj4));
/** The bundled EPSG table: code → [name, PROJ string] (vendor/epsg/epsg.json). */
const epsgTable = () =>
  (table ??= import("./vendor/epsg/epsg.json", { with: { type: "json" } }).then((m) => m.default));

/**
 * A CRS option value: `{epsg}` for an EPSG code in its usual spellings (`EPSG:25832`, `EPSG::25832`,
 * `urn:ogc:def:crs:EPSG::25832`, a bare number), `{text}` for WKT or a PROJ string, null when empty.
 */
export function parseCrs(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .trim();
  if (!text) return null;
  const m = text.match(/^(?:EPSG:{1,2}|urn:ogc:def:crs:EPSG:[\d.]*:)(\d+)$/i) || text.match(/^(\d+)$/);
  return m ? { epsg: Number(m[1]) } : { text };
}

/** The proj4 definition of a CRS option and a label for it; null for none; throws when it is unusable. */
export async function resolveCrs(value) {
  const parsed = parseCrs(value);
  if (!parsed) return null;
  if ("epsg" in parsed) {
    const entry = (await epsgTable())[parsed.epsg];
    if (!entry) throw new Error("EPSG:" + parsed.epsg + " is not in the bundled EPSG table.");
    return { label: "EPSG:" + parsed.epsg + " · " + entry[0], definition: entry[1] };
  }
  const name = parsed.text.match(/^\s*\w+\s*\[\s*"([^"]+)"/)?.[1]; // WKT: the first quoted name
  return {
    label: name || (parsed.text.length > 48 ? parsed.text.slice(0, 45) + "…" : parsed.text),
    definition: parsed.text,
  };
}

/** The placement of a model whose east/north meters are measured from `anchor` ({lat, lon, x?, y?}). */
export function anchorPlacement(anchor) {
  const deg = 180 / Math.PI;
  return {
    kind: "anchor",
    label: anchor.lat.toFixed(5) + ", " + anchor.lon.toFixed(5),
    toLonLat: (x, y) => lonLat(anchor, x, y),
    fromLonLat: (lon, lat) => [
      (anchor.x || 0) + ((lon - anchor.lon) / deg) * earthRadius * Math.cos(anchor.lat / deg),
      (anchor.y || 0) + ((lat - anchor.lat) / deg) * earthRadius,
    ],
  };
}

/**
 * Where a model sits: `{kind: "crs" | "anchor", label, toLonLat(x, y) → [lon, lat],
 * fromLonLat(lon, lat) → [x, y]}`, or null for a model in local coordinates. A CRS wins over an
 * anchor. Rejects when the CRS cannot be used.
 */
export async function placement({ crs, anchor }) {
  const resolved = await resolveCrs(crs);
  if (!resolved) return anchor ? anchorPlacement(anchor) : null;
  const proj4 = await proj4Library();
  let converter;
  try {
    converter = proj4(resolved.definition, "EPSG:4326");
  } catch (e) {
    throw new Error("CRS " + resolved.label + " cannot be used: " + (e.message || e));
  }
  return {
    kind: "crs",
    label: resolved.label,
    toLonLat: (x, y) => converter.forward([x, y]),
    fromLonLat: (lon, lat) => converter.inverse([lon, lat]),
  };
}
