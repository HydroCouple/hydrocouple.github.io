/**
 * Card groups over table rows (interaction phase E3d-3b): a node's aquifer bed ([2D_AQUIFER_NODE]) and
 * transport boundaries ([TRANSPORT_BOUNDARIES]); a conduit's aquifer link ([2D_AQUIFER_LINKS]),
 * dispersion coefficient ([CONDUIT_DISPERSION]) and transport sources ([TRANSPORT_SOURCES]). They are
 * the rows of the 2D groundwater and Transport (ARD) tables that name this object: a card and its
 * table edit the same rows with the same checks. A card's change replaces only its object's rows, in
 * place; its undo puts the tables back as they were (`restore`).
 */
import { checkScopedRow, readScopedRows, unitsOf } from "./surface-sections.mjs";
import { checkTransportRow, readTransportRows, ARD } from "./transport-tables.mjs";

const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
const blank = (v) => v === "" || v === null || v === undefined;
const yesNo = [
  ["YES", "Yes"],
  ["NO", "No"],
];
const sources = [
  ["", "None"],
  ["VALUE", "A value"],
  ["TIMESERIES", "A time series"],
];
export const tableGroupKeys = ["aquiferBed", "aquiferLink", "ardBoundary", "ard"];

/** `rows` with the ones `mine` picks replaced by `next`, where the first of them was (else at the end). */
function replaceOwn(rows, mine, next) {
  const out = [];
  let placed = false;
  for (const r of rows) {
    if (!mine(r)) out.push(r);
    else if (!placed) {
      out.push(...next);
      placed = true;
    }
  }
  if (!placed) out.push(...next);
  return out;
}
const mesh = (session) => session.cells?.mannings?.length > 0;
const species = (session) => [...session.solver.reactions.species].map((sp) => sp.name);
const isConduit = (session, id) => session.solver.links.get(id).type === 0;

/** A reaction species' rows of a boundary or source table: from, value, series per species. */
function speciesFields(session, rows, prefix, valueLabel) {
  const series = session.timeseriesIds();
  return species(session).flatMap((sp) => {
    const r = rows.find((r) => same(r.values.species, sp));
    const from = r ? r.values.from : "";
    return [
      { name: prefix + ":" + sp, label: sp, type: "choice", value: from, choices: sources },
      { name: prefix + "v:" + sp, label: sp + " " + valueLabel, type: "number", value: from === "VALUE" ? r.values.value : "", when: { name: prefix + ":" + sp, in: ["VALUE"] } },
      { name: prefix + "t:" + sp, label: sp + " time series", type: "choice", value: from === "TIMESERIES" ? r.values.series : "", choices: [["", "— choose —"], ...series.map((t) => [t, t])], when: { name: prefix + ":" + sp, in: ["TIMESERIES"] } },
    ];
  });
}
/** The checked rows a boundary or source card asks for. */
function speciesRows(session, table, id, values, prefix, what) {
  const rows = [];
  for (const sp of species(session)) {
    const from = values[prefix + ":" + sp] ?? "";
    if (!from) continue;
    if (from !== "VALUE" && from !== "TIMESERIES") throw new Error(sp + ": choose none, a value or a time series.");
    const row = { values: { element: id, species: sp, from, value: from === "VALUE" ? values[prefix + "v:" + sp] : "", series: from === "TIMESERIES" ? values[prefix + "t:" + sp] : "" } };
    const problem = checkTransportRow(session, table, row, sp + " " + what);
    if (problem) throw new Error(problem);
    rows.push(row);
  }
  return rows;
}

/** The table groups of a node or link card (none that do not apply to it). */
export function tableGroups(session, kind, id) {
  const groups = [];
  const u = unitsOf(session);
  if (kind === "node") {
    if (mesh(session)) {
      const t = { rows: readScopedRows(session, "nodeBeds") },
        r = t.rows.find((r) => same(r.values.node, id))?.values,
        on = { name: "bed", in: ["own"] };
      groups.push({
        key: "aquiferBed",
        title: "Aquifer bed",
        fields: [
          { name: "bed", label: "Bed", type: "choice", value: r ? "own" : "", choices: [["", "None"], ["own", "Own bed"]] },
          { name: "cell", label: "Cell", type: "number", value: r ? r.cell : "", when: on },
          { name: "kc", label: "Bed conductivity (Kc)", unit: u.rate, type: "number", value: r ? r.kc : 0, when: on },
          { name: "dc", label: "Bed thickness", unit: u.len, type: "number", value: r ? r.dc : 0, when: on },
          { name: "area", label: "Exchange area", unit: u.area, type: "number", value: r ? r.area : 0, when: on },
          { name: "exchange", label: "Exchanges water", type: "choice", value: r ? r.exchange : "YES", choices: yesNo, when: on },
        ],
        restore: { nodeBeds: t.rows },
        note: "A blank cell is located from the node; an area of 0 uses the cell's. Also listed under 2D groundwater.",
      });
    }
    if (species(session).length) {
      const t = { rows: readTransportRows(session, "ardBoundaries") };
      groups.push({
        key: "ardBoundary",
        title: "Transport boundary",
        fields: speciesFields(
          session,
          t.rows.filter((r) => same(r.values.element, id)),
          "b",
          "concentration",
        ),
        restore: { ardBoundaries: t.rows },
        note: "A reaction species' concentration held at this node, saved in the transport component's file. Also listed under Transport (ARD).",
      });
    }
  } else if (kind === "link" && isConduit(session, id)) {
    if (mesh(session)) {
      const t = { rows: readScopedRows(session, "aquiferLinks") },
        r = t.rows.find((r) => same(r.values.link, id))?.values,
        on = { name: "row", in: ["own"] };
      groups.push({
        key: "aquiferLink",
        title: "Aquifer link",
        fields: [
          { name: "row", label: "Bed", type: "choice", value: r ? "own" : "", choices: [["", "None"], ["own", "Own bed"]] },
          { name: "kc", label: "Bed conductivity (Kc)", unit: u.rate, type: "number", value: r ? r.kc : 0, when: on },
          { name: "dc", label: "Bed thickness", unit: u.len, type: "number", value: r ? r.dc : 0, when: on },
          { name: "exchange", label: "Exchanges water", type: "choice", value: r ? r.exchange : "YES", choices: yesNo, when: on },
        ],
        restore: { aquiferLinks: t.rows },
        note: "Kc 0 uses the conduit's seepage rate, a thickness of 0 its full depth. Also listed under 2D groundwater.",
      });
    }
    const registered = [...session.solver.processComponents].some((c) => c.id === ARD);
    const d = { rows: readTransportRows(session, "ardDispersion") },
      own = d.rows.find((r) => same(r.values.conduit, id));
    if (registered || own || species(session).length) {
      const s = { rows: readTransportRows(session, "ardSources") };
      groups.push({
        key: "ard",
        title: "Transport (ARD)",
        fields: [
          { name: "disp", label: "Dispersion coefficient", unit: session.unitSystem === 0 ? "ft²/s" : "m²/s", type: "number", value: own ? own.values.value : "" },
          ...speciesFields(
            session,
            s.rows.filter((r) => same(r.values.element, id)),
            "s",
            "rate (mass/s)",
          ),
        ],
        restore: { ardDispersion: d.rows, ardSources: s.rows },
        note: "A blank coefficient uses the model-wide dispersion. A source adds a reaction species along the conduit (a negative rate takes it out). Saved in the transport component's file; also listed under Transport (ARD).",
      });
    }
  }
  return groups;
}

/** Write a table group: this object's rows checked as the tables check them, then put in place. */
export function applyTableGroup(session, kind, id, key, values) {
  if (values.restore) {
    for (const [name, rows] of Object.entries(values.restore)) session.setScopedRows(name, rows); // undo
    return;
  }
  const check = (problem) => {
    if (problem) throw new Error(problem);
  };
  if (kind === "node" && key === "aquiferBed") {
    check(values.bed === "" || values.bed === "own" ? null : "Choose no bed or an own bed.");
    const row = { values: { node: id, cell: values.cell ?? "", kc: values.kc, dc: values.dc, area: values.area, exchange: values.exchange } };
    if (values.bed === "own") check(checkScopedRow(session, "nodeBeds", row, "The bed"));
    const t = { rows: readScopedRows(session, "nodeBeds") };
    session.setScopedRows(
      "nodeBeds",
      replaceOwn(t.rows, (r) => same(r.values.node, id), values.bed === "own" ? [row] : []),
    );
  } else if (kind === "node" && key === "ardBoundary") {
    const next = speciesRows(session, "ardBoundaries", id, values, "b", "boundary");
    session.setScopedRows(
      "ardBoundaries",
      replaceOwn(readTransportRows(session, "ardBoundaries"), (r) => same(r.values.element, id), next),
    );
  } else if (kind === "link" && key === "aquiferLink" && isConduit(session, id)) {
    check(values.row === "" || values.row === "own" ? null : "Choose no bed or an own bed.");
    const row = { values: { link: id, kc: values.kc, dc: values.dc, exchange: values.exchange } };
    if (values.row === "own") check(checkScopedRow(session, "aquiferLinks", row, "The bed"));
    const t = { rows: readScopedRows(session, "aquiferLinks") };
    session.setScopedRows(
      "aquiferLinks",
      replaceOwn(t.rows, (r) => same(r.values.link, id), values.row === "own" ? [row] : []),
    );
  } else if (kind === "link" && key === "ard" && isConduit(session, id)) {
    const disp = blank(values.disp) ? [] : [{ values: { conduit: id, value: values.disp } }];
    if (disp.length) check(checkTransportRow(session, "ardDispersion", disp[0], "Dispersion"));
    const next = speciesRows(session, "ardSources", id, values, "s", "source");
    // Both checked before either is written.
    session.setScopedRows(
      "ardDispersion",
      replaceOwn(readTransportRows(session, "ardDispersion"), (r) => same(r.values.conduit, id), disp),
    );
    session.setScopedRows(
      "ardSources",
      replaceOwn(readTransportRows(session, "ardSources"), (r) => same(r.values.element, id), next),
    );
  } else throw new Error("No property group " + key + " for this " + kind + ".");
}
