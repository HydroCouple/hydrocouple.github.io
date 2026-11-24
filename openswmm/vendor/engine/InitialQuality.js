/**
 * @file InitialQuality.ts
 * @brief `solver.initialQuality`: the `[INITIAL_QUALITY]` rows (Python
 *        `openswmm.engine._initial_quality`).
 *
 * Rows are snapshots in file order, keyed by (element, constituent). They seed
 * state at `initialize()`, so edits belong to the BUILDING/OPENED states.
 *
 * @license  Apache-2.0
 */
import { BadParamError, ElementNotFoundError, raiseForCode } from "./errors.js";
import { resolveIndex } from "./element.js";
import { checkedAlloc, withCString, withCStrings } from "./mem.js";
import { SolverView } from "./view.js";
/** `solver.initialQuality`. */
export class InitialQuality extends SolverView {
    constructor() {
        super(...arguments);
        /** Reserved constituent for water age (hours). */
        this.WATER_AGE = InitialQuality.WATER_AGE;
        /** Reserved constituent for temperature (degC). */
        this.TEMPERATURE = InitialQuality.TEMPERATURE;
    }
    /** Number of rows. */
    get length() {
        const n = this._raw.swmm_init_quality_count(this._h);
        if (n < 0)
            throw new ElementNotFoundError(n, "Invalid engine handle reading [INITIAL_QUALITY] count");
        return n;
    }
    /** @internal */
    _row(rowIndex) {
        const n = this.length;
        const i = rowIndex < 0 ? rowIndex + n : rowIndex;
        if (!Number.isInteger(i) || i < 0 || i >= n)
            throw new ElementNotFoundError(rowIndex);
        return i;
    }
    /** The row at `rowIndex` (negative counts from the end). */
    get(rowIndex) {
        const i = this._row(rowIndex);
        const out = checkedAlloc(this._mod, 16);
        try {
            const [constituent] = withCStrings(this._mod, 256, 1, ([buf], len) => this._raw.swmm_init_quality_get(this._h, i, out, out + 4, buf, len, out + 8));
            return {
                isLink: this._mod.HEAP32[out >> 2] !== 0,
                elemIndex: this._mod.HEAP32[(out + 4) >> 2],
                constituent,
                value: this._mod.HEAPF64[(out + 8) >> 3],
            };
        }
        finally {
            this._mod._free(out);
        }
    }
    [Symbol.iterator]() {
        return Array.from({ length: this.length }, (_, i) => this.get(i))[Symbol.iterator]();
    }
    /**
     * Add or update the row for (`node` or `link`, `constituent`). Pollutant
     * values must be non-negative; water age and temperature are signed.
     */
    set(constituent, value, { node, link }) {
        if ((node === undefined) === (link === undefined)) {
            throw new BadParamError("Pass exactly one of node or link to identify the element");
        }
        const h = this._h;
        const isLink = link !== undefined;
        const elem = isLink
            ? resolveIndex(this._raw, h, "link", link)
            : resolveIndex(this._raw, h, "node", node);
        raiseForCode(this._raw.swmm_init_quality_set(h, isLink ? 1 : 0, elem, constituent, value));
        this._solver._bumpGeneration();
    }
    /** Remove a row; later rows shift down by one. */
    remove(rowIndex) {
        raiseForCode(this._raw.swmm_init_quality_remove(this._h, rowIndex));
        this._solver._bumpGeneration();
    }
    /** Whether a row came from the initial-quality file rather than the `.inp`. */
    isFile(rowIndex) {
        return this._raw.swmm_init_quality_is_file(this._h, this._row(rowIndex)) !== 0;
    }
    /** The initial-quality file (`""` = none). */
    get filePath() {
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_init_quality_file_get(this._h, buf, len));
    }
    set filePath(path) {
        raiseForCode(this._raw.swmm_init_quality_file_set(this._h, path ?? ""));
    }
}
/** Reserved constituent for water age (hours). */
InitialQuality.WATER_AGE = "__WATER_AGE__";
/** Reserved constituent for temperature (degC). */
InitialQuality.TEMPERATURE = "__TEMPERATURE__";
//# sourceMappingURL=InitialQuality.js.map