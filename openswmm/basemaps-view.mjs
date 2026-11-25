/**
 * The "Add basemap…" picker (interaction phase B1): a view over the basemap catalog (layers.mjs
 * basemapSources). A Mapbox style replaces the style at the bottom of the stack; imagery and maps, and a
 * custom XYZ layer, go on top of it. The controller (app.mjs) adds the choice to the layer tree.
 */
import { basemapSources, validTileUrl } from "./layers.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** The XYZ tile holding a point at zoom z. */
export function tileAt(lon, lat, z) {
  const n = 2 ** z,
    r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n),
    y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}
/**
 * A preview image URL for a basemap at `center`: a Mapbox style through the Static Images API (credit
 * in the card's caption), a raster as the tile holding the center. null when it needs a token.
 */
export function previewUrl(source, { lon, lat, zoom }, token) {
  if (source.kind === "style") {
    if (!token) return null;
    const id = source.style.replace("mapbox://styles/", "");
    return "https://api.mapbox.com/styles/v1/" + id + "/static/" + lon.toFixed(5) + "," + lat.toFixed(5) + "," + Math.max(0, zoom - 1).toFixed(2) + ",0/240x136@2x?attribution=false&logo=false&access_token=" + token;
  }
  const t = tileAt(lon, lat, Math.max(0, Math.min(source.maxzoom || 19, Math.round(zoom))));
  if (source.url === "mapbox://mapbox.satellite") return token ? "https://api.mapbox.com/v4/mapbox.satellite/" + t.z + "/" + t.x + "/" + t.y + "@2x.jpg90?access_token=" + token : null;
  return source.tiles[0].replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y);
}

/**
 * @param {{current: string, onPick: (source: string, custom?: {label: string, url: string, maxzoom: number}) => void, center: {lon: number, lat: number, zoom: number}, token: string}} o
 * `current`: the style row's source; `center`: where the previews look (view.previewCenter)
 */
export function basemapPicker({ current, onPick, center, token }) {
  const thumb = (url) => {
    const box = el("span", { className: "bm-thumb" });
    if (!url) return box;
    const img = el("img", { alt: "", loading: "lazy", decoding: "async", crossOrigin: "anonymous", src: url });
    img.onerror = () => box.classList.add("failed");
    box.append(img);
    return box;
  };
  const pick = (key) =>
    el(
      "button",
      { type: "button", className: "bm-pick" + (key === current ? " current" : ""), onclick: () => onPick(key) },
      thumb(previewUrl(basemapSources[key], center, token)),
      el("b", { textContent: basemapSources[key].label }),
      el("span", { textContent: key === current ? "Current style" : hint(key) }),
    );
  const keys = (kind) => Object.keys(basemapSources).filter((k) => basemapSources[k].kind === kind);
  const name = el("input", { ariaLabel: "Basemap name", placeholder: "Orthophoto 2024" }),
    url = el("input", { ariaLabel: "Tile URL", placeholder: "https://tiles.example.com/{z}/{x}/{y}.png" }),
    maxzoom = el("input", { type: "number", min: 1, max: 24, step: 1, value: 19, ariaLabel: "Maximum zoom" }),
    note = el("p", { className: "hint", role: "status" });
  // The custom layer's tile at the same place, as its URL is typed.
  const preview = el("span", { className: "bm-thumb custom" });
  let typing;
  url.oninput = () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      preview.classList.remove("failed");
      const u = url.value.trim();
      preview.replaceChildren();
      if (!validTileUrl(u)) return;
      const img = el("img", { alt: "", decoding: "async", crossOrigin: "anonymous", src: previewUrl({ kind: "raster", tiles: [u], maxzoom: +maxzoom.value || 19 }, center, token) });
      img.onerror = () => preview.classList.add("failed");
      preview.append(img);
    }, 400);
  };
  const add = el("button", { type: "button", className: "primary", textContent: "Add custom layer" });
  add.onclick = () => {
    if (!name.value.trim()) return (note.textContent = "Name the layer.");
    if (!validTileUrl(url.value.trim())) return (note.textContent = "The URL needs http(s) and {z}, {x} and {y}.");
    onPick("custom", { label: name.value.trim(), url: url.value.trim(), maxzoom: +maxzoom.value || 19 });
  };
  return el(
    "div",
    { className: "record-editor basemap-picker" },
    el("h3", { textContent: "Mapbox styles" }),
    el("p", { className: "hint", textContent: "One at a time, at the bottom of the stack: choosing one replaces the current style." }),
    el("div", { className: "bm-picks" }, ...keys("style").map(pick)),
    el("h3", { textContent: "Imagery and maps" }),
    el("p", { className: "hint", textContent: "Stacked on top of the style; each has its own order and opacity in Basemaps." }),
    el("div", { className: "bm-picks" }, ...keys("raster").map(pick)),
    el("h3", { textContent: "Custom XYZ tiles" }),
    el("p", { className: "hint", textContent: "Any {z}/{x}/{y} tile URL whose server allows requests from this page (CORS)." }),
    el("div", { className: "fields" }, el("label", { className: "prop" }, el("span", { textContent: "Name" }), name), el("label", { className: "prop" }, el("span", { textContent: "Maximum zoom" }), maxzoom)),
    el("div", { className: "bm-custom" }, el("label", { className: "prop" }, el("span", { textContent: "Tile URL" }), url), preview),
    note,
    el("div", { className: "actions end" }, add),
  );
}
function hint(key) {
  return (
    {
      outdoors: "Terrain and trails · © Mapbox © OpenStreetMap",
      streets: "Roads and places · © Mapbox © OpenStreetMap",
      light: "Muted light · © Mapbox © OpenStreetMap",
      dark: "Muted dark · © Mapbox © OpenStreetMap",
      "satellite-streets": "Imagery and roads · © Mapbox © Maxar",
      satellite: "Imagery · © Mapbox © Maxar",
      osm: "© OpenStreetMap contributors",
      esri: "Imagery · Esri, Maxar",
    }[key] || ""
  );
}
