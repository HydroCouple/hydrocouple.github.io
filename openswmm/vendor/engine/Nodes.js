/**
 * @file Nodes.ts
 * @brief Node collection and individual node accessor for the OpenSWMM WASM bindings.
 *
 * @details Mirrors the Python `_nodes.pyi` binding specification:
 * - {@link Nodes} is an iterable collection of all nodes in the model.
 * - {@link Node} is a single-node accessor with typed property getters/setters.
 *
 * All values are in the model's native unit system (see {@link FlowUnits}).
 *
 * @author   Caleb Buahin <caleb.buahin@gmail.com>
 * @copyright Copyright (c) 2026 Caleb Buahin. All rights reserved.
 * @license  Apache-2.0
 */
import { NodeType } from "./enums.js";
import { ElementNotFoundError, StaleObjectError, raiseForCode } from "./errors.js";
import { checkedAlloc, guardedRaw } from "./mem.js";
import { bulkRead, bulkWrite, getDouble, getDoubles, getInt, getText, resolveIndex, } from "./element.js";
import { readStruct, withStruct } from "./structs.js";
// =============================================================================
// Node sub-views (Python StorageView, OutfallView, DividerView)
// =============================================================================
/** Storage-node parameters (`node.storage`, STORAGE nodes only). */
export class StorageView {
    /** @internal */
    constructor(_node) {
        this._node = _node;
    }
    /** Index of the storage curve (TABULAR shape). */
    get curve() {
        const c = this._node._ctx();
        return getInt(c, c.raw.swmm_node_get_storage_curve);
    }
    set curve(curveIdx) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_storage_curve(c.engine, c.index, curveIdx));
    }
    /** `[a, b, c]` of the FUNCTIONAL area curve A = a·d^b + c. */
    get functional() {
        const c = this._node._ctx();
        return getDoubles(c, 3, c.raw.swmm_node_get_storage_functional);
    }
    set functional([a, b, cc]) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_storage_functional(c.engine, c.index, a, b, cc));
    }
    /** Storage shape ({@link StorageShape}). */
    get shape() {
        const c = this._node._ctx();
        return getInt(c, c.raw.swmm_node_get_storage_shape);
    }
    set shape(value) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_storage_shape(c.engine, c.index, value));
    }
    /** `[p1, p2, p3]` of a geometric shape (meaning depends on {@link shape}; zeros otherwise). */
    get geometry() {
        const c = this._node._ctx();
        return getDoubles(c, 3, c.raw.swmm_node_get_storage_geometry);
    }
    set geometry([p1, p2, p3]) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_storage_geometry(c.engine, c.index, p1, p2, p3));
    }
    /**
     * Constant-rate exfiltration (a `[STORAGE]` row ending in a bare Ksat).
     * Setting it replaces any Green-Ampt parameters; it reads 0 when
     * exfiltration uses Green-Ampt or is off.
     */
    get seepRate() {
        const c = this._node._ctx();
        return getDouble(c, c.raw.swmm_node_get_storage_seep_rate);
    }
    set seepRate(rate) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_storage_seep_rate(c.engine, c.index, rate));
    }
    /** Green-Ampt exfiltration `[suction, ksat, imd]`. */
    get exfilParams() {
        const c = this._node._ctx();
        return getDoubles(c, 3, c.raw.swmm_node_get_exfil_params);
    }
    set exfilParams([suction, ksat, imd]) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_exfil_params(c.engine, c.index, suction, ksat, imd));
    }
}
/** Outfall parameters (`node.outfall`, OUTFALL nodes only). */
export class OutfallView {
    /** @internal */
    constructor(_node) {
        this._node = _node;
    }
    /** Outfall type ({@link OutfallType}). */
    get type() {
        const c = this._node._ctx();
        return getInt(c, c.raw.swmm_node_get_outfall_type);
    }
    set type(value) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_outfall_type(c.engine, c.index, value));
    }
    /** Make this a FIXED outfall at `stage`. */
    setStage(stage) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_outfall_stage(c.engine, c.index, stage));
    }
    /** Make this a TIDAL outfall on a curve (by index). */
    setTidalCurve(curveIdx) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_outfall_tidal(c.engine, c.index, curveIdx));
    }
    /** Make this a TIMESERIES outfall on a series (by index). */
    setTimeseries(tsIdx) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_outfall_timeseries(c.engine, c.index, tsIdx));
    }
    /** Index of the tidal curve. */
    getTidalCurve() {
        const c = this._node._ctx();
        return getInt(c, c.raw.swmm_node_get_outfall_tidal);
    }
    /** Index of the stage time series. */
    getTimeseries() {
        const c = this._node._ctx();
        return getInt(c, c.raw.swmm_node_get_outfall_timeseries);
    }
    /** The type's parameter (e.g. the FIXED stage). */
    get param() {
        const c = this._node._ctx();
        return getDouble(c, c.raw.swmm_node_get_outfall_param);
    }
    /** Whether the outfall has a flap gate. */
    get flapGate() {
        const c = this._node._ctx();
        return getInt(c, c.raw.swmm_node_get_outfall_flap_gate) !== 0;
    }
    set flapGate(value) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_outfall_flap_gate(c.engine, c.index, value ? 1 : 0));
    }
    /** Index of the subcatchment the outfall's flow is routed onto, or -1. */
    get routeTo() {
        const c = this._node._ctx();
        return getInt(c, c.raw.swmm_node_get_outfall_route_to);
    }
    set routeTo(subcatchIdx) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_outfall_route_to(c.engine, c.index, subcatchIdx));
    }
    /** Volumes, heat and pollutant amounts the outfall has exported so far. */
    get exportReceipt() {
        const c = this._node._ctx();
        const count = c.raw.swmm_pollutant_count(c.engine);
        const amounts = checkedAlloc(c.mod, 8 * Math.max(count, 1));
        try {
            const receipt = withStruct(c.mod, "SWMM_OutfallExportReceipt", (p) => {
                raiseForCode(c.raw.swmm_node_get_export_receipt(c.engine, c.index, p, amounts, count));
                return readStruct(c.mod, "SWMM_OutfallExportReceipt", p);
            });
            const values = {};
            const units = {};
            for (let i = 0; i < count; i++) {
                const name = c.raw.swmm_pollutant_id(c.engine, i);
                values[name] = c.mod.HEAPF64[(amounts >> 3) + i];
                const u = getInt({ ...c, index: i }, c.raw.swmm_pollutant_get_units);
                units[name] = u === 2 ? "counts" : "kg";
            }
            return {
                exported_m3: receipt.exported_m3,
                reversed_m3: receipt.reversed_m3,
                exported_heat_j: receipt.exported_heat_j,
                flags: receipt.flags,
                pollutant_amounts: values,
                pollutant_amount_units: units,
            };
        }
        finally {
            c.mod._free(amounts);
        }
    }
}
/** Flow-divider parameters (`node.divider`, DIVIDER nodes only). */
export class DividerView {
    /** @internal */
    constructor(_node) {
        this._node = _node;
    }
    /** Divider type code. */
    get type() {
        const c = this._node._ctx();
        return getInt(c, c.raw.swmm_node_get_divider_type);
    }
    set type(value) {
        const c = this._node._ctx();
        raiseForCode(c.raw.swmm_node_set_divider_type(c.engine, c.index, value));
    }
    /** `method`, `diversion_link`, `curve`, `cutoff_flow`, `weir_height`, `weir_coefficient`. */
    get params() {
        const c = this._node._ctx();
        return withStruct(c.mod, "SWMM_DividerParams", (p) => {
            raiseForCode(c.raw.swmm_node_get_divider_params(c.engine, c.index, p));
            return readStruct(c.mod, "SWMM_DividerParams", p);
        });
    }
    set params(record) {
        const c = this._node._ctx();
        withStruct(c.mod, "SWMM_DividerParams", (p) => raiseForCode(c.raw.swmm_node_set_divider_params(c.engine, c.index, p)), record);
    }
}
// =============================================================================
// Node
// =============================================================================
/**
 * Accessor for a single SWMM node.
 *
 * Obtain instances via {@link Nodes.get} or by iterating a {@link Nodes}
 * collection — do not construct directly.
 *
 * @remarks
 * A `Node` is a lightweight view; it stores only the engine handle, the
 * parent collection reference, and the node index. Calls are forwarded
 * directly to the WASM engine, so every property read crosses the WASM
 * boundary.
 *
 * If the model is closed and re-opened the node wrapper becomes stale;
 * accessing any property then throws {@link StaleObjectError}.
 */
export class Node {
    /** @internal */
    constructor(mod, engine, collection, generation, index) {
        this._mod = mod;
        this._raw = guardedRaw(mod, () => collection.assertAlive());
        this._engine = engine;
        this._collection = collection;
        this._generation = generation;
        this.index = index;
    }
    /** @internal — throw if the parent collection has been re-created. */
    _checkStale() {
        if (this._generation !== this._collection.generation) {
            throw new StaleObjectError();
        }
    }
    /** @internal This node's engine context, after the staleness check. */
    _ctx() {
        this._checkStale();
        return { mod: this._mod, raw: this._raw, engine: this._engine, index: this.index };
    }
    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------
    /** String identifier of this node. */
    get id() {
        this._checkStale();
        return this._raw.swmm_node_id(this._engine, this.index);
    }
    /** Node classification. */
    get type() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_node_get_type(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    // -------------------------------------------------------------------------
    // State (read-only during simulation)
    // -------------------------------------------------------------------------
    /** Current water depth above the invert elevation (m or ft). */
    get depth() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_depth(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Set the water depth (available in BUILDING/OPENED state). */
    set depth(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_node_set_depth(this._engine, this.index, value));
    }
    /** Hydraulic head (invert elevation + depth, m or ft). */
    get head() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_head(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Current stored volume (m³ or ft³). */
    get volume() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_volume(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Lateral inflow rate (flow units). */
    get lateralInflow() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_lateral_inflow(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Inject a lateral inflow (flow units). Calls `swmm_node_set_lateral_inflow`. */
    set lateralInflow(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_node_set_lateral_inflow(this._engine, this.index, value));
    }
    /** Total overflow / flooding rate leaving this node (flow units). */
    get overflow() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_overflow(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Total inflow rate entering this node (flow units). */
    get inflow() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_inflow(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Evaporation + exfiltration losses from this node (flow units). */
    get losses() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_losses(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Total outflow rate leaving this node via downstream links (flow units). */
    get outflow() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_outflow(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    // -------------------------------------------------------------------------
    // Geometry (settable before initialization)
    // -------------------------------------------------------------------------
    /** Invert elevation (m or ft). */
    get invertElev() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_invert_elev(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Set invert elevation (BUILDING or OPENED state). */
    set invertElev(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_node_set_invert_elev(this._engine, this.index, value));
    }
    /** Maximum design depth (m or ft). */
    get maxDepth() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_max_depth(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Set maximum design depth (BUILDING or OPENED state). */
    set maxDepth(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_node_set_max_depth(this._engine, this.index, value));
    }
    /** Physical junction chamber area (ft2/m2); zero retains legacy behavior. */
    get storageArea() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_storage_area(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Set chamber area before initialization (ordinary junctions only). */
    set storageArea(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_node_set_storage_area(this._engine, this.index, value));
    }
    // -------------------------------------------------------------------------
    // Boundary conditions
    // -------------------------------------------------------------------------
    /**
     * Impose a fixed head boundary at this node (outfall nodes only).
     * Only valid in RUNNING state; use {@link Forcing.nodeHeadBoundary} for
     * per-step overrides.
     */
    setHeadBoundary(head) {
        this._checkStale();
        raiseForCode(this._raw.swmm_node_set_head_boundary(this._engine, this.index, head));
    }
    // -------------------------------------------------------------------------
    // Python Node members (wave B)
    // -------------------------------------------------------------------------
    /** The solver (or model builder) this node belongs to. */
    get solver() {
        return this._collection.solver;
    }
    /** The node's tag (`[TAGS]`). */
    get tag() {
        const c = this._ctx();
        return getText(c, c.raw.swmm_node_get_tag);
    }
    set tag(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_node_set_tag(c.engine, c.index, value ?? ""));
    }
    /** Whether the node is a virtual junction. */
    get isVirtual() {
        const c = this._ctx();
        return getInt(c, c.raw.swmm_node_is_virtual) !== 0;
    }
    set isVirtual(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_node_set_virtual(c.engine, c.index, value ? 1 : 0));
    }
    /** Why the node cannot be virtual (0 = eligible). */
    get virtualRuleViolation() {
        const c = this._ctx();
        return getInt(c, c.raw.swmm_node_virtual_eligible);
    }
    /** Whether the node is an inlet junction. */
    get isInlet() {
        const c = this._ctx();
        return getInt(c, c.raw.swmm_node_is_inlet) !== 0;
    }
    set isInlet(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_node_set_inlet(c.engine, c.index, value ? 1 : 0));
    }
    /** Why the node cannot be an inlet (0 = eligible). */
    inletRuleViolation(forDropInlet = false) {
        const c = this._ctx();
        return getInt(c, (e, i, out) => c.raw.swmm_node_inlet_eligible(e, i, forDropInlet ? 1 : 0, out));
    }
    /** Depth from invert to rim. */
    get rimDepth() {
        const c = this._ctx();
        return getDouble(c, c.raw.swmm_node_get_rim_depth);
    }
    set rimDepth(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_node_set_rim_depth(c.engine, c.index, value));
    }
    /** Additional depth above the rim before surcharging floods. */
    get surchargeDepth() {
        const c = this._ctx();
        return getDouble(c, c.raw.swmm_node_get_surcharge_depth);
    }
    set surchargeDepth(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_node_set_surcharge_depth(c.engine, c.index, value));
    }
    /** Ponded area when flooded. */
    get pondedArea() {
        const c = this._ctx();
        return getDouble(c, c.raw.swmm_node_get_ponded_area);
    }
    set pondedArea(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_node_set_pond_area(c.engine, c.index, value));
    }
    /** Initial water depth. */
    get initialDepth() {
        const c = this._ctx();
        return getDouble(c, c.raw.swmm_node_get_initial_depth);
    }
    set initialDepth(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_node_set_initial_depth(c.engine, c.index, value));
    }
    /** Elevation of the highest connected conduit crown. */
    get crownElev() {
        const c = this._ctx();
        return getDouble(c, c.raw.swmm_node_get_crown_elev);
    }
    /** Volume when full. */
    get fullVolume() {
        const c = this._ctx();
        return getDouble(c, c.raw.swmm_node_get_full_volume);
    }
    /** Number of connected links. */
    get degree() {
        const c = this._ctx();
        return getInt(c, c.raw.swmm_node_get_degree);
    }
    /** Concentration of a pollutant (by index or id). */
    quality(pollutant) {
        const c = this._ctx();
        const q = resolveIndex(c.raw, c.engine, "pollutant", pollutant);
        return getDouble(c, (e, i, out) => c.raw.swmm_node_get_quality(e, i, q, out));
    }
    /** Inject a pollutant mass flux at the node. */
    setQualityMassFlux(pollutant, massRate) {
        const c = this._ctx();
        const q = resolveIndex(c.raw, c.engine, "pollutant", pollutant);
        raiseForCode(c.raw.swmm_node_set_quality_mass_flux(c.engine, c.index, q, massRate));
    }
    /** Depth at which the node holds `volume`. */
    depthFromVolume(volume) {
        const c = this._ctx();
        return getDouble(c, (e, i, out) => c.raw.swmm_node_get_depth_from_volume(e, i, volume, out));
    }
    /** @internal */
    _subview(want, name, make) {
        const type = this.type;
        if (type !== want) {
            throw new TypeError(`node ${JSON.stringify(this.id)} is a ${NodeType[type]}, not ${NodeType[want]}; ` +
                `the .${name} sub-view is only valid for ${NodeType[want].toLowerCase()} nodes`);
        }
        return make();
    }
    /** Storage parameters. @throws TypeError unless the node is STORAGE */
    get storage() {
        return this._subview(NodeType.STORAGE, "storage", () => new StorageView(this));
    }
    /** Outfall parameters. @throws TypeError unless the node is an OUTFALL */
    get outfall() {
        return this._subview(NodeType.OUTFALL, "outfall", () => new OutfallView(this));
    }
    /** Divider parameters. @throws TypeError unless the node is a DIVIDER */
    get divider() {
        return this._subview(NodeType.DIVIDER, "divider", () => new DividerView(this));
    }
    // -------------------------------------------------------------------------
    // Statistics
    // -------------------------------------------------------------------------
    /**
     * Accumulated simulation statistics for this node.
     * Only meaningful after the simulation has ended.
     */
    get stats() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_node_get_stat_max_depth(this._engine, this.index, ptr));
            const maxDepth = this._mod.getValue(ptr, "double");
            raiseForCode(this._raw.swmm_node_get_stat_max_overflow(this._engine, this.index, ptr));
            const maxOverflow = this._mod.getValue(ptr, "double");
            raiseForCode(this._raw.swmm_node_get_stat_vol_flooded(this._engine, this.index, ptr));
            const volFlooded = this._mod.getValue(ptr, "double");
            raiseForCode(this._raw.swmm_node_get_stat_time_flooded(this._engine, this.index, ptr));
            const timeFlooded = this._mod.getValue(ptr, "double");
            return { maxDepth, maxOverflow, volFlooded, timeFlooded };
        }
        finally {
            this._mod._free(ptr);
        }
    }
}
// =============================================================================
// Nodes collection
// =============================================================================
/**
 * Iterable collection of all nodes in the current model.
 *
 * Obtain via {@link Solver.nodes}. Supports numeric index lookup,
 * string-ID lookup, and `for…of` iteration.
 *
 * @example
 * ```ts
 * const nodes = solver.nodes;
 * console.log(nodes.length);             // number of nodes
 *
 * const n0 = nodes.get(0);              // by numeric index
 * const n1 = nodes.get("J1");           // by string ID
 *
 * for (const node of nodes) {
 *   console.log(node.id, node.depth);
 * }
 * ```
 */
export class Nodes {
    /** @internal */
    /** @internal Check the owner before touching native memory. */
    assertAlive() {
        this._checkOwner();
    }
    constructor(mod, engine, _checkOwner = () => { }, 
    /** The solver (or model builder) that owns the collection. */
    solver = null) {
        this._checkOwner = _checkOwner;
        this.solver = solver;
        /**
         * Generation counter incremented whenever the engine is re-opened.
         * Used by {@link Node} to detect stale wrappers.
         * @internal
         */
        this.generation = 0;
        this._mod = mod;
        this._raw = guardedRaw(mod, this._checkOwner);
        this._engine = engine;
    }
    // -------------------------------------------------------------------------
    // Collection interface
    // -------------------------------------------------------------------------
    /** Number of nodes in the model. */
    get length() {
        return this._raw.swmm_node_count(this._engine);
    }
    /**
     * Look up a node by zero-based index or string ID.
     *
     * @throws {@link BadIndexError} if `index` is out of range.
     * @throws {@link ElementNotFoundError} if `id` is not found.
     */
    get(indexOrId) {
        if (typeof indexOrId === "string") {
            const idx = this._raw.swmm_node_index(this._engine, indexOrId);
            if (idx < 0)
                throw new ElementNotFoundError(indexOrId);
            return new Node(this._mod, this._engine, this, this.generation, idx);
        }
        const count = this.length;
        if (indexOrId < 0 || indexOrId >= count) {
            throw new ElementNotFoundError(indexOrId, `Node index ${indexOrId} out of range [0, ${count})`);
        }
        return new Node(this._mod, this._engine, this, this.generation, indexOrId);
    }
    /** True when a node with this index or id exists. */
    has(key) {
        if (typeof key === "string")
            return this.getIndex(key) >= 0;
        return Number.isInteger(key) && key >= 0 && key < this.length;
    }
    /** Every node id, in index order. */
    get ids() {
        return Array.from({ length: this.length }, (_, i) => this.getId(i));
    }
    /** Add a node of a {@link NodeType}; earlier node views become stale, as in Python. */
    add(nodeId, nodeType) {
        raiseForCode(this._raw.swmm_node_add(this._engine, nodeId, nodeType));
        this.generation++;
        return this.get(nodeId);
    }
    /** Remove the last node, which must be `nodeId`. Earlier node views become stale. */
    popLast(nodeId) {
        raiseForCode(this._raw.swmm_node_pop_last(this._engine, nodeId));
        this.generation++;
    }
    /** Rename a node; references follow. Earlier node views become stale. */
    rename(key, newId) {
        raiseForCode(this._raw.swmm_node_rename(this._engine, this.get(key).index, newId));
        this.generation++;
    }
    /** Total inflow of every node. */
    get inflows() {
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_node_get_inflows_bulk(this._engine, p, n));
    }
    /** Outflow of every node. */
    get outflows() {
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_node_get_outflows_bulk(this._engine, p, n));
    }
    /** Losses (evaporation, exfiltration) of every node. */
    get losses() {
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_node_get_losses_bulk(this._engine, p, n));
    }
    /**
     * Set every node's lateral inflow (one value per node). A method, not a
     * settable property, because the engine also updates the field itself.
     */
    setLateralInflows(values) {
        bulkWrite(this._mod, this.length, values, "lateral inflows", (p, n) => this._raw.swmm_node_set_lat_inflows_bulk(this._engine, p, n));
    }
    /** Concentration of a pollutant (by index or id) at every node. */
    qualities(pollutant) {
        const q = resolveIndex(this._raw, this._engine, "pollutant", pollutant);
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_node_get_quality_bulk(this._engine, q, p, n));
    }
    /**
     * Return the zero-based index for a string node ID, or -1 if not found.
     */
    getIndex(id) {
        return this._raw.swmm_node_index(this._engine, id);
    }
    /**
     * Return the string ID for a zero-based node index.
     *
     * @throws {@link BadIndexError} if `idx` is out of range.
     */
    getId(idx) {
        const id = this._raw.swmm_node_id(this._engine, idx);
        if (!id)
            throw new ElementNotFoundError(idx, `Node index ${idx} out of range`);
        return id;
    }
    // -------------------------------------------------------------------------
    // Bulk array accessors
    // -------------------------------------------------------------------------
    /**
     * Depths of all nodes as a `Float64Array` (m or ft).
     * Avoids the overhead of calling `get(i).depth` in a loop.
     */
    get depths() {
        const n = this.length;
        const result = new Float64Array(n);
        const ptr = checkedAlloc(this._mod, 8);
        try {
            for (let i = 0; i < n; i++) {
                raiseForCode(this._raw.swmm_node_get_depth(this._engine, i, ptr));
                result[i] = this._mod.getValue(ptr, "double");
            }
        }
        finally {
            this._mod._free(ptr);
        }
        return result;
    }
    /**
     * Hydraulic heads of all nodes as a `Float64Array` (m or ft).
     */
    get heads() {
        const n = this.length;
        const result = new Float64Array(n);
        const ptr = checkedAlloc(this._mod, 8);
        try {
            for (let i = 0; i < n; i++) {
                raiseForCode(this._raw.swmm_node_get_head(this._engine, i, ptr));
                result[i] = this._mod.getValue(ptr, "double");
            }
        }
        finally {
            this._mod._free(ptr);
        }
        return result;
    }
    /**
     * Stored volumes of all nodes as a `Float64Array` (m³ or ft³).
     */
    get volumes() {
        const n = this.length;
        const result = new Float64Array(n);
        const ptr = checkedAlloc(this._mod, 8);
        try {
            for (let i = 0; i < n; i++) {
                raiseForCode(this._raw.swmm_node_get_volume(this._engine, i, ptr));
                result[i] = this._mod.getValue(ptr, "double");
            }
        }
        finally {
            this._mod._free(ptr);
        }
        return result;
    }
    /**
     * Lateral inflow rates of all nodes as a `Float64Array` (flow units).
     */
    get lateralInflows() {
        const n = this.length;
        const result = new Float64Array(n);
        const ptr = checkedAlloc(this._mod, 8);
        try {
            for (let i = 0; i < n; i++) {
                raiseForCode(this._raw.swmm_node_get_lateral_inflow(this._engine, i, ptr));
                result[i] = this._mod.getValue(ptr, "double");
            }
        }
        finally {
            this._mod._free(ptr);
        }
        return result;
    }
    /**
     * Overflow rates of all nodes as a `Float64Array` (flow units).
     */
    get overflows() {
        const n = this.length;
        const result = new Float64Array(n);
        const ptr = checkedAlloc(this._mod, 8);
        try {
            for (let i = 0; i < n; i++) {
                raiseForCode(this._raw.swmm_node_get_overflow(this._engine, i, ptr));
                result[i] = this._mod.getValue(ptr, "double");
            }
        }
        finally {
            this._mod._free(ptr);
        }
        return result;
    }
    // -------------------------------------------------------------------------
    // Iteration
    // -------------------------------------------------------------------------
    /** Iterate over every node in the model in index order. */
    [Symbol.iterator]() {
        let i = 0;
        const length = this.length;
        return {
            next: () => {
                if (i < length) {
                    return { value: this.get(i++), done: false };
                }
                return { value: undefined, done: true };
            },
        };
    }
}
//# sourceMappingURL=Nodes.js.map