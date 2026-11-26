// Long-lived editing worker: holds the ModelSession and answers {id, op, args} requests.
import { ModelSession } from "./model.mjs";
let ready;
function session() {
  ready ??= (async () => {
    const { default: create } = await import("./vendor/engine/openswmm_engine.js");
    return new ModelSession(await create());
  })();
  return ready;
}
self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    const s = await session();
    if (!["open", "summary", "fields", "set", "setAll", "write", "writeAll", "close", "record", "setRecord", "addRecord", "renameRecord", "impact", "deleteRecord", "restore", "rules", "checkRules", "setRules", "ruleRefs", "inflowChoices", "inflows", "setInflows", "coPollutant", "setCoPollutant", "landuse", "setLanduse", "subQuality", "setSubQuality", "treatment", "checkTreatments", "setTreatment", "climate", "setClimate", "lidUsage", "setLidUsage", "events", "setEvents", "addNode", "insertNode", "removeInserted", "addLink", "addGage", "removeAdded", "objectImpact", "deleteObjects", "restoreDeleted", "problems", "addSubcatchment", "subcatchLinks", "setSubcatchLinks", "moveObject", "setVertices", "setLengths", "convertObjects", "unconvertObjects", "labels", "setLabels", "inletChoices", "insertInlet", "removeInlet", "groups", "setGroup", "userFlags", "setUserFlags", "scopedRows", "setScopedRows", "reactions", "checkReactions", "setReactions"].includes(op))
      throw new Error("Unknown request " + op);
    postMessage({ id, result: s[op](...args) });
  } catch (error) {
    postMessage({ id, error: error.message || String(error) });
  }
};
