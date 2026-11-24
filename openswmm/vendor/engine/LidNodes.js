/**
 * @file LidNodes.ts
 * @brief Ordered storage-node LID layers and layer treatments, in the
 *        model's rainfall depth/rate units (Python
 *        `openswmm.engine._lid_nodes`).
 *
 * @license  Apache-2.0
 */
/** Kind of an authored LID node layer. */
export var LidNodeLayerKind;
(function (LidNodeLayerKind) {
    LidNodeLayerKind[LidNodeLayerKind["SURFACE"] = 0] = "SURFACE";
    LidNodeLayerKind[LidNodeLayerKind["MEDIA"] = 1] = "MEDIA";
    LidNodeLayerKind[LidNodeLayerKind["AGGREGATE"] = 2] = "AGGREGATE";
    LidNodeLayerKind[LidNodeLayerKind["BOTTOM"] = 3] = "BOTTOM";
})(LidNodeLayerKind || (LidNodeLayerKind = {}));
const PARAM_COUNTS = [2, 7, 3, 2];
/**
 * One authored layer; MEDIA and AGGREGATE repeat freely, top to bottom.
 * `params`: SURFACE (thickness, vegetation fraction), MEDIA (thickness,
 * porosity, field capacity, wilting point, Ksat, Kslope, suction), AGGREGATE
 * (thickness, porosity, Ksat), BOTTOM (seepage, clog factor). Thickness and
 * suction are in or mm; conductivity and seepage in/hr or mm/hr. BOTTOM is a
 * boundary and takes no layer number for outlet anchors.
 */
export class LidNodeLayer {
    constructor(kind, params) {
        const expected = PARAM_COUNTS[kind];
        if (expected === undefined)
            throw new RangeError(`${kind} is not a valid LidNodeLayerKind`);
        if (params.length !== expected) {
            throw new RangeError(`${LidNodeLayerKind[kind]} requires ${expected} parameters`);
        }
        this.kind = kind;
        this.params = Object.freeze(params.map(Number));
        Object.freeze(this);
    }
}
/**
 * Treatment on a one-based physical layer: removal percent and decay per
 * day. The optional `R=` or `C=` expression acts after the fixed removal on
 * outgoing water; decay acts on retained mass once per routing step.
 */
export class LidLayerTreatment {
    constructor(layer, pollutant, removalPercent = 0, decayPerDay = 0, expression = "") {
        this.layer = layer;
        this.pollutant = pollutant;
        this.removalPercent = removalPercent;
        this.decayPerDay = decayPerDay;
        this.expression = expression;
        Object.freeze(this);
    }
}
//# sourceMappingURL=LidNodes.js.map