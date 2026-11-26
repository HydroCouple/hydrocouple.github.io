/**
 * The ARD transport tables (interaction phase E3d-2c): [CONDUIT_DISPERSION], [TRANSPORT_BOUNDARIES]
 * and [TRANSPORT_SOURCES], as the desktop's Quality & Transport page (ardtransportmodels.cpp). They live
 * in the transport component's file, so the first change registers it as `<model>.ard` (as the
 * desktop does). Boundaries and sources apply to reaction species only (the engine's resolver). Read as
 * `{columns, rows}` without scopes (scoped-table.mjs) and replaced whole, checked here first.
 */
const ARD = "org.hydrocouple.openswmm.transport.ard";
const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
const blankish = (v) => v === "" || v === null || v === undefined;
const stem = (session) => session.entry.replace(/^.*\//, "").replace(/\.[^.]*$/, "");
const conduits = (s) => s.links.ids.filter((id) => s.links.get(id).type === 0);
const reactionSpecies = (s) => [...s.reactions.species].map((sp) => sp.name);
const seriesNames = (session) => session.timeseriesIds?.() ?? [];

/** A boundary or source table: an element, a reaction species, a value or a time series. */
const rowTable = (title, element, elements, source, note) => ({
  title,
  columns: (session) => [
    { key: "element", label: element, type: "choice", choices: elements(session.solver) },
    { key: "species", label: "Species", type: "choice", choices: reactionSpecies(session.solver) },
    { key: "from", label: "From", type: "choice", choices: ["VALUE", "TIMESERIES"], labels: { VALUE: "A value", TIMESERIES: "A time series" } },
    { key: "value", label: source ? "Rate (mass/s)" : "Concentration", type: "number", blank: true },
    { key: "series", label: "Time series", type: "choice", choices: seriesNames(session) },
  ],
  read: (s) =>
    (source ? s.transport.sources : s.transport.boundaries).map((r) => ({
      values: { element: r.element, species: r.species, from: r.isTimeseries ? "TIMESERIES" : "VALUE", value: r.isTimeseries ? "" : r.value, series: r.isTimeseries ? r.timeseries : "" },
    })),
  check: (session, row, label) => {
    const s = session.solver,
      v = row.values;
    if (!elements(s).some((e) => same(e, v.element))) return label + ": choose the " + element.toLowerCase() + ".";
    if (!reactionSpecies(s).some((sp) => same(sp, v.species))) return label + ": choose a reaction species" + (reactionSpecies(s).length ? "." : " (define them under Reactions).");
    if (v.from === "TIMESERIES") {
      if (!seriesNames(session).some((t) => same(t, v.series))) return label + ": choose the time series.";
    } else {
      const n = Number(v.value);
      if (blankish(v.value) || !Number.isFinite(n)) return label + ": enter the " + (source ? "rate" : "concentration") + ".";
      if (!source && n < 0) return label + ": a concentration cannot be negative.";
    }
    return null;
  },
  key: (row) => String(row.values.element).toUpperCase() + "|" + String(row.values.species).toUpperCase(),
  replace: (session, rows) => {
    const t = session.solver.transport,
      s = session.solver;
    for (let i = (source ? t.sources : t.boundaries).length - 1; i >= 0; i--) (source ? t.removeSource(i) : t.removeBoundary(i));
    for (const { values: v } of rows) {
      const el = elements(s).find((e) => same(e, v.element)),
        sp = reactionSpecies(s).find((x) => same(x, v.species));
      const ts = v.from === "TIMESERIES" ? seriesNames(session).find((x) => same(x, v.series)) : null;
      source ? t.setSource(el, sp, ts ? 0 : Number(v.value), ts) : t.setBoundary(el, sp, ts ? 0 : Number(v.value), ts);
    }
  },
  note,
});

const tables = {
  ardDispersion: {
    title: "Conduit dispersion",
    columns: (session) => [
      { key: "conduit", label: "Conduit", type: "choice", choices: conduits(session.solver) },
      { key: "value", label: "Coefficient (" + (session.unitSystem === 0 ? "ft²/s" : "m²/s") + ")", type: "number" },
    ],
    read: (s) => s.transport.conduitDispersion.map((r) => ({ values: { conduit: s.links.getId(r.linkIndex), value: r.value } })),
    check: (session, row, label) => {
      if (!conduits(session.solver).some((c) => same(c, row.values.conduit))) return label + ": choose a conduit.";
      const n = Number(row.values.value);
      return blankish(row.values.value) || !(n >= 0) ? label + ": the coefficient is 0 or more." : null;
    },
    key: (row) => String(row.values.conduit).toUpperCase(),
    replace: (session, rows) => {
      const t = session.solver.transport,
        s = session.solver;
      for (let i = t.conduitDispersion.length - 1; i >= 0; i--) t.removeConduitDispersion(i);
      for (const { values: v } of rows) t.setConduitDispersion(s.links.get(conduits(s).find((c) => same(c, v.conduit))).index, Number(v.value));
    },
    note: "A conduit's own dispersion coefficient, in place of the model-wide dispersion.",
  },
  ardBoundaries: rowTable("Transport boundaries", "Node", (s) => s.nodes.ids, false, "A reaction species' concentration held at a node: a value or a time series."),
  ardSources: rowTable("Transport sources", "Conduit", conduits, true, "A reaction species added along a conduit (a negative rate takes it out): a value or a time series."),
};
export const transportTables = Object.keys(tables);

export function transportRows(session, name) {
  const t = tables[name];
  return { name, title: t.title, scopes: null, columns: t.columns(session), rows: t.read(session.solver), note: t.note };
}

/** Replace a table's rows (checked first; the component is registered on the first change). */
export function setTransportRows(session, name, rows) {
  const t = tables[name],
    before = t.read(session.solver);
  const errors = [],
    seen = new Set();
  rows.forEach((row, i) => {
    const label = "Row " + (i + 1),
      problem = t.check(session, row, label);
    if (problem) return errors.push(problem);
    const k = t.key(row);
    if (seen.has(k)) errors.push(label + " repeats an earlier row.");
    seen.add(k);
  });
  if (errors.length) throw new Error(errors.join(" "));
  const pc = session.solver.processComponents;
  if (rows.length && ![...pc].some((c) => c.id === ARD)) pc.register(ARD, stem(session) + ".ard");
  t.replace(session, rows);
  return before;
}
