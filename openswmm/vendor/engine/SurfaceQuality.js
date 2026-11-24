/**
 * @file SurfaceQuality.ts
 * @brief `surface2d.quality`: scoped 2D surface-quality authoring (coverages,
 *        initial loadings, curb lengths) and buildup snapshots (Python
 *        `openswmm.engine._surface_quality`).
 *
 * Edit before initialization. GLOBAL < TAG < CELL resolution applies to whole
 * coverage sets. Indices address cells.
 *
 * @license  Apache-2.0
 */
import { CellScope } from "./enums.js";
import { raiseForCode } from "./errors.js";
import { checkedAlloc, withCStrings, withInt } from "./mem.js";
/** A whole land-use coverage set at one scope: `[landuse, percent]` pairs. */
export class SurfaceCoverage {
    constructor(scope, tag, cell, landuses) {
        this.scope = scope;
        this.tag = tag;
        this.cell = cell;
        this.landuses = landuses;
        Object.freeze(this);
    }
}
/** Initial species buildup in project mass per acre/hectare. */
export class SurfaceLoading {
    constructor(scope, tag, cell, species, value) {
        this.scope = scope;
        this.tag = tag;
        this.cell = cell;
        this.species = species;
        this.value = value;
        Object.freeze(this);
    }
}
/** Authored curb length in project length units. */
export class SurfaceCurbLength {
    constructor(scope, tag, cell, length) {
        this.scope = scope;
        this.tag = tag;
        this.cell = cell;
        this.length = length;
        Object.freeze(this);
    }
}
function scopeOf(scope) {
    if (!(scope in CellScope))
        throw new RangeError(`${scope} is not a valid CellScope`);
    return scope;
}
/** `surface2d.quality`: coverages, loadings and curb lengths. */
export class SurfaceQuality {
    /** @internal Obtain through {@link Surface2D.quality}. */
    constructor(mod, handle, raw) {
        this.mod = mod;
        this.handle = handle;
        this.raw = raw;
    }
    /** @internal Allocate `bytes` of zeroed scratch, call `fn`, free. */
    _scratch(bytes, fn) {
        const p = checkedAlloc(this.mod, bytes);
        try {
            this.mod.HEAPU8.fill(0, p, p + bytes);
            return fn(p);
        }
        finally {
            this.mod._free(p);
        }
    }
    /** Coverage sets; percentages sum to 100 or less. */
    get coverages() {
        const h = this.handle;
        const mod = this.mod;
        const count = withInt(mod, (p) => this.raw.swmm_2d_coverage_count(h, p));
        return this._scratch(16, (p) => Array.from({ length: count }, (_, index) => {
            const pairs = withInt(mod, (q) => this.raw.swmm_2d_coverage_row_size(h, index, q));
            let tag = "";
            const uses = [];
            for (let k = 0; k < pairs; k++) {
                const [t, landuse] = withCStrings(mod, 256, 2, ([tb, lb], len) => this.raw.swmm_2d_coverage_get(h, index, k, p, tb, len, p + 4, lb, len, p + 8));
                tag = t;
                uses.push([landuse, mod.HEAPF64[(p + 8) >> 3]]);
            }
            return new SurfaceCoverage(mod.HEAP32[p >> 2], tag, mod.HEAP32[(p + 4) >> 2], uses);
        }));
    }
    /** Replace the whole coverage set at a scope from `landuse → percent`. */
    setCoverage(scope, landuses, { tag = "", cell = -1 } = {}) {
        const items = landuses instanceof Map ? [...landuses] : Object.entries(landuses);
        if (!items.length) {
            throw new RangeError("Coverage needs at least one land use; remove the row to clear it");
        }
        if (items.some(([, v]) => !Number.isFinite(v))) {
            throw new RangeError("Coverage percentages must be finite");
        }
        const mod = this.mod;
        const n = items.length;
        const names = [];
        try {
            for (const [name] of items) {
                const bytes = mod.lengthBytesUTF8(name) + 1;
                const s = checkedAlloc(mod, bytes);
                mod.stringToUTF8(name, s, bytes);
                names.push(s);
            }
            // Name pointers, then the doubles from the next 8-byte boundary.
            this._scratch(16 * n, (p) => {
                mod.HEAPU32.set(names, p >> 2);
                const values = p + 4 * n + ((4 * n) % 8);
                mod.HEAPF64.set(items.map(([, v]) => v), values >> 3);
                raiseForCode(this.raw.swmm_2d_coverage_set(this.handle, scopeOf(scope), tag, cell, p, values, n));
            });
        }
        finally {
            for (const s of names)
                mod._free(s);
        }
    }
    /** Remove a coverage row; later indices shift. */
    removeCoverage(index) {
        raiseForCode(this.raw.swmm_2d_coverage_remove(this.handle, index));
    }
    /** Initial buildup rows, in project mass per acre/hectare. */
    get loadings() {
        const h = this.handle;
        const mod = this.mod;
        const count = withInt(mod, (p) => this.raw.swmm_2d_loading_count(h, p));
        return this._scratch(16, (p) => Array.from({ length: count }, (_, index) => {
            const [tag, species] = withCStrings(mod, 256, 2, ([tb, sb], len) => this.raw.swmm_2d_loading_get(h, index, p, tb, len, p + 4, sb, len, p + 8));
            return new SurfaceLoading(mod.HEAP32[p >> 2], tag, mod.HEAP32[(p + 4) >> 2], species, mod.HEAPF64[(p + 8) >> 3]);
        }));
    }
    /** Add or replace initial buildup at GLOBAL, TAG or CELL scope. */
    setLoading(scope, species, value, { tag = "", cell = -1 } = {}) {
        raiseForCode(this.raw.swmm_2d_loading_set(this.handle, scopeOf(scope), tag, cell, species, value));
    }
    removeLoading(index) {
        raiseForCode(this.raw.swmm_2d_loading_remove(this.handle, index));
    }
    /** Curb-length rows in project length units. */
    get curbLengths() {
        const h = this.handle;
        const mod = this.mod;
        const count = withInt(mod, (p) => this.raw.swmm_2d_curb_length_count(h, p));
        return this._scratch(16, (p) => Array.from({ length: count }, (_, index) => {
            const [tag] = withCStrings(mod, 256, 1, ([tb], len) => this.raw.swmm_2d_curb_length_get(h, index, p, tb, len, p + 4, p + 8));
            return new SurfaceCurbLength(mod.HEAP32[p >> 2], tag, mod.HEAP32[(p + 4) >> 2], mod.HEAPF64[(p + 8) >> 3]);
        }));
    }
    /** Add or replace a positive curb length at one scope. */
    setCurbLength(scope, length, { tag = "", cell = -1 } = {}) {
        raiseForCode(this.raw.swmm_2d_curb_length_set(this.handle, scopeOf(scope), tag, cell, length));
    }
    removeCurbLength(index) {
        raiseForCode(this.raw.swmm_2d_curb_length_remove(this.handle, index));
    }
    /**
     * Per-cell buildup of a species (project mass per acre/hectare). Needs an
     * active surface-quality store: {@link LifecycleError} before start.
     */
    buildup(species) {
        const mod = this.mod;
        const n = withInt(mod, (p) => this.raw.swmm_2d_cell_count(this.handle, p));
        const p = checkedAlloc(mod, Math.max(8 * n, 8));
        try {
            raiseForCode(this.raw.swmm_2d_get_buildup_bulk(this.handle, species, p, n));
            return new Float64Array(mod.HEAPU8.buffer, p, n).slice();
        }
        finally {
            mod._free(p);
        }
    }
}
//# sourceMappingURL=SurfaceQuality.js.map