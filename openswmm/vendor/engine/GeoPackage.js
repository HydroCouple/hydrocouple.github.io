/**
 * @file GeoPackage.ts
 * @brief `GeoPackage`: SWMM GeoPackage databases — simulation results,
 *        observed series and read-only SQL (Python
 *        `openswmm.engine._geopackage`).
 *
 * Paths name files in the module's file system. The module is built with
 * SQLite and the GeoPackage plugin unless configured with
 * `-DOPENSWMM_WASM_GEOPACKAGE=OFF`.
 *
 * @license  Apache-2.0
 */
import { ElementNotFoundError, GeoPackageError, LifecycleError, StaleObjectError, } from "./errors.js";
import { checkedAlloc, rawOf, withCString } from "./mem.js";
const TRANSACTION_STATE = ["No active transaction", "Transaction already active"];
/** Transaction misuse is a {@link LifecycleError}; other failures a {@link GeoPackageError}. */
function gpkgError(what, detail) {
    if (TRANSACTION_STATE.includes(detail))
        return new LifecycleError(`${what}: ${detail}`);
    return new GeoPackageError(detail ? `${what}: ${detail}` : what);
}
/** GeoPackage database access for SWMM models, results and observed data. */
export class GeoPackage {
    /**
     * Open (or create) a GeoPackage file.
     *
     * @throws {@link GeoPackageError} if the file cannot be opened.
     */
    constructor(_mod, path) {
        this._mod = _mod;
        this._raw = rawOf(_mod);
        this._handle = this._raw.swmm_gpkg_open(path);
        if (!this._handle)
            throw gpkgError(`Failed to open GeoPackage ${path}`, "");
    }
    /** @internal */
    get _h() {
        if (!this._handle)
            throw new StaleObjectError("GeoPackage is closed");
        return this._handle;
    }
    /** Close the database; repeated calls are harmless. */
    close() {
        if (this._handle) {
            this._raw.swmm_gpkg_close(this._handle);
            this._handle = 0;
        }
    }
    [Symbol.dispose]() {
        this.close();
    }
    /** The library's last error message (`""` when none). */
    get lastError() {
        return this._raw.swmm_gpkg_last_error(this._h) ?? "";
    }
    // ---- transactions ------------------------------------------------------------
    /** Begin a transaction for bulk operations. */
    begin() {
        if (this._raw.swmm_gpkg_begin(this._h) !== 0) {
            throw gpkgError("Transaction begin failed", this.lastError);
        }
    }
    commit() {
        if (this._raw.swmm_gpkg_commit(this._h) !== 0) {
            throw gpkgError("Transaction commit failed", this.lastError);
        }
    }
    rollback() {
        if (this._raw.swmm_gpkg_rollback(this._h) !== 0) {
            throw gpkgError("Transaction rollback failed", this.lastError);
        }
    }
    // ---- simulations ------------------------------------------------------------------
    simulationCount() {
        return this._raw.swmm_gpkg_simulation_count(this._h);
    }
    /** Every simulation id (rows that cannot be read are skipped, as in Python). */
    simulationIds() {
        const h = this._h;
        const n = this._raw.swmm_gpkg_simulation_count(h);
        const ids = [];
        for (let i = 0; i < n; i++) {
            let ok = true;
            const id = withCString(this._mod, 256, (buf, len) => {
                ok = this._raw.swmm_gpkg_simulation_id(h, i, buf, len) === 0;
                return 0;
            });
            if (ok)
                ids.push(id);
        }
        return ids;
    }
    /** Object counts of a simulation. */
    objectCounts(simId) {
        const h = this._h;
        return {
            nodes: this._raw.swmm_gpkg_node_count(h, simId),
            links: this._raw.swmm_gpkg_link_count(h, simId),
            subcatchments: this._raw.swmm_gpkg_subcatch_count(h, simId),
            gages: this._raw.swmm_gpkg_gage_count(h, simId),
        };
    }
    /** Number of output variables defined. */
    variableCount() {
        return this._raw.swmm_gpkg_variable_count(this._h);
    }
    topologyEdgeCount(simId) {
        return this._raw.swmm_gpkg_topology_edge_count(this._h, simId);
    }
    // ---- results ---------------------------------------------------------------------
    /** Records of a result series; `objType` is NODE, LINK, SUBCATCH or SYSTEM. */
    resultTsCount(simId, objType, objId, variable) {
        return this._raw.swmm_gpkg_result_ts_count(this._h, simId, objType, objId, variable);
    }
    /** A result series as `[times, values]`. */
    readResultTs(simId, objType, objId, variable) {
        const h = this._h;
        const n = this._raw.swmm_gpkg_result_ts_count(h, simId, objType, objId, variable);
        if (n <= 0)
            return [new Float64Array(0), new Float64Array(0)];
        const mod = this._mod;
        const p = checkedAlloc(mod, 16 * n);
        try {
            const read = this._raw.swmm_gpkg_read_result_ts(h, simId, objType, objId, variable, p, p + 8 * n, n);
            const count = Math.max(0, Math.min(read, n));
            return [
                new Float64Array(mod.HEAPU8.buffer, p, count).slice(),
                new Float64Array(mod.HEAPU8.buffer, p + 8 * n, count).slice(),
            ];
        }
        finally {
            mod._free(p);
        }
    }
    /**
     * One summary statistic.
     *
     * @throws {@link ElementNotFoundError} if the summary does not exist.
     */
    readSummary(simId, objType, objId, variable) {
        const mod = this._mod;
        const p = checkedAlloc(mod, 8);
        try {
            mod.HEAPF64[p >> 3] = 0;
            if (this._raw.swmm_gpkg_read_summary(this._h, simId, objType, objId, variable, p) !== 0) {
                throw new ElementNotFoundError(`${objType}/${objId}/${variable}`, `Summary not found: ${objType}/${objId}/${variable}`);
            }
            return mod.HEAPF64[p >> 3];
        }
        finally {
            mod._free(p);
        }
    }
    // ---- observed data ----------------------------------------------------------------
    /** Create an observed series; empty optional fields are stored as none. Returns its id. */
    createObservedSeries(name, variable, objType = "", objId = "", source = "", units = "") {
        const sid = this._raw.swmm_gpkg_create_observed_series(this._h, name, variable, objType || null, objId || null, source || null, units || null);
        if (sid < 0)
            throw gpkgError("Failed to create series", this.lastError);
        return sid;
    }
    /** Write one observed value (ISO 8601 timestamp). */
    writeObservedValue(seriesId, timestamp, value, flag = "") {
        const rc = this._raw.swmm_gpkg_write_observed_value(this._h, seriesId, timestamp, value, flag || null);
        if (rc !== 0)
            throw gpkgError("Write failed", this.lastError);
    }
    /** Write many observed values (wrap in {@link begin}/{@link commit} for speed). */
    writeObservedValues(seriesId, timestamps, values, flags = null) {
        const n = timestamps.length;
        const h = this._h;
        if (values.length !== n)
            throw new RangeError("timestamps and values must have the same length");
        if (flags && flags.length !== 0 && flags.length !== n) {
            throw new RangeError("flags must be empty or match the timestamp count");
        }
        if (n === 0)
            return;
        const mod = this._mod;
        const useFlags = !!flags && flags.length > 0;
        const strings = [];
        const text = (s) => {
            const bytes = mod.lengthBytesUTF8(s) + 1;
            const p = checkedAlloc(mod, bytes);
            mod.stringToUTF8(s, p, bytes);
            strings.push(p);
            return p;
        };
        const ts = checkedAlloc(mod, 4 * n);
        const fl = checkedAlloc(mod, 4 * n);
        const vs = checkedAlloc(mod, 8 * n);
        try {
            for (let i = 0; i < n; i++) {
                mod.HEAPU32[(ts >> 2) + i] = text(timestamps[i]);
                mod.HEAPU32[(fl >> 2) + i] = useFlags ? text(flags[i]) : 0;
                mod.HEAPF64[(vs >> 3) + i] = values[i];
            }
            const rc = this._raw.swmm_gpkg_write_observed_values(h, seriesId, ts, vs, useFlags ? fl : 0, n);
            if (rc !== 0)
                throw gpkgError("Bulk write failed", this.lastError);
        }
        finally {
            for (const p of strings)
                mod._free(p);
            mod._free(ts);
            mod._free(fl);
            mod._free(vs);
        }
    }
    observedSeriesCount() {
        return this._raw.swmm_gpkg_observed_series_count(this._h);
    }
    observedValueCount(seriesId) {
        return this._raw.swmm_gpkg_observed_value_count(this._h, seriesId);
    }
    /** An observed series as `[ISO 8601 timestamps, values]`. */
    readObservedValues(seriesId) {
        const h = this._h;
        const n = this._raw.swmm_gpkg_observed_value_count(h, seriesId);
        if (n <= 0)
            return [[], new Float64Array(0)];
        const tsLen = 32;
        const mod = this._mod;
        const ts = checkedAlloc(mod, n * tsLen);
        const vs = checkedAlloc(mod, 8 * n);
        try {
            mod.HEAPU8.fill(0, ts, ts + n * tsLen);
            const read = Math.max(0, Math.min(this._raw.swmm_gpkg_read_observed_values(h, seriesId, ts, tsLen, vs, n), n));
            return [
                Array.from({ length: read }, (_, i) => mod.UTF8ToString(ts + i * tsLen, tsLen)),
                new Float64Array(mod.HEAPU8.buffer, vs, read).slice(),
            ];
        }
        finally {
            mod._free(ts);
            mod._free(vs);
        }
    }
    // ---- SQL ---------------------------------------------------------------------------
    /** First integer of a read-only SQL query. */
    queryInt(sql) {
        return this._raw.swmm_gpkg_query_int(this._h, sql);
    }
    /** First number of a read-only SQL query. */
    queryDouble(sql) {
        const mod = this._mod;
        const p = checkedAlloc(mod, 8);
        try {
            mod.HEAPF64[p >> 3] = 0;
            if (this._raw.swmm_gpkg_query_double(this._h, sql, p) !== 0) {
                throw gpkgError("Query failed", this.lastError);
            }
            return mod.HEAPF64[p >> 3];
        }
        finally {
            mod._free(p);
        }
    }
}
/** Register the GeoPackage plugin (Python `_geopackage.register`); empty fields are passed as none. */
export function registerGeoPackage(mod, key = "", org = "", email = "", deploy = "") {
    return (rawOf(mod).swmm_gpkg_register(key || null, org || null, email || null, deploy || null) !== 0);
}
/** Whether the GeoPackage plugin is registered (Python `_geopackage.is_registered`). */
export function isGeoPackageRegistered(mod) {
    return rawOf(mod).swmm_gpkg_is_registered() !== 0;
}
//# sourceMappingURL=GeoPackage.js.map