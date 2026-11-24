/**
 * @file Infrastructure.ts
 * @brief `solver.infrastructure`: transects, street cross-sections, inlet
 *        designs and placements, and LID controls with their storage-node
 *        stacks and subcatchment placements (Python
 *        `openswmm.engine._infrastructure`).
 *
 * Python's dict records are objects with camelCase keys here
 * (`t_crown` → `tCrown`); records read from one method are accepted by its
 * counterpart (`getDesign` → `setDesign`, `nodeSnapshot` → `replaceNode`,
 * `usageRecord` → `replaceUsages`).
 *
 * @license  Apache-2.0
 */
import { resolveIndex } from "./element.js";
import { InletPlacement } from "./enums.js";
import { ElementNotFoundError, raiseForCode } from "./errors.js";
import { LidLayerTreatment, LidNodeLayer } from "./LidNodes.js";
import { checkedAlloc, withCString, withDouble, withInt } from "./mem.js";
import { STRUCTS } from "./raw.js";
import { readStruct, withStruct, withStructs, writeStruct } from "./structs.js";
import { SolverView } from "./view.js";
const camelKey = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snakeKey = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** Struct fields (snake_case) → a camelCase record. */
function camel(value) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [camelKey(k), v]));
}
/** A camelCase record → struct fields (snake_case). */
function snake(value) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [snakeKey(k), v]));
}
/** Call `fn` with `n` zeroed `double*` outputs and return their values. */
function doubles(mod, n, fn) {
    const p = checkedAlloc(mod, 8 * n);
    try {
        mod.HEAPF64.fill(0, p >> 3, (p >> 3) + n);
        const ptrs = Array.from({ length: n }, (_, i) => p + 8 * i);
        raiseForCode(fn(ptrs));
        return ptrs.map((q) => mod.HEAPF64[q >> 3]);
    }
    finally {
        mod._free(p);
    }
}
/** An id-addressed infrastructure family (Python's per-family views). */
class NamedFamily extends SolverView {
    get length() {
        return this._raw[`swmm_${this._kind}_count`](this._h);
    }
    /** Zero-based index of an id. @throws {@link ElementNotFoundError} if absent. */
    getIndex(id) {
        const i = this._raw[`swmm_${this._kind}_index`](this._h, id);
        if (i < 0)
            throw new ElementNotFoundError(id);
        return i;
    }
    getId(idx) {
        return this._raw[`swmm_${this._kind}_id`](this._h, idx) ?? "";
    }
    *[Symbol.iterator]() {
        const n = this.length;
        for (let i = 0; i < n; i++)
            yield this.getId(i);
    }
    has(key) {
        if (typeof key === "string")
            return this._raw[`swmm_${this._kind}_index`](this._h, key) >= 0;
        return Number.isInteger(key) && key >= 0 && key < this.length;
    }
    /** Rename, updating stored references. */
    rename(key, newId) {
        const idx = typeof key === "string" ? this.getIndex(key) : key;
        raiseForCode(this._raw[`swmm_${this._kind}_rename`](this._h, idx, newId));
        this._solver._bumpGeneration();
    }
    /** @internal Index of `key`, range-checked (Python `_resolve_index`). */
    _index(key) {
        if (typeof key === "string")
            return this.getIndex(key);
        const n = this.length;
        if (!Number.isInteger(key) || key < 0 || key >= n) {
            throw new RangeError(`${this._kind} index ${key} out of range [0, ${n})`);
        }
        return key;
    }
}
// ---- transects ----------------------------------------------------------------
/** `solver.infrastructure.transects`: natural-channel cross-sections. */
export class Transects extends NamedFamily {
    constructor() {
        super(...arguments);
        this._kind = "transect";
    }
    /** Add a transect; returns its index. */
    add(transectId) {
        raiseForCode(this._raw.swmm_transect_add(this._h, transectId));
        this._solver._bumpGeneration();
        return this.length - 1;
    }
    /** @internal Index or id; negative indices count from the end. */
    _resolve(key) {
        if (typeof key === "string")
            return this.getIndex(key);
        const n = this.length;
        const idx = key < 0 ? key + n : key;
        if (!(idx >= 0 && idx < n))
            throw new RangeError(String(key));
        return idx;
    }
    has(key) {
        try {
            this._resolve(key);
            return true;
        }
        catch {
            return false;
        }
    }
    /** Remove a transect, clearing the sites that referenced it. */
    remove(key) {
        const idx = this._resolve(key);
        raiseForCode(this._raw.swmm_transect_remove(this._h, idx));
        this._solver._bumpGeneration();
    }
    rename(key, newId) {
        const idx = this._resolve(key);
        raiseForCode(this._raw.swmm_transect_rename(this._h, idx, newId));
        this._solver._bumpGeneration();
    }
    setRoughness(idx, nLeft, nRight, nChannel) {
        raiseForCode(this._raw.swmm_transect_set_roughness(this._h, idx, nLeft, nRight, nChannel));
    }
    /** `[nLeft, nRight, nChannel]`. */
    getRoughness(idx) {
        const [l, r, c] = doubles(this._mod, 3, ([a, b, d]) => this._raw.swmm_transect_get_roughness(this._h, idx, a, b, d));
        return [l, r, c];
    }
    /** Append a `(station, elevation)` point. */
    addStation(idx, station, elevation) {
        raiseForCode(this._raw.swmm_transect_add_station(this._h, idx, station, elevation));
    }
    stationCount(idx) {
        return this._raw.swmm_transect_get_station_count(this._h, idx);
    }
    /** `[station, elevation]` of one point. */
    getStation(idx, stationIdx) {
        const [s, e] = doubles(this._mod, 2, ([a, b]) => this._raw.swmm_transect_get_station(this._h, idx, stationIdx, a, b));
        return [s, e];
    }
    /** Every `[station, elevation]` point. */
    stations(idx) {
        return Array.from({ length: this.stationCount(idx) }, (_, i) => this.getStation(idx, i));
    }
    clearStations(idx) {
        raiseForCode(this._raw.swmm_transect_clear_stations(this._h, idx));
    }
    /** `[left, right]` bank stations. */
    getBankStations(idx) {
        const [l, r] = doubles(this._mod, 2, ([a, b]) => this._raw.swmm_transect_get_bank_stations(this._h, idx, a, b));
        return [l, r];
    }
    setBankStations(idx, left, right) {
        raiseForCode(this._raw.swmm_transect_set_bank_stations(this._h, idx, left, right));
    }
    /** `[left, right]` encroachment stations. */
    getEncroachmentStations(idx) {
        const [l, r] = doubles(this._mod, 2, ([a, b]) => this._raw.swmm_transect_get_encroachment_stations(this._h, idx, a, b));
        return [l, r];
    }
    setEncroachmentStations(idx, left, right) {
        raiseForCode(this._raw.swmm_transect_set_encroachment_stations(this._h, idx, left, right));
    }
    /** `[nFactor, xFactor, yFactor]` geometry modifiers. */
    getModifiers(idx) {
        const [n, x, y] = doubles(this._mod, 3, ([a, b, c]) => this._raw.swmm_transect_get_modifiers(this._h, idx, a, b, c));
        return [n, x, y];
    }
    setModifiers(idx, nFactor, xFactor, yFactor) {
        raiseForCode(this._raw.swmm_transect_set_modifiers(this._h, idx, nFactor, xFactor, yFactor));
    }
    getComments(idx) {
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_transect_get_comments(this._h, idx, buf, len));
    }
    setComments(idx, text) {
        raiseForCode(this._raw.swmm_transect_set_comments(this._h, idx, text));
    }
}
/** `solver.infrastructure.streets`: street cross-sections. */
export class Streets extends NamedFamily {
    constructor() {
        super(...arguments);
        this._kind = "street";
    }
    /** Add a street cross-section; returns its index. */
    add(streetId) {
        raiseForCode(this._raw.swmm_street_add(this._h, streetId));
        this._solver._bumpGeneration();
        return this.length - 1;
    }
    /** Set a street's geometry; gutter, sides (2) and backing default as in Python. */
    setParams(idx, { tCrown, hCurb, sx, nRoad, gutterDepres = 0, gutterWidth = 0, sides = 2, backWidth = 0, backSlope = 0, backN = 0, }) {
        raiseForCode(this._raw.swmm_street_set_params(this._h, idx, tCrown, hCurb, sx, nRoad, gutterDepres, gutterWidth, sides, backWidth, backSlope, backN));
    }
    /** The street's geometry, in the units it was given (inverse of {@link setParams}). */
    getParams(idx) {
        const mod = this._mod;
        const p = checkedAlloc(mod, 80);
        try {
            mod.HEAPU8.fill(0, p, p + 80);
            const d = (i) => p + 8 * i;
            raiseForCode(this._raw.swmm_street_get_params(this._h, idx, d(0), d(1), d(2), d(3), d(4), d(5), d(6), d(7), d(8), d(9)));
            const f = (i) => mod.HEAPF64[d(i) >> 3];
            return {
                tCrown: f(0),
                hCurb: f(1),
                sx: f(2),
                nRoad: f(3),
                gutterDepres: f(4),
                gutterWidth: f(5),
                sides: mod.HEAP32[d(6) >> 2],
                backWidth: f(7),
                backSlope: f(8),
                backN: f(9),
            };
        }
        finally {
            mod._free(p);
        }
    }
}
function designFields(values) {
    if (values.curveId !== undefined) {
        const id = values.curveId ?? "";
        if (id.includes("\0"))
            throw new RangeError("curve_id must not contain NUL");
        if (new TextEncoder().encode(id).length >= 64) {
            throw new RangeError("curve_id is longer than 63 bytes");
        }
    }
    return snake(values);
}
/** `solver.infrastructure.inlets`: inlet designs. */
export class Inlets extends NamedFamily {
    constructor() {
        super(...arguments);
        this._kind = "inlet";
    }
    /** Add an inlet design of type `inletType` (e.g. `"GRATE"`); returns its index. */
    add(inletId, inletType) {
        raiseForCode(this._raw.swmm_inlet_add(this._h, inletId, inletType));
        this._solver._bumpGeneration();
        return this.length - 1;
    }
    setParams(idx, { length = 0, width = 0, grateType = "", openArea = 0, splashVeloc = 0, } = {}) {
        raiseForCode(this._raw.swmm_inlet_set_params(this._h, idx, length, width, grateType, openArea, splashVeloc));
    }
    /** Grate/slotted dimensions (the type string comes from {@link getType}). */
    getParams(idx) {
        const mod = this._mod;
        const p = checkedAlloc(mod, 32 + 256);
        try {
            mod.HEAPU8.fill(0, p, p + 32 + 256);
            raiseForCode(this._raw.swmm_inlet_get_params(this._h, idx, p, p + 8, p + 32, 256, p + 16, p + 24));
            const f = mod.HEAPF64;
            return {
                length: f[p >> 3],
                width: f[(p + 8) >> 3],
                grateType: mod.UTF8ToString(p + 32, 256),
                openArea: f[(p + 16) >> 3],
                splashVeloc: f[(p + 24) >> 3],
            };
        }
        finally {
            mod._free(p);
        }
    }
    /** The type string given to {@link add}. */
    getType(idx) {
        const mod = this._mod;
        const buf = checkedAlloc(mod, 256);
        try {
            mod.HEAPU8[buf] = 0;
            raiseForCode(this._raw.swmm_inlet_get_type(this._h, idx, buf, 256));
            return mod.UTF8ToString(buf, 256);
        }
        finally {
            mod._free(buf);
        }
    }
    /** Every field of a design; fields its type does not use read as zero. */
    getDesign(key) {
        const idx = typeof key === "string" ? this.getIndex(key) : key;
        return withStruct(this._mod, "SWMM_InletDesign", (p) => {
            raiseForCode(this._raw.swmm_inlet_get_design(this._h, idx, p));
            return camel(readStruct(this._mod, "SWMM_InletDesign", p));
        });
    }
    /**
     * Overwrite a design (the type may change). Fields left out keep their
     * current values, so `setDesign("Curb1", { throat: ThroatType.INCLINED })`
     * is a read-modify-write.
     */
    setDesign(key, design = {}) {
        const idx = typeof key === "string" ? this.getIndex(key) : key;
        const fields = designFields(design);
        const mod = this._mod;
        withStruct(mod, "SWMM_InletDesign", (p) => {
            raiseForCode(this._raw.swmm_inlet_get_design(this._h, idx, p));
            const strings = [];
            try {
                writeStruct(mod, "SWMM_InletDesign", p, fields, strings);
                raiseForCode(this._raw.swmm_inlet_set_design(this._h, idx, p));
            }
            finally {
                for (const s of strings)
                    mod._free(s);
            }
        });
    }
    /**
     * The normalized design, changing no inlet: inactive fields cleared and a
     * custom curve's kind derived from the named curve when it exists.
     */
    validateDesign(design) {
        return withStructs(this._mod, "SWMM_InletDesign", [designFields(design)], (proposed) => withStruct(this._mod, "SWMM_InletDesign", (normalized) => {
            raiseForCode(this._raw.swmm_inlet_validate_design(this._h, proposed, normalized));
            return camel(readStruct(this._mod, "SWMM_InletDesign", normalized));
        }));
    }
    getComment(key) {
        const idx = typeof key === "string" ? this.getIndex(key) : key;
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_inlet_get_comment(this._h, idx, buf, len));
    }
    setComment(key, text) {
        const idx = typeof key === "string" ? this.getIndex(key) : key;
        raiseForCode(this._raw.swmm_inlet_set_comment(this._h, idx, text ?? ""));
    }
}
/**
 * `solver.infrastructure.inletUsages`: inlet placements on conduits
 * (`[INLET_USAGE]`) and inlet junctions (`[INLET_JUNCTIONS]`), one store.
 */
export class InletUsages extends SolverView {
    get length() {
        return Math.max(this._raw.swmm_inlet_usage_count(this._h), 0);
    }
    /** Row hosted by conduit `linkIdx`, or -1. */
    findLink(linkIdx) {
        return this._raw.swmm_inlet_usage_find_link(this._h, Math.trunc(linkIdx));
    }
    /** Row hosted by inlet junction `nodeIdx`, or -1. */
    findNode(nodeIdx) {
        return this._raw.swmm_inlet_usage_find_node(this._h, Math.trunc(nodeIdx));
    }
    get(usageIdx) {
        return withStruct(this._mod, "SWMM_InletUsage", (p) => {
            raiseForCode(this._raw.swmm_inlet_usage_get(this._h, usageIdx, p));
            return camel(readStruct(this._mod, "SWMM_InletUsage", p));
        });
    }
    /** Preflight a placement without changing rows. */
    validate(record) {
        withStructs(this._mod, "SWMM_InletUsage", [snake(record)], (p) => raiseForCode(this._raw.swmm_inlet_usage_validate(this._h, p)));
    }
    /**
     * Create or replace the row of a host (one row per host). A NODE host must
     * already be an inlet junction; a LINK host must be a conduit. Returns the
     * row index.
     */
    set(hostKind, hostIdx, designIdx, captureNodeIdx, { numInlets = 1, pctClogged = 0, flowLimit = 0, localDepress = 0, localWidth = 0, placement = InletPlacement.AUTOMATIC, } = {}) {
        const record = {
            hostKind,
            hostIdx,
            designIdx,
            captureNodeIdx,
            numInlets,
            pctClogged,
            flowLimit,
            localDepress,
            localWidth,
            placement,
        };
        const row = withStructs(this._mod, "SWMM_InletUsage", [snake(record)], (p) => withInt(this._mod, (out) => {
            this._mod.HEAP32[out >> 2] = -1;
            return this._raw.swmm_inlet_usage_set(this._h, p, out);
        }));
        this._solver._bumpGeneration();
        return row;
    }
    remove(usageIdx) {
        raiseForCode(this._raw.swmm_inlet_usage_remove(this._h, usageIdx));
        this._solver._bumpGeneration();
    }
    *[Symbol.iterator]() {
        const n = this.length;
        for (let i = 0; i < n; i++)
            yield this.get(i);
    }
}
const BOTTOM_MODES = ["CURRENT", "SEALED", "MESH_AQUIFER"];
function usageFields(r) {
    const text = (v) => {
        const s = v ?? "";
        if (s.includes("\0"))
            throw new RangeError("Record strings cannot contain null bytes");
        return s;
    };
    return {
        subcatch_idx: r.subcatchIndex,
        control_idx: r.lidIndex,
        number: r.number,
        area: r.area,
        width: r.width,
        init_sat: r.initSat,
        from_imperv: r.fromImperv,
        to_perv: r.toPerv,
        from_perv: r.fromPerv,
        report_file: text(r.reportFile),
        report_file_resolved: text(r.reportFileResolved),
        drain_to: text(r.drainTo),
    };
}
/**
 * `solver.infrastructure.lids`: `[LID_CONTROLS]` (layers, removals, node
 * stacks with Richards flow) and `[LID_USAGE]` placements.
 */
export class LIDs extends NamedFamily {
    constructor() {
        super(...arguments);
        this._kind = "lid";
    }
    /** Add a LID control; returns its index. */
    add(lidId, lidType) {
        raiseForCode(this._raw.swmm_lid_add(this._h, lidId, lidType));
        this._solver._bumpGeneration();
        return this.length - 1;
    }
    /** @internal */
    _node(key) {
        const h = this._h;
        if (typeof key === "string")
            return resolveIndex(this._raw, h, "node", key);
        const n = this._raw.swmm_node_count(h);
        if (!Number.isInteger(key) || key < 0 || key >= n) {
            throw new RangeError(`Node index ${key} out of range [0, ${n})`);
        }
        return key;
    }
    /** @internal */
    _link(key) {
        const h = this._h;
        if (typeof key === "string")
            return resolveIndex(this._raw, h, "link", key);
        const n = this._raw.swmm_link_count(h);
        if (!Number.isInteger(key) || key < 0 || key >= n) {
            throw new RangeError(`Link index ${key} out of range [0, ${n})`);
        }
        return key;
    }
    // ---- node layer stacks ---------------------------------------------------------
    /** The ordered stack, including an optional BOTTOM boundary. */
    getLayers(key) {
        const idx = this._index(key);
        const n = this._raw.swmm_lid_node_layer_count(this._h, idx);
        return withStruct(this._mod, "SWMM_LidNodeLayer", (p) => Array.from({ length: n }, (_, i) => {
            raiseForCode(this._raw.swmm_lid_node_layer_get(this._h, idx, i, p));
            const row = readStruct(this._mod, "SWMM_LidNodeLayer", p);
            const kind = row.kind;
            return new LidNodeLayer(kind, row.params.slice(0, [2, 7, 3, 2][kind]));
        }));
    }
    getTreatments(key) {
        const idx = this._index(key);
        const h = this._h;
        const n = this._raw.swmm_lid_node_treatment_count(h, idx);
        return withStruct(this._mod, "SWMM_LidLayerTreatment", (p) => Array.from({ length: n }, (_, i) => {
            raiseForCode(this._raw.swmm_lid_node_treatment_get(h, idx, i, p));
            const r = readStruct(this._mod, "SWMM_LidLayerTreatment", p);
            return new LidLayerTreatment(r.layer, this._raw.swmm_pollutant_id(h, r.pollutant) ?? "", r.removal_percent, r.decay_per_day, r.expression);
        }));
    }
    /** Flow model (0 existing, 1 Richards), cells and solver tolerances. */
    getFlowOptions(key) {
        const idx = this._index(key);
        return withStruct(this._mod, "SWMM_LidRichardsOptions", (p) => {
            raiseForCode(this._raw.swmm_lid_richards_options_get(this._h, idx, p));
            return camel(readStruct(this._mod, "SWMM_LidRichardsOptions", p));
        });
    }
    /** Retention materials in layer order (SURFACE/BOTTOM rows are ignored by flow). */
    getMaterials(key) {
        const idx = this._index(key);
        const n = this._raw.swmm_lid_node_layer_count(this._h, idx);
        return withStruct(this._mod, "SWMM_LidRichardsMaterial", (p) => Array.from({ length: n }, (_, i) => {
            raiseForCode(this._raw.swmm_lid_richards_material_get(this._h, idx, i, p));
            return camel(readStruct(this._mod, "SWMM_LidRichardsMaterial", p));
        }));
    }
    /**
     * Replace a NODE stack atomically and sync its nodes (pre-start only). An
     * invalid stack leaves the old stack, node depths and anchored offsets
     * unchanged. With `flow`, omitted treatments/materials keep their current
     * values.
     */
    setLayers(key, layers, options = {}) {
        this._configure(key, layers, options, false);
    }
    /** Preflight a complete NODE profile (flow and treatments included), changing nothing. */
    validateLayers(key, layers, options) {
        if (!options?.flow)
            throw new RangeError("flow options are required for profile validation");
        this._configure(key, layers, options, true);
    }
    /** @internal */
    _configure(key, layers, { treatments, flow, materials, }, validate) {
        const h = this._h;
        const idx = this._index(key);
        const rows = Array.from(layers);
        if (!rows.length)
            throw new RangeError("At least one MEDIA or AGGREGATE layer is required");
        if (rows.some((l) => !(l instanceof LidNodeLayer))) {
            throw new TypeError("layers must contain LidNodeLayer instances");
        }
        if (!flow && materials)
            throw new RangeError("materials requires flow options");
        let materialRows = [];
        let rules = treatments ? Array.from(treatments) : null;
        if (flow) {
            const values = materials ? Array.from(materials) : this.getMaterials(key);
            if (values.length !== rows.length) {
                throw new RangeError("materials must have one row per authored layer");
            }
            materialRows = values.map((m) => ({
                theta_r: m.thetaR ?? 0,
                alpha: m.alpha ?? 0,
                n: m.n ?? 0,
                l: m.l ?? 0.5,
                specific_storage: m.specificStorage ?? 0,
            }));
            rules ?? (rules = this.getTreatments(key));
        }
        if (rules?.some((t) => !(t instanceof LidLayerTreatment))) {
            throw new TypeError("treatments must contain LidLayerTreatment instances");
        }
        const layerRows = rows.map((l) => ({ kind: l.kind, params: [...l.params] }));
        withStructs(this._mod, "SWMM_LidNodeLayer", layerRows, (lp) => {
            if (!rules) {
                raiseForCode(this._raw.swmm_lid_node_layers_set(h, idx, lp, rows.length));
                return;
            }
            const ruleRows = rules.map((t) => ({
                layer: t.layer,
                pollutant: resolveIndex(this._raw, h, "pollutant", t.pollutant),
                removal_percent: t.removalPercent,
                decay_per_day: t.decayPerDay,
                expression: t.expression,
            }));
            withStructs(this._mod, "SWMM_LidLayerTreatment", ruleRows, (tp) => {
                const tptr = ruleRows.length ? tp : 0;
                if (!flow) {
                    raiseForCode(this._raw.swmm_lid_node_configure(h, idx, lp, rows.length, tptr, ruleRows.length));
                    return;
                }
                const options = {
                    model: flow.model,
                    cells_per_layer: flow.cellsPerLayer ?? 8,
                    atol: flow.atol ?? 1e-7,
                    rtol: flow.rtol ?? 1e-5,
                    max_step: flow.maxStep ?? 30,
                };
                withStructs(this._mod, "SWMM_LidRichardsOptions", [options], (op) => withStructs(this._mod, "SWMM_LidRichardsMaterial", materialRows, (mp) => {
                    const call = validate
                        ? this._raw.swmm_lid_node_validate_flow
                        : this._raw.swmm_lid_node_configure_flow;
                    raiseForCode(call(h, idx, lp, rows.length, tptr, ruleRows.length, op, mp));
                }));
            });
        });
    }
    // ---- storage-node assignments ----------------------------------------------------
    /** Assign a control to a storage node; syncs its MaxDepth (InitSat %). */
    assignNode(node, control, { initialSaturation = 0 } = {}) {
        const n = this._node(node);
        const c = this._index(control);
        raiseForCode(this._raw.swmm_node_set_lid(this._h, n, c, initialSaturation));
    }
    /** `[control index, InitSat %]`, or `null` for an ordinary node. */
    nodeAssignment(node) {
        const n = this._node(node);
        const mod = this._mod;
        const p = checkedAlloc(mod, 16);
        try {
            mod.HEAP32[p >> 2] = -1;
            mod.HEAPF64[(p + 8) >> 3] = 0;
            raiseForCode(this._raw.swmm_node_get_lid(this._h, n, p, p + 8));
            const c = mod.HEAP32[p >> 2];
            return c < 0 ? null : [c, mod.HEAPF64[(p + 8) >> 3]];
        }
        finally {
            mod._free(p);
        }
    }
    /** Revert a LID storage node to plain storage and remove its anchors. */
    removeNode(node) {
        raiseForCode(this._raw.swmm_node_set_lid(this._h, this._node(node), -1, 0));
    }
    /** Runtime sublayers, top to bottom; elevations in model length units. */
    nodeProfile(node) {
        const n = this._node(node);
        const count = this._raw.swmm_lid_node_state_count(this._h, n);
        const mod = this._mod;
        const p = checkedAlloc(mod, 32);
        try {
            return Array.from({ length: count }, (_, i) => {
                mod.HEAPU8.fill(0, p, p + 32);
                raiseForCode(this._raw.swmm_lid_node_state_get(this._h, n, i, p, p + 8, p + 16, p + 24));
                const f = mod.HEAPF64;
                return {
                    layer: mod.HEAP32[p >> 2],
                    bottom: f[(p + 8) >> 3],
                    top: f[(p + 16) >> 3],
                    moisture: f[(p + 24) >> 3],
                };
            });
        }
        finally {
            mod._free(p);
        }
    }
    /** Richards cells: pressure/head in project length, water in volume units. */
    richardsProfile(node) {
        const n = this._node(node);
        const count = this._raw.swmm_lid_node_state_count(this._h, n);
        return Array.from({ length: count }, (_, i) => {
            const [pressure, head, water] = doubles(this._mod, 3, ([a, b, c]) => this._raw.swmm_lid_richards_state_get(this._h, n, i, a, b, c));
            return { pressure, head, water };
        });
    }
    /** Last-interval counts, minimum step (s) and balance (m³). */
    richardsStatistics(node) {
        const n = this._node(node);
        return withStruct(this._mod, "SWMM_LidRichardsStatistics", (p) => {
            raiseForCode(this._raw.swmm_lid_richards_statistics_get(this._h, n, p));
            return camel(readStruct(this._mod, "SWMM_LidRichardsStatistics", p));
        });
    }
    /** Geometric LID contact area in project square-length units, before init. */
    nodeBaseArea(node) {
        const n = this._node(node);
        return withDouble(this._mod, (p) => this._raw.swmm_lid_node_base_area(this._h, n, p));
    }
    /**
     * Accepted mesh-bottom diagnostics, always SI (positive net is LID to
     * aquifer). Needs an initialized explicit mesh-bottom connection.
     */
    nodeBottomState(node) {
        const n = this._node(node);
        return withStruct(this._mod, "SWMM_LidBottomState", (p) => {
            raiseForCode(this._raw.swmm_lid_node_bottom_state_get(this._h, n, p));
            return camel(readStruct(this._mod, "SWMM_LidBottomState", p));
        });
    }
    /** Per-node bottom owner. */
    nodeBottom(node) {
        const n = this._node(node);
        return BOTTOM_MODES[withInt(this._mod, (p) => this._raw.swmm_node_get_lid_bottom(this._h, n, p))];
    }
    /** Change one assigned LID's bottom owner without editing the shared control. */
    setNodeBottom(node, mode) {
        const n = this._node(node);
        const m = BOTTOM_MODES.indexOf(String(mode).toUpperCase());
        if (m < 0)
            throw new RangeError("bottom must be CURRENT, SEALED or MESH_AQUIFER");
        raiseForCode(this._raw.swmm_node_set_lid_bottom(this._h, n, m));
    }
    /** Anchor a link to a one-based physical layer; layer 0 removes the anchor. */
    setOutletAnchor(link, layer, { position = "BOTTOM" } = {}) {
        const i = this._link(link);
        const pos = position.toUpperCase();
        if (pos !== "TOP" && pos !== "BOTTOM")
            throw new RangeError("position must be TOP or BOTTOM");
        raiseForCode(this._raw.swmm_lid_node_outlet_set(this._h, i, layer, pos === "TOP" ? 1 : 0));
    }
    /** `[one-based layer, "TOP" | "BOTTOM"]`, or `null` if unanchored. */
    getOutletAnchor(link) {
        const i = this._link(link);
        const mod = this._mod;
        const p = checkedAlloc(mod, 8);
        try {
            mod.HEAP32[p >> 2] = 0;
            mod.HEAP32[(p + 4) >> 2] = 0;
            raiseForCode(this._raw.swmm_lid_node_outlet_get(this._h, i, p, p + 4));
            const layer = mod.HEAP32[p >> 2];
            return layer === 0 ? null : [layer, mod.HEAP32[(p + 4) >> 2] ? "TOP" : "BOTTOM"];
        }
        finally {
            mod._free(p);
        }
    }
    /** The node's assignment and the anchors of its links. */
    nodeSnapshot(node) {
        const h = this._h;
        const n = this._node(node);
        const mod = this._mod;
        const state = withStruct(mod, "SWMM_StorageLidState", (p) => {
            raiseForCode(this._raw.swmm_storage_lid_get(h, n, p));
            return camel(readStruct(mod, "SWMM_StorageLidState", p));
        });
        const anchors = [];
        withStruct(mod, "SWMM_StorageLidAnchor", (p) => {
            const ends = checkedAlloc(mod, 8);
            try {
                for (let link = 0; link < this._raw.swmm_link_count(h); link++) {
                    raiseForCode(this._raw.swmm_link_get_from_node(h, link, ends));
                    raiseForCode(this._raw.swmm_link_get_to_node(h, link, ends + 4));
                    if (mod.HEAP32[ends >> 2] === n || mod.HEAP32[(ends + 4) >> 2] === n) {
                        raiseForCode(this._raw.swmm_storage_lid_anchor_get(h, link, p));
                        const a = camel(readStruct(mod, "SWMM_StorageLidAnchor", p));
                        if (a.layer > 0)
                            anchors.push(a);
                    }
                }
            }
            finally {
                mod._free(ends);
            }
        });
        return { state, anchors };
    }
    /** Prepare an assignment without changing anything (dependent geometry in internal feet). */
    prepareNode(node, control, { initialSaturation = 0, bottom = 0 } = {}) {
        const h = this._h;
        const n = this._node(node);
        const c = control === null ? -1 : this._index(control);
        const mod = this._mod;
        const capacity = this._raw.swmm_link_count(h);
        const anchorSize = STRUCTS.SWMM_StorageLidAnchor.size;
        return withStruct(mod, "SWMM_StorageLidState", (sp) => withStructs(mod, "SWMM_StorageLidAnchor", Array(capacity).fill({}), (ap) => {
            const count = withInt(mod, (cp) => this._raw.swmm_storage_lid_prepare(h, n, c, initialSaturation, bottom, sp, capacity ? ap : 0, capacity, cp));
            return {
                state: camel(readStruct(mod, "SWMM_StorageLidState", sp)),
                anchors: Array.from({ length: count }, (_, i) => camel(readStruct(mod, "SWMM_StorageLidAnchor", ap + i * anchorSize))),
            };
        }));
    }
    /** Validate a complete assignment snapshot without changing anything (before initialization). */
    validateNode(node, snapshot) {
        this._install(node, snapshot, true);
    }
    /** Restore an assignment and its anchors atomically (exact internal-foot geometry). */
    replaceNode(node, snapshot) {
        this._install(node, snapshot, false);
    }
    /** @internal */
    _install(node, snapshot, validate) {
        const h = this._h;
        const n = this._node(node);
        const anchors = snapshot.anchors.map((a) => snake(a));
        withStructs(this._mod, "SWMM_StorageLidState", [snake(snapshot.state)], (sp) => withStructs(this._mod, "SWMM_StorageLidAnchor", anchors, (ap) => {
            const call = validate
                ? this._raw.swmm_storage_lid_validate
                : this._raw.swmm_storage_lid_replace;
            raiseForCode(call(h, n, sp, anchors.length ? ap : 0, anchors.length));
        }));
    }
    // ---- control parameters ------------------------------------------------------------
    setSurface(idx, { storage, roughness, slope }) {
        raiseForCode(this._raw.swmm_lid_set_surface(this._h, idx, storage, roughness, slope));
    }
    getSurface(idx) {
        const [storage, roughness, slope] = doubles(this._mod, 3, ([a, b, c]) => this._raw.swmm_lid_get_surface(this._h, idx, a, b, c));
        return { storage, roughness, slope };
    }
    setSoil(idx, p) {
        raiseForCode(this._raw.swmm_lid_set_soil(this._h, idx, p.thick, p.porosity, p.fc, p.wp, p.ksat, p.kslope));
    }
    getSoil(idx) {
        const [thick, porosity, fc, wp, ksat, kslope] = doubles(this._mod, 6, ([a, b, c, d, e, f]) => this._raw.swmm_lid_get_soil(this._h, idx, a, b, c, d, e, f));
        return { thick, porosity, fc, wp, ksat, kslope };
    }
    setStorage(idx, { thick, voidFrac, ksat }) {
        raiseForCode(this._raw.swmm_lid_set_storage(this._h, idx, thick, voidFrac, ksat));
    }
    getStorage(idx) {
        const [thick, voidFrac, ksat] = doubles(this._mod, 3, ([a, b, c]) => this._raw.swmm_lid_get_storage(this._h, idx, a, b, c));
        return { thick, voidFrac, ksat };
    }
    setDrain(idx, { coeff, expon, offset }) {
        raiseForCode(this._raw.swmm_lid_set_drain(this._h, idx, coeff, expon, offset));
    }
    getDrain(idx) {
        const [coeff, expon, offset] = doubles(this._mod, 3, ([a, b, c]) => this._raw.swmm_lid_get_drain(this._h, idx, a, b, c));
        return { coeff, expon, offset };
    }
    /**
     * Set the pavement layer. Leave `regenDegree` out to keep the stored
     * fraction; a given degree must lie in [0, 1].
     */
    setPavement(idx, { thick, voidRatio, fracImperv, ksat, clogFactor = 0, regenDays = 0, regenDegree, }) {
        const h = this._h;
        if (regenDegree === undefined || regenDegree === null) {
            raiseForCode(this._raw.swmm_lid_set_pavement(h, idx, thick, voidRatio, fracImperv, ksat, clogFactor, regenDays));
        }
        else {
            raiseForCode(this._raw.swmm_lid_set_pavement_ex(h, idx, thick, voidRatio, fracImperv, ksat, clogFactor, regenDays, regenDegree));
        }
    }
    getPavement(idx) {
        const [thick, voidRatio, fracImperv, ksat, clogFactor, regenDays, regenDegree] = doubles(this._mod, 7, ([a, b, c, d, e, f, g]) => this._raw.swmm_lid_get_pavement_ex(this._h, idx, a, b, c, d, e, f, g));
        return { thick, voidRatio, fracImperv, ksat, clogFactor, regenDays, regenDegree };
    }
    /** Set the drainage-mat layer (GREEN_ROOF). */
    setDrainmat(idx, { thick, voidFrac, roughness }) {
        raiseForCode(this._raw.swmm_lid_set_drainmat(this._h, idx, thick, voidFrac, roughness));
    }
    getDrainmat(idx) {
        const [thick, voidFrac, roughness] = doubles(this._mod, 3, ([a, b, c]) => this._raw.swmm_lid_get_drainmat(this._h, idx, a, b, c));
        return { thick, voidFrac, roughness };
    }
    /**
     * Underdrain removal (percent) of a constituent: below the pollutant
     * count a pollutant, pollutant count + m reaction species m. No entry reads 0.
     */
    getRemoval(idx, constituent) {
        return withDouble(this._mod, (p) => this._raw.swmm_lid_get_removal(this._h, idx, constituent, p));
    }
    /** Set the underdrain removal (0-100); 0 removes the entry. Before `start()` only. */
    setRemoval(idx, constituent, percent) {
        raiseForCode(this._raw.swmm_lid_set_removal(this._h, idx, constituent, percent));
    }
    /** The control's {@link LidType} code. */
    getType(idx) {
        return withInt(this._mod, (p) => {
            this._mod.HEAP32[p >> 2] = -1;
            return this._raw.swmm_lid_get_type(this._h, idx, p);
        });
    }
    /** Change the type of an unassigned control before a node stack is applied. */
    setType(idx, lidType) {
        raiseForCode(this._raw.swmm_lid_set_type(this._h, idx, lidType));
    }
    /** Preflight a type change, changing nothing. */
    validateType(idx, lidType) {
        raiseForCode(this._raw.swmm_lid_validate_type(this._h, idx, lidType));
    }
    /** One {@link LidExtraField} scalar, in authored input units. */
    getExtra(idx, field) {
        return withDouble(this._mod, (p) => this._raw.swmm_lid_get_extra(this._h, idx, field, p));
    }
    /** Set one checked scalar, keeping its sibling fields. */
    setExtra(idx, field, value) {
        raiseForCode(this._raw.swmm_lid_set_extra(this._h, idx, field, value));
    }
    /** The authored drain curve token. */
    getDrainCurve(idx) {
        const h = this._h;
        if (!(idx >= 0 && idx < this._raw.swmm_lid_count(h)))
            throw new RangeError(String(idx));
        return this._raw.swmm_lid_get_drain_curve(h, idx) ?? "";
    }
    // ---- [LID_USAGE] placements ----------------------------------------------------------
    /** Place control `lid` (an index, as in Python) on a subcatchment. */
    usageAdd(subcatchment, lid, { number, area, width, initSat = 0, fromImperv = 0, }) {
        if (typeof lid === "string") {
            throw new TypeError("LID lookup by id is not supported by the C API; pass the integer index returned from add(id, type)");
        }
        const si = this._subcatch(subcatchment);
        raiseForCode(this._raw.swmm_lid_usage_add(this._h, si, lid, number, area, width, initSat, fromImperv));
    }
    /** @internal */
    _subcatch(key) {
        const h = this._h;
        if (typeof key === "string")
            return resolveIndex(this._raw, h, "subcatch", key);
        const n = this._raw.swmm_subcatch_count(h);
        if (!Number.isInteger(key) || key < 0 || key >= n) {
            throw new RangeError(`Subcatchment index ${key} out of range [0, ${n})`);
        }
        return key;
    }
    /** Placement rows across all subcatchments. */
    usageCount() {
        return this._raw.swmm_lid_usage_count(this._h);
    }
    /** One placement's numeric fields. */
    usageGet(usageIdx) {
        const mod = this._mod;
        const p = checkedAlloc(mod, 80);
        try {
            mod.HEAPU8.fill(0, p, p + 80);
            raiseForCode(this._raw.swmm_lid_usage_get(this._h, usageIdx, p, p + 4, p + 8, p + 16, p + 24, p + 32, p + 40, p + 48, p + 56));
            const f = mod.HEAPF64;
            const i = mod.HEAP32;
            return {
                subcatchIndex: i[p >> 2],
                lidIndex: i[(p + 4) >> 2],
                number: i[(p + 8) >> 2],
                area: f[(p + 16) >> 3],
                width: f[(p + 24) >> 3],
                initSat: f[(p + 32) >> 3],
                fromImperv: f[(p + 40) >> 3],
                toPerv: i[(p + 48) >> 2],
                fromPerv: f[(p + 56) >> 3],
            };
        }
        finally {
            mod._free(p);
        }
    }
    /** Remove one placement by global index. */
    usageRemove(usageIdx) {
        raiseForCode(this._raw.swmm_lid_usage_remove(this._h, usageIdx));
        this._solver._bumpGeneration();
    }
    /** A complete placement, report paths and drain target included. */
    usageRecord(usageIdx) {
        return withStruct(this._mod, "SWMM_LidUsageRecord", (p) => {
            raiseForCode(this._raw.swmm_lid_usage_get_record(this._h, usageIdx, p));
            const r = readStruct(this._mod, "SWMM_LidUsageRecord", p);
            return {
                subcatchIndex: r.subcatch_idx,
                lidIndex: r.control_idx,
                number: r.number,
                area: r.area,
                width: r.width,
                initSat: r.init_sat,
                fromImperv: r.from_imperv,
                toPerv: r.to_perv,
                fromPerv: r.from_perv,
                reportFile: r.report_file,
                reportFileResolved: r.report_file_resolved,
                drainTo: r.drain_to,
            };
        });
    }
    /** Preflight a complete placement, changing nothing (project input units). */
    validateUsage(record) {
        withStructs(this._mod, "SWMM_LidUsageRecord", [usageFields(record)], (p) => raiseForCode(this._raw.swmm_lid_usage_validate_record(this._h, p)));
    }
    /** Replace one subcatchment's ordered placements atomically; other rows stay. */
    replaceUsages(subcatchment, records) {
        const n = this._subcatch(subcatchment);
        const rows = Array.from(records, usageFields);
        withStructs(this._mod, "SWMM_LidUsageRecord", rows, (p) => raiseForCode(this._raw.swmm_lid_usage_replace_subcatch(this._h, n, rows.length ? p : 0, rows.length)));
        this._solver._bumpGeneration();
    }
}
/** `solver.infrastructure`: the five infrastructure views. */
export class Infrastructure {
    /** @internal */
    constructor(solver) {
        this.transects = new Transects(solver);
        this.streets = new Streets(solver);
        this.inlets = new Inlets(solver);
        this.inletUsages = new InletUsages(solver);
        this.lids = new LIDs(solver);
    }
}
//# sourceMappingURL=Infrastructure.js.map