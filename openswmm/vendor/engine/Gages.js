/**
 * @file Gages.ts
 * @brief Rain gage collection and individual gage accessor.
 *
 * @details Mirrors the Python `_gages.pyi` binding specification.
 *
 * @author   Caleb Buahin <caleb.buahin@gmail.com>
 * @copyright Copyright (c) 2026 Caleb Buahin. All rights reserved.
 * @license  Apache-2.0
 */
import { ElementNotFoundError, StaleObjectError, raiseForCode } from "./errors.js";
import { checkedAlloc, guardedRaw, withCString } from "./mem.js";
import { oadateToDatetime } from "./dates.js";
// =============================================================================
// Gage
// =============================================================================
/**
 * Accessor for a single SWMM rain gage.
 *
 * Obtain instances via {@link Gages.get} — do not construct directly.
 */
export class Gage {
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
    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------
    /** String identifier of this gage. */
    get id() {
        this._checkStale();
        return this._raw.swmm_gage_id(this._engine, this.index);
    }
    // -------------------------------------------------------------------------
    // Configuration (read)
    // -------------------------------------------------------------------------
    /** Rainfall data format ({@link GageRainType}). */
    get rainType() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_gage_get_rain_type(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    set rainType(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_rain_type(this._engine, this.index, value));
    }
    /** Data source ({@link GageDataSource}). */
    get dataSource() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_gage_get_data_source(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    set dataSource(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_data_source(this._engine, this.index, value));
    }
    /** Multiplier applied to all recorded rainfall values. */
    get scaleFactor() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_gage_get_scale_factor(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Set the scale factor. */
    set scaleFactor(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_scale_factor(this._engine, this.index, value));
    }
    /** Recording interval (seconds). */
    get rainInterval() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_gage_get_rain_interval(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    set rainInterval(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_rain_interval(this._engine, this.index, value));
    }
    /** Snow catch correction factor. */
    get snowFactor() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_gage_get_snow_factor(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    set snowFactor(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_snow_factor(this._engine, this.index, value));
    }
    /** Rain depth unit for a file source: 0 = inches, 1 = millimeters. */
    get rainUnits() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_gage_get_rain_units(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    set rainUnits(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_rain_units(this._engine, this.index, value));
    }
    /** Assigned time series identifier. */
    get timeseries() {
        this._checkStale();
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_gage_get_timeseries(this._engine, this.index, buf, len));
    }
    set timeseries(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_timeseries(this._engine, this.index, value));
    }
    get stationId() {
        this._checkStale();
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_gage_get_station_id(this._engine, this.index, buf, len));
    }
    set stationId(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_station_id(this._engine, this.index, value));
    }
    get fileColumn() {
        this._checkStale();
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_gage_get_file_column(this._engine, this.index, buf, len));
    }
    set fileColumn(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_file_column(this._engine, this.index, value));
    }
    get fileFormat() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_gage_get_file_format(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    set fileFormat(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_file_format(this._engine, this.index, value));
    }
    /** Select a rainfall file and optional station identifier. */
    setFilename(path, stationId = "") {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_filename(this._engine, this.index, path, stationId));
    }
    /**
     * Read rainfall from an external file (Python `set_file`). `column` picks a
     * column of a multi-column CSV/TSV/TSF file (the `FILE "path:col"` form).
     */
    setFile(path, stationId, column) {
        this.setFilename(path, stationId);
        if (column !== undefined) {
            raiseForCode(this._raw.swmm_gage_set_file_column(this._engine, this.index, column));
        }
    }
    /** Read rainfall from a named time series (Python `set_timeseries`). */
    setTimeseries(tsId) {
        this.timeseries = tsId;
    }
    /** Set the rain interval in seconds (Python `set_rain_interval`). */
    setRainInterval(seconds) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_rain_interval(this._engine, this.index, seconds));
    }
    /** The gage's rainfall as `[time, value]` rows (times in whole seconds, UTC). */
    get rainfallSeries() {
        this._checkStale();
        const n = (() => {
            const p = checkedAlloc(this._mod, 4);
            try {
                raiseForCode(this._raw.swmm_gage_get_rainfall_series_count(this._engine, this.index, p));
                return this._mod.HEAP32[p >> 2];
            }
            finally {
                this._mod._free(p);
            }
        })();
        if (n === 0)
            return [];
        const block = checkedAlloc(this._mod, 16 * n);
        try {
            raiseForCode(this._raw.swmm_gage_get_rainfall_series(this._engine, this.index, block, block + 8 * n, n));
            const base = block >> 3;
            return Array.from({ length: n }, (_, i) => {
                const t = oadateToDatetime(this._mod.HEAPF64[base + i]);
                t.setUTCMilliseconds(0);
                return [t, this._mod.HEAPF64[base + n + i]];
            });
        }
        finally {
            this._mod._free(block);
        }
    }
    /** The solver (or model builder) this gage belongs to. */
    get solver() {
        return this._collection.solver;
    }
    // -------------------------------------------------------------------------
    // Runtime state
    // -------------------------------------------------------------------------
    /** Current rainfall rate at this gage (in/hr or mm/hr). */
    get rainfall() {
        this._checkStale();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_gage_get_rainfall(this._engine, this.index, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Set the current rainfall rate (used for direct forcing). */
    set rainfall(value) {
        this._checkStale();
        raiseForCode(this._raw.swmm_gage_set_rainfall(this._engine, this.index, value));
    }
}
// =============================================================================
// Gages collection
// =============================================================================
/**
 * Iterable collection of all rain gages in the current model.
 *
 * Obtain via {@link Solver.gages}.
 *
 * @example
 * ```ts
 * for (const gage of solver.gages) {
 *   console.log(gage.id, gage.rainfall);
 * }
 * ```
 */
export class Gages {
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
    /** Number of rain gages in the model. */
    get length() {
        return this._raw.swmm_gage_count(this._engine);
    }
    /**
     * Look up a gage by zero-based index or string ID.
     *
     * @throws {@link ElementNotFoundError} if not found.
     */
    get(indexOrId) {
        if (typeof indexOrId === "string") {
            const idx = this._raw.swmm_gage_index(this._engine, indexOrId);
            if (idx < 0)
                throw new ElementNotFoundError(indexOrId);
            return new Gage(this._mod, this._engine, this, this.generation, idx);
        }
        const count = this.length;
        if (indexOrId < 0 || indexOrId >= count) {
            throw new ElementNotFoundError(indexOrId, `Gage index ${indexOrId} out of range [0, ${count})`);
        }
        return new Gage(this._mod, this._engine, this, this.generation, indexOrId);
    }
    /** True when a gage with this index or id exists. */
    has(key) {
        if (typeof key === "string")
            return this.getIndex(key) >= 0;
        return Number.isInteger(key) && key >= 0 && key < this.length;
    }
    /** Every gage id, in index order. */
    get ids() {
        return Array.from({ length: this.length }, (_, i) => this.getId(i));
    }
    /** Add a rain gage; earlier gage views become stale, as in Python. */
    add(gageId) {
        raiseForCode(this._raw.swmm_gage_add(this._engine, gageId));
        this.generation++;
        return this.get(gageId);
    }
    /** Rename a gage; references follow. Earlier gage views become stale. */
    rename(key, newId) {
        const idx = this.get(key).index;
        raiseForCode(this._raw.swmm_gage_rename(this._engine, idx, newId));
        this.generation++;
    }
    /** Re-read every gage's rain file. Earlier gage views become stale. */
    reloadRainFiles() {
        raiseForCode(this._raw.swmm_gage_reload_rain_files(this._engine));
        this.generation++;
    }
    /** Return the zero-based index for a string gage ID, or -1. */
    getIndex(id) {
        return this._raw.swmm_gage_index(this._engine, id);
    }
    /** Return the string ID for a zero-based gage index. */
    getId(idx) {
        const id = this._raw.swmm_gage_id(this._engine, idx);
        if (!id)
            throw new ElementNotFoundError(idx, `Gage index ${idx} out of range`);
        return id;
    }
    // -------------------------------------------------------------------------
    // Bulk array accessors
    // -------------------------------------------------------------------------
    /** Current rainfall rates of all gages (in/hr or mm/hr). */
    get rainfalls() {
        const n = this.length;
        const result = new Float64Array(n);
        const ptr = checkedAlloc(this._mod, 8);
        try {
            for (let i = 0; i < n; i++) {
                raiseForCode(this._raw.swmm_gage_get_rainfall(this._engine, i, ptr));
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
//# sourceMappingURL=Gages.js.map