/**
 * @file HotStart.ts
 * @brief Hot start files and the save schedule (Python
 *        `openswmm.engine._hotstart`).
 *
 * A {@link HotStart} is an open hot start file (native or legacy): read its
 * records, edit initial states (written back on {@link HotStart.close}), or
 * apply it to a solver. It owns a native handle: close it (or use `using`).
 * {@link SaveSchedule} is the model's `[SAVE HOTSTART]` list
 * (`solver.saveSchedule`). Record values are in internal units (ft, ft³, s).
 *
 * @license  Apache-2.0
 */
import { ErrorCode } from "./enums.js";
import { BadParamError, ElementNotFoundError, StaleObjectError, raiseForCode } from "./errors.js";
import { datetimeToOadate, oadateToDatetime } from "./dates.js";
import { checkedAlloc, rawOf, withCString, withDouble, withInt } from "./mem.js";
import { SolverView } from "./view.js";
const CONTENTS = [
    [0x01, "SPECIES"],
    [0x02, "GROUNDWATER"],
    [0x04, "GW_TRANSPORT"],
    [0x08, "SNOW"],
    [0x10, "LID"],
    [0x20, "SURFACE"],
    [0x40, "ENGINE_CHECKPOINT"],
    [0x80, "LEGACY"],
];
const SAVE_FORMATS = ["AUTO", "LEGACY", "NATIVE"];
const LEGACY_OMITS = [
    [0x1, "WATER_AGE"],
    [0x2, "REACTION_SPECIES"],
    [0x4, "AQUIFER"],
    [0x8, "NODE_LIDS"],
];
/** Raise a hot-start I/O error with the engine's detail. */
function checkIo(raw, rc) {
    if (rc === ErrorCode.HOTSTART) {
        const detail = raw.swmm_hotstart_last_io_error();
        if (detail)
            raiseForCode(rc, detail);
    }
    raiseForCode(rc);
}
const closeHandle = new FinalizationRegistry(({ raw, handle }) => void raw.swmm_hotstart_close(handle));
/** An open hot start file. */
export class HotStart {
    /** @internal Use {@link HotStart.open} or {@link HotStart.openLegacy}. */
    constructor(mod, handle = 0) {
        /** @internal */
        this._handle = 0;
        this._mod = mod;
        this._raw = rawOf(mod);
        this._handle = handle;
        if (handle)
            closeHandle.register(this, { raw: this._raw, handle }, this);
    }
    /** Save the solver's current state to a new hot start file. */
    static saveFrom(solver, path) {
        checkIo(rawOf(solver.module), rawOf(solver.module).swmm_hotstart_save(solver.handle, path));
    }
    /** Open a hot start file (in the module's virtual filesystem). */
    static open(mod, path) {
        const raw = rawOf(mod);
        const out = checkedAlloc(mod, 4);
        try {
            mod.HEAPU32[out >> 2] = 0;
            checkIo(raw, raw.swmm_hotstart_open(path, out));
            return new HotStart(mod, mod.HEAPU32[out >> 2]);
        }
        finally {
            mod._free(out);
        }
    }
    /**
     * Open a legacy (SWMM 5) hot start file against `model` (OPENED or later):
     * its counts must match the model, whose names the records take. Read-only.
     */
    static openLegacy(model, path) {
        const mod = model.module;
        const raw = rawOf(mod);
        const out = checkedAlloc(mod, 4);
        try {
            mod.HEAPU32[out >> 2] = 0;
            checkIo(raw, raw.swmm_hotstart_open_legacy(model.handle, path, out));
            return new HotStart(mod, mod.HEAPU32[out >> 2]);
        }
        finally {
            mod._free(out);
        }
    }
    /** Write pending edits and release the handle (idempotent). */
    close() {
        if (this._handle) {
            closeHandle.unregister(this);
            this._raw.swmm_hotstart_close(this._handle);
            this._handle = 0;
        }
    }
    [Symbol.dispose]() {
        this.close();
    }
    /** @internal */
    get _h() {
        if (!this._handle)
            throw new StaleObjectError("HotStart is closed");
        return this._handle;
    }
    /** Apply the file's state to a solver. */
    apply(solver) {
        raiseForCode(this._raw.swmm_hotstart_apply(solver.handle, this._h));
    }
    /** Simulation start date of the run that saved the file. */
    get startDatetime() {
        return oadateToDatetime(withDouble(this._mod, (p) => this._raw.swmm_hotstart_get_start_date(this._h, p)));
    }
    /** Simulated time the file holds: the start date plus the elapsed time. */
    get simDatetime() {
        const elapsed = withDouble(this._mod, (p) => this._raw.swmm_hotstart_get_sim_time(this._h, p));
        return new Date(this.startDatetime.getTime() + elapsed * 1000);
    }
    /** End date of the saving run, or `null`. */
    get endDatetime() {
        const v = withDouble(this._mod, (p) => this._raw.swmm_hotstart_get_end_date(this._h, p));
        return v ? oadateToDatetime(v) : null;
    }
    /** When the file was written (UTC), or `null`. */
    get savedAt() {
        const p = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_hotstart_get_saved_at(this._h, p));
            const seconds = this._mod.HEAPU32[p >> 2] + this._mod.HEAP32[(p >> 2) + 1] * 2 ** 32;
            return seconds ? new Date(seconds * 1000) : null;
        }
        finally {
            this._mod._free(p);
        }
    }
    /** Coordinate reference system, or `null` when the file has none. */
    get crs() {
        try {
            return (withCString(this._mod, 256, (buf, len) => this._raw.swmm_hotstart_get_crs(this._h, buf, len)) || null);
        }
        catch (err) {
            if (err instanceof StaleObjectError)
                throw err;
            return null;
        }
    }
    /** File format version. */
    get version() {
        return withInt(this._mod, (p) => this._raw.swmm_hotstart_get_version(this._h, p));
    }
    /** Sections the file holds (`"SPECIES"`, `"GROUNDWATER"`, ..., `"LEGACY"`). */
    get contents() {
        const flags = withInt(this._mod, (p) => this._raw.swmm_hotstart_get_contents(this._h, p));
        return CONTENTS.filter(([bit]) => flags & bit).map(([, name]) => name);
    }
    /** Number of node records. */
    get nodeCount() {
        return this._raw.swmm_hotstart_node_count(this._h);
    }
    /** Number of link records. */
    get linkCount() {
        return this._raw.swmm_hotstart_link_count(this._h);
    }
    /** Number of subcatchment records. */
    get subcatchmentCount() {
        return this._raw.swmm_hotstart_subcatch_count(this._h);
    }
    /** Names of the species whose concentrations the records hold. */
    get species() {
        const h = this._h;
        return Array.from({ length: this._raw.swmm_hotstart_species_count(h) }, (_, i) => withCString(this._mod, 256, (buf, len) => this._raw.swmm_hotstart_get_species(h, i, buf, len)));
    }
    /** Warnings raised while reading the file. */
    get warnings() {
        const h = this._h;
        return Array.from({ length: this._raw.swmm_hotstart_warning_count(h) }, (_, i) => this._raw.swmm_hotstart_warning(h, i) ?? "");
    }
    /** @internal Read `count` records with `get(i, idBuf, len, out0..out3)` and species. */
    _records(count, get, species) {
        const h = this._h;
        const ns = species ? this._raw.swmm_hotstart_species_count(h) : 0;
        const p = checkedAlloc(this._mod, 40);
        try {
            return Array.from({ length: count }, (_, i) => {
                const id = withCString(this._mod, 256, (buf, len) => get(i, buf, len, p, p + 8, p + 16, p + 24));
                const values = Array.from(this._mod.HEAPF64.subarray(p >> 3, (p >> 3) + 4));
                const conc = Array.from({ length: ns }, (_, k) => {
                    raiseForCode(species(i, k, p + 32));
                    return this._mod.HEAPF64[(p + 32) >> 3];
                });
                return [id, values, conc];
            });
        }
        finally {
            this._mod._free(p);
        }
    }
    /** Every node record. */
    nodeRecords() {
        const h = this._h;
        return this._records(this.nodeCount, (i, buf, len, a, b, c, d) => this._raw.swmm_hotstart_get_node(h, i, buf, len, a, b, c, d), (i, k, out) => this._raw.swmm_hotstart_get_node_species(h, i, k, out)).map(([id, [depth, head, volume, age], concentrations]) => ({
            id,
            depth,
            head,
            volume,
            age,
            concentrations,
        }));
    }
    /** Every link record. */
    linkRecords() {
        const h = this._h;
        return this._records(this.linkCount, (i, buf, len, a, b, c, d) => this._raw.swmm_hotstart_get_link(h, i, buf, len, a, b, c, d), (i, k, out) => this._raw.swmm_hotstart_get_link_species(h, i, k, out)).map(([id, [flow, depth, volume, age], concentrations]) => ({
            id,
            flow,
            depth,
            volume,
            age,
            concentrations,
        }));
    }
    /** Every subcatchment record. */
    subcatchmentRecords() {
        const h = this._h;
        return this._records(this.subcatchmentCount, (i, buf, len, a, b, c, d) => this._raw.swmm_hotstart_get_subcatch(h, i, buf, len, a, b, c, d)).map(([id, [runoff, gwFlow, gwUpperMoisture, gwLowerDepth]]) => ({
            id,
            runoff,
            gwFlow,
            gwUpperMoisture,
            gwLowerDepth,
        }));
    }
    /** Set a node's depth (ft). */
    setNodeDepth(nodeId, depth) {
        raiseForCode(this._raw.swmm_hotstart_set_node_depth(this._h, nodeId, depth));
    }
    /** Set a node's head (ft). */
    setNodeHead(nodeId, head) {
        raiseForCode(this._raw.swmm_hotstart_set_node_head(this._h, nodeId, head));
    }
    /** Set a link's flow (ft³/s). */
    setLinkFlow(linkId, flow) {
        raiseForCode(this._raw.swmm_hotstart_set_link_flow(this._h, linkId, flow));
    }
    /** Set a link's depth (ft). */
    setLinkDepth(linkId, depth) {
        raiseForCode(this._raw.swmm_hotstart_set_link_depth(this._h, linkId, depth));
    }
    /** Set a subcatchment's runoff (ft³/s). */
    setSubcatchmentRunoff(subId, runoff) {
        raiseForCode(this._raw.swmm_hotstart_set_subcatch_runoff(this._h, subId, runoff));
    }
    /** Set a node's initial depth; head and volume are derived at restart. Written on close. */
    setNodeState(nodeId, depth) {
        raiseForCode(this._raw.swmm_hotstart_set_node_state(this._h, nodeId, depth));
    }
    /** Set a link's initial flow and depth; volume is derived at restart. Written on close. */
    setLinkState(linkId, flow, depth) {
        raiseForCode(this._raw.swmm_hotstart_set_link_state(this._h, linkId, flow, depth));
    }
}
function unpack(value) {
    const [when, path] = Array.isArray(value) ? value : [value.when, value.path];
    if (!(when instanceof Date) || typeof path !== "string") {
        throw new TypeError("a save entry is {when, path} or [when, path]");
    }
    return [when, path];
}
/** `solver.saveSchedule`: the `[SAVE HOTSTART]` entries. */
export class SaveSchedule extends SolverView {
    /** Number of entries. */
    get length() {
        return withInt(this._mod, (p) => this._raw.swmm_hotstart_saves_count(this._h, p));
    }
    /** @internal */
    _index(idx) {
        const n = this.length;
        const i = idx < 0 ? idx + n : idx;
        if (!Number.isInteger(i) || i < 0 || i >= n)
            throw new ElementNotFoundError(idx);
        return i;
    }
    /** The entry at `idx` (negative counts from the end). */
    get(idx) {
        const i = this._index(idx);
        const path = withCString(this._mod, 256, (buf, len) => this._raw.swmm_hotstart_saves_get_path(this._h, i, buf, len));
        const when = withDouble(this._mod, (p) => this._raw.swmm_hotstart_saves_get_datetime(this._h, i, p));
        return { when: oadateToDatetime(when), path };
    }
    /** Replace the entry at `idx`. */
    set(idx, value) {
        const i = this._index(idx);
        const [when, path] = unpack(value);
        raiseForCode(this._raw.swmm_hotstart_saves_set_path(this._h, i, path));
        raiseForCode(this._raw.swmm_hotstart_saves_set_datetime(this._h, i, datetimeToOadate(when)));
    }
    /** Remove the entry at `idx`. */
    delete(idx) {
        raiseForCode(this._raw.swmm_hotstart_saves_remove(this._h, this._index(idx)));
    }
    /** Insert an entry at `idx` (the list is rebuilt; formats are kept). */
    insert(idx, value) {
        const n = this.length;
        const rows = Array.from({ length: n }, (_, i) => [
            this.get(i),
            this.getFormat(i),
        ]);
        rows.splice(Math.max(0, Math.min(idx < 0 ? idx + n : idx, n)), 0, [value, "AUTO"]);
        this.clear();
        rows.forEach(([entry, format], i) => {
            this.append(entry);
            if (format !== "AUTO")
                this.setFormat(i, format);
        });
    }
    /** Append an entry. */
    append(value) {
        const [when, path] = unpack(value);
        raiseForCode(this._raw.swmm_hotstart_saves_add(this._h, path, datetimeToOadate(when)));
    }
    /** Remove every entry. */
    clear() {
        raiseForCode(this._raw.swmm_hotstart_saves_clear(this._h));
    }
    /** File format of an entry: `"AUTO"`, `"LEGACY"` or `"NATIVE"`. */
    getFormat(idx) {
        const i = this._index(idx);
        return SAVE_FORMATS[withInt(this._mod, (p) => this._raw.swmm_hotstart_saves_get_format(this._h, i, p))];
    }
    /** Set an entry's file format. */
    setFormat(idx, format) {
        const code = SAVE_FORMATS.indexOf(String(format).toUpperCase());
        if (code < 0) {
            throw new BadParamError(`hot-start save format must be one of ${SAVE_FORMATS.join(", ")}; got ${format}`);
        }
        raiseForCode(this._raw.swmm_hotstart_saves_set_format(this._h, this._index(idx), code));
    }
    /** What a legacy-format save would leave out for this model. */
    legacyOmits() {
        const flags = withInt(this._mod, (p) => this._raw.swmm_hotstart_legacy_omits(this._h, p));
        return LEGACY_OMITS.filter(([bit]) => flags & bit).map(([, name]) => name);
    }
    [Symbol.iterator]() {
        return Array.from({ length: this.length }, (_, i) => this.get(i))[Symbol.iterator]();
    }
}
const RESTART_BACKENDS = ["NONE", "HOTSTART", "GEOPACKAGE", "HDF5", "OTHER"];
/** Raise a restart file error with the engine's reason. */
function checkRestart(raw, rc) {
    if (rc !== 0)
        raiseForCode(rc, raw.swmm_restart_last_error() || undefined);
}
/**
 * What `path` (in the module's virtual filesystem) holds, judged from its
 * first bytes, without changing it: `"NONE"` (missing or empty), `"HOTSTART"`,
 * `"GEOPACKAGE"`, `"HDF5"` or `"OTHER"`.
 */
export function probeRestartFile(mod, path) {
    const raw = rawOf(mod);
    return RESTART_BACKENDS[withInt(mod, (p) => raw.swmm_restart_probe(path, p))];
}
/**
 * Runs and restart records of a GeoPackage or HDF5 file, read-only: the decoded
 * JSON of `swmm_restart_inspect_json` (`path`, `backend` and `runs`; each run has
 * `run_id`, provenance fields and `records`; each record has `record_id`,
 * `model_datetime` in decimal days, `elapsed_seconds`, `continuation`, `status`
 * and more). Only records whose `status` is `"complete"` can be restored. Throws
 * with the engine's reason for a missing file or one that is not a GeoPackage
 * or HDF5 file.
 */
export function inspectRestartFile(mod, path) {
    const raw = rawOf(mod);
    const need = checkedAlloc(mod, 4);
    try {
        mod.HEAPU32[need >> 2] = 0;
        checkRestart(raw, raw.swmm_restart_inspect_json(path, 0, 0, need));
        const size = mod.HEAPU32[need >> 2];
        const buf = checkedAlloc(mod, Math.max(1, size));
        try {
            checkRestart(raw, raw.swmm_restart_inspect_json(path, buf, size, need));
            return JSON.parse(mod.UTF8ToString(buf, size));
        }
        finally {
            mod._free(buf);
        }
    }
    finally {
        mod._free(need);
    }
}
/**
 * `solver.restart`: the model's `[RESTART]` section, the saved state the run
 * starts from and where it records its own. Whether the settings agree is
 * checked when the run initializes.
 *
 * ```ts
 * const r = solver.restart;
 * r.sourceFile = "/previous.gpkg";
 * r.sourceRecord = "LATEST";
 * r.mode = "INITIAL_CONDITIONS"; // or "CONTINUE"
 * r.recordFile = "/states.h5";
 * r.recordFormat = "HDF5"; // or "GEOPACKAGE"
 * r.recordAt = ["END", new Date(Date.UTC(2020, 0, 1, 0, 30))];
 * r.recordEvery = 900; // seconds; 0 for none
 * ```
 */
export class RestartSettings extends SolverView {
    /** @internal */
    _get(key) {
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_restart_get(this._h, key, buf, len));
    }
    /** @internal */
    _set(key, value) {
        raiseForCode(this._raw.swmm_restart_set(this._h, key, value));
    }
    /** Restart file to start from; empty turns restoring off. */
    get sourceFile() {
        return this._get("SOURCE_FILE");
    }
    set sourceFile(value) {
        this._set("SOURCE_FILE", value);
    }
    /** Run in the source file; empty selects its only run. */
    get sourceRun() {
        return this._get("SOURCE_RUN");
    }
    set sourceRun(value) {
        this._set("SOURCE_RUN", value);
    }
    /** Record ID, or `"LATEST"`. */
    get sourceRecord() {
        return this._get("SOURCE_RECORD");
    }
    set sourceRecord(value) {
        this._set("SOURCE_RECORD", value);
    }
    /** `"INITIAL_CONDITIONS"` or `"CONTINUE"`. */
    get mode() {
        return this._get("MODE");
    }
    set mode(value) {
        this._set("MODE", value);
    }
    /** File this run records its states into; empty turns recording off. */
    get recordFile() {
        return this._get("RECORD_FILE");
    }
    set recordFile(value) {
        this._set("RECORD_FILE", value);
    }
    /** `"GEOPACKAGE"`, `"HDF5"` or empty; never inferred. */
    get recordFormat() {
        return this._get("RECORD_FORMAT");
    }
    set recordFormat(value) {
        this._set("RECORD_FORMAT", value);
    }
    /** Interval between records in seconds; 0 for none. */
    get recordEvery() {
        return Number(this._get("RECORD_EVERY"));
    }
    set recordEvery(seconds) {
        this._set("RECORD_EVERY", String(Number(seconds)));
    }
    /** Records carry the engine checkpoint so they can CONTINUE. */
    get recordContinuation() {
        return this._get("RECORD_CONTINUATION") === "YES";
    }
    set recordContinuation(value) {
        this._set("RECORD_CONTINUATION", value ? "YES" : "NO");
    }
    /**
     * True when the initialized run restores or records an engine checkpoint.
     * Such a run that saves binary results needs a new output file.
     */
    get usesCheckpoint() {
        return withInt(this._mod, (p) => this._raw.swmm_restart_uses_checkpoint(this._h, p)) !== 0;
    }
    /** Requested record times: `"END"` or a `Date` (UTC wall clock) each. */
    get recordAt() {
        const n = withInt(this._mod, (p) => this._raw.swmm_restart_record_at_count(this._h, p));
        return Array.from({ length: n }, (_, i) => {
            const when = withDouble(this._mod, (p) => this._raw.swmm_restart_record_at_get(this._h, i, p));
            return when === 0 ? "END" : oadateToDatetime(when);
        });
    }
    set recordAt(values) {
        raiseForCode(this._raw.swmm_restart_record_at_clear(this._h));
        for (const v of values) {
            const when = typeof v === "string" && v.toUpperCase() === "END" ? 0 : datetimeToOadate(v);
            raiseForCode(this._raw.swmm_restart_record_at_add(this._h, when));
        }
    }
}
//# sourceMappingURL=HotStart.js.map