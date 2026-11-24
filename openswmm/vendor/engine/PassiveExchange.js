/**
 * @file PassiveExchange.ts
 * @brief Experimental integrated native passive exchange with read-only V1
 *        snapshots (Python `_passive_exchange`).
 *
 * Amount components keep their canonical order and native concentration or
 * volume basis. Inspection copies carry no ownership or authority to fund a
 * transfer. Access is serialized with the solver: inspection from inside a
 * callback is refused.
 *
 * @license  Apache-2.0
 */
import { raiseForCode } from "./errors.js";
import { STRUCTS } from "./raw.js";
import { readStruct, withStruct } from "./structs.js";
import { SolverView } from "./view.js";
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
/** A native `SWMM_PassiveAmountV1` as its ordered components. */
function amount(value) {
    const row = value;
    return { components: row.components.slice(0, row.count) };
}
/** camelCase copy of a native row, with amount fields converted. */
function record(row) {
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [
        camel(k),
        v !== null && typeof v === "object" && "components" in v ? amount(v) : v,
    ]));
}
/** A uint64 index: a safe non-negative integer or an in-range bigint. */
function u64(value, name) {
    if (typeof value === "bigint") {
        if (value >= 0n && value < 2n ** 64n)
            return value;
    }
    else if (Number.isSafeInteger(value) && value >= 0) {
        return BigInt(value);
    }
    throw new RangeError(`${name} must be an unsigned 64-bit integer`);
}
/** Integrated reference profile (Python `solver.passive_exchange`). Enable once after `start(false)`, before stepping. */
export class PassiveExchange extends SolverView {
    /** @internal Obtain through {@link Solver.passiveExchange}. */
    constructor(owner) {
        super(owner, true);
    }
    _check(rc) {
        if (rc)
            raiseForCode(rc, this._raw.swmm_passive_exchange_last_error() || undefined);
    }
    /** Run a native call outside callbacks, as Python's `require_idle` + `_operation`. */
    _call(fn) {
        this._solver._requireIdle();
        const h = this._h;
        this._check(this._solver._operation(() => fn(h)));
    }
    /** Read one native struct `name` filled by `fn(h, size, ptr)`. */
    _read(name, fn) {
        return withStruct(this._mod, name, (p) => {
            this._call((h) => fn(h, STRUCTS[name].size, p));
            return readStruct(this._mod, name, p);
        });
    }
    /** Enroll the supported passive profile: capacity 1..65536, preflight 0 or 1. */
    enable(capacity = 4096, preflight = 0) {
        const cap = u64(capacity, "capacity");
        this._call((h) => this._raw.swmm_passive_exchange_enable(h, cap, preflight));
    }
    /** Attach numerical checkpoints at the initial enrolled boundary. */
    enableCheckpoint() {
        this._call((h) => this._raw.swmm_passive_exchange_enable_checkpoint(h));
    }
    /** Copy the status observation. */
    status() {
        return record(this._read("SWMM_PassiveStatusV1", (h, n, p) => this._raw.swmm_passive_exchange_status_v1(h, n, p)));
    }
    /** Copy the pool observation of a node, preserving exact amount components. */
    pool(node) {
        return record(this._read("SWMM_PassivePoolV1", (h, n, p) => this._raw.swmm_passive_exchange_pool_v1(h, node, n, p)));
    }
    /** Copy a receipt observation. */
    receipt(receipt) {
        const id = u64(receipt, "receipt");
        return record(this._read("SWMM_PassiveReceiptV1", (h, n, p) => this._raw.swmm_passive_exchange_receipt_v1(h, id, n, p)));
    }
    /** Copy one row of a receipt; `remaining` 1 reads what is left to deliver. */
    row(receipt, row, remaining = 0) {
        const id = u64(receipt, "receipt");
        const index = u64(row, "row");
        return record(this._read("SWMM_PassiveRowV1", (h, n, p) => this._raw.swmm_passive_exchange_row_v1(h, id, remaining, index, n, p)));
    }
    /** Copy a leg observation with its stage. */
    leg(leg) {
        const id = u64(leg, "leg");
        return this._leg((h, n, p) => this._raw.swmm_passive_exchange_leg_v2(h, id, n, p));
    }
    /** Copy the current attempt observation with its stage. */
    attempt() {
        return this._leg((h, n, p) => this._raw.swmm_passive_exchange_attempt_v2(h, n, p));
    }
    _leg(fn) {
        const value = this._read("SWMM_PassiveLegV2", fn);
        return { ...record(value.leg), stage: value.stage };
    }
}
//# sourceMappingURL=PassiveExchange.js.map