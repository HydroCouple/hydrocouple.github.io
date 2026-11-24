import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parseCrs, resolveCrs, placement, anchorPlacement } from "../crs.mjs";
import { lonLat } from "../surface.mjs";
import { sketch } from "../view.mjs";

/**
 * Independent check: the inverse transverse Mercator of a UTM zone on GRS 80 (Krüger series, three
 * terms, better than 1e-9° inside a zone), written without proj4.
 */
function utmInverse(zone, x, y, north = true) {
  const a = 6378137,
    f = 1 / 298.257222101,
    k0 = 0.9996,
    n = f / (2 - f),
    A = (a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  const beta = [n / 2 - (2 * n * n) / 3 + (37 * n ** 3) / 96, (n * n) / 48 + n ** 3 / 15, (17 * n ** 3) / 480];
  const delta = [2 * n - (2 * n * n) / 3 - 2 * n ** 3, (7 * n * n) / 3 - (8 * n ** 3) / 5, (56 * n ** 3) / 15];
  const xi = (y - (north ? 0 : 1e7)) / (k0 * A),
    eta = (x - 5e5) / (k0 * A);
  let xi1 = xi,
    eta1 = eta;
  for (let j = 1; j <= 3; j++) {
    xi1 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let lat = chi;
  for (let j = 1; j <= 3; j++) lat += delta[j - 1] * Math.sin(2 * j * chi);
  const lon = ((zone * 6 - 183) * Math.PI) / 180 + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

test("CRS option spellings parse to a code or a definition text", () => {
  for (const text of ["EPSG:25832", '"EPSG:25832"', "epsg::25832", "urn:ogc:def:crs:EPSG::25832", "25832"])
    assert.deepEqual(parseCrs(text), { epsg: 25832 }, text);
  assert.deepEqual(parseCrs("+proj=utm +zone=32 +ellps=GRS80"), { text: "+proj=utm +zone=32 +ellps=GRS80" });
  assert.equal(parseCrs(""), null);
  assert.equal(parseCrs(undefined), null);
  assert.equal(parseCrs('""'), null);
});

test("the Bellinge node F74F370 in EPSG:25832 lands where the UTM inverse puts it", async () => {
  const place = await placement({ crs: "EPSG:25832" });
  assert.equal(place.kind, "crs");
  assert.equal(place.label, "EPSG:25832 · ETRS89 / UTM zone 32N");
  const [x, y] = [586712.67, 6135376.58];
  const [lon, lat] = place.toLonLat(x, y);
  const [lon0, lat0] = utmInverse(32, x, y);
  assert.ok(Math.abs(lon - lon0) < 1e-7 && Math.abs(lat - lat0) < 1e-7, [lon, lat, lon0, lat0].join(" "));
  assert.ok(lon > 10.3 && lon < 10.4 && lat > 55.3 && lat < 55.4, "Odense"); // where the catchment is
  const [bx, by] = place.fromLonLat(lon, lat);
  assert.ok(Math.hypot(bx - x, by - y) < 1e-6, "round trip in meters");
});

test("a US state plane system in survey feet places a point and keeps its unit", async () => {
  const place = await placement({ crs: "EPSG:2284" });
  assert.equal(place.label, "EPSG:2284 · NAD83 / Virginia South (ftUS)");
  const lon = -77.436,
    lat = 37.541; // Richmond, east of the central meridian (-78.5), north of the origin latitude
  const [x, y] = place.fromLonLat(lon, lat);
  assert.ok(x > 3.5e6 && y > 1e6, [x, y].join(" "));
  const [lon2, lat2] = place.toLonLat(x, y);
  assert.ok(Math.abs(lon2 - lon) < 1e-9 && Math.abs(lat2 - lat) < 1e-9);
  // One thousandth of a degree of longitude at this latitude is 88.3 m = 289.6 US survey feet.
  const [x2] = place.fromLonLat(lon + 1e-3, lat);
  const feet = (1e-3 * (Math.PI / 180) * 6378137 * Math.cos((lat * Math.PI) / 180)) / 0.3048006096;
  assert.ok(Math.abs(x2 - x - feet) / feet < 0.01, (x2 - x) + " vs " + feet);
});

test("WKT and PROJ definitions place a model like the EPSG code does", async () => {
  const wkt =
    'PROJCS["ETRS89 / UTM zone 32N",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",' +
    'SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],' +
    'PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",9],' +
    'PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]';
  const code = await placement({ crs: "EPSG:25832" });
  for (const [text, label] of [
    [wkt, "ETRS89 / UTM zone 32N"],
    ["+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs", "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_…"],
  ]) {
    const place = await placement({ crs: text });
    assert.equal(place.label, label);
    const a = place.toLonLat(586712.67, 6135376.58),
      b = code.toLonLat(586712.67, 6135376.58);
    assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, label);
  }
});

test("an unknown code or a broken definition is refused with a message", async () => {
  await assert.rejects(resolveCrs("EPSG:999999"), /EPSG:999999 is not in the bundled EPSG table/);
  await assert.rejects(placement({ crs: "+proj=nonsense +ellps=GRS80" }), /cannot be used/);
});

test("a hand-placed anchor keeps the local approximation and inverts it", async () => {
  const anchor = { lat: 40.5, lon: -105.1, x: 1000, y: 2000 };
  const place = await placement({ crs: "", anchor });
  assert.equal(place.kind, "anchor");
  assert.equal(place.label, "40.50000, -105.10000");
  assert.deepEqual(place.toLonLat(1800, 2600), lonLat(anchor, 1800, 2600));
  const [x, y] = place.fromLonLat(...place.toLonLat(1800, 2600));
  assert.ok(Math.abs(x - 1800) < 1e-7 && Math.abs(y - 2600) < 1e-7);
  assert.deepEqual(anchorPlacement(anchor).toLonLat(1000, 2000), [-105.1, 40.5]);
  assert.equal(await placement({}), null);
  // A CRS wins over an anchor.
  assert.equal((await placement({ crs: "EPSG:4326", anchor })).kind, "crs");
});

test("the deck sketch carries the CRS option as written", async () => {
  const deck = await readFile(new URL("./fixtures/crs.inp", import.meta.url), "utf8");
  assert.equal(sketch(deck).crs, "EPSG:2284");
  assert.equal(sketch("[OPTIONS]\nFLOW_UNITS CFS\n").crs, "");
  assert.equal(sketch('[OPTIONS]\nCRS "EPSG:4326"\n').crs, '"EPSG:4326"');
  assert.deepEqual(parseCrs(sketch('[OPTIONS]\nCRS "EPSG:4326"\n').crs), { epsg: 4326 });
});
