/**
 * @file Pollutants.ts
 * @brief `solver.pollutants` (Python `openswmm.engine._pollutants`).
 *
 * @license  Apache-2.0
 */
import { ConcentrationUnits } from "./enums.js";
import { ElementNotFoundError, raiseForCode } from "./errors.js";
import { getDouble, getInt, resolveIndex } from "./element.js";
import { checkedAlloc } from "./mem.js";
import { SolverView } from "./view.js";
/** One `[POLLUTANTS]` entry; stale after pollutants are added or renamed. */
export class Pollutant extends SolverView {
    /** @internal */
    constructor(solver, 
    /** Zero-based index in {@link Pollutants}. */
    index) {
        super(solver, true);
        this.index = index;
    }
    /** @internal */
    _c() {
        return { mod: this._mod, raw: this._raw, engine: this._h, index: this.index };
    }
    /** @internal */
    _getD(fn) {
        return getDouble(this._c(), fn);
    }
    /** Pollutant id. */
    get id() {
        return this._raw.swmm_pollutant_id(this._h, this.index) ?? "";
    }
    /** Concentration units ({@link ConcentrationUnits}). */
    get units() {
        const c = this._c();
        return getInt(c, c.raw.swmm_pollutant_get_units);
    }
    set units(value) {
        raiseForCode(this._raw.swmm_pollutant_set_units(this._h, this.index, value));
    }
    /** First-order decay coefficient (1/days). */
    get kdecay() {
        return this._getD(this._raw.swmm_pollutant_get_kdecay);
    }
    set kdecay(value) {
        raiseForCode(this._raw.swmm_pollutant_set_kdecay(this._h, this.index, value));
    }
    /** Molecular weight. */
    get mwt() {
        return this._getD(this._raw.swmm_pollutant_get_mwt);
    }
    set mwt(value) {
        raiseForCode(this._raw.swmm_pollutant_set_mwt(this._h, this.index, value));
    }
    /** Concentration in rainfall. */
    get rainConc() {
        return this._getD(this._raw.swmm_pollutant_get_rain_conc);
    }
    set rainConc(value) {
        raiseForCode(this._raw.swmm_pollutant_set_rain_conc(this._h, this.index, value));
    }
    /** Concentration in groundwater. */
    get gwConc() {
        return this._getD(this._raw.swmm_pollutant_get_gw_conc);
    }
    set gwConc(value) {
        raiseForCode(this._raw.swmm_pollutant_set_gw_conc(this._h, this.index, value));
    }
    /** Initial concentration throughout the conveyance system. */
    get initConc() {
        return this._getD(this._raw.swmm_pollutant_get_init_conc);
    }
    set initConc(value) {
        raiseForCode(this._raw.swmm_pollutant_set_init_conc(this._h, this.index, value));
    }
    /** Concentration in RDII. */
    get rdiiConc() {
        return this._getD(this._raw.swmm_pollutant_get_rdii_conc);
    }
    set rdiiConc(value) {
        raiseForCode(this._raw.swmm_pollutant_set_rdii_conc(this._h, this.index, value));
    }
    /** Concentration in dry-weather flow. */
    get dwfConc() {
        return this._getD(this._raw.swmm_pollutant_get_dwf_conc);
    }
    set dwfConc(value) {
        raiseForCode(this._raw.swmm_pollutant_set_dwf_conc(this._h, this.index, value));
    }
    /** Whether buildup happens only during snowfall. */
    get snowOnly() {
        const c = this._c();
        return getInt(c, c.raw.swmm_pollutant_get_snow_only) !== 0;
    }
    set snowOnly(value) {
        raiseForCode(this._raw.swmm_pollutant_set_snow_only(this._h, this.index, value ? 1 : 0));
    }
    /** `[co-pollutant, fraction]`, or `null` when there is none. */
    get coPollutant() {
        const p = checkedAlloc(this._mod, 16);
        try {
            raiseForCode(this._raw.swmm_pollutant_get_co_pollutant(this._h, this.index, p, p + 8));
            const co = this._mod.HEAP32[p >> 2];
            return co < 0 ? null : [new Pollutant(this._solver, co), this._mod.HEAPF64[(p + 8) >> 3]];
        }
        finally {
            this._mod._free(p);
        }
    }
    /** Make this pollutant a fraction of another's runoff concentration. */
    setCoPollutant(co, fraction) {
        const coIdx = co instanceof Pollutant ? co.index : resolveIndex(this._raw, this._h, "pollutant", co);
        raiseForCode(this._raw.swmm_pollutant_set_co_pollutant(this._h, this.index, coIdx, fraction));
    }
}
/** `solver.pollutants`: the `[POLLUTANTS]` entries by index or id. */
export class Pollutants extends SolverView {
    /** Number of pollutants. */
    get length() {
        return this._raw.swmm_pollutant_count(this._h);
    }
    /** @internal */
    _resolve(key) {
        const i = resolveIndex(this._raw, this._h, "pollutant", key);
        if (i < 0 || i >= this.length)
            throw new ElementNotFoundError(key);
        return i;
    }
    /** The pollutant at an index or id. */
    get(key) {
        return new Pollutant(this._solver, this._resolve(key));
    }
    /** True when a pollutant with this index or id exists. */
    has(key) {
        try {
            this._resolve(key);
            return true;
        }
        catch (err) {
            if (err instanceof ElementNotFoundError)
                return false;
            throw err;
        }
    }
    [Symbol.iterator]() {
        return Array.from({ length: this.length }, (_, i) => new Pollutant(this._solver, i))[Symbol.iterator]();
    }
    /** Index of a pollutant id. @throws ElementNotFoundError */
    getIndex(pollutId) {
        return this._resolve(pollutId);
    }
    /** Id at an index. @throws ElementNotFoundError */
    getId(idx) {
        return this._raw.swmm_pollutant_id(this._h, this._resolve(idx));
    }
    /** Add a pollutant; earlier views become stale, as in Python. */
    add(pollutId, units = ConcentrationUnits.MG_PER_L) {
        raiseForCode(this._raw.swmm_pollutant_add(this._h, pollutId, units));
        this._solver._bumpGeneration();
        return this.get(pollutId);
    }
    /** Rename a pollutant; references follow. Earlier views become stale. */
    rename(key, newId) {
        raiseForCode(this._raw.swmm_pollutant_rename(this._h, this._resolve(key), newId));
        this._solver._bumpGeneration();
    }
    /** Set a node's concentration of a pollutant. */
    setNodeQuality(node, pollutant, conc) {
        const n = resolveIndex(this._raw, this._h, "node", node);
        raiseForCode(this._raw.swmm_node_set_quality(this._h, n, this._resolve(pollutant), conc));
    }
    /** Set a link's concentration of a pollutant. */
    setLinkQuality(link, pollutant, conc) {
        const l = resolveIndex(this._raw, this._h, "link", link);
        raiseForCode(this._raw.swmm_link_set_quality(this._h, l, this._resolve(pollutant), conc));
    }
}
//# sourceMappingURL=Pollutants.js.map