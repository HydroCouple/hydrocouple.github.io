/**
 * @file Statistics.ts
 * @brief `solver.statistics`: per-element run statistics and the report's
 *        summary tables as data (Python `openswmm.engine._statistics`).
 *
 * Array properties return one value per element (a fresh `Float64Array`);
 * `*At(idx)` read one element. Summary tables are available once the run has
 * ended and until the engine is closed.
 *
 * @license  Apache-2.0
 */
import { SummaryTable } from "./enums.js";
import { raiseForCode } from "./errors.js";
import { bulkRead } from "./element.js";
import { checkedAlloc, withCString, withCStrings, withDouble, withInt } from "./mem.js";
import { SolverView } from "./view.js";
/** `solver.statistics`. */
export class Statistics extends SolverView {
    /** @internal */
    _nodes(bulk) {
        const h = this._h;
        return bulkRead(this._mod, this._raw.swmm_node_count(h), (p, n) => bulk(h, p, n));
    }
    /** @internal */
    _links(bulk) {
        const h = this._h;
        return bulkRead(this._mod, this._raw.swmm_link_count(h), (p, n) => bulk(h, p, n));
    }
    /** @internal */
    _subs(bulk) {
        const h = this._h;
        return bulkRead(this._mod, this._raw.swmm_subcatch_count(h), (p, n) => bulk(h, p, n));
    }
    /** @internal */
    _at(fn, idx) {
        return withDouble(this._mod, (p) => fn(this._h, idx, p));
    }
    /** Peak depth of every node. */
    get nodeMaxDepth() {
        return this._nodes(this._raw.swmm_stat_node_max_depth_bulk);
    }
    /** Peak overflow of every node. */
    get nodeMaxOverflow() {
        return this._nodes(this._raw.swmm_stat_node_max_overflow_bulk);
    }
    /** Flood volume of every node. */
    get nodeVolFlooded() {
        return this._nodes(this._raw.swmm_stat_node_vol_flooded_bulk);
    }
    /** Time flooded of every node. */
    get nodeTimeFlooded() {
        return this._nodes(this._raw.swmm_stat_node_time_flooded_bulk);
    }
    /** Peak flow of every link. */
    get linkMaxFlow() {
        return this._links(this._raw.swmm_stat_link_max_flow_bulk);
    }
    /** Peak velocity of every link. */
    get linkMaxVelocity() {
        return this._links(this._raw.swmm_stat_link_max_velocity_bulk);
    }
    /** Peak filling of every link. */
    get linkMaxFilling() {
        return this._links(this._raw.swmm_stat_link_max_filling_bulk);
    }
    /** Volume conveyed by every link. */
    get linkVolFlow() {
        return this._links(this._raw.swmm_stat_link_vol_flow_bulk);
    }
    /** Surcharge time of every link. */
    get linkSurchargeTime() {
        return this._links(this._raw.swmm_stat_link_surcharge_time_bulk);
    }
    /** Runoff volume of every subcatchment. */
    get subcatchmentRunoffVol() {
        return this._subs(this._raw.swmm_stat_subcatch_runoff_vol_bulk);
    }
    /** Peak runoff of every subcatchment. */
    get subcatchmentMaxRunoff() {
        return this._subs(this._raw.swmm_stat_subcatch_max_runoff_bulk);
    }
    /** Precipitation depth of every subcatchment (in or mm; no bulk C call, so one per element). */
    get subcatchmentPrecip() {
        const n = this._raw.swmm_subcatch_count(this._h);
        return Float64Array.from({ length: n }, (_, i) => this._at(this._raw.swmm_stat_subcatch_precip, i));
    }
    /** Peak depth of one node. */
    nodeMaxDepthAt(idx) {
        return this._at(this._raw.swmm_stat_node_max_depth, idx);
    }
    /** Peak overflow of one node. */
    nodeMaxOverflowAt(idx) {
        return this._at(this._raw.swmm_stat_node_max_overflow, idx);
    }
    /** Flood volume of one node. */
    nodeVolFloodedAt(idx) {
        return this._at(this._raw.swmm_stat_node_vol_flooded, idx);
    }
    /** Time flooded of one node. */
    nodeTimeFloodedAt(idx) {
        return this._at(this._raw.swmm_stat_node_time_flooded, idx);
    }
    /** Peak flow of one link. */
    linkMaxFlowAt(idx) {
        return this._at(this._raw.swmm_stat_link_max_flow, idx);
    }
    /** Peak velocity of one link. */
    linkMaxVelocityAt(idx) {
        return this._at(this._raw.swmm_stat_link_max_velocity, idx);
    }
    /** Peak filling of one link. */
    linkMaxFillingAt(idx) {
        return this._at(this._raw.swmm_stat_link_max_filling, idx);
    }
    /** Surcharge time of one link. */
    linkSurchargeTimeAt(idx) {
        return this._at(this._raw.swmm_stat_link_surcharge_time, idx);
    }
    /** Volume conveyed by one link. */
    linkVolFlowAt(idx) {
        return this._at(this._raw.swmm_stat_link_vol_flow, idx);
    }
    /** Runoff volume of one subcatchment. */
    subcatchmentRunoffVolAt(idx) {
        return this._at(this._raw.swmm_stat_subcatch_runoff_vol, idx);
    }
    /** Peak runoff of one subcatchment. */
    subcatchmentMaxRunoffAt(idx) {
        return this._at(this._raw.swmm_stat_subcatch_max_runoff, idx);
    }
    /** A report summary table with its title, columns, rows and values. */
    summaryTable(table) {
        const h = this._h;
        const mod = this._mod;
        const title = withCString(mod, 256, (buf, len) => this._raw.swmm_summary_table_title(h, table, buf, len));
        const ncol = withInt(mod, (p) => this._raw.swmm_summary_column_count(h, table, p));
        const nrow = withInt(mod, (p) => this._raw.swmm_summary_row_count(h, table, p));
        const columns = Array.from({ length: ncol }, (_, c) => {
            const [name, units] = withCStrings(mod, 256, 2, ([n, u], len) => this._raw.swmm_summary_column(h, table, c, n, len, u, len));
            return { name, units };
        });
        const values = new Float64Array(nrow * ncol).fill(NaN);
        const rows = [];
        if (nrow > 0) {
            const ids = checkedAlloc(mod, 8 * nrow);
            try {
                raiseForCode(this._raw.swmm_summary_rows_read(h, table, ids, ids + 4 * nrow, nrow));
                if (ncol > 0) {
                    values.set(bulkRead(mod, nrow * ncol, (p, n) => this._raw.swmm_summary_values_read(h, table, p, n)));
                }
                const needed = withInt(mod, (p) => {
                    this._raw.swmm_summary_labels_read(h, table, 0, 0, p); // size query: BADPARAM + needed
                    return 0;
                });
                const labelBuf = checkedAlloc(mod, Math.max(needed, 1));
                let labels;
                try {
                    raiseForCode(this._raw.swmm_summary_labels_read(h, table, labelBuf, Math.max(needed, 1), 0));
                    labels = mod.UTF8ToString(labelBuf, Math.max(needed, 1)).split("\n");
                }
                finally {
                    mod._free(labelBuf);
                }
                for (let r = 0; r < nrow; r++) {
                    rows.push({
                        objectType: mod.HEAP32[(ids >> 2) + r],
                        objectIndex: mod.HEAP32[(ids >> 2) + nrow + r],
                        label: labels[r] ?? "",
                    });
                }
            }
            finally {
                mod._free(ids);
            }
        }
        return { table, title, columns, rows, values };
    }
    /** Every summary table, in report order (tables without rows included). */
    summaryTables() {
        return Object.values(SummaryTable)
            .filter((v) => typeof v === "number")
            .map((t) => this.summaryTable(t));
    }
    /** One row of a summary table. */
    summaryRowAt(table, row) {
        const p = checkedAlloc(this._mod, 8);
        try {
            const label = withCString(this._mod, 256, (buf, len) => this._raw.swmm_summary_row(this._h, table, row, p, p + 4, buf, len));
            return {
                objectType: this._mod.HEAP32[p >> 2],
                objectIndex: this._mod.HEAP32[(p + 4) >> 2],
                label,
            };
        }
        finally {
            this._mod._free(p);
        }
    }
    /** One cell of a summary table. */
    summaryValueAt(table, row, column) {
        return withDouble(this._mod, (p) => this._raw.swmm_summary_value(this._h, table, row, column, p));
    }
}
//# sourceMappingURL=Statistics.js.map