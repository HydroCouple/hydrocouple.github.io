/**
 * @file view.ts
 * @brief Base of the solver-level service views (pollutants, land uses,
 *        climate, inflows, ...).
 *
 * A view reaches the engine through its solver. With `fresh: true` (item
 * views, as Python's `_check_fresh`) it refuses to work after the solver's
 * generation changed; collection views follow the live model.
 *
 * @license  Apache-2.0
 */
import { StaleObjectError } from "./errors.js";
import { guardedRaw } from "./mem.js";
export class SolverView {
    /** @internal */
    constructor(_solver, _fresh = false) {
        this._solver = _solver;
        this._fresh = _fresh;
        this._raw = guardedRaw(_solver.module, () => void _solver.handle);
        this._generation = _solver.generation;
    }
    /** @internal The engine handle (after the staleness check for item views). */
    get _h() {
        if (this._fresh && this._generation !== this._solver.generation) {
            throw new StaleObjectError();
        }
        return this._solver.handle;
    }
    /** @internal */
    get _mod() {
        return this._solver.module;
    }
    /** The solver this view belongs to. */
    get solver() {
        return this._solver;
    }
}
//# sourceMappingURL=view.js.map