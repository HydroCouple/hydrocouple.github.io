/**
 * @file Subcatchments.ts
 * @brief Subcatchment collection and individual subcatchment accessor.
 *
 * @details Mirrors the Python `_subcatchments.pyi` binding specification.
 *
 * @author   Caleb Buahin <caleb.buahin@gmail.com>
 * @copyright Copyright (c) 2026 Caleb Buahin. All rights reserved.
 * @license  Apache-2.0
 */
import { ElementNotFoundError, StaleObjectError, raiseForCode } from "./errors.js";
import { checkedAlloc, guardedRaw, withCString } from "./mem.js";
import { bulkRead, getDouble, getDoubles, getInt, getText, resolveIndex, resolveSurfaceSpecies, } from "./element.js";
/** Accumulated statistics of a subcatchment (`sub.stats`). */
export class SubcatchmentStatsView {
    /** @internal */
    constructor(_sub) {
        this._sub = _sub;
    }
    /** Total precipitation. */
    get precip() {
        const c = this._sub._ctx();
        return getDouble(c, c.raw.swmm_subcatch_get_stat_precip);
    }
    /** Total runoff volume. */
    get runoffVol() {
        const c = this._sub._ctx();
        return getDouble(c, c.raw.swmm_subcatch_get_stat_runoff_vol);
    }
    /** Peak runoff rate. */
    get maxRunoff() {
        const c = this._sub._ctx();
        return getDouble(c, c.raw.swmm_subcatch_get_stat_max_runoff);
    }
}
/** Infiltration model and parameters (`sub.infiltration`). */
export class InfiltrationView {
    /** @internal */
    constructor(_sub) {
        this._sub = _sub;
    }
    /** Infiltration model ({@link InfilModel}); changing it keeps each model's parameters. */
    get model() {
        const c = this._sub._ctx();
        return getInt(c, c.raw.swmm_subcatch_get_infil_model);
    }
    set model(value) {
        const c = this._sub._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_infil_model(c.engine, c.index, value));
    }
    /** Horton `[f0, fmin, decay, dryTime]`. */
    get horton() {
        const c = this._sub._ctx();
        return getDoubles(c, 4, c.raw.swmm_subcatch_get_infil_horton);
    }
    /** Set the Horton parameters. */
    setHorton(f0, fmin, decay, dryTime) {
        const c = this._sub._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_infil_horton(c.engine, c.index, f0, fmin, decay, dryTime));
    }
    /** Green-Ampt `[suction, conductivity, initialDeficit]`. */
    get greenAmpt() {
        const c = this._sub._ctx();
        return getDoubles(c, 3, c.raw.swmm_subcatch_get_infil_green_ampt);
    }
    /** Set the Green-Ampt parameters. */
    setGreenAmpt(suction, conductivity, initialDeficit) {
        const c = this._sub._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_infil_green_ampt(c.engine, c.index, suction, conductivity, initialDeficit));
    }
    /** SCS curve number. */
    get curveNumber() {
        const c = this._sub._ctx();
        return getDoubles(c, 2, c.raw.swmm_subcatch_get_infil_curve_number)[0];
    }
    /** Curve-number drying time. */
    get curveNumberDryingTime() {
        const c = this._sub._ctx();
        return getDoubles(c, 2, c.raw.swmm_subcatch_get_infil_curve_number)[1];
    }
    /** Set the curve number and drying time. */
    setCurveNumber(cn, dryingTime) {
        const c = this._sub._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_infil_curve_number(c.engine, c.index, cn, dryingTime));
    }
}
/**
 * Land-use coverage fractions (`sub.coverage`, `[COVERAGES]`) by land use
 * index or id; iteration yields the land uses with a nonzero fraction.
 */
export class CoverageView {
    /** @internal */
    constructor(_sub) {
        this._sub = _sub;
    }
    /** Fraction of the subcatchment under a land use. */
    get(landuse) {
        const c = this._sub._ctx();
        const lu = resolveIndex(c.raw, c.engine, "landuse", landuse);
        return getDouble(c, (e, i, out) => c.raw.swmm_subcatch_get_coverage(e, i, lu, out));
    }
    /** Set the fraction under a land use. */
    set(landuse, value) {
        const c = this._sub._ctx();
        const lu = resolveIndex(c.raw, c.engine, "landuse", landuse);
        raiseForCode(c.raw.swmm_subcatch_set_coverage(c.engine, c.index, lu, value));
    }
    /** Coverage entries cannot be deleted; set the fraction to 0 instead. @throws TypeError */
    delete(landuse) {
        void landuse;
        throw new TypeError("coverage entries can't be deleted; set fraction to 0.0 instead");
    }
    /** Number of land uses with a nonzero fraction. */
    get length() {
        return [...this].length;
    }
    [Symbol.iterator]() {
        const c = this._sub._ctx();
        const ids = Array.from({ length: c.raw.swmm_landuse_count(c.engine) }, (_, i) => c.raw.swmm_landuse_id(c.engine, i)).filter((id) => id && this.get(id) !== 0);
        return ids[Symbol.iterator]();
    }
}
/**
 * Initial buildup per pollutant or reaction species (`sub.loadings`,
 * `[LOADINGS]`); iteration yields the pollutants with a nonzero loading.
 */
export class LoadingsView {
    /** @internal */
    constructor(_sub) {
        this._sub = _sub;
    }
    /** Initial loading (mass per area) of a pollutant or species. */
    get(species) {
        const c = this._sub._ctx();
        const p = resolveSurfaceSpecies(c.mod, c.raw, c.engine, species);
        return getDouble(c, (e, i, out) => c.raw.swmm_subcatch_get_initial_loading(e, i, p, out));
    }
    /** Set the initial loading of a pollutant or species. */
    set(species, value) {
        const c = this._sub._ctx();
        const p = resolveSurfaceSpecies(c.mod, c.raw, c.engine, species);
        raiseForCode(c.raw.swmm_subcatch_set_initial_loading(c.engine, c.index, p, value));
    }
    /** Loadings cannot be deleted; set the value to 0 instead. @throws TypeError */
    delete(species) {
        void species;
        throw new TypeError("loading entries can't be deleted; set the value to 0.0 instead");
    }
    /** Number of pollutants with a nonzero loading. */
    get length() {
        return [...this].length;
    }
    [Symbol.iterator]() {
        const c = this._sub._ctx();
        const ids = Array.from({ length: c.raw.swmm_pollutant_count(c.engine) }, (_, i) => c.raw.swmm_pollutant_id(c.engine, i)).filter((id) => id && this.get(id) !== 0);
        return ids[Symbol.iterator]();
    }
}
// =============================================================================
// Subcatchment
// =============================================================================
/**
 * Accessor for a single SWMM subcatchment.
 *
 * Obtain instances via {@link Subcatchments.get} — do not construct directly.
 */
export class Subcatchment {
    /** @internal */
    constructor(mod, engine, collection, generation, index) {
        this._mod = mod;
        this._raw = guardedRaw(mod, () => collection.assertAlive());
        this._engine = engine;
        this._collection = collection;
        this._generation = generation;
        this.index = index;
    }
    /** @internal */
    _checkStale() {
        if (this._generation !== this._collection.generation) {
            throw new StaleObjectError();
        }
    }
    /** @internal This subcatchment's engine context, after the staleness check. */
    _ctx() {
        this._checkStale();
        return { mod: this._mod, raw: this._raw, engine: this._engine, index: this.index };
    }
    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------
    /** String identifier of this subcatchment. */
    get id() {
        this._checkStale();
        return this._raw.swmm_subcatch_id(this._engine, this.index);
    }
    // -------------------------------------------------------------------------
    // Hydrologic state
    // -------------------------------------------------------------------------
    /** Current surface runoff rate (flow units). */
    /**
     * Frozen-ground state of the pervious area after the last runoff step, as
     * `[temperatureC, frozenFraction, infiltrationFactor]`, or `null` without a
     * `[FROZEN_GROUND]` row.
     */
    get frozenGround() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 32);
        try {
            raiseForCode(this._raw.swmm_subcatch_get_frozen_ground(this._engine, this.index, ptr, ptr + 8, ptr + 16, ptr + 24));
            const values = this._mod.HEAPF64.subarray((ptr + 8) >> 3, (ptr + 32) >> 3);
            return this._mod.HEAP32[ptr >> 2] ? [values[0], values[1], values[2]] : null;
        }
        finally {
            this._mod._free(ptr);
        }
    }
    get runoff() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_subcatch_get_runoff(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    // -------------------------------------------------------------------------
    // Physical properties
    // -------------------------------------------------------------------------
    /** Subcatchment drainage area (ha or acres). */
    get area() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_subcatch_get_area(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Percent impervious (0–100). */
    get impervPct() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_subcatch_get_imperv_pct(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Representative width used for overland flow routing (m or ft). */
    get width() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_subcatch_get_width(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Land surface slope (%). */
    get slope() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_subcatch_get_slope(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    // -------------------------------------------------------------------------
    // Topology
    // -------------------------------------------------------------------------
    /** Zero-based index of the outlet node, or -1 if draining to another subcatchment. */
    get outletNodeIndex() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_subcatch_get_outlet(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Zero-based index of the assigned rain gage. */
    get gageIndex() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_subcatch_get_gage(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    // -------------------------------------------------------------------------
    // Python Subcatchment members (wave B)
    // -------------------------------------------------------------------------
    /** The solver (or model builder) this subcatchment belongs to. */
    get solver() {
        return this._collection.solver;
    }
    /** @internal The owner, which every cross-collection view needs. */
    _owner() {
        const owner = this._collection.solver;
        if (!owner)
            throw new ElementNotFoundError(this.index, "subcatchment has no owner");
        return owner;
    }
    /** The subcatchment's tag (`[TAGS]`). */
    get tag() {
        const c = this._ctx();
        return getText(c, c.raw.swmm_subcatch_get_tag);
    }
    set tag(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_tag(c.engine, c.index, value ?? ""));
    }
    /** Assigned snowpack name (`""` = none). */
    get snowpack() {
        const c = this._ctx();
        return c.raw.swmm_subcatch_get_snowpack(c.engine, c.index) ?? "";
    }
    set snowpack(value) {
        if ((value ?? "").includes("\0"))
            throw new RangeError("Snow-pack names cannot contain NUL");
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_snowpack(c.engine, c.index, value ?? ""));
    }
    /** @internal A double property through get/set functions. */
    _get(fn) {
        return getDouble(this._ctx(), fn);
    }
    /** Rainfall multiplier. */
    get rainScaleFactor() {
        return this._get(this._ctx().raw.swmm_subcatch_get_rain_scale_factor);
    }
    set rainScaleFactor(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_rain_scale_factor(c.engine, c.index, value));
    }
    /** Snowfall multiplier. */
    get snowScaleFactor() {
        return this._get(this._ctx().raw.swmm_subcatch_get_snow_scale_factor);
    }
    set snowScaleFactor(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_snow_scale_factor(c.engine, c.index, value));
    }
    /** Percent of the impervious area with no depression storage. */
    get zeroImpervPct() {
        return this._get(this._ctx().raw.swmm_subcatch_get_zero_imperv_pct);
    }
    set zeroImpervPct(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_zero_imperv_pct(c.engine, c.index, value));
    }
    /** Manning n of the impervious area. */
    get nImperv() {
        return this._get(this._ctx().raw.swmm_subcatch_get_n_imperv);
    }
    set nImperv(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_n_imperv(c.engine, c.index, value));
    }
    /** Manning n of the pervious area. */
    get nPerv() {
        return this._get(this._ctx().raw.swmm_subcatch_get_n_perv);
    }
    set nPerv(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_n_perv(c.engine, c.index, value));
    }
    /** Depression storage of the impervious area. */
    get dsImperv() {
        return this._get(this._ctx().raw.swmm_subcatch_get_ds_imperv);
    }
    set dsImperv(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_ds_imperv(c.engine, c.index, value));
    }
    /** Depression storage of the pervious area. */
    get dsPerv() {
        return this._get(this._ctx().raw.swmm_subcatch_get_ds_perv);
    }
    set dsPerv(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_ds_perv(c.engine, c.index, value));
    }
    /** The rain gage. Assign a gage view, index or id. */
    get gage() {
        return this._owner().gages.get(this.gageIndex);
    }
    set gage(value) {
        const c = this._ctx();
        const gi = typeof value === "object" ? value.index : resolveIndex(c.raw, c.engine, "gage", value);
        raiseForCode(c.raw.swmm_subcatch_set_gage(c.engine, c.index, gi));
    }
    /** Where the runoff goes: a node, another subcatchment, or `null`. */
    get outlet() {
        const c = this._ctx();
        const p = checkedAlloc(c.mod, 4);
        try {
            if (c.raw.swmm_subcatch_get_outlet(c.engine, c.index, p) === 0 && c.mod.HEAP32[p >> 2] >= 0) {
                return this._owner().nodes.get(c.mod.HEAP32[p >> 2]);
            }
            raiseForCode(c.raw.swmm_subcatch_get_outlet_subcatch(c.engine, c.index, p));
            const s = c.mod.HEAP32[p >> 2];
            return s >= 0 ? this._owner().subcatchments.get(s) : null;
        }
        finally {
            c.mod._free(p);
        }
    }
    /** Send the runoff to a node (view, index or id). */
    setOutletNode(node) {
        const c = this._ctx();
        const ni = typeof node === "object" ? node.index : resolveIndex(c.raw, c.engine, "node", node);
        raiseForCode(c.raw.swmm_subcatch_set_outlet(c.engine, c.index, ni));
    }
    /** Send the runoff to another subcatchment (view, index or id). */
    setOutletSubcatchment(sub) {
        const c = this._ctx();
        const si = typeof sub === "object" ? sub.index : resolveIndex(c.raw, c.engine, "subcatch", sub);
        raiseForCode(c.raw.swmm_subcatch_set_outlet_subcatch(c.engine, c.index, si));
    }
    /** Index of the aquifer (`null` = none). Assign an index, id or `null`. */
    get aquifer() {
        const c = this._ctx();
        const v = getInt(c, c.raw.swmm_subcatch_get_aquifer);
        return v < 0 ? null : v;
    }
    set aquifer(value) {
        const c = this._ctx();
        const ai = value === null ? -1 : resolveIndex(c.raw, c.engine, "aquifer", value);
        raiseForCode(c.raw.swmm_subcatch_set_aquifer(c.engine, c.index, ai));
    }
    /** Index of the groundwater receiving node (`null` = none). */
    get gwNode() {
        const c = this._ctx();
        const v = getInt(c, c.raw.swmm_subcatch_get_gw_node);
        return v < 0 ? null : v;
    }
    set gwNode(value) {
        const c = this._ctx();
        const ni = value === null
            ? -1
            : typeof value === "object"
                ? value.index
                : resolveIndex(c.raw, c.engine, "node", value);
        raiseForCode(c.raw.swmm_subcatch_set_gw_node(c.engine, c.index, ni));
    }
    /** Groundwater flow coefficients. */
    get gwParams() {
        const c = this._ctx();
        const [surfElev, a1, b1, a2, b2, a3, tw, hstar] = getDoubles(c, 8, c.raw.swmm_subcatch_get_gw_params);
        return { surfElev, a1, b1, a2, b2, a3, tw, hstar };
    }
    /** Set the groundwater flow coefficients. */
    setGwParams(surfElev, a1, b1, a2, b2, a3, tw, hstar) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_gw_params(c.engine, c.index, surfElev, a1, b1, a2, b2, a3, tw, hstar));
    }
    /** Groundwater flow from the aquifer. */
    get groundwater() {
        return this._get(this._ctx().raw.swmm_subcatch_get_groundwater);
    }
    /** Current rainfall rate. */
    get rainfall() {
        return this._get(this._ctx().raw.swmm_subcatch_get_rainfall);
    }
    set rainfall(value) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_rainfall(c.engine, c.index, value));
    }
    /** Snow depth. */
    get snowDepth() {
        return this._get(this._ctx().raw.swmm_subcatch_get_snow_depth);
    }
    /** Evaporation rate. */
    get evap() {
        return this._get(this._ctx().raw.swmm_subcatch_get_evap);
    }
    /** Infiltration rate. */
    get infil() {
        return this._get(this._ctx().raw.swmm_subcatch_get_infil);
    }
    /** Runoff concentration of a pollutant (by index or id). */
    quality(pollutant) {
        const c = this._ctx();
        const q = resolveIndex(c.raw, c.engine, "pollutant", pollutant);
        return getDouble(c, (e, i, out) => c.raw.swmm_subcatch_get_quality(e, i, q, out));
    }
    /** Ponded mass of a pollutant. */
    pondedQuality(pollutant) {
        const c = this._ctx();
        const q = resolveIndex(c.raw, c.engine, "pollutant", pollutant);
        return getDouble(c, (e, i, out) => c.raw.swmm_subcatch_get_ponded_quality(e, i, q, out));
    }
    /** Set the ponded mass of a pollutant. */
    setPondedQuality(pollutant, mass) {
        const c = this._ctx();
        const q = resolveIndex(c.raw, c.engine, "pollutant", pollutant);
        raiseForCode(c.raw.swmm_subcatch_set_ponded_quality(c.engine, c.index, q, mass));
    }
    /** Set the groundwater state; -1 keeps a value. */
    setGwState(theta = -1, lowerDepth = -1) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_gw_state(c.engine, c.index, theta, lowerDepth));
    }
    /** `[theta, lowerDepth]` of the groundwater. */
    getGwState() {
        const c = this._ctx();
        return getDoubles(c, 2, c.raw.swmm_subcatch_get_gw_state);
    }
    /** Set the snow state of a surface (0 plowable, 1 impervious, 2 pervious); -1 (ati: -1000) keeps a value. */
    setSnowState(surface, swe = -1, fw = -1, ati = -1000, coldc = -1) {
        const c = this._ctx();
        raiseForCode(c.raw.swmm_subcatch_set_snow_state(c.engine, c.index, surface, swe, fw, ati, coldc));
    }
    /** `[swe, fw, ati, coldc]` of a surface's snow. */
    getSnowState(surface) {
        const c = this._ctx();
        return getDoubles(c, 4, (e, i, ...outs) => c.raw.swmm_subcatch_get_snow_state(e, i, surface, outs[0], outs[1], outs[2], outs[3]));
    }
    /** Accumulated statistics. */
    get stats() {
        return new SubcatchmentStatsView(this);
    }
    /** Infiltration model and parameters. */
    get infiltration() {
        return new InfiltrationView(this);
    }
    /** Land-use coverage fractions. */
    get coverage() {
        return new CoverageView(this);
    }
    /** Coverage fraction of every land use, in land-use order (one C call). */
    coverages() {
        const c = this._ctx();
        const n = c.raw.swmm_landuse_count(c.engine);
        if (n <= 0)
            return [];
        return Array.from(bulkRead(c.mod, n, (p, k) => c.raw.swmm_subcatch_get_coverages(c.engine, c.index, p, k)));
    }
    /** Initial pollutant loadings. */
    get loadings() {
        return new LoadingsView(this);
    }
}
// =============================================================================
// Subcatchments collection
// =============================================================================
/**
 * Iterable collection of all subcatchments in the current model.
 *
 * Obtain via {@link Solver.subcatchments}.
 *
 * @example
 * ```ts
 * for (const sc of solver.subcatchments) {
 *   console.log(sc.id, sc.runoff);
 * }
 * ```
 */
export class Subcatchments {
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
        /** @internal */
        this.generation = 0;
        this._mod = mod;
        this._raw = guardedRaw(mod, this._checkOwner);
        this._engine = engine;
    }
    // -------------------------------------------------------------------------
    // Collection interface
    // -------------------------------------------------------------------------
    /** Number of subcatchments in the model. */
    get length() {
        return this._raw.swmm_subcatch_count(this._engine);
    }
    /**
     * Look up a subcatchment by zero-based index or string ID.
     *
     * @throws {@link ElementNotFoundError} if not found.
     */
    get(indexOrId) {
        if (typeof indexOrId === "string") {
            const idx = this._raw.swmm_subcatch_index(this._engine, indexOrId);
            if (idx < 0)
                throw new ElementNotFoundError(indexOrId);
            return new Subcatchment(this._mod, this._engine, this, this.generation, idx);
        }
        const count = this.length;
        if (indexOrId < 0 || indexOrId >= count) {
            throw new ElementNotFoundError(indexOrId, `Subcatchment index ${indexOrId} out of range [0, ${count})`);
        }
        return new Subcatchment(this._mod, this._engine, this, this.generation, indexOrId);
    }
    /** True when a subcatchment with this index or id exists. */
    has(key) {
        if (typeof key === "string")
            return this.getIndex(key) >= 0;
        return Number.isInteger(key) && key >= 0 && key < this.length;
    }
    /** Every subcatchment id, in index order. */
    get ids() {
        return Array.from({ length: this.length }, (_, i) => this.getId(i));
    }
    /** Add a subcatchment; earlier subcatchment views become stale, as in Python. */
    add(subId) {
        raiseForCode(this._raw.swmm_subcatch_add(this._engine, subId));
        this.generation++;
        return this.get(subId);
    }
    /** Rename a subcatchment; references follow. Earlier views become stale. */
    rename(key, newId) {
        raiseForCode(this._raw.swmm_subcatch_rename(this._engine, this.get(key).index, newId));
        this.generation++;
    }
    /** Rainfall of every subcatchment. */
    get rainfalls() {
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_subcatch_get_rainfall_bulk(this._engine, p, n));
    }
    /** Evaporation of every subcatchment. */
    get evaps() {
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_subcatch_get_evap_bulk(this._engine, p, n));
    }
    /** Infiltration of every subcatchment. */
    get infils() {
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_subcatch_get_infil_bulk(this._engine, p, n));
    }
    /** Snow depth of every subcatchment. */
    get snowDepths() {
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_subcatch_get_snow_depth_bulk(this._engine, p, n));
    }
    /** Runoff concentration of a pollutant (by index or id) for every subcatchment. */
    qualities(pollutant) {
        const q = resolveIndex(this._raw, this._engine, "pollutant", pollutant);
        return bulkRead(this._mod, this.length, (p, n) => this._raw.swmm_subcatch_get_quality_bulk(this._engine, q, p, n));
    }
    /** A subcatchment's custom groundwater flow expression ({@link GwfType}). */
    getGwfExpression(key, gwfType) {
        const idx = this.get(key).index;
        return withCString(this._mod, 1024, (buf, len) => this._raw.swmm_subcatch_get_gwf_expression(this._engine, idx, gwfType, buf, len));
    }
    /** Set (or with `""` clear) a custom groundwater flow expression. */
    setGwfExpression(key, gwfType, expression) {
        const idx = this.get(key).index;
        raiseForCode(this._raw.swmm_subcatch_set_gwf_expression(this._engine, idx, gwfType, expression ?? ""));
    }
    /** Check an expression: `[ok, message, column]` (column -1 when ok). */
    validateGwfExpression(expression) {
        const p = checkedAlloc(this._mod, 512 + 4);
        try {
            this._mod.HEAPU8[p] = 0;
            this._mod.HEAP32[(p + 512) >> 2] = -1;
            const rc = this._raw.swmm_gwf_validate_expression(this._engine, expression, p, 512, p + 512);
            if (rc === 0)
                return [true, "", -1];
            return [false, this._mod.UTF8ToString(p, 512), this._mod.HEAP32[(p + 512) >> 2]];
        }
        finally {
            this._mod._free(p);
        }
    }
    /** Variables a groundwater expression may use: `[name, description]`. */
    gwfVariables() {
        const n = this._raw.swmm_gwf_variable_count(this._engine);
        return Array.from({ length: n }, (_, i) => [
            withCString(this._mod, 64, (buf, len) => this._raw.swmm_gwf_variable_name(this._engine, i, buf, len)),
            withCString(this._mod, 256, (buf, len) => this._raw.swmm_gwf_variable_description(this._engine, i, buf, len)),
        ]);
    }
    /** Functions a groundwater expression may call. */
    gwfFunctions() {
        const n = this._raw.swmm_gwf_function_count(this._engine);
        return Array.from({ length: n }, (_, i) => withCString(this._mod, 64, (buf, len) => this._raw.swmm_gwf_function_name(this._engine, i, buf, len)));
    }
    /** Return the zero-based index for a string subcatchment ID, or -1. */
    getIndex(id) {
        return this._raw.swmm_subcatch_index(this._engine, id);
    }
    /** Return the string ID for a zero-based subcatchment index. */
    getId(idx) {
        const id = this._raw.swmm_subcatch_id(this._engine, idx);
        if (!id)
            throw new ElementNotFoundError(idx, `Subcatchment index ${idx} out of range`);
        return id;
    }
    // -------------------------------------------------------------------------
    // Bulk array accessors
    // -------------------------------------------------------------------------
    /** Runoff rates of all subcatchments (flow units). */
    get runoffs() {
        const n = this.length;
        const result = new Float64Array(n);
        const ptr = checkedAlloc(this._mod, 8);
        try {
            for (let i = 0; i < n; i++) {
                raiseForCode(this._raw.swmm_subcatch_get_runoff(this._engine, i, ptr));
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
//# sourceMappingURL=Subcatchments.js.map