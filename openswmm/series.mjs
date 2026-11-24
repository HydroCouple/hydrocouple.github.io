import {
  OutputReader,
  FlowUnits,
  OutNodeVar,
  OutLinkVar,
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
