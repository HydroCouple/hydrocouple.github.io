const decode = (data) => new TextDecoder().decode(data);
const encode = (data) => new TextEncoder().encode(data);
function blocks(text) {
  const found = new Map();
  let part = "";
  for (const line of text.split(/\r?\n/)) {
    const header = line.trim().match(/^\[([^\]]+)\](?:\s*;.*)?$/);
    if (header) {
      part = header[1].toUpperCase();
      if (!found.has(part)) found.set(part, []);
    } else if (part) found.get(part).push(line);
  }
  return found;
}
function rows(parts, name) {
  return (parts.get(name) || [])
    .map((s) => s.split(";")[0].trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/));
}
export function networkInfo(bytes) {
  const parts = blocks(decode(bytes));
  if ([...parts.keys()].some((k) => k.startsWith("2D_")))
    throw new Error(
      "Choose a 1D network. Open an existing coupled project directly.",
    );
  const units =
    rows(parts, "OPTIONS")
      .find(([k]) => k.toUpperCase() === "FLOW_UNITS")?.[1]
      ?.toUpperCase() || "CFS";
  if (!["CMS", "LPS", "MLD"].includes(units))
    throw new Error(
      "This attachment tool requires a metric 1D deck. A preconfigured US-unit coupled deck can be opened directly.",
    );
  return {
    nodes: ["JUNCTIONS", "STORAGE"].flatMap((k) =>
      rows(parts, k).map((r) => r[0]),
    ),
    hasRain: rows(parts, "RAINGAGES").length > 0,
  };
}
export function attachNetwork(
  project,
  networkFiles,
  entry,
  { cell, node, area, cd, rain },
) {
  const surface = blocks(decode(project.inputs[project.entry]));
  if (
    !surface.has("2D_TRIANGLES") ||
    rows(surface, "JUNCTIONS").length ||
    rows(surface, "STORAGE").length
  )
    throw new Error("Start with an uncoupled triangle surface study.");
  const info = networkInfo(networkFiles[entry]);
  if (
    !info.nodes.includes(node) ||
    !Number.isInteger(cell) ||
    cell < 0 ||
    cell >= rows(surface, "2D_TRIANGLES").length ||
    !(area > 0) ||
    !(cd > 0) ||
    !Number.isFinite(area + cd)
  )
    throw new Error(
      "Choose an existing surface cell and 1D node and positive exchange parameters.",
    );
  if (rain && !info.hasRain)
    throw new Error(
      "The selected network has no rain gages. Disable direct surface rainfall or add a 1D gage.",
    );
  const text = decode(networkFiles[entry]).replace(
    /^\s*\[END\]\s*(?:;[^\n]*)?$/gim,
    "",
  );
  const sections = [];
  for (const [key, body] of surface) {
    if (!key.startsWith("2D_")) continue;
    if (key.includes("NODE_MAP"))
      throw new Error("This surface already has exchange mappings.");
    if (key === "2D_OPTIONS") {
      sections.push(
        "[2D_OPTIONS]",
        ...body.filter((s) => !/^\s*(RAINFALL_MODE|OUTPUT_FILE)\s/i.test(s)),
        "RAINFALL_MODE " + (rain ? "SYSTEM" : "NONE"),
        "OUTPUT_FILE coupled-surface.h5",
      );
    } else sections.push("[" + key + "]", ...body);
  }
  sections.push("[2D_TRIANGLE_NODE_MAP]", [cell, node, cd, area].join(" "));
  const inputs = Object.assign(Object.create(null), networkFiles);
  for (const [name, bytes] of Object.entries(project.inputs))
    inputs["original-surface/" + name] = bytes;
  let model = "coupled.inp";
  while (Object.hasOwn(inputs, model)) model = "new-" + model;
  inputs[model] = encode(text + "\n\n" + sections.join("\n") + "\n");
  return {
    name: "Coupled surface and network",
    entry: model,
    inputs,
    anchor: project.anchor,
    split: false,
  };
}
