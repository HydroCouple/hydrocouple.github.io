/**
 * @file Spatial.ts
 * @brief `solver.spatial`: coordinates, polylines, polygons, the `[MAP]`
 *        section and the coordinate reference system (Python
 *        `openswmm.engine._spatial`).
 *
 * Coordinate arrays are {@link NDArray}s of shape `[n, 2]` (x, y rows);
 * setters also take a list of `[x, y]` pairs.
 *
 * @license  Apache-2.0
 */
import { resolveIndex } from "./element.js";
import { raiseForCode } from "./errors.js";
import { checkedAlloc, withCString, withInt } from "./mem.js";
import { SolverView } from "./view.js";
/** Split `[n, 2]` coordinates into x and y columns. */
function columns(coords, what) {
    let n;
    let at;
    if (Array.isArray(coords)) {
        const rows = coords;
        if (rows.some((r) => r.length !== 2))
            throw new RangeError(`${what} rows must be [x, y]`);
        n = rows.length;
        at = (i, c) => rows[i][c];
    }
    else {
        const a = coords;
        if (a.shape.length !== 2 || a.shape[1] !== 2) {
            throw new RangeError(`${what} must be shape (n, 2); got (${a.shape.join(", ")})`);
        }
        n = a.shape[0];
        at = (i, c) => a.data[2 * i + c];
    }
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        xs[i] = at(i, 0);
        ys[i] = at(i, 1);
    }
    return [xs, ys];
}
/** `solver.spatial`. */
export class Spatial extends SolverView {
    /** @internal */
    _index(kind, key) {
        return resolveIndex(this._raw, this._h, kind, key);
    }
    /** @internal Call a getter with two `double*` outputs. */
    _pair(fn) {
        const mod = this._mod;
        const p = checkedAlloc(mod, 16);
        try {
            mod.HEAPF64[p >> 3] = 0;
            mod.HEAPF64[(p + 8) >> 3] = 0;
            raiseForCode(fn(p, p + 8));
            return [mod.HEAPF64[p >> 3], mod.HEAPF64[(p + 8) >> 3]];
        }
        finally {
            mod._free(p);
        }
    }
    /** @internal Read `n` points through `(x*, y*)` buffers. */
    _points(n, fn) {
        const mod = this._mod;
        const p = checkedAlloc(mod, Math.max(16 * n, 8));
        try {
            raiseForCode(fn(p, p + 8 * n));
            const xs = new Float64Array(mod.HEAPU8.buffer, p, n);
            const ys = new Float64Array(mod.HEAPU8.buffer, p + 8 * n, n);
            const data = new Float64Array(2 * n);
            for (let i = 0; i < n; i++) {
                data[2 * i] = xs[i];
                data[2 * i + 1] = ys[i];
            }
            return { shape: [n, 2], data };
        }
        finally {
            mod._free(p);
        }
    }
    /** @internal Pass x and y columns to a setter. */
    _write(xs, ys, fn) {
        const mod = this._mod;
        const n = xs.length;
        const p = checkedAlloc(mod, Math.max(16 * n, 8));
        try {
            mod.HEAPF64.set(xs, p >> 3);
            mod.HEAPF64.set(ys, (p >> 3) + n);
            raiseForCode(fn(p, p + 8 * n));
        }
        finally {
            mod._free(p);
        }
    }
    // ---- CRS, [MAP] and annotations ----------------------------------------------
    /**
     * Coordinate reference system (EPSG token, WKT or proj string); `""` when
     * the model has none (`solver.crs` throws `CRSError` instead).
     */
    get crs() {
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_spatial_get_crs(this._h, buf, len));
    }
    set crs(value) {
        raiseForCode(this._raw.swmm_spatial_set_crs(this._h, value));
    }
    /** `[MAP] DIMENSIONS` as `[x1, y1, x2, y2]`. */
    get mapDimensions() {
        const mod = this._mod;
        const p = checkedAlloc(mod, 32);
        try {
            mod.HEAPF64.fill(0, p >> 3, (p >> 3) + 4);
            raiseForCode(this._raw.swmm_spatial_get_map_dimensions(this._h, p, p + 8, p + 16, p + 24));
            const f = mod.HEAPF64;
            return [f[p >> 3], f[(p >> 3) + 1], f[(p >> 3) + 2], f[(p >> 3) + 3]];
        }
        finally {
            mod._free(p);
        }
    }
    set mapDimensions([x1, y1, x2, y2]) {
        raiseForCode(this._raw.swmm_spatial_set_map_dimensions(this._h, x1, y1, x2, y2));
    }
    /** `[MAP] UNITS`, upper case (`""` when not stated). */
    get mapUnits() {
        const mod = this._mod;
        const buf = checkedAlloc(mod, 64);
        try {
            mod.HEAPU8[buf] = 0;
            raiseForCode(this._raw.swmm_spatial_get_map_units(this._h, buf, 64));
            return mod.UTF8ToString(buf, 64);
        }
        finally {
            mod._free(buf);
        }
    }
    set mapUnits(value) {
        raiseForCode(this._raw.swmm_spatial_set_map_units(this._h, value));
    }
    /**
     * Lines of `LABELS`, `BACKDROP`, `PROFILE` or `PROFILES`, verbatim and
     * joined by newlines (the engine never interprets them).
     */
    getAnnotation(section) {
        const mod = this._mod;
        const required = withInt(mod, (p) => this._raw.swmm_spatial_get_annotation(this._h, section, 0, 0, p));
        const buf = checkedAlloc(mod, Math.max(required, 1));
        try {
            mod.HEAPU8[buf] = 0;
            raiseForCode(this._raw.swmm_spatial_get_annotation(this._h, section, buf, required, 0));
            return mod.UTF8ToString(buf, required);
        }
        finally {
            mod._free(buf);
        }
    }
    /** Replace an annotation section's lines; `""` or `null` removes it. */
    setAnnotation(section, text) {
        raiseForCode(this._raw.swmm_spatial_set_annotation(this._h, section, text ?? ""));
    }
    // ---- nodes -------------------------------------------------------------------
    /** Whether coordinates were supplied, a valid origin (0, 0) included. */
    nodeHasCoord(node) {
        const i = this._index("node", node);
        return withInt(this._mod, (p) => this._raw.swmm_spatial_node_has_coord(this._h, i, p)) !== 0;
    }
    nodeCoord(node) {
        const i = this._index("node", node);
        return this._pair((x, y) => this._raw.swmm_spatial_get_node_coord(this._h, i, x, y));
    }
    setNodeCoord(node, x, y) {
        const i = this._index("node", node);
        raiseForCode(this._raw.swmm_spatial_set_node_coord(this._h, i, x, y));
    }
    /** Every node's coordinates, shape `[nNodes, 2]`. */
    nodeCoords() {
        const h = this._h;
        const n = this._raw.swmm_node_count(h);
        // The C bulk calls refuse a zero count.
        if (n === 0)
            return { shape: [0, 2], data: new Float64Array(0) };
        return this._points(n, (x, y) => this._raw.swmm_spatial_get_node_coords_bulk(h, x, y, n));
    }
    /** Set every node's coordinates from `[nNodes, 2]` rows. */
    setNodeCoords(coords) {
        const h = this._h;
        const n = this._raw.swmm_node_count(h);
        const [xs, ys] = columns(coords, "node coords array");
        if (xs.length !== n) {
            throw new RangeError(`node coords array must have shape (${n}, 2), got (${xs.length}, 2)`);
        }
        if (n > 0)
            this._write(xs, ys, (x, y) => this._raw.swmm_spatial_set_node_coords_bulk(h, x, y, n));
    }
    // ---- links -------------------------------------------------------------------
    /** A link's mid-point coordinate. */
    linkCoord(link) {
        const i = this._index("link", link);
        return this._pair((x, y) => this._raw.swmm_spatial_get_link_coord(this._h, i, x, y));
    }
    setLinkCoord(link, x, y) {
        const i = this._index("link", link);
        raiseForCode(this._raw.swmm_spatial_set_link_coord(this._h, i, x, y));
    }
    /**
     * A link's full polyline, shape `[n, 2]`: the start node, the interior
     * vertices, then the end node.
     */
    linkVertices(link) {
        const i = this._index("link", link);
        const h = this._h;
        const n = withInt(this._mod, (p) => this._raw.swmm_spatial_get_link_vertex_count(h, i, p));
        return this._points(n, (x, y) => this._raw.swmm_spatial_get_link_vertices(h, i, x, y, n));
    }
    /** Set a link's interior vertices (the end nodes are not included). */
    setLinkVertices(link, vertices) {
        const i = this._index("link", link);
        const h = this._h;
        const [xs, ys] = columns(vertices, "link vertices");
        this._write(xs, ys, (x, y) => this._raw.swmm_spatial_set_link_vertices(h, i, x, y, xs.length));
    }
    // ---- subcatchments -------------------------------------------------------------
    /** A subcatchment's centroid coordinate. */
    subcatchmentCoord(sub) {
        const i = this._index("subcatch", sub);
        return this._pair((x, y) => this._raw.swmm_spatial_get_subcatch_coord(this._h, i, x, y));
    }
    setSubcatchmentCoord(sub, x, y) {
        const i = this._index("subcatch", sub);
        raiseForCode(this._raw.swmm_spatial_set_subcatch_coord(this._h, i, x, y));
    }
    /**
     * Every boundary ring, concatenated, shape `[n, 2]`. Each ring is closed by
     * repeating its first vertex (the last may be open); even/odd containment
     * defines holes.
     */
    subcatchmentPolygon(sub) {
        const i = this._index("subcatch", sub);
        const h = this._h;
        const n = withInt(this._mod, (p) => this._raw.swmm_spatial_get_subcatch_polygon_count(h, i, p));
        return this._points(n, (x, y) => this._raw.swmm_spatial_get_subcatch_polygon(h, i, x, y, n));
    }
    /** Set concatenated boundary rings (close each ring before the next). */
    setSubcatchmentPolygon(sub, polygon) {
        const i = this._index("subcatch", sub);
        const h = this._h;
        const [xs, ys] = columns(polygon, "polygon");
        this._write(xs, ys, (x, y) => this._raw.swmm_spatial_set_subcatch_polygon(h, i, x, y, xs.length));
    }
    // ---- gages -------------------------------------------------------------------
    gageCoord(gage) {
        const i = this._index("gage", gage);
        return this._pair((x, y) => this._raw.swmm_spatial_get_gage_coord(this._h, i, x, y));
    }
    setGageCoord(gage, x, y) {
        const i = this._index("gage", gage);
        raiseForCode(this._raw.swmm_spatial_set_gage_coord(this._h, i, x, y));
    }
}
//# sourceMappingURL=Spatial.js.map