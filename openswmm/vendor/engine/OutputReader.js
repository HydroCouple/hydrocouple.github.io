/**
 * @file OutputReader.ts
 * @brief `OutputReader`: read a SWMM binary `.out` file independently of a
 *        solver (Python `openswmm.engine._output_reader`).
 *
 * Results are float32 as stored in the file. Objects are selected by index or
 * id; time series take an inclusive period range.
 *
 * @license  Apache-2.0
 */
import { ErrorCode, OutLinkVar, OutNodeVar, OutSubcatchVar, } from "./enums.js";
import { oadateToDatetime } from "./dates.js";
import { ElementNotFoundError, FileError, StaleObjectError, raiseForCode } from "./errors.js";
import { checkedAlloc, rawOf, withDouble } from "./mem.js";
import { MS_PER_DAY } from "./units.js";
const OA_EPOCH_MS = Date.UTC(1899, 11, 30);
/** A SWMM DateTime as a `Date`, truncated to the whole second like Python. */
function periodDate(value) {
    const day = Math.floor(value);
    const us = Math.round((value - day) * MS_PER_DAY * 1000);
    return new Date(OA_EPOCH_MS + day * MS_PER_DAY + Math.floor(us / 1e6) * 1000);
}
/** Flooding statistics of one node, re-derived from the file's report samples. */
export class OutputNodeStats {
    /** @internal */
    constructor(_reader, _index) {
        this._reader = _reader;
        this._index = _index;
    }
    /** @internal */
    _get(fn) {
        const r = this._reader;
        return withDouble(r.module, (p) => fn(r._handleOrThrow(), this._index, p));
    }
    get maxDepth() {
        return this._get(this._reader._raw.swmm_output_get_node_stat_max_depth);
    }
    get maxOverflow() {
        return this._get(this._reader._raw.swmm_output_get_node_stat_max_overflow);
    }
    get volFlooded() {
        return this._get(this._reader._raw.swmm_output_get_node_stat_vol_flooded);
    }
    /** Cumulative flooded duration in seconds. */
    get timeFlooded() {
        return this._get(this._reader._raw.swmm_output_get_node_stat_time_flooded);
    }
}
/** Read a SWMM binary `.out` file. */
export class OutputReader {
    /**
     * Open an output file. With `live`, read a file still being written and
     * call {@link refresh} for new periods.
     *
     * @throws {@link FileError} if the file cannot be opened.
     */
    constructor(module, path, { live = false } = {}) {
        this.module = module;
        this._ids = {};
        this._periodTimes = null;
        this._raw = rawOf(module);
        this._handle = live ? this._raw.swmm_output_open_live(path) : this._raw.swmm_output_open(path);
        if (!this._handle) {
            throw new FileError(ErrorCode.OUTFILE, `cannot open output file: ${path}`);
        }
    }
    /** @internal */
    _handleOrThrow() {
        if (!this._handle)
            throw new StaleObjectError("OutputReader is closed");
        return this._handle;
    }
    /** @internal */
    get _h() {
        return this._handleOrThrow();
    }
    /** Close the file and release its handle. */
    close() {
        if (this._handle) {
            this._raw.swmm_output_close(this._handle);
            this._handle = 0;
        }
    }
    [Symbol.dispose]() {
        this.close();
    }
    /** Whether the file holds a core or optional subcatchment variable. */
    hasSubcatchVariable(code) {
        return this._raw.swmm_output_has_subcatch_variable(this._h, code) !== 0;
    }
    /** Whether the reader is waiting for the writer's closing records. */
    get isLive() {
        return this._raw.swmm_output_is_live(this._h) !== 0;
    }
    /**
     * Pick up completed periods (and the closing records once written). Returns
     * the available period count. Does not modify the file.
     */
    refresh() {
        const mod = this.module;
        const p = checkedAlloc(mod, 4);
        try {
            mod.HEAP32[p >> 2] = 0;
            if (this._raw.swmm_output_refresh(this._h, p)) {
                throw new Error("Unable to refresh output file");
            }
            this._periodTimes = null;
            return mod.HEAP32[p >> 2];
        }
        finally {
            mod._free(p);
        }
    }
    // ---- metadata -------------------------------------------------------------
    get version() {
        return this._raw.swmm_output_get_version(this._h);
    }
    get flowUnits() {
        return this._raw.swmm_output_get_flow_units(this._h);
    }
    get periodCount() {
        return this._raw.swmm_output_get_period_count(this._h);
    }
    /** Reporting time step in seconds (Python `timedelta`). */
    get reportStep() {
        return this._raw.swmm_output_get_report_step(this._h);
    }
    get startDatetime() {
        return oadateToDatetime(withDouble(this.module, (p) => this._raw.swmm_output_get_start_date(this._h, p)));
    }
    get pollutantCount() {
        return this._raw.swmm_output_get_pollut_count(this._h);
    }
    get nodeCount() {
        return this._raw.swmm_output_get_node_count(this._h);
    }
    get linkCount() {
        return this._raw.swmm_output_get_link_count(this._h);
    }
    get subcatchmentCount() {
        return this._raw.swmm_output_get_subcatch_count(this._h);
    }
    /** SWMM error code stored in the file footer (0 = clean run). */
    get errorCode() {
        return this._raw.swmm_output_get_error_code(this._h);
    }
    // ---- object ids -------------------------------------------------------------
    /** @internal */
    _idList(kind) {
        const h = this._h;
        let ids = this._ids[kind];
        if (!ids) {
            const raw = this._raw;
            const [count, get] = {
                node: [raw.swmm_output_get_node_count, raw.swmm_output_get_node_id],
                link: [raw.swmm_output_get_link_count, raw.swmm_output_get_link_id],
                subcatchment: [raw.swmm_output_get_subcatch_count, raw.swmm_output_get_subcatch_id],
                pollutant: [raw.swmm_output_get_pollut_count, raw.swmm_output_get_pollut_id],
            }[kind];
            ids = Array.from({ length: count(h) }, (_, i) => get(h, i) ?? "");
            this._ids[kind] = ids;
        }
        return [...ids];
    }
    get nodeIds() {
        return this._idList("node");
    }
    get linkIds() {
        return this._idList("link");
    }
    get subcatchmentIds() {
        return this._idList("subcatchment");
    }
    /**
     * Species (pollutant) column names in column order. The water-age column
     * (`__WATER_AGE__`, in hours) reuses a concentration unit code, so key on
     * the name, not the unit code.
     */
    get pollutantIds() {
        return this._idList("pollutant");
    }
    /** Unit labels in species-column order, including reserved age/heat. */
    get pollutantUnits() {
        const h = this._h;
        const labels = { 0: "mg/L", 1: "ug/L", 2: "count/L" };
        const reserved = { __WATER_AGE__: "h", __TEMPERATURE__: "degC" };
        return this.pollutantIds.map((name, i) => reserved[name] ?? labels[this._raw.swmm_output_get_pollut_units(h, i)] ?? null);
    }
    // ---- time axis ----------------------------------------------------------------
    /** Every reporting period's time (whole seconds). Cached; a copy is returned. */
    get periodTimes() {
        const h = this._h;
        if (!this._periodTimes) {
            const n = this._raw.swmm_output_get_period_count(h);
            this._periodTimes = Array.from({ length: n }, (_, i) => periodDate(withDouble(this.module, (p) => this._raw.swmm_output_get_period_time(h, i, p))));
        }
        return this._periodTimes.map((d) => new Date(d.getTime()));
    }
    // ---- index resolution ------------------------------------------------------------
    /** @internal */
    _resolve(key, kind) {
        if (typeof key === "string") {
            const idx = this._idList(kind).indexOf(key);
            if (idx < 0)
                throw new ElementNotFoundError(key);
            return idx;
        }
        if (typeof key !== "number" || !Number.isInteger(key)) {
            throw new TypeError(`${kind} key must be int or str, got ${typeof key}`);
        }
        const count = {
            node: this.nodeCount,
            link: this.linkCount,
            subcatchment: this.subcatchmentCount,
        }[kind];
        if (key < 0 || key >= count) {
            throw new RangeError(`${kind} index ${key} out of range [0, ${count})`);
        }
        return key;
    }
    /** @internal */
    _floats(n, fill) {
        const mod = this.module;
        const p = checkedAlloc(mod, Math.max(4 * n, 4));
        try {
            raiseForCode(fill(p));
            return new Float32Array(mod.HEAPU8.buffer, p, n).slice();
        }
        finally {
            mod._free(p);
        }
    }
    // ---- per-period results -------------------------------------------------------------
    /** Every node's value of `variable` at `period`. */
    nodeResult(period, variable) {
        const h = this._h;
        return this._floats(this.nodeCount, (p) => this._raw.swmm_output_get_node_result(h, period, variable, p));
    }
    /** Every link's value of `variable` at `period`. */
    linkResult(period, variable) {
        const h = this._h;
        return this._floats(this.linkCount, (p) => this._raw.swmm_output_get_link_result(h, period, variable, p));
    }
    /** Every subcatchment's value of `variable` at `period`. */
    subcatchmentResult(period, variable) {
        const h = this._h;
        return this._floats(this.subcatchmentCount, (p) => this._raw.swmm_output_get_subcatch_result(h, period, variable, p));
    }
    /** The system-wide value of `variable` at `period`. */
    systemResult(period, variable) {
        const h = this._h;
        return this._floats(1, (p) => this._raw.swmm_output_get_system_result(h, period, variable, p))[0];
    }
    // ---- time series -------------------------------------------------------------------
    /** @internal */
    _range({ start, end }) {
        const n = this.periodCount;
        const s = start ?? 0;
        const e = end ?? n - 1;
        if (!(s >= 0 && s <= e && e <= n - 1)) {
            throw new RangeError(`period range [${s}, ${e}] out of [0, ${n - 1}]`);
        }
        return [s, e];
    }
    /** `variable` of one node over the reporting window (inclusive range). */
    nodeSeries(node, variable, range = {}) {
        const idx = this._resolve(node, "node");
        const [s, e] = this._range(range);
        const h = this._h;
        return this._floats(e - s + 1, (p) => this._raw.swmm_output_get_node_series(h, idx, variable, s, e, p));
    }
    /** `variable` of one link over the reporting window (inclusive range). */
    linkSeries(link, variable, range = {}) {
        const idx = this._resolve(link, "link");
        const [s, e] = this._range(range);
        const h = this._h;
        return this._floats(e - s + 1, (p) => this._raw.swmm_output_get_link_series(h, idx, variable, s, e, p));
    }
    /** `variable` of one subcatchment over the reporting window (inclusive range). */
    subcatchmentSeries(sub, variable, range = {}) {
        const idx = this._resolve(sub, "subcatchment");
        const [s, e] = this._range(range);
        const h = this._h;
        return this._floats(e - s + 1, (p) => this._raw.swmm_output_get_subcatch_series(h, idx, variable, s, e, p));
    }
    /** A system-wide `variable` over the reporting window (inclusive range). */
    systemSeries(variable, range = {}) {
        const [s, e] = this._range(range);
        const h = this._h;
        return this._floats(e - s + 1, (p) => this._raw.swmm_output_get_system_series(h, variable, s, e, p));
    }
    // ---- all attributes at one period ------------------------------------------------------
    /** @internal */
    _attributes(base, read) {
        const mod = this.module;
        const budget = Math.max(32, base + this.pollutantCount);
        const p = checkedAlloc(mod, 4 * budget + 4);
        try {
            const count = p + 4 * budget;
            mod.HEAP32[count >> 2] = 0;
            raiseForCode(read(p, count));
            const n = mod.HEAP32[count >> 2];
            // Keyed by variable code; pollutant slots continue from POLLUT_BASE.
            const values = new Float32Array(mod.HEAPU8.buffer, p, n);
            return new Map(Array.from(values, (v, i) => [i, v]));
        }
        finally {
            mod._free(p);
        }
    }
    /** All output variables of a node at `period`, keyed by {@link OutNodeVar} code. */
    nodeAttributes(node, period) {
        const idx = this._resolve(node, "node");
        const h = this._h;
        return this._attributes(OutNodeVar.POLLUT_BASE, (v, c) => this._raw.swmm_output_get_node_attribute(h, idx, period, v, c));
    }
    /** All output variables of a link at `period`, keyed by {@link OutLinkVar} code. */
    linkAttributes(link, period) {
        const idx = this._resolve(link, "link");
        const h = this._h;
        return this._attributes(OutLinkVar.POLLUT_BASE, (v, c) => this._raw.swmm_output_get_link_attribute(h, idx, period, v, c));
    }
    /** All output variables of a subcatchment at `period`, keyed by {@link OutSubcatchVar} code. */
    subcatchmentAttributes(sub, period) {
        const idx = this._resolve(sub, "subcatchment");
        const h = this._h;
        return this._attributes(OutSubcatchVar.POLLUT_BASE, (v, c) => this._raw.swmm_output_get_subcatch_attribute(h, idx, period, v, c));
    }
    // ---- node summary statistics --------------------------------------------------------------
    /**
     * Cumulative flooding statistics of a node, aggregated over the file's
     * report samples (the engine-side `Node.stats` are finer).
     */
    nodeStats(node) {
        return new OutputNodeStats(this, this._resolve(node, "node"));
    }
}
//# sourceMappingURL=OutputReader.js.map