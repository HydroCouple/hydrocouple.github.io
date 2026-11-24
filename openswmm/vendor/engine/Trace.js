/**
 * @file Trace.ts
 * @brief Flow tracing over hydraulic output or supplied hydraulic averages
 *        (Python `_trace`).
 *
 * All dimensional quantities are SI. Travel times are passage-weighted
 * estimates under frozen average flows, not particle arrival times. A
 * {@link FlowTracer} owns its inputs; close it (or use it with `using`).
 *
 * @license  Apache-2.0
 */
import { LinkType, NodeType, TraceDirection, TraceStatus } from "./enums.js";
import { ElementNotFoundError } from "./errors.js";
import { checkedAlloc, rawOf } from "./mem.js";
import { CALLBACK_SIGNATURES, STRUCTS } from "./raw.js";
import { readStruct, withStruct, withStructs } from "./structs.js";
/** Native tracing failure; `code` is a {@link TraceStatus}, separate from engine errors. */
export class TraceError extends Error {
    constructor(code, message) {
        super(message || `Flow tracing failed (${TraceStatus[code] ?? code})`);
        this.name = "TraceError";
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** camelCase copy of a native row. */
function record(row) {
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
}
/** snake_case native values of a record over `defaults`. */
function native(defaults, values) {
    const out = {};
    for (const [k, v] of Object.entries({ ...defaults, ...(values ?? {}) })) {
        if (v !== undefined)
            out[snake(k)] = v;
    }
    return out;
}
function text(value) {
    const s = String(value);
    if (s.includes("\0"))
        throw new RangeError("Trace strings cannot contain NUL characters");
    return s;
}
const NODE_AVERAGE = {
    volumeM3: 0,
    inflowM3s: 0,
    lateralInM3s: 0,
    withdrawalM3s: 0,
    overflowM3s: 0,
    outgoingM3s: 0,
    residenceS: 0,
    firstVolumeM3: 0,
    lastVolumeM3: 0,
    flags: 0,
};
const LINK_AVERAGE = {
    netFlowM3s: 0,
    absoluteFlowM3s: 0,
    absoluteVelocityMps: 0,
    forwardVolumeM3: 0,
    reverseVolumeM3: 0,
    travelS: 0,
    firstVolumeM3: 0,
    lastVolumeM3: 0,
    direction: 0,
    flags: 0,
};
const TRACE_INFO = {
    schemaVersion: 0,
    algorithmVersion: 0,
    nodeCount: 0,
    linkCount: 0,
    periods: 0,
    sourceFlowUnits: 0,
    cacheLoaded: 0,
    firstReportDate: 0,
    lastReportDate: 0,
    durationS: 0,
};
/** Independent tracing handle (Python `FlowTracer`); close it or use it with `using`. */
export class FlowTracer {
    /**
     * Copy a topology into a new native handle. Missing fields take the Python
     * dataclass defaults; `options` fields default to the native values.
     */
    constructor(_mod, nodes, links, { options = null } = {}) {
        this._mod = _mod;
        this._handle = 0;
        this._busy = false;
        this._raw = rawOf(_mod);
        const ns = Array.from(nodes, (n) => ({
            id: text(n.id ?? ""),
            type: n.type ?? NodeType.JUNCTION,
            flags: n.flags ?? 0,
        }));
        const ls = Array.from(links, (l) => ({
            id: text(l.id ?? ""),
            from_node: l.fromNode ?? 0,
            to_node: l.toNode ?? 0,
            type: l.type ?? LinkType.CONDUIT,
            length_m: l.lengthM ?? 0,
        }));
        this._nn = ns.length;
        this._nl = ls.length;
        const opts = native(FlowTracer.defaultOptions(_mod), options);
        const out = checkedAlloc(_mod, 4);
        try {
            _mod.HEAPU32[out >> 2] = 0;
            const status = withStructs(_mod, "SWMM_TraceNodeInput", ns, (np) => withStructs(_mod, "SWMM_TraceLinkInput", ls, (lp) => withStruct(_mod, "SWMM_TraceOptions", (op) => this._raw.swmm_trace_create(np, ns.length, lp, ls.length, op, out), opts)));
            this._handle = _mod.HEAPU32[out >> 2];
            this._check(status);
        }
        finally {
            _mod._free(out);
        }
    }
    /** The native numerical defaults in SI units. */
    static defaultOptions(mod) {
        return withStruct(mod, "SWMM_TraceOptions", (p) => {
            rawOf(mod).swmm_trace_default_options(p);
            return record(readStruct(mod, "SWMM_TraceOptions", p));
        });
    }
    _check(status) {
        if (status) {
            throw new TraceError(status, this._raw.swmm_trace_error(this._handle) || "");
        }
    }
    /** The open handle, refused while an operation (or its progress callback) runs. */
    _h() {
        if (this._busy)
            throw new Error("FlowTracer is in use by another operation");
        if (!this._handle)
            throw new Error("FlowTracer is closed");
        return this._handle;
    }
    /** Release this handle; repeated closes are harmless. */
    close() {
        if (this._busy)
            throw new Error("FlowTracer is in use by another operation");
        if (this._handle) {
            this._raw.swmm_trace_close(this._handle);
            this._handle = 0;
        }
    }
    /** {@link close}, for `using`. */
    [Symbol.dispose]() {
        this.close();
    }
    /** Node IDs in the original topology order. */
    get nodeIds() {
        const h = this._h();
        return Array.from({ length: this._nn }, (_, i) => this._raw.swmm_trace_node_id(h, i));
    }
    /** Link IDs in the original topology order. */
    get linkIds() {
        const h = this._h();
        return Array.from({ length: this._nl }, (_, i) => this._raw.swmm_trace_link_id(h, i));
    }
    /** Copies of the node and link inputs, in input order. */
    get topology() {
        const h = this._h();
        return this._pair("SWMM_TraceNodeInput", "SWMM_TraceLinkInput", (np, lp) => this._raw.swmm_trace_get_topology(h, np, this._nn, lp, this._nl));
    }
    /** Scan metadata, including topology counts and cache status. */
    get info() {
        const h = this._h();
        return withStruct(this._mod, "SWMM_TraceInfo", (p) => {
            this._check(this._raw.swmm_trace_get_info(h, p));
            return record(readStruct(this._mod, "SWMM_TraceInfo", p));
        });
    }
    /** Prepared hydraulic averages and derived delays in SI units. */
    get averages() {
        const h = this._h();
        return this._pair("SWMM_TraceNodeAverage", "SWMM_TraceLinkAverage", (np, lp) => this._raw.swmm_trace_get_averages(h, np, this._nn, lp, this._nl));
    }
    /** Read two native row arrays (one per node, one per link) filled by `fill`. */
    _pair(nodeStruct, linkStruct, fill) {
        const mod = this._mod;
        const nsize = STRUCTS[nodeStruct].size;
        const lsize = STRUCTS[linkStruct].size;
        const nodes = checkedAlloc(mod, nsize * Math.max(this._nn, 1));
        const links = checkedAlloc(mod, lsize * Math.max(this._nl, 1));
        try {
            this._check(fill(nodes, links));
            return [
                Array.from({ length: this._nn }, (_, i) => record(readStruct(mod, nodeStruct, nodes + i * nsize))),
                Array.from({ length: this._nl }, (_, i) => record(readStruct(mod, linkStruct, links + i * lsize))),
            ];
        }
        finally {
            mod._free(nodes);
            mod._free(links);
        }
    }
    /** Restore averages in topology order; derived delays are recomputed. */
    setAverages(nodes, links, { info = null } = {}) {
        this._h();
        const ns = Array.from(nodes, (n) => native(NODE_AVERAGE, n));
        const ls = Array.from(links, (l) => native(LINK_AVERAGE, l));
        if (ns.length !== this._nn || ls.length !== this._nl) {
            throw new RangeError("Average row counts must match the topology");
        }
        const h = this._h();
        const status = withStructs(this._mod, "SWMM_TraceNodeAverage", ns, (np) => withStructs(this._mod, "SWMM_TraceLinkAverage", ls, (lp) => withStruct(this._mod, "SWMM_TraceInfo", (ip) => this._raw.swmm_trace_set_averages(h, np, this._nn, lp, this._nl, info ? ip : 0), native(TRACE_INFO, info))));
        this._check(status);
    }
    /** Run a long native operation with an optional progress callback. */
    _run(progress, call) {
        const h = this._h();
        if (progress !== null && progress !== undefined && typeof progress !== "function") {
            throw new TypeError("progress must be callable");
        }
        let error;
        let failed = false;
        const slot = progress
            ? this._mod.addFunction((fraction, stage) => {
                try {
                    return progress(fraction, stage ? this._mod.UTF8ToString(stage) : "") ? 1 : 0;
                }
                catch (err) {
                    // Never let a JavaScript error unwind through the native frames.
                    error = err;
                    failed = true;
                    return 1;
                }
            }, CALLBACK_SIGNATURES.SWMM_TraceProgress)
            : 0;
        let status;
        this._busy = true;
        try {
            status = call(h, slot);
        }
        finally {
            this._busy = false;
            if (slot)
                this._mod.removeFunction(slot);
        }
        if (failed)
            throw error;
        this._check(status);
    }
    /**
     * Read a completed output, matching topology by ID rather than row order.
     * A cache needs HDF5 and a verified content digest in `fingerprint` (for
     * example SHA-256 of the output bytes); a path or timestamp is not enough.
     */
    prepare(outputPath, { cachePath = null, fingerprint = null, progress = null, } = {}) {
        const output = text(outputPath);
        const cache = cachePath === null ? "" : text(cachePath);
        const digest = fingerprint === null ? "" : text(fingerprint);
        this._h();
        if (cache && !digest) {
            throw new RangeError("A cache requires a verified output content fingerprint");
        }
        this._run(progress, (h, cb) => this._raw.swmm_trace_prepare(h, output, cache, digest, cb, 0));
    }
    /**
     * Scan the complete reporting periods of a growing or canceled output (no
     * footer or cache needed). Appends during the scan are ignored; call again
     * to refresh. Truncation raises a {@link TraceError} with `MISMATCH`.
     */
    prepareLive(outputPath, { progress = null } = {}) {
        const output = text(outputPath);
        this._run(progress, (h, cb) => this._raw.swmm_trace_prepare_live(h, output, cb, 0));
    }
    /**
     * Trace upstream or downstream from a node ID or zero-based index. Results
     * keep NaN for unknown times and repeat passage ratios above one for cycles.
     */
    estimate(seed, direction = TraceDirection.DOWNSTREAM, { progress = null } = {}) {
        this._h();
        let index;
        if (typeof seed === "string") {
            index = this.nodeIds.indexOf(seed);
            if (index < 0)
                throw new ElementNotFoundError(seed);
        }
        else if (typeof seed === "number" && Number.isInteger(seed)) {
            index = seed;
        }
        else {
            throw new TypeError("Trace seed must be a node ID or an integer index");
        }
        if (!(direction in TraceDirection) || typeof direction !== "number") {
            throw new RangeError(`${String(direction)} is not a valid TraceDirection`);
        }
        if (index < 0 || index >= this._nn) {
            throw new RangeError("Trace seed index is outside the topology");
        }
        const mod = this._mod;
        const vsize = STRUCTS.SWMM_TraceValue.size;
        const nodes = checkedAlloc(mod, vsize * Math.max(this._nn, 1));
        const links = checkedAlloc(mod, vsize * Math.max(this._nl, 1));
        const summary = checkedAlloc(mod, STRUCTS.SWMM_TraceSummary.size);
        try {
            this._run(progress, (h, cb) => this._raw.swmm_trace_estimate(h, direction, index, nodes, this._nn, links, this._nl, summary, cb, 0));
            const value = (p) => {
                const row = record(readStruct(mod, "SWMM_TraceValue", p));
                return { ...row, terminalKind: row.terminalKind < 0 ? null : row.terminalKind };
            };
            return {
                nodes: Array.from({ length: this._nn }, (_, i) => value(nodes + i * vsize)),
                links: Array.from({ length: this._nl }, (_, i) => value(links + i * vsize)),
                summary: record(readStruct(mod, "SWMM_TraceSummary", summary)),
            };
        }
        finally {
            mod._free(nodes);
            mod._free(links);
            mod._free(summary);
        }
    }
}
//# sourceMappingURL=Trace.js.map