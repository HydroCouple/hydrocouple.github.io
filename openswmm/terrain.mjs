import { lonLat } from "./surface.mjs";
const tnm =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const skadi = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/";
const openTopography = "https://portal.opentopography.org/API/globaldem";
const hgtBytes = 3601 * 3601 * 2;
export function tileName(lat, lon) {
  const part = (n, positive, negative, width) =>
    (n < 0 ? negative : positive) +
    String(Math.abs(Math.floor(n))).padStart(width, "0");
  return part(lat, "N", "S", 2) + part(lon, "E", "W", 3);
}
// Providers occasionally drop a request or answer 429/5xx. Retry those twice before failing the acquisition.
async function checked(url, options) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      if (attempt < 3) {
        await new Promise((ok) => setTimeout(ok, 750 * attempt));
        continue;
      }
      throw new Error(
        "Terrain service could not be reached from this browser. Retry or import a local terrain grid.",
      );
    }
    if (response.ok) return response;
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await new Promise((ok) => setTimeout(ok, 750 * attempt));
      continue;
    }
    throw new Error(
      "Terrain download failed (HTTP " +
        response.status +
        "). Import a local grid or choose another source.",
    );
  }
}
/**
 * Bilinear value at a longitude/latitude on a north-up grid. `x0`/`y0` is the
 * outer corner of pixel (0, 0) and values are pixel-centered. Missing data gives NaN.
 */
function bilinear(grid, lon, lat) {
  const fc = (lon - grid.x0) / grid.sx - 0.5,
    fr = (grid.y0 - lat) / grid.sy - 0.5;
  const c = Math.floor(fc),
    r = Math.floor(fr);
  if (c < 0 || r < 0 || c + 1 >= grid.width || r + 1 >= grid.height)
    return NaN;
  const fx = fc - c,
    fy = fr - r;
  return (
    (1 - fy) * ((1 - fx) * grid.at(r, c) + fx * grid.at(r, c + 1)) +
    fy * ((1 - fx) * grid.at(r + 1, c) + fx * grid.at(r + 1, c + 1))
  );
}
/** Read a single-band, uncompressed Float32 GeoTIFF (as written by the 3DEP ImageServer). */
export function readTiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(0) === 0x4949;
  if (!little && view.getUint16(0) !== 0x4d4d)
    throw new Error("The elevation service did not return a GeoTIFF.");
  const ifd = view.getUint32(4, little),
    tags = new Map(),
    sizes = { 2: 1, 3: 2, 4: 4, 12: 8 };
  for (let i = 0; i < view.getUint16(ifd, little); i++) {
    const at = ifd + 2 + 12 * i,
      type = view.getUint16(at + 2, little),
      count = view.getUint32(at + 4, little);
    if (!sizes[type]) continue;
    const start =
      sizes[type] * count <= 4 ? at + 8 : view.getUint32(at + 8, little);
    tags.set(
      view.getUint16(at, little),
      Array.from({ length: count }, (_, k) =>
        type === 3
          ? view.getUint16(start + 2 * k, little)
          : type === 4
            ? view.getUint32(start + 4 * k, little)
            : type === 12
              ? view.getFloat64(start + 8 * k, little)
              : view.getUint8(start + k),
      ),
    );
  }
  const one = (tag, fallback) => (tags.get(tag) ?? [fallback])[0];
  const width = one(256),
    height = one(257);
  if (
    one(259, 1) !== 1 ||
    one(258) !== 32 ||
    one(339) !== 3 ||
    one(277, 1) !== 1 ||
    !tags.has(33550) ||
    !tags.has(33922)
  )
    throw new Error("Unsupported elevation GeoTIFF layout.");
  const tiled = tags.has(322),
    tw = tiled ? one(322) : width,
    th = tiled ? one(323) : one(278, height),
    offsets = tags.get(tiled ? 324 : 273),
    counts = tags.get(tiled ? 325 : 279),
    across = Math.ceil(width / tw);
  // GTRasterTypeGeoKey 2 places the tie point on a pixel center rather than its corner.
  const keys = tags.get(34735) || [];
  let point = false;
  for (let k = 4; k + 3 < keys.length; k += 4)
    if (keys[k] === 1025) point = keys[k + 3] === 2;
  const [sx, sy] = tags.get(33550),
    tie = tags.get(33922);
  return {
    width,
    height,
    sx,
    sy,
    x0: tie[3] - (point ? sx / 2 : 0),
    y0: tie[4] + (point ? sy / 2 : 0),
    // An empty (sparse) block means the service has no data there.
    at(r, c) {
      const block = tiled
        ? Math.floor(r / th) * across + Math.floor(c / tw)
        : Math.floor(r / th);
      if (!counts[block]) return NaN;
      const k = tiled ? (r % th) * tw + (c % tw) : (r % th) * width + c;
      return view.getFloat32(offsets[block] + 4 * k, little);
    },
  };
}
async function usgs(points, spacing, assets, progress) {
  const lons = points.map((p) => p[0]),
    lats = points.map((p) => p[1]);
  // Square pixels at 1/8 of the node spacing (1 m to 1/3 arc-second), padded for interpolation.
  const deg = 180 / Math.PI / 6371008.8;
  const px = Math.min(1 / 10800, Math.max(1 * deg, (spacing / 8) * deg));
  const west = Math.min(...lons) - 2 * px,
    south = Math.min(...lats) - 2 * px;
  const width = Math.ceil((Math.max(...lons) - west) / px) + 3,
    height = Math.ceil((Math.max(...lats) - south) / px) + 3;
  progress("Downloading USGS 3DEP elevation · " + width + " × " + height);
  const query = new URLSearchParams({
    bbox: [west, south, west + width * px, south + height * px].join(","),
    bboxSR: "4326",
    imageSR: "4326",
    size: width + "," + height,
    format: "tiff",
    pixelType: "F32",
    compression: "None",
    interpolation: "RSP_BilinearInterpolation",
    f: "image",
  });
  const bytes = new Uint8Array(
    await (await checked(tnm + "?" + query)).arrayBuffer(),
  );
  assets["terrain/usgs-3dep.tif"] = bytes;
  // Sample with the returned georeference; the service may adjust the requested extent.
  const grid = readTiff(bytes);
  return points.map(([lon, lat]) => bilinear(grid, lon, lat));
}
async function gunzip(bytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Sample 1-arc-second HGT tiles; `load(tile)` returns the stored file and its raw samples. */
async function hgt(points, assets, progress, load) {
  const groups = new Map(),
    heights = new Array(points.length);
  points.forEach(([lon, lat], i) => {
    const tile = tileName(lat, lon);
    if (!groups.has(tile)) groups.set(tile, []);
    groups.get(tile).push({ i, lat, lon });
  });
  for (const [tile, locations] of groups) {
    progress("Downloading elevation tile " + tile);
    const { name, bytes, raw } = await load(tile);
    if (raw.byteLength !== hgtBytes)
      throw new Error("Unexpected 1-arc-second tile dimensions");
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (const { i, lat, lon } of locations) {
      const col = (lon - Math.floor(lon)) * 3600,
        row = (1 - lat + Math.floor(lat)) * 3600;
      const x = Math.min(Math.floor(col), 3599),
        y = Math.min(Math.floor(row), 3599);
      const at = (dx, dy) => view.getInt16(2 * ((y + dy) * 3601 + x + dx));
      const z = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
      if (z.includes(-32768))
        throw new Error(
          "The elevation tile has a void in this domain. Import a complete local DEM.",
        );
      const fx = col - x,
        fy = row - y;
      heights[i] =
        (1 - fy) * ((1 - fx) * z[0] + fx * z[1]) +
        fy * ((1 - fx) * z[2] + fx * z[3]);
    }
    assets["terrain/" + name] = bytes;
  }
  return heights;
}
async function localSrtm(points, assets, progress, localTiles) {
  if (points.some(([, lat]) => lat < -56 || lat >= 60))
    throw new Error(
      "This site is outside SRTM coverage. Import a local elevation grid.",
    );
  const bundle = await import("./vendor/zip/jszip.min.js");
  const Zip = bundle.default || globalThis.JSZip;
  return hgt(points, assets, progress, async (tile) => {
    const name = tile + ".SRTMGL1.hgt.zip",
      bytes = localTiles?.[name];
    if (!bytes) throw new Error("Missing local tile " + name);
    const zip = await Zip.loadAsync(bytes);
    const entry = Object.values(zip.files).find(
      (f) => f.name.toUpperCase() === tile + ".HGT",
    );
    if (!entry) throw new Error("No " + tile + ".hgt in " + name);
    return { name, bytes, raw: await entry.async("uint8array") };
  });
}
function terrainTiles(points, assets, progress) {
  return hgt(points, assets, progress, async (tile) => {
    const name = tile + ".hgt.gz",
      bytes = new Uint8Array(
        await (
          await checked(skadi + tile.slice(0, 3) + "/" + name)
        ).arrayBuffer(),
      );
    return { name, bytes, raw: await gunzip(bytes) };
  });
}
/** Parse an Esri ASCII grid (corner or center registration). */
export function readAsciiGrid(text) {
  const lines = text.split(/\r?\n/),
    head = {};
  let k = 0;
  for (; k < lines.length; k++) {
    const m = lines[k].trim().match(/^([A-Za-z_]+)\s+(\S+)$/);
    if (!m) break;
    head[m[1].toLowerCase()] = Number(m[2]);
  }
  const width = head.ncols,
    height = head.nrows,
    sx = head.cellsize ?? head.dx,
    sy = head.cellsize ?? head.dy;
  const values = lines.slice(k).join(" ").trim().split(/\s+/).map(Number);
  if (
    !(width > 1 && height > 1 && sx > 0 && sy > 0) ||
    values.length !== width * height
  )
    throw new Error("Unrecognized elevation grid from OpenTopography.");
  const center = "xllcenter" in head;
  const x0 = center ? head.xllcenter - sx / 2 : head.xllcorner,
    y0 = (center ? head.yllcenter - sy / 2 : head.yllcorner) + height * sy;
  return {
    width,
    height,
    sx,
    sy,
    x0,
    y0,
    at: (r, c) => {
      const v = values[r * width + c];
      return v === head.nodata_value ? NaN : v;
    },
  };
}
async function openTopo(points, demtype, apiKey, assets, progress) {
  if (!["SRTMGL1", "COP30", "NASADEM"].includes(demtype))
    throw new Error("Choose an OpenTopography dataset.");
  if (!apiKey?.trim())
    throw new Error("Enter your OpenTopography API key for this source.");
  const pad = 3 / 3600,
    lons = points.map((p) => p[0]),
    lats = points.map((p) => p[1]);
  const query = new URLSearchParams({
    demtype,
    south: Math.min(...lats) - pad,
    north: Math.max(...lats) + pad,
    west: Math.min(...lons) - pad,
    east: Math.max(...lons) + pad,
    outputFormat: "AAIGrid",
    API_Key: apiKey.trim(),
  });
  progress("Downloading " + demtype + " from OpenTopography");
  let text;
  try {
    text = await (await checked(openTopography + "?" + query)).text();
  } catch (e) {
    if (/HTTP 401/.test(e.message))
      throw new Error("OpenTopography rejected the API key (HTTP 401).");
    throw e;
  }
  // The stored response and the request description never include the key.
  assets["terrain/opentopography-" + demtype + ".asc"] =
    new TextEncoder().encode(text);
  const grid = readAsciiGrid(text);
  return points.map(([lon, lat]) => bilinear(grid, lon, lat));
}
export async function getTerrain(opt, progress, apiKey) {
  const { size, cell, lat, lon, source } = opt;
  if (
    ![size, cell, lat, lon].every(Number.isFinite) ||
    cell <= 0 ||
    size <= 0 ||
    size > 5000 ||
    size < 50 ||
    cell < 5 ||
    size / cell > 80 ||
    Math.abs(lat) > 80 ||
    Math.abs(lon) > 180
  )
    throw new Error("Invalid study coordinates or resolution.");
  if (source === "local") {
    const grid = opt.grid;
    if (
      !grid ||
      grid.x !== 0 ||
      grid.y !== 0 ||
      !Array.isArray(grid.heights) ||
      !grid.heights.every(Number.isFinite) ||
      (grid.columns - 1) * grid.dx < size - 1e-8 ||
      (grid.rows - 1) * grid.dy < size - 1e-8
    )
      throw new Error(
        "The local grid must cover the study square from (0,0) in metres with finite node heights.",
      );
    return {
      raster: grid,
      source: "Imported local elevation grid",
      assets: {},
    };
  }
  const n = Math.min(33, Math.max(3, Math.ceil(size / cell) + 1)),
    spacing = size / (n - 1);
  const points = Array.from({ length: n * n }, (_, i) =>
    lonLat({ lat, lon }, (i % n) * spacing, Math.floor(i / n) * spacing),
  );
  if (points.some(([x]) => Math.abs(x) > 180))
    throw new Error("Choose a domain on one side of the antimeridian.");
  const assets = {};
  let heights, label;
  if (source === "usgs") {
    heights = await usgs(points, spacing, assets, progress);
    label = "USGS 3DEP dynamic elevation · bilinear samples in metres";
  } else if (source === "skadi") {
    heights = await terrainTiles(points, assets, progress);
    label =
      "AWS Terrain Tiles (Skadi, 1 arc-second) · SRTM-derived mosaic with USGS 3DEP and national DEMs · metres";
  } else if (source === "opentopo") {
    heights = await openTopo(points, opt.demtype, apiKey, assets, progress);
    label = "OpenTopography " + opt.demtype + " · bilinear samples in metres";
  } else if (source === "tiles") {
    heights = await localSrtm(points, assets, progress, opt.tiles);
    label = "Imported SRTMGL1 tiles · EGM96 metres";
  } else if (source === "plane") {
    heights = points.map((_, i) => Math.floor(i / n) * spacing * opt.slope);
    label = "Synthetic sloping plane";
  } else throw new Error("Unrecognized terrain source");
  if (!heights.every((z) => Number.isFinite(z) && z > -10000))
    throw new Error(
      "Terrain coverage is incomplete. Choose another source or import a local grid.",
    );
  return {
    raster: {
      columns: n,
      rows: n,
      x: 0,
      y: 0,
      dx: spacing,
      dy: spacing,
      heights,
    },
    source: label,
    assets,
  };
}
