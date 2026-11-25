import {
  OutputReader,
  FlowUnits,
  OutNodeVar,
  OutLinkVar,
  OutSubcatchVar,
  OutSystemVar,
} from "./vendor/engine/index.js";

export function readHydrograph(module, bytes, selection) {
  module.FS.writeFile("/result.out", bytes);
  const reader = new OutputReader(module, "/result.out");
  try {
    const nodes = reader.nodeIds,
      links = reader.linkIds;
    if (!nodes.length && !links.length)
      return { nodes, links, values: [], times: [] };
    const kind = selection?.kind || (nodes.length ? "node" : "link");
    const id = selection?.id || (kind === "node" ? nodes : links)[0];
    const flow = reader.flowUnits;
    const unit =
      kind === "node" ? (flow >= FlowUnits.CMS ? "m" : "ft") : FlowUnits[flow];
    const values =
      kind === "node"
        ? reader.nodeSeries(id, OutNodeVar.DEPTH)
        : reader.linkSeries(id, OutLinkVar.FLOW);
    return {
      nodes,
      links,
      id,
      kind,
      unit,
      values,
      times: reader.periodTimes.map((t) => t.toISOString()),
    };
  } finally {
    reader.close();
    module.FS.unlink("/result.out");
  }
}

/**
 * Result series for the plot panel (plots.mjs) from one binary output. `requests`:
 * `[{key, kind: "node" | "link" | "subcatchment" | "system", id, variable}]`, variable named as in
 * the engine's Out*Var enums (DEPTH, FLOW, RUNOFF, …). Returns the start (ISO), the reporting
 * times as seconds after it, the flow units' name and, per request, its values or why it failed.
 */
export function readSeries(module, bytes, requests) {
  module.FS.writeFile("/plot.out", bytes);
  const reader = new OutputReader(module, "/plot.out");
  try {
    const start = reader.startDatetime;
    // SWMM stamps report times 1 ms late: whole seconds.
    const seconds = reader.periodTimes.map((t) => Math.round((t.getTime() - start.getTime()) / 1000));
    const series = requests.map(({ key, kind, id, variable }) => {
      try {
        const read =
          kind === "node"
            ? reader.nodeSeries(id, OutNodeVar[variable])
            : kind === "link"
              ? reader.linkSeries(id, OutLinkVar[variable])
              : kind === "subcatchment"
                ? reader.subcatchmentSeries(id, OutSubcatchVar[variable])
                : reader.systemSeries(OutSystemVar[variable]);
        return { key, values: Array.from(read) };
      } catch (e) {
        return { key, error: e.message || String(e) };
      }
    });
    return { start: start.toISOString(), seconds, flowUnits: FlowUnits[reader.flowUnits], series };
  } finally {
    reader.close();
    module.FS.unlink("/plot.out");
  }
}
