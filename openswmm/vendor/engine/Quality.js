/**
 * @file Quality.ts
 * @brief `solver.quality` and its land uses (Python `openswmm.engine._quality`).
 *
 * Buildup and washoff are per (land use, constituent), where the constituent
 * is a pollutant or a reaction species; treatment is per (node, pollutant).
 *
 * @license  Apache-2.0
 */
import { ElementNotFoundError, raiseForCode } from "./errors.js";
import { getDouble, resolveIndex, resolveSurfaceSpecies } from "./element.js";
import { checkedAlloc, withCString } from "./mem.js";
import { SolverView } from "./view.js";
/** One `[LANDUSES]` entry. */
export class Landuse extends SolverView {
    /** @internal */
    constructor(solver, 
    /** Zero-based index in {@link Landuses}. */
    index) {
        super(solver);
        this.index = index;
    }
    /** Land use id. */
    get id() {
        return this._raw.swmm_landuse_id(this._h, this.index) ?? "";
    }
    /** Days between street sweepings. */
    get sweepInterval() {
        return getDouble({ mod: this._mod, raw: this._raw, engine: this._h, index: this.index }, this._raw.swmm_landuse_get_sweep_interval);
    }
    set sweepInterval(value) {
        raiseForCode(this._raw.swmm_landuse_set_sweep_interval(this._h, this.index, value));
    }
    /** Fraction of buildup available for sweeping. */
    get sweepRemoval() {
        return getDouble({ mod: this._mod, raw: this._raw, engine: this._h, index: this.index }, this._raw.swmm_landuse_get_sweep_removal);
    }
    set sweepRemoval(value) {
        raiseForCode(this._raw.swmm_landuse_set_sweep_removal(this._h, this.index, value));
    }
    /** Rename the land use. */
    rename(newId) {
        raiseForCode(this._raw.swmm_landuse_rename(this._h, this.index, newId));
    }
}
/** The `[LANDUSES]` entries by index or id (`solver.quality.landuses`). */
export class Landuses extends SolverView {
    /** Number of land uses. */
    get length() {
        return this._raw.swmm_landuse_count(this._h);
    }
    /** @internal */
    _resolve(key) {
        const i = resolveIndex(this._raw, this._h, "landuse", key);
        if (i < 0 || i >= this.length)
            throw new ElementNotFoundError(key);
        return i;
    }
    /** The land use at an index or id. */
    get(key) {
        return new Landuse(this._solver, this._resolve(key));
    }
    /** True when a land use with this index or id exists. */
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
        return Array.from({ length: this.length }, (_, i) => new Landuse(this._solver, i))[Symbol.iterator]();
    }
    /** Index of a land use id. @throws ElementNotFoundError */
    getIndex(landuseId) {
        return this._resolve(landuseId);
    }
    /** Id at an index. @throws ElementNotFoundError */
    getId(idx) {
        return this._raw.swmm_landuse_id(this._h, this._resolve(idx));
    }
    /** Add a land use; invalidates the solver's views, as in Python. */
    add(landuseId) {
        raiseForCode(this._raw.swmm_landuse_add(this._h, landuseId));
        this._solver._bumpGeneration();
        return this.get(landuseId);
    }
}
/** `solver.quality`: buildup, washoff and treatment. */
export class Quality extends SolverView {
    /** The land uses. */
    get landuses() {
        return new Landuses(this._solver);
    }
    /** @internal */
    _keys(landuse, constituent) {
        const h = this._h;
        return [
            resolveIndex(this._raw, h, "landuse", landuse),
            resolveSurfaceSpecies(this._mod, this._raw, h, constituent),
        ];
    }
    /** Set the buildup of a constituent on a land use. */
    setBuildup(landuse, pollutant, { func, c1, c2, c3, normalizer = 0 }) {
        const [lu, p] = this._keys(landuse, pollutant);
        raiseForCode(this._raw.swmm_buildup_set(this._h, lu, p, func, c1, c2, c3, normalizer));
    }
    /** The buildup of a constituent on a land use. */
    getBuildup(landuse, pollutant) {
        const [lu, p] = this._keys(landuse, pollutant);
        const b = checkedAlloc(this._mod, 32 + 8);
        try {
            raiseForCode(this._raw.swmm_buildup_get(this._h, lu, p, b, b + 8, b + 16, b + 24, b + 32));
            const f = this._mod.HEAPF64;
            return {
                func: this._mod.HEAP32[b >> 2],
                c1: f[(b + 8) >> 3],
                c2: f[(b + 16) >> 3],
                c3: f[(b + 24) >> 3],
                normalizer: this._mod.HEAP32[(b + 32) >> 2],
            };
        }
        finally {
            this._mod._free(b);
        }
    }
    /** Set the washoff of a constituent from a land use. */
    setWashoff(landuse, pollutant, { func, coeff, expon, sweep_effic = 0, bmp_effic = 0, }) {
        const [lu, p] = this._keys(landuse, pollutant);
        raiseForCode(this._raw.swmm_washoff_set(this._h, lu, p, func, coeff, expon, sweep_effic, bmp_effic));
    }
    /** The washoff of a constituent from a land use. */
    getWashoff(landuse, pollutant) {
        const [lu, p] = this._keys(landuse, pollutant);
        const b = checkedAlloc(this._mod, 40);
        try {
            raiseForCode(this._raw.swmm_washoff_get(this._h, lu, p, b, b + 8, b + 16, b + 24, b + 32));
            const f = this._mod.HEAPF64;
            return {
                func: this._mod.HEAP32[b >> 2],
                coeff: f[(b + 8) >> 3],
                expon: f[(b + 16) >> 3],
                sweep_effic: f[(b + 24) >> 3],
                bmp_effic: f[(b + 32) >> 3],
            };
        }
        finally {
            this._mod._free(b);
        }
    }
    /** @internal */
    _nodePollutant(node, pollutant) {
        const h = this._h;
        return [
            resolveIndex(this._raw, h, "node", node),
            resolveIndex(this._raw, h, "pollutant", pollutant),
        ];
    }
    /** Set a node's treatment expression for a pollutant. */
    setTreatment(node, pollutant, expression) {
        const [n, p] = this._nodePollutant(node, pollutant);
        raiseForCode(this._raw.swmm_treatment_set(this._h, n, p, expression));
    }
    /** A node's treatment expression for a pollutant (`""` = none). */
    getTreatment(node, pollutant) {
        const [n, p] = this._nodePollutant(node, pollutant);
        return withCString(this._mod, 1024, (buf, len) => this._raw.swmm_treatment_get(this._h, n, p, buf, len));
    }
    /** Remove a node's treatment of a pollutant. */
    clearTreatment(node, pollutant) {
        const [n, p] = this._nodePollutant(node, pollutant);
        raiseForCode(this._raw.swmm_treatment_clear(this._h, n, p));
    }
    /** Check a treatment expression: `[ok, message, column]` (column -1 when ok). */
    validateTreatmentExpression(expression) {
        const p = checkedAlloc(this._mod, 512 + 4);
        try {
            this._mod.HEAPU8[p] = 0;
            this._mod.HEAP32[(p + 512) >> 2] = -1;
            const rc = this._raw.swmm_treatment_validate_expression(this._h, expression, p, 512, p + 512);
            if (rc === 0)
                return [true, "", -1];
            return [false, this._mod.UTF8ToString(p, 512), this._mod.HEAP32[(p + 512) >> 2]];
        }
        finally {
            this._mod._free(p);
        }
    }
}
//# sourceMappingURL=Quality.js.map