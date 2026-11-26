/**
 * Scoped 2D section rows (interaction phase E3d-2): rows that apply to all cells (`*`), the cells with a
 * tag, or one cell, as the desktop's 2D section tables (openswmm.gui mesh2dsectionrowmodel.cpp: Scope,
 * Tag / cell, then the section's values). Each section is read as `{columns, rows}` and replaced whole,
 * checked here first: the engine checks names and species only when a run starts. Rows are
 * `{scope: "GLOBAL" | "TAG" | "CELL", target: "" | tag | 1-based cell, values: {column: value}}`.
 * The session (model.mjs) owns the engine; these functions take it.
 */
import { CellScope } from "./vendor/engine/index.js";

const scopes = { GLOBAL: "All cells", TAG: "Tag", CELL: "Cell" };
const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
const target = (r) => (r.scope === CellScope.TAG ? r.tag : r.scope === CellScope.CELL ? String(r.cell + 1) : "");

/** The sections and how they read, check and write (`q` is `surface2d.quality`). */
const sections = {
  coverage: {
    title: "2D land-use coverage",
    columns: (session) => session.landuseIds().map((l) => ({ key: l, label: l + " (%)", type: "number", blank: true })),
    read: (q) => q.coverages.map((c) => ({ scope: CellScope[c.scope], target: target(c), values: Object.fromEntries(c.landuses.map(([l, p]) => [l, p])) })),
    check: (session, row, label) => {
      const pairs = Object.entries(row.values).filter(([, v]) => v !== "" && v !== null && v !== undefined);
      if (!pairs.length) return label + ": cover at least one land use.";
      for (const [l, v] of pairs) if (!(Number(v) >= 0)) return label + ": the " + l + " percentage cannot be negative.";
      const sum = pairs.reduce((a, [, v]) => a + Number(v), 0);
      if (sum > 100 + 1e-9) return label + ": the land uses cover " + +sum.toFixed(6) + " %, more than 100 %.";
      return null;
    },
    clear: (q) => {
      for (let i = q.coverages.length - 1; i >= 0; i--) q.removeCoverage(i);
    },
    write: (q, row, at) => q.setCoverage(row.scope, Object.fromEntries(Object.entries(row.values).filter(([, v]) => v !== "" && v !== null && v !== undefined).map(([l, v]) => [l, Number(v)])), at),
    note: "Percent of each cell's area under each land use; blank is not covered, and the land uses of one row cover 100 % or less. A tag or cell row replaces the coverage of all cells there.",
  },
  loading: {
    title: "2D initial buildup",
    columns: (session) => [
      { key: "species", label: "Species", type: "choice", choices: session.pollutantIds() },
      { key: "value", label: "Initial buildup (" + (session.unitSystem === 0 ? "mass/acre" : "mass/hectare") + ")", type: "number" },
    ],
    read: (q) => q.loadings.map((l) => ({ scope: CellScope[l.scope], target: target(l), values: { species: l.species, value: l.value } })),
    check: (session, row, label) => {
      if (!session.pollutantIds().some((p) => same(p, row.values.species))) return label + ": choose a pollutant.";
      if (!(Number(row.values.value) >= 0)) return label + ": the buildup cannot be negative.";
      return null;
    },
    key: (row) => String(row.values.species).toUpperCase(),
    canon: (session, row) => ({ ...row, values: { ...row.values, species: session.pollutantIds().find((p) => same(p, row.values.species)) } }),
    clear: (q) => {
      for (let i = q.loadings.length - 1; i >= 0; i--) q.removeLoading(i);
    },
    write: (q, row, at) => q.setLoading(row.scope, row.values.species, Number(row.values.value), at),
    note: "Buildup on the cells' land at the start of the run, shared among their land uses.",
  },
  curb: {
    title: "2D curb length",
    columns: (session) => [{ key: "length", label: "Curb length (" + (session.unitSystem === 0 ? "ft" : "m") + ")", type: "number" }],
    read: (q) => q.curbLengths.map((c) => ({ scope: CellScope[c.scope], target: target(c), values: { length: c.length } })),
    check: (session, row, label) => (Number(row.values.length) > 0 ? null : label + ": the curb length must be above 0."),
    clear: (q) => {
      for (let i = q.curbLengths.length - 1; i >= 0; i--) q.removeCurbLength(i);
    },
    write: (q, row, at) => q.setCurbLength(row.scope, Number(row.values.length), at),
    note: "Curb length on the cells, for land uses whose buildup is per curb length.",
  },
};
export const scopedSections = Object.keys(sections);

/** A section's columns and rows (only for a model with a mesh). */
export function scopedRows(session, name) {
  const sec = sections[name];
  if (!sec) throw new Error("No 2D section " + name + ".");
  if (!session.cells?.mannings?.length) throw new Error("This model has no 2D surface.");
  return { name, title: sec.title, scopes, columns: sec.columns(session), rows: sec.read(session.solver.surface2d.quality), note: sec.note, tags: [...new Set(session.cells.tag.filter(Boolean))].sort(), cells: session.cells.mannings.length };
}

/** Replace a section's rows, all checked first; returns the rows there were (undo). */
export function setScopedRows(session, name, rows) {
  const sec = sections[name];
  const { rows: before, tags, cells } = scopedRows(session, name);
  const errors = [],
    seen = new Set();
  rows.forEach((row, i) => {
    const label = "Row " + (i + 1);
    const scope = row.scope,
      t = String(row.target ?? "").trim();
    if (!(scope in scopes)) return errors.push(label + ": choose all cells, a tag or a cell.");
    if (scope === "TAG" && !tags.some((x) => same(x, t))) return errors.push(label + ": no cell has the tag " + (t || "(blank)") + (tags.length ? " (tags: " + tags.join(", ") + ")." : "; this mesh has no tags."));
    if (scope === "CELL" && !(Number.isInteger(Number(t)) && Number(t) >= 1 && Number(t) <= cells)) return errors.push(label + ": a cell is a number from 1 to " + cells + ".");
    const problem = sec.check(session, row, label);
    if (problem) return errors.push(problem);
    const key = scope + ":" + (scope === "GLOBAL" ? "*" : t.toUpperCase()) + ":" + (sec.key ? sec.key(row) : "");
    if (seen.has(key)) errors.push(label + " repeats an earlier row's scope" + (sec.key ? " and species" : "") + ".");
    seen.add(key);
  });
  if (errors.length) throw new Error(errors.join(" "));
  const q = session.solver.surface2d.quality;
  sec.clear(q);
  for (const given of rows) {
    const row = sec.canon ? sec.canon(session, given) : given,
      t = String(row.target ?? "").trim();
    sec.write(q, { ...row, scope: CellScope[row.scope] }, row.scope === "TAG" ? { tag: tags.find((x) => same(x, t)) } : row.scope === "CELL" ? { cell: Number(t) - 1 } : {});
  }
  return before;
}
