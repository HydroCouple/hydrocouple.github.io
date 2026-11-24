/**
 * @file NamedObjects.ts
 * @brief `solver.aquifers` and `solver.snowpacks` (Python `Aquifers`,
 *        `Snowpacks` in `openswmm.engine._subcatchments`).
 *
 * Both collections hold named objects reached by index or id; the C API gives
 * count/index/id/add/rename plus per-kind parameters. Adding or renaming
 * invalidates the solver's views, as in Python.
 *
 * @license  Apache-2.0
 */
import { ElementNotFoundError, raiseForCode } from "./errors.js";
import { getDoubles, getText } from "./element.js";
import { guardedRaw, withDouble } from "./mem.js";
/** Collection of named objects (Python `_NamedObjects`). */
class NamedObjects {
    /** @internal */
    constructor(_solver) {
        this._solver = _solver;
        this._raw = guardedRaw(_solver.module, () => void _solver.handle);
    }
    /** @internal */
    get _h() {
        return this._solver.handle;
    }
    /** @internal Context for one object, by index or id. */
    _ctx(key) {
        return { mod: this._solver.module, raw: this._raw, engine: this._h, index: this._key(key) };
    }
    /** @internal */
    _key(key) {
        return typeof key === "number" ? key : this.getIndex(key);
    }
    /** Number of objects. */
    get length() {
        return this._count();
    }
    /** Index of an id. @throws ElementNotFoundError */
    getIndex(objId) {
        const i = this._index(objId);
        if (i < 0)
            throw new ElementNotFoundError(objId);
        return i;
    }
    /** Id at an index (`""` when out of range). */
    getId(idx) {
        return this._id(idx) ?? "";
    }
    /** True when an object with this index or id exists. */
    has(key) {
        if (typeof key === "string")
            return this._index(key) >= 0;
        return Number.isInteger(key) && key >= 0 && key < this._count();
    }
    /** The ids, in index order. */
    [Symbol.iterator]() {
        return Array.from({ length: this._count() }, (_, i) => this.getId(i))[Symbol.iterator]();
    }
    /** Add an object; returns its index. Invalidates the solver's views. */
    add(objId) {
        raiseForCode(this._add(objId));
        this._solver._bumpGeneration();
        return this._count() - 1;
    }
    /** Rename an object; references follow. Invalidates the solver's views. */
    rename(key, newId) {
        raiseForCode(this._rename(this._key(key), newId));
        this._solver._bumpGeneration();
    }
}
/** `solver.aquifers`: the `[AQUIFERS]` entries. */
export class Aquifers extends NamedObjects {
    _count() {
        return this._raw.swmm_aquifer_count(this._h);
    }
    _index(id) {
        return this._raw.swmm_aquifer_index(this._h, id);
    }
    _id(idx) {
        return this._raw.swmm_aquifer_id(this._h, idx);
    }
    _add(id) {
        return this._raw.swmm_aquifer_add(this._h, id);
    }
    _rename(idx, newId) {
        return this._raw.swmm_aquifer_rename(this._h, idx, newId);
    }
    /** One of the 12 numeric parameters ({@link AquiferParam}). */
    getParam(aquifer, param) {
        const idx = this._key(aquifer);
        return withDouble(this._solver.module, (p) => this._raw.swmm_aquifer_get_param(this._h, idx, param, p));
    }
    /**
     * Set a numeric parameter. Flux coefficients take effect on the next step
     * mid-run; structural and initial-condition parameters are pre-start only
     * (LifecycleError while running).
     */
    setParam(aquifer, param, value) {
        raiseForCode(this._raw.swmm_aquifer_set_param(this._h, this._key(aquifer), param, value));
    }
    /** Name of the aquifer's monthly evaporation pattern (`""` = none). */
    getEvapPattern(aquifer) {
        const c = this._ctx(aquifer);
        return getText(c, c.raw.swmm_aquifer_get_evap_pattern);
    }
    /** Set the evaporation pattern (pre-start only; `""` clears). */
    setEvapPattern(aquifer, name) {
        raiseForCode(this._raw.swmm_aquifer_set_evap_pattern(this._h, this._key(aquifer), name ?? ""));
    }
}
const SURFACE_FIELDS = ["cmin", "cmax", "tbase", "fwfrac", "sd0", "fw0", "last"];
const REMOVAL_FIELDS = ["dsnow", "fout", "fimp", "fperv", "fimelt", "fsubcatch"];
/** `solver.snowpacks`: the `[SNOWPACKS]` entries. */
export class Snowpacks extends NamedObjects {
    _count() {
        return this._raw.swmm_snowpack_count(this._h);
    }
    _index(id) {
        return this._raw.swmm_snowpack_index(this._h, id);
    }
    _id(idx) {
        return this._raw.swmm_snowpack_id(this._h, idx);
    }
    _add(id) {
        return this._raw.swmm_snowpack_add(this._h, id);
    }
    _rename(idx, newId) {
        return this._raw.swmm_snowpack_rename(this._h, idx, newId);
    }
    /** @internal */
    _getSurface(snowpack, fn) {
        const v = getDoubles(this._ctx(snowpack), 7, fn);
        return Object.fromEntries(SURFACE_FIELDS.map((k, i) => [k, v[i]]));
    }
    /** Plowable-area parameters. */
    getPlowable(snowpack) {
        return this._getSurface(snowpack, this._raw.swmm_snowpack_get_plowable);
    }
    /** Set the plowable-area parameters. */
    setPlowable(snowpack, s) {
        const v = SURFACE_FIELDS.map((k) => s[k]);
        raiseForCode(this._raw.swmm_snowpack_set_plowable(this._h, this._key(snowpack), ...v));
    }
    /** Impervious-area parameters. */
    getImpervious(snowpack) {
        return this._getSurface(snowpack, this._raw.swmm_snowpack_get_impervious);
    }
    /** Set the impervious-area parameters. */
    setImpervious(snowpack, s) {
        const v = SURFACE_FIELDS.map((k) => s[k]);
        raiseForCode(this._raw.swmm_snowpack_set_impervious(this._h, this._key(snowpack), ...v));
    }
    /** Pervious-area parameters. */
    getPervious(snowpack) {
        return this._getSurface(snowpack, this._raw.swmm_snowpack_get_pervious);
    }
    /** Set the pervious-area parameters. */
    setPervious(snowpack, s) {
        const v = SURFACE_FIELDS.map((k) => s[k]);
        raiseForCode(this._raw.swmm_snowpack_set_pervious(this._h, this._key(snowpack), ...v));
    }
    /** Removal (plowing) parameters. */
    getRemoval(snowpack) {
        const v = getDoubles(this._ctx(snowpack), 6, this._raw.swmm_snowpack_get_removal);
        return Object.fromEntries(REMOVAL_FIELDS.map((k, i) => [k, v[i]]));
    }
    /** Set the removal parameters. */
    setRemoval(snowpack, r) {
        const v = REMOVAL_FIELDS.map((k) => r[k]);
        raiseForCode(this._raw.swmm_snowpack_set_removal(this._h, this._key(snowpack), ...v));
    }
    /** Subcatchment that receives plowed snow (`""` = none). */
    getRemovalSubcatch(snowpack) {
        const c = this._ctx(snowpack);
        return getText(c, c.raw.swmm_snowpack_get_removal_subcatch);
    }
    /** Set (or with `""` clear) the subcatchment that receives plowed snow. */
    setRemovalSubcatch(snowpack, name) {
        raiseForCode(this._raw.swmm_snowpack_set_removal_subcatch(this._h, this._key(snowpack), name ?? ""));
    }
}
//# sourceMappingURL=NamedObjects.js.map