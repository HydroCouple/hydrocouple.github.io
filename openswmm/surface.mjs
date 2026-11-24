import { distributions } from "./distributions.mjs";
const enc = new TextEncoder();
export const earthRadius = 6371008.8;
/** Local tangent approximation for the small square study areas accepted by the editor. */
export function lonLat(anchor, x, y) {
  const deg = 180 / Math.PI;
  return [
    anchor.lon +
      (((x - (anchor.x || 0)) / earthRadius) * deg) /
        Math.cos(anchor.lat / deg),
    anchor.lat + ((y - (anchor.y || 0)) / earthRadius) * deg,
  ];
}
export function rainfall(method, depth, minutes, interval = 5) {
  const table = distributions[method];
  if (table?.minutes && minutes !== table.minutes)
    throw new Error("This published storm requires 24 hours.");
  if (
    (!table && !["uniform", "triangular"].includes(method)) ||
    !Number.isFinite(depth) ||
    depth <= 0 ||
    !Number.isInteger(minutes) ||
    minutes < interval ||
    minutes % interval
  )
    throw new Error(
      "Use a positive depth and a duration divisible by five minutes.",
    );
  const cumulative = (f) => {
    if (!table)
      return method === "uniform"
        ? f
        : f <= 0.5
          ? 2 * f * f
          : 1 - 2 * (1 - f) * (1 - f);
    const pos = f * (table.values.length - 1),
      k = Math.min(Math.floor(pos), table.values.length - 2);
    return (
      (table.values[k] + (pos - k) * (table.values[k + 1] - table.values[k])) /
      table.scale
    );
  };
  return Array.from({ length: minutes / interval }, (_, i) => ({
    minutes: i * interval,
    intensity:
      (depth *
        (cumulative(((i + 1) * interval) / minutes) -
          cumulative((i * interval) / minutes)) *
        60) /
      interval,
  }));
}
function clock(minutes) {
  return Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0");
}
/** Local east/north metres of a WGS84 position relative to an origin (inverse of lonLat). */
export function toLocal(origin, lon, lat) {
  const deg = Math.PI / 180;
  return [
    (lon - origin.lon) * deg * earthRadius * Math.cos(origin.lat * deg),
    (lat - origin.lat) * deg * earthRadius,
  ];
}
function geometries(document) {
  if (document.type === "FeatureCollection") return document.features.map(geometries).flat();
  if (document.type === "Feature") return geometries(document.geometry);
  if (document.type === "GeometryCollection") return document.geometries.map(geometries).flat();
  return [document];
}
function checkPosition([lon, lat]) {
  if (!Number.isFinite(lat + lon) || Math.abs(lat) > 80 || Math.abs(lon) > 180)
    throw new Error("Use WGS84 longitude/latitude coordinates.");
}
/** WGS84 LineString / MultiLineString features as polylines of [lon, lat] for mesh constraint lines. */
export function linesFromGeoJSON(document) {
  const lines = [];
  for (const g of geometries(document)) {
    const parts =
      g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : null;
    if (!parts) throw new Error("Constraint lines must be GeoJSON LineString or MultiLineString features.");
    for (const part of parts) {
      if (part.length < 2) throw new Error("A constraint line needs two or more positions.");
      part.forEach(checkPosition);
      lines.push(part.map(([lon, lat]) => [lon, lat]));
    }
  }
  if (!lines.length) throw new Error("The file holds no lines.");
  if (lines.reduce((n, l) => n + l.length, 0) > 20000) throw new Error("Oversized constraint lines.");
  return lines;
}
/** Convert one WGS84 Polygon (with optional holes) into local east/north constraints. */
export function domainFromGeoJSON(document) {
  const feature =
    document.type === "FeatureCollection" && document.features.length === 1
      ? document.features[0]
      : document;
  const polygon = feature.type === "Feature" ? feature.geometry : feature;
  if (polygon?.type !== "Polygon" || !polygon.coordinates.length)
    throw new Error("Select one GeoJSON Polygon, optionally with holes.");
  const points = [],
    paths = [];
  let west = 180,
    south = 90;
  for (const ring of polygon.coordinates) {
    if (ring.length < 4 || ring.length + points.length > 20000)
      throw new Error("Invalid or oversized polygon ring.");
    const first = ring[0],
      last = ring.at(-1);
    if (first[0] !== last[0] || first[1] !== last[1])
      throw new Error("Close each polygon ring.");
    const vertices = [];
    for (const position of ring.slice(0, -1)) {
      checkPosition(position);
      west = Math.min(west, position[0]);
      south = Math.min(south, position[1]);
      vertices.push(points.length);
      points.push(position);
    }
    paths.push({
      kind: paths.length ? 1 : 0,
      marker: paths.length ? 2 : 1,
      vertices,
    });
  }
  const origin = { lon: west, lat: south },
    xy = points.flatMap(([lon, lat]) => toLocal(origin, lon, lat));
  return {
    lon: west,
    lat: south,
    size: Math.max(50, Math.ceil(Math.max(...xy))),
    domain: { points: xy, paths },
  };
}
export function buildSurface(module, opt, terrain) {
  const { size, cell, lat, lon, minutes, depth, storm } = opt;
  if (!(
    size >= 50 &&
    size <= 5000 &&
    cell >= 5 &&
    cell <= size &&
    size / cell <= 80
  ))
    throw new Error(
      "Choose a 50–5000 m domain with 1–80 target cells per side.",
    );
  const domain = opt.domain || {
    points: [0, 0, size, 0, size, size, 0, size],
    paths: [{ kind: 0, marker: 1, vertices: [0, 1, 2, 3] }],
  };
  // Constraint lines (WGS84 polylines) become breakline paths in the domain's local frame.
  const points = [...domain.points],
    paths = [...domain.paths];
  const origin = { lon: opt.lon, lat: opt.lat };
  for (const line of opt.lines || []) {
    const vertices = [];
    for (const [lon, lat] of line) {
      vertices.push(points.length / 2);
      points.push(...toLocal(origin, lon, lat));
    }
    paths.push({ kind: 2, marker: 3, vertices });
  }
  const quality = opt.mesh || {};
  const mesh = module.runJob({
    points,
    paths,
    maximumSize: cell,
    raster: terrain.raster,
    options: {
      minimumAngleDegrees: quality.minimumAngleDegrees ?? 30,
      smoothingPasses: quality.smoothingPasses ?? 0,
      minimumTarget: quality.minimumTarget ?? 0,
      strictSizing: quality.strictSizing ?? true,
    },
    metadata: { crs: "EPSG:4326 local tangent plane at " + lat + ", " + lon },
  });
  if (!mesh.ok)
    throw new Error(
      mesh.message +
        (mesh.report
          ? " (size conflicts " + mesh.report.sizeConflicts + ", transition conflicts " + mesh.report.transitionConflicts + ")"
          : ""),
    );
  const report = {
    ...mesh.report,
    vertices: mesh.xyz.length / 3,
    cells: mesh.triangles.length / 3,
    constraintLines: (opt.lines || []).length,
  };
  const vertices = [],
    triangles = [],
    outlets = [];
  const edgeKey = (a, b) => Math.min(a, b) + "," + Math.max(a, b);
  const outer = new Set();
  for (let i = 0; i < mesh.edgeMarkers.length; i++)
    if (mesh.edgeMarkers[i] === 1)
      outer.add(
        edgeKey(mesh.edgeVertices[2 * i], mesh.edgeVertices[2 * i + 1]),
      );
  for (let i = 0; i < mesh.xyz.length; i += 3)
    vertices.push([mesh.xyz[i], mesh.xyz[i + 1], mesh.xyz[i + 2]].join(" "));
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const tri = mesh.triangles.subarray(i, i + 3);
    triangles.push([...tri, opt.roughness, 0].join(" "));
    for (let e = 0; e < 3; e++) {
      const side = [tri[(e + 1) % 3], tri[(e + 2) % 3]];
      if (
        outer.has(edgeKey(...side)) &&
        (opt.boundary === "perimeter" ||
          (opt.boundary === "south" &&
            side.every((v) => Math.abs(mesh.xyz[3 * v + 1]) < 1e-8)))
      )
        outlets.push([i / 3, e, "NORMAL_FLOW", opt.slope, "*", "*"].join(" "));
    }
  }
  if (opt.boundary !== "walls" && !outlets.length)
    throw new Error(
      "No boundary edge matches this outlet. Choose the outer perimeter or closed walls.",
    );
  const stormRows = rainfall(storm, depth, minutes);
  const sections = [
    ["TITLE", "Browser surface study"],
    [
      "OPTIONS",
      "FLOW_UNITS CMS",
      "FLOW_ROUTING DYNWAVE",
      "START_DATE 01/01/2024",
      "START_TIME 00:00",
      "END_DATE " + (minutes + 60 >= 1440 ? "01/02/2024" : "01/01/2024"),
      "END_TIME " + clock((minutes + 60) % 1440),
      "REPORT_STEP 00:05:00",
      "ROUTING_STEP 5",
    ],
    ["RAINGAGES", "RG1 INTENSITY 0:05 1 TIMESERIES STORM"],
    [
      "TIMESERIES",
      ...stormRows.map(
        (r) => "STORM " + clock(r.minutes) + " " + r.intensity.toFixed(9),
      ),
    ],
    [
      "2D_OPTIONS",
      "DRY_DEPTH 0.001",
      "REPORT_2D YES",
      "REPORT_2D_STEP 300",
      "OUTPUT_FILE surface.h5",
    ],
    ["2D_VERTICES", ...vertices],
    ["2D_TRIANGLES", ...triangles],
    ["2D_BOUNDARY_CONDITIONS", ...outlets],
  ];
  const inp =
    sections
      .map(([key, ...rows]) => "[" + key + "]\n" + rows.join("\n"))
      .join("\n\n") + "\n";
  const { tiles, grid, ...authored } = opt;
  const inputs = {
    "surface.inp": enc.encode(inp),
    "terrain.json": enc.encode(JSON.stringify(terrain.raster)),
    "mesh-report.json": enc.encode(JSON.stringify(report, null, 2)),
    "source.json": enc.encode(
      JSON.stringify(
        {
          source: terrain.source,
          stormSource: distributions[storm]?.source || storm,
          options: authored,
        },
        null,
        2,
      ),
    ),
    "rainfall.csv": enc.encode(
      "minutes,intensity_mm_per_h\n" +
        stormRows.map((r) => r.minutes + "," + r.intensity).join("\n"),
    ),
    ...terrain.assets,
  };
  return {
    name: "Surface study",
    entry: "surface.inp",
    inputs,
    anchor: { lat, lon },
    split: false,
  };
}
