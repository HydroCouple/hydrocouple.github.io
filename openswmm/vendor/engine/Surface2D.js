/**
 * @file Surface2D.ts
 * @brief 2D surface routing for the OpenSWMM WASM bindings.
 *
 * @details Mirrors the Python `_2d.pyi` specification: {@link Surface2D} is
 * `solver.surface2d` (Python `Solver.surface2d`) and
 * {@link Infiltration2D} is `solver.surface2d.infiltration`. Method names are
 * the Python names in camelCase (`get_depths()` → `getDepths()`).
 *
 * The 2D module solves the depth-averaged shallow-water equations on an
 * unstructured triangle/quad mesh with the explicit local-inertial marcher,
 * coupled two-way to the 1D network. It is active once the model has a mesh
 * and {@link Solver.initialize} has run; before that, solver reads throw
 * {@link LifecycleError}.
 *
 * ### Units
 * The solver runs in SI whatever the model's flow units: depths and heads
 * are meters; rainfall, evaporation, net source and the per-cell 1D coupling
 * flux are rates in m/s (the coupling flux is per unit cell area); volumes are
 * m³ and the total exchange flow m³/s.
 *
 * ### Indexing
 * A "triangle index" is a cell index: triangles first, then quads. Per-cell
 * arrays have {@link Surface2D.nTriangles} entries; edge arrays have
 * `nTriangles * edgeStride` (stride 3 on an all-triangle mesh, 4 with quads).
 *
 * ### Results files
 * `[2D_OPTIONS] OUTPUT_FILE` writes CF/UGRID HDF5 to the module's file
 * system; read it with {@link Output2DReader} or `solver.openResults()`.
 *
 * @author   Caleb Buahin <caleb.buahin@gmail.com>
 * @copyright Copyright (c) 2026 Caleb Buahin. All rights reserved.
 * @license  Apache-2.0
 */
import { DomainSources, } from "./Coupling.js";
import { MeshSnow } from "./Snow2D.js";
import { SurfaceQuality } from "./SurfaceQuality.js";
import { ForcingPersist, SurfaceForcingMode, SurfaceInfilDest, } from "./enums.js";
import { Groundwater } from "./Groundwater.js";
import { BadParamError, ElementNotFoundError, raiseForCode } from "./errors.js";
import { datetimeToOadate } from "./dates.js";
import { readStruct, withStructs } from "./structs.js";
import { STRUCTS } from "./raw.js";
import { checkedAlloc, guardedRaw, withCString, withCStrings, withDouble, withDoubleArray, withDoubleInput, withInt, } from "./mem.js";
const MOMENTUM = ["LOCAL_INERTIAL", "FULL_SWE", "DIFFUSIVE_WAVE"];
const TAG_BYTES = 256;
/** Scratch block for C out-parameters; freed after `use` returns. */
function scratch(mod, bytes, use) {
    const p = checkedAlloc(mod, Math.max(bytes, 8));
    try {
        return use(p);
    }
    finally {
        mod._free(p);
    }
}
// =============================================================================
// Surface2D
// =============================================================================
/**
 * Read/write interface to the 2D surface routing module (`solver.surface2d`).
 *
 * @example
 * ```ts
 * solver.open("/model.inp", "/model.rpt", "/model.out");
 * solver.initialize();
 * const mesh = solver.surface2d;
 * if (mesh.isActive) {
 *   solver.start();
 *   while (solver.step() > 0) {
 *     const depths = mesh.getDepths();   // Float64Array, meters
 *   }
 * }
 * ```
 */
export class Surface2D {
    /** @internal Obtain through {@link Solver.surface2d}. */
    constructor(mod, handle, checkOwner = () => { }, _owner) {
        this.mod = mod;
        this.handle = handle;
        this._owner = _owner;
        this.raw = guardedRaw(mod, checkOwner);
        this.groundwater = new Groundwater(mod, handle, checkOwner, _owner);
    }
    // ---- availability & editing ----------------------------------------------
    /** Whether the 2D solver is active (a mesh is present and initialize ran). */
    get isActive() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_is_active(this.handle, p)) !== 0;
    }
    /** Re-open a mesh for editing between runs. */
    prepareForEdit() {
        raiseForCode(this.raw.swmm_2d_prepare_for_edit(this.handle));
    }
    // ---- mesh topology -------------------------------------------------------
    get nVertices() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_vertex_count(this.handle, p));
    }
    /** Number of cells (triangles + quads); every per-cell array has this length. */
    get nTriangles() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_triangle_count(this.handle, p));
    }
    /** Same value as {@link nTriangles}. */
    get nCells() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_cell_count(this.handle, p));
    }
    get nQuads() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_quad_count(this.handle, p));
    }
    /** Edge slots per cell in the bulk edge arrays: 3, or 4 once the mesh has a quad. */
    get edgeStride() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_edge_stride(this.handle, p));
    }
    getCellVertexCount(idx) {
        return withInt(this.mod, (p) => this.raw.swmm_2d_cell_vertex_count(this.handle, idx, p));
    }
    /** Vertex indices of a cell (3 for a triangle, 4 for a quad). */
    getCellVertices(idx) {
        return this.cellInts(idx, (v, nv) => this.raw.swmm_2d_cell_get_vertices(this.handle, idx, v, nv));
    }
    /** Neighbor cell across each local edge (`-1` on the boundary). */
    getCellNeighbours(idx) {
        return this.cellInts(idx, (n, nv) => this.raw.swmm_2d_cell_get_neighbours(this.handle, idx, n, nv));
    }
    /** The three vertices of a triangle (refuses quads; use {@link getCellVertices}). */
    getTriangleVertices(idx) {
        return this.ints3((p) => this.raw.swmm_2d_triangle_get_vertices(this.handle, idx, p, p + 4, p + 8));
    }
    /** The three neighbors of a triangle (`-1` on the boundary). */
    getTriangleNeighbours(idx) {
        return this.ints3((p) => this.raw.swmm_2d_triangle_get_neighbours(this.handle, idx, p, p + 4, p + 8));
    }
    // ---- mesh geometry -------------------------------------------------------
    /** Vertex coordinates (meters after initialize). */
    getVertexCoords() {
        const n = this.nVertices;
        if (n <= 0)
            return { x: new Float64Array(0), y: new Float64Array(0), z: new Float64Array(0) };
        return scratch(this.mod, 24 * n, (p) => {
            raiseForCode(this.raw.swmm_2d_vertex_get_xyz_bulk(this.handle, p, p + 8 * n, p + 16 * n));
            const all = new Float64Array(this.mod.HEAPF64.buffer, p, 3 * n).slice();
            return { x: all.subarray(0, n), y: all.subarray(n, 2 * n), z: all.subarray(2 * n) };
        });
    }
    getVertexXyz(idx) {
        return this.doubles3((p) => this.raw.swmm_2d_vertex_get_xyz(this.handle, idx, p, p + 8, p + 16));
    }
    /** Set a vertex's ground elevation; derived cell geometry follows. */
    setVertexZ(idx, z) {
        raiseForCode(this.raw.swmm_2d_set_vertex_z(this.handle, idx, z));
    }
    /** Set every vertex elevation at once (one value per vertex). */
    setVertexZBulk(z) {
        const n = this.nVertices;
        if (z.length !== n) {
            throw new BadParamError(`setVertexZBulk expects one Z per vertex: got ${z.length}, mesh has ${n}`);
        }
        withDoubleInput(this.mod, z, (p, count) => this.raw.swmm_2d_set_vertex_z_bulk(this.handle, p, count));
    }
    getTriangleArea(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_triangle_get_area(this.handle, idx, p));
    }
    getTriangleCentroid(idx) {
        return this.doubles3((p) => this.raw.swmm_2d_triangle_get_centroid(this.handle, idx, p, p + 8, p + 16));
    }
    getTriangleMannings(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_triangle_get_mannings(this.handle, idx, p));
    }
    setTriangleMannings(idx, n) {
        raiseForCode(this.raw.swmm_2d_set_triangle_mannings(this.handle, idx, n));
    }
    getTriangleInitDepth(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_triangle_get_init_depth(this.handle, idx, p));
    }
    setTriangleInitDepth(idx, depth) {
        raiseForCode(this.raw.swmm_2d_set_triangle_init_depth(this.handle, idx, depth));
    }
    getTriangleInitVelocity(idx) {
        return scratch(this.mod, 16, (p) => {
            raiseForCode(this.raw.swmm_2d_triangle_get_init_velocity(this.handle, idx, p, p + 8));
            return [this.mod.getValue(p, "double"), this.mod.getValue(p + 8, "double")];
        });
    }
    setTriangleInitVelocity(idx, u, v) {
        raiseForCode(this.raw.swmm_2d_set_triangle_init_velocity(this.handle, idx, u, v));
    }
    getTriangleTag(idx) {
        return withCString(this.mod, TAG_BYTES, (b, n) => this.raw.swmm_2d_get_triangle_tag(this.handle, idx, b, n));
    }
    setTriangleTag(idx, tag) {
        raiseForCode(this.raw.swmm_2d_set_triangle_tag(this.handle, idx, tag));
    }
    getVertexTag(idx) {
        return withCString(this.mod, TAG_BYTES, (b, n) => this.raw.swmm_2d_get_vertex_tag(this.handle, idx, b, n));
    }
    setVertexTag(idx, tag) {
        raiseForCode(this.raw.swmm_2d_set_vertex_tag(this.handle, idx, tag));
    }
    // ---- 1D coupling ---------------------------------------------------------
    get vertexCouplingCount() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_vertex_coupling_count(this.handle, p));
    }
    get triangleCouplingCount() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_triangle_coupling_count(this.handle, p));
    }
    /** Node index coupled to a vertex, or `-1`. */
    getVertexCoupledNode(vertexIdx) {
        return withInt(this.mod, (p) => this.raw.swmm_2d_vertex_get_coupled_node(this.handle, vertexIdx, p));
    }
    setVertexCoupledNode(vertexIdx, nodeName) {
        raiseForCode(this.raw.swmm_2d_set_vertex_coupled_node(this.handle, vertexIdx, nodeName));
    }
    getVertexCouplingCd(vertexIdx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_vertex_coupling_cd(this.handle, vertexIdx, p));
    }
    setVertexCouplingCd(vertexIdx, cd) {
        raiseForCode(this.raw.swmm_2d_set_vertex_coupling_cd(this.handle, vertexIdx, cd));
    }
    getVertexCouplingArea(vertexIdx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_vertex_coupling_area(this.handle, vertexIdx, p));
    }
    setVertexCouplingArea(vertexIdx, area) {
        raiseForCode(this.raw.swmm_2d_set_vertex_coupling_area(this.handle, vertexIdx, area));
    }
    /** Node index coupled to a triangle, or `-1`. */
    getTriangleCoupledNode(triIdx) {
        return withInt(this.mod, (p) => this.raw.swmm_2d_triangle_get_coupled_node(this.handle, triIdx, p));
    }
    addTriangleCoupling(triIdx, nodeName, cd, area) {
        raiseForCode(this.raw.swmm_2d_add_triangle_coupling(this.handle, triIdx, nodeName, cd, area));
    }
    clearTriangleCouplings() {
        raiseForCode(this.raw.swmm_2d_clear_triangle_couplings(this.handle));
    }
    get triangleCouplingRows() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_triangle_coupling_rows(this.handle, p));
    }
    getTriangleCouplingRow(rowIdx) {
        return scratch(this.mod, 24, (p) => {
            raiseForCode(this.raw.swmm_2d_get_triangle_coupling_row(this.handle, rowIdx, p, p + 4, p + 8, p + 16));
            return {
                triangle: this.mod.getValue(p, "i32"),
                node: this.mod.getValue(p + 4, "i32"),
                cd: this.mod.getValue(p + 8, "double"),
                area: this.mod.getValue(p + 16, "double"),
            };
        });
    }
    // ---- state: per-cell arrays (copies) ---------------------------------------
    /** Water depth per cell (m). */
    getDepths() {
        return this.cellArray((p) => this.raw.swmm_2d_get_depths_bulk(this.handle, p));
    }
    /** Water-surface elevation per cell (m). */
    getHeads() {
        return this.cellArray((p) => this.raw.swmm_2d_get_heads_bulk(this.handle, p));
    }
    /** Physical Cartesian X/Y velocities in m/s; owned arrays. Dry cells are zero;
     * paired NaNs preserve the engine's indeterminate wet-cell diagnostic. */
    getVelocities() {
        const n = this.nCells;
        return scratch(this.mod, 16 * n, (p) => {
            raiseForCode(this.raw.swmm_2d_get_velocities_bulk(this.handle, p, p + 8 * n));
            return [
                new Float64Array(this.mod.HEAPF64.buffer, p, n).slice(),
                new Float64Array(this.mod.HEAPF64.buffer, p + 8 * n, n).slice(),
            ];
        });
    }
    /** 1D coupling flux per cell (m/s per unit cell area, positive into the surface). */
    getCouplingFluxes() {
        return this.cellArray((p) => this.raw.swmm_2d_get_coupling_fluxes_bulk(this.handle, p));
    }
    /** Rainfall rate per cell (m/s). */
    getRainfallBulk() {
        return this.cellArray((p) => this.raw.swmm_2d_get_rainfall_bulk(this.handle, p));
    }
    /** Cumulative rainfall volume per cell (m³). */
    getRainVolumeBulk() {
        return this.cellArray((p) => this.raw.swmm_2d_get_rain_volume_bulk(this.handle, p));
    }
    /** Cumulative 1D-exchange volume per cell (m³). */
    getCouplingVolumeBulk() {
        return this.cellArray((p) => this.raw.swmm_2d_get_coupling_volume_bulk(this.handle, p));
    }
    /** Maximum depth reached per cell (m). */
    getStatMaxDepths() {
        return this.cellArray((p) => this.raw.swmm_2d_get_stat_max_depths(this.handle, p));
    }
    /** Maximum velocity magnitude per cell (m/s). */
    getStatMaxVelocities() {
        return this.cellArray((p) => this.raw.swmm_2d_get_stat_max_velocities(this.handle, p));
    }
    /** Maximum per-cell continuity error. */
    getStatMaxContinuityErr() {
        return this.cellArray((p) => this.raw.swmm_2d_get_stat_max_continuity_err(this.handle, p));
    }
    // ---- state: edge and vertex arrays -----------------------------------------
    /** Depth-integrated normal flux per edge slot (m²/s, positive leaving the cell). */
    getEdgeFluxBulk() {
        return this.edgeArray((p) => this.raw.swmm_2d_get_edge_flux_bulk(this.handle, p));
    }
    /** Edge length and outward unit normal per edge slot. */
    getEdgeGeometryBulk() {
        const n = this.nTriangles * this.edgeStride;
        if (n <= 0)
            return { length: new Float64Array(0), nx: new Float64Array(0), ny: new Float64Array(0) };
        return scratch(this.mod, 24 * n, (p) => {
            raiseForCode(this.raw.swmm_2d_edge_get_geometry_bulk(this.handle, p, p + 8 * n, p + 16 * n));
            const all = new Float64Array(this.mod.HEAPF64.buffer, p, 3 * n).slice();
            return { length: all.subarray(0, n), nx: all.subarray(n, 2 * n), ny: all.subarray(2 * n) };
        });
    }
    /** Edge conveyance multipliers per edge slot (1 = unrestricted). */
    getEdgeConveyanceBulk() {
        return this.edgeArray((p) => this.raw.swmm_2d_get_edge_conveyance_bulk(this.handle, p));
    }
    /** Reconstructed water-surface elevation per vertex (m). */
    getVertexHeads() {
        return withDoubleArray(this.mod, this.nVertices, (p) => this.raw.swmm_2d_vertex_get_heads_bulk(this.handle, p));
    }
    /** Depth per vertex for rendering (m). */
    getVertexRenderDepths() {
        return withDoubleArray(this.mod, this.nVertices, (p) => this.raw.swmm_2d_vertex_get_render_depths_bulk(this.handle, p));
    }
    // ---- state: single values --------------------------------------------------
    getDepth(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_depth(this.handle, idx, p));
    }
    getHead(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_head(this.handle, idx, p));
    }
    getRainfall(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_rainfall(this.handle, idx, p));
    }
    /** Net source/sink rate (m/s). */
    getNetSource(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_net_source(this.handle, idx, p));
    }
    getCouplingFlux(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_coupling_flux(this.handle, idx, p));
    }
    getVertexHead(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_vertex_get_head(this.handle, idx, p));
    }
    /** Gages and weights that distribute rainfall onto `cell`. */
    rainfallWeights(cell) {
        return scratch(this.mod, 8, (hdr) => {
            raiseForCode(this.raw.swmm_2d_get_rainfall_weights(this.handle, cell, hdr, 0, 0, 0, hdr + 4));
            const count = this.mod.getValue(hdr + 4, "i32");
            if (count <= 0) {
                return {
                    method: this.mod.getValue(hdr, "i32"),
                    gages: new Int32Array(0),
                    weights: new Float64Array(0),
                };
            }
            // Doubles first: the block is 8-byte aligned, the ints after it need 4.
            return scratch(this.mod, 12 * count, (w) => {
                const g = w + 8 * count;
                raiseForCode(this.raw.swmm_2d_get_rainfall_weights(this.handle, cell, hdr, g, w, count, hdr + 4));
                const n = Math.min(count, this.mod.getValue(hdr + 4, "i32"));
                return {
                    method: this.mod.getValue(hdr, "i32"),
                    gages: new Int32Array(this.mod.HEAP32.buffer, g, n).slice(),
                    weights: new Float64Array(this.mod.HEAPF64.buffer, w, n).slice(),
                };
            });
        });
    }
    // ---- run summary ------------------------------------------------------------
    /** Largest cell depth right now (m). */
    get maxDepth() {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_max_depth(this.handle, p));
    }
    /** Water volume on the surface (m³). */
    get totalVolume() {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_total_volume(this.handle, p));
    }
    /** Sum of the 1D coupling flows (m³/s, positive from the surface into the 1D network). */
    get totalExchangeFlow() {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_total_exchange_flow(this.handle, p));
    }
    /** Internal marcher steps taken in the last advance. */
    get solverSteps() {
        // `long` is 32-bit on wasm32; the count is never negative.
        return withInt(this.mod, (p) => this.raw.swmm_2d_get_solver_steps(this.handle, p)) >>> 0;
    }
    /** Last accepted internal step (s). */
    get solverLastStep() {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_solver_last_step(this.handle, p));
    }
    /** Continuity error of the 2D volume balance as a fraction, `(in - out) / in`. */
    get continuityError() {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_continuity_error(this.handle, p));
    }
    get runStats() {
        const s = STRUCTS.SWMM_2DRunStats;
        const f = s.fields;
        return scratch(this.mod, s.size, (p) => {
            this.mod.HEAPU8.fill(0, p, p + s.size);
            raiseForCode(this.raw.swmm_2d_get_run_stats(this.handle, p));
            const i32 = (o) => this.mod.getValue(p + o, "i32");
            const f64 = (o) => this.mod.getValue(p + o, "double");
            const momentum = i32(f.momentum.offset);
            const nTiers = Math.max(0, Math.min(i32(f.n_tiers.offset), 8));
            return {
                backend: this.mod.UTF8ToString(p + f.backend.offset, 64),
                momentum: momentum >= 0 && momentum < MOMENTUM.length ? MOMENTUM[momentum] : momentum,
                ltsTiers: i32(f.lts_tiers.offset),
                steps: i32(f.steps.offset) >>> 0,
                faceEvals: i32(f.face_evals.offset) >>> 0,
                lastStep: f64(f.last_step.offset),
                activeFrac: [
                    f64(f.active_frac_min.offset),
                    f64(f.active_frac_mean.offset),
                    f64(f.active_frac_max.offset),
                ],
                tierCells: Array.from({ length: nTiers }, (_, k) => i32(f.tier_cells.offset + 4 * k) >>> 0),
            };
        });
    }
    /** 2D volume balance (m³) and its continuity error (a fraction). */
    getMassBalance() {
        const v = scratch(this.mod, 80, (p) => {
            raiseForCode(this.raw.swmm_2d_get_mass_balance(this.handle, p, p + 8, p + 16, p + 24, p + 32, p + 40, p + 48, p + 56, p + 64, p + 72));
            return Array.from({ length: 10 }, (_, k) => this.mod.getValue(p + 8 * k, "double"));
        });
        return {
            initStorage: v[0],
            finalStorage: v[1],
            rainfallIn: v[2],
            coupling1dTo2dIn: v[3],
            coupling2dTo1dOut: v[4],
            outfallIn: v[5],
            outfallOut: v[6],
            boundaryIn: v[7],
            boundaryOut: v[8],
            evapOut: v[9],
            continuityError: this.continuityError,
        };
    }
    // ---- runtime forcing --------------------------------------------------------
    /** Force the rainfall rate (m/s) on one cell. */
    forceRainfall(idx, value, opts = {}) {
        const [mode, persist] = forcing(opts);
        raiseForCode(this.raw.swmm_2d_force_rainfall(this.handle, idx, value, mode, persist));
    }
    /** Force the same rainfall rate (m/s) on every cell. */
    forceRainfallUniform(value, opts = {}) {
        const [mode, persist] = forcing(opts);
        raiseForCode(this.raw.swmm_2d_force_rainfall_uniform(this.handle, value, mode, persist));
    }
    /** Force an evaporation demand (m/s) on one cell; dry cells stop losing water. */
    forceEvap(idx, value, opts = {}) {
        const [mode, persist] = forcing(opts);
        raiseForCode(this.raw.swmm_2d_force_evap(this.handle, idx, value, mode, persist));
    }
    forceEvapUniform(value, opts = {}) {
        const [mode, persist] = forcing(opts);
        raiseForCode(this.raw.swmm_2d_force_evap_uniform(this.handle, value, mode, persist));
    }
    /** Force the 1D coupling flux of one cell (m/s per unit cell area, positive into the surface). */
    forceCouplingFlux(idx, value, opts = {}) {
        const [mode, persist] = forcing(opts);
        raiseForCode(this.raw.swmm_2d_force_coupling_flux(this.handle, idx, value, mode, persist));
    }
    forceClearAll() {
        raiseForCode(this.raw.swmm_2d_force_clear_all(this.handle));
    }
    /** Depth below which a cell is treated as dry (m). */
    get dryDepth() {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_dry_depth(this.handle, p));
    }
    set dryDepth(value) {
        raiseForCode(this.raw.swmm_2d_set_dry_depth(this.handle, value));
    }
    // ---- boundary conditions ------------------------------------------------------
    get boundaryEdgeCount() {
        return withInt(this.mod, (p) => this.raw.swmm_2d_boundary_edge_count(this.handle, p));
    }
    getEdgeBcType(triIdx, edge) {
        return withInt(this.mod, (p) => this.raw.swmm_2d_get_edge_bc_type(this.handle, triIdx, edge, p));
    }
    setEdgeBcType(triIdx, edge, bcType) {
        raiseForCode(this.raw.swmm_2d_set_edge_bc_type(this.handle, triIdx, edge, bcType));
    }
    /** Specified stage (m). */
    getEdgeBcHead(triIdx, edge) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_edge_bc_head(this.handle, triIdx, edge, p));
    }
    setEdgeBcHead(triIdx, edge, head) {
        raiseForCode(this.raw.swmm_2d_set_edge_bc_head(this.handle, triIdx, edge, head));
    }
    /** Normal-flow slope. */
    getEdgeBcSlope(triIdx, edge) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_edge_bc_slope(this.handle, triIdx, edge, p));
    }
    setEdgeBcSlope(triIdx, edge, slope) {
        raiseForCode(this.raw.swmm_2d_set_edge_bc_slope(this.handle, triIdx, edge, slope));
    }
    /** Specified flow (m³/s). */
    getEdgeBcFlow(triIdx, edge) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_edge_bc_flow(this.handle, triIdx, edge, p));
    }
    setEdgeBcFlow(triIdx, edge, flow) {
        raiseForCode(this.raw.swmm_2d_set_edge_bc_flow(this.handle, triIdx, edge, flow));
    }
    /** Cumulative volume through a boundary edge (m³, positive leaving). */
    getEdgeBcCumFlux(triIdx, edge) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_edge_bc_cum_flux(this.handle, triIdx, edge, p));
    }
    getEdgeBcTseriesName(triIdx, edge) {
        return withCString(this.mod, TAG_BYTES, (b, n) => this.raw.swmm_2d_get_edge_bc_tseries_name(this.handle, triIdx, edge, b, n));
    }
    setEdgeBcTseriesName(triIdx, edge, name) {
        raiseForCode(this.raw.swmm_2d_set_edge_bc_tseries_name(this.handle, triIdx, edge, name));
    }
    getEdgeBcFlowTseriesName(triIdx, edge) {
        return withCString(this.mod, TAG_BYTES, (b, n) => this.raw.swmm_2d_get_edge_bc_flow_tseries_name(this.handle, triIdx, edge, b, n));
    }
    setEdgeBcFlowTseriesName(triIdx, edge, name) {
        raiseForCode(this.raw.swmm_2d_set_edge_bc_flow_tseries_name(this.handle, triIdx, edge, name));
    }
    getEdgeBcRatingCurveName(triIdx, edge) {
        return withCString(this.mod, TAG_BYTES, (b, n) => this.raw.swmm_2d_get_edge_bc_rating_curve_name(this.handle, triIdx, edge, b, n));
    }
    setEdgeBcRatingCurveName(triIdx, edge, name) {
        raiseForCode(this.raw.swmm_2d_set_edge_bc_rating_curve_name(this.handle, triIdx, edge, name));
    }
    // ---- edge conveyance ------------------------------------------------------------
    getEdgeConveyance(tri, edge) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_edge_conveyance(this.handle, tri, edge, p));
    }
    setEdgeConveyance(tri, edge, conveyance) {
        raiseForCode(this.raw.swmm_2d_set_edge_conveyance(this.handle, tri, edge, conveyance));
    }
    resetEdgeConveyance() {
        raiseForCode(this.raw.swmm_2d_reset_edge_conveyance(this.handle));
    }
    // ---- REPORT_2D_VARIABLES vocabulary -------------------------------------------
    /** Variable names accepted by `[2D_OPTIONS] REPORT_2D_VARIABLES`. */
    outputVariables() {
        const n = this.raw.swmm_2d_output_variable_count();
        return Array.from({ length: n }, (_, i) => this.raw.swmm_2d_output_variable_name(i));
    }
    /** Bit mask for a variable selection such as `"DEPTH HEAD"`; throws on an invalid one. */
    outputVariableMask(text) {
        const mask = this.raw.swmm_2d_output_variable_mask(text) >>> 0;
        if (!mask)
            throw new BadParamError(`Invalid or empty 2D output variable selection: ${text}`);
        return mask;
    }
    /** The canonical selection text for a mask. */
    outputVariableText(mask) {
        return this.raw.swmm_2d_output_variable_text(mask >>> 0) ?? "";
    }
    // ---- wave E: results file, owners, coupling, quality, edges ------------------------
    /**
     * Bind a fresh absolute HDF5 destination on an executable OPENED model.
     * Start creates it exclusively; an existing destination is refused.
     */
    setResultsFile(path) {
        raiseForCode(this.raw.swmm_2d_set_results_file(this.handle, path));
    }
    /** Multiply mesh coordinates by this factor to obtain meters. */
    get geometryScaleToSi() {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_geometry_scale_to_si(this.handle, p));
    }
    /** Prefer CPU for an unoverridden AUTO backend before initialization (not saved). */
    setAutoBackendCpu(enabled = true) {
        raiseForCode(this.raw.swmm_2d_set_auto_backend_cpu(this.handle, enabled ? 1 : 0));
    }
    /** Authored SUBCATCH UNIFORM ownership records as zero-based subcatchment indices. */
    getSurfaceOwners() {
        const count = withInt(this.mod, (p) => this.raw.swmm_surface_owner_get(this.handle, 0, 0, p));
        return scratch(this.mod, 4 * Math.max(count, 1) + 4, (rows) => {
            const n = rows + 4 * Math.max(count, 1);
            raiseForCode(this.raw.swmm_surface_owner_get(this.handle, rows, count, n));
            return new Int32Array(this.mod.HEAPU8.buffer, rows, this.mod.HEAP32[n >> 2]).slice();
        });
    }
    /**
     * Review the stored (`null`) or proposed ownership without changing the
     * model: objects, shares, mesh weather area (m²), validity, the token for
     * {@link replaceSurfaceOwners} and diagnostics. Needs an editing state.
     */
    previewSurfaceOwners(rows = null) {
        const mod = this.mod;
        const h = this.handle;
        const proposed = rows === null ? null : ownerIndices(rows);
        const count = proposed === null ? -1 : proposed.length;
        const objSize = STRUCTS.SWMM_SurfaceOwnerObject.size;
        const shareSize = STRUCTS.SWMM_SurfaceOwnerShare.size;
        return scratch(mod, 4 * Math.max(count, 1) + 32 + 17 + 16384, (base) => {
            const rowsPtr = base;
            const counts = base + 4 * Math.max(count, 1); // on, sn, an, valid
            const token = counts + 16;
            const diag = token + 17;
            if (proposed)
                mod.HEAP32.set(proposed, rowsPtr >> 2);
            mod.HEAPU8.fill(0, counts, diag + 16384);
            const call = (objects, oc, shares, sc, areas, ac) => this.raw.swmm_surface_owner_preview(h, count > 0 ? rowsPtr : 0, count, objects, oc, counts, shares, sc, counts + 4, areas, ac, counts + 8, counts + 12, token, 17, diag, 16384, 0, 0);
            raiseForCode(call(0, 0, 0, 0, 0, 0));
            const [oc, sc, ac] = [0, 1, 2].map((i) => mod.HEAP32[(counts >> 2) + i]);
            const objects = checkedAlloc(mod, objSize * Math.max(oc, 1));
            const shares = checkedAlloc(mod, shareSize * Math.max(sc, 1));
            const areas = checkedAlloc(mod, 8 * Math.max(ac, 1));
            try {
                mod.HEAPU8.fill(0, objects, objects + objSize * Math.max(oc, 1));
                mod.HEAPU8.fill(0, shares, shares + shareSize * Math.max(sc, 1));
                raiseForCode(call(objects, oc, shares, sc, areas, ac));
                const [on, sn, an, valid] = [0, 1, 2, 3].map((i) => mod.HEAP32[(counts >> 2) + i]);
                const camel = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [
                    k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
                    v,
                ]));
                return {
                    objects: Array.from({ length: on }, (_, i) => {
                        const r = readStruct(mod, "SWMM_SurfaceOwnerObject", objects + i * objSize);
                        return {
                            ...camel(r),
                            reviewed: r.reviewed !== 0,
                            lumped: r.lumped !== 0,
                        };
                    }),
                    shares: Array.from({ length: sn }, (_, i) => camel(readStruct(mod, "SWMM_SurfaceOwnerShare", shares + i * shareSize))),
                    meshWeatherArea: new Float64Array(mod.HEAPU8.buffer, areas, an).slice(),
                    valid: valid !== 0,
                    token: mod.UTF8ToString(token, 17),
                    diagnostics: mod.UTF8ToString(diag, 16384),
                };
            }
            finally {
                mod._free(objects);
                mod._free(shares);
                mod._free(areas);
            }
        });
    }
    /**
     * Replace the ownership records with the latest preview's token; `[]`
     * clears them. A stale token or invalid proposal changes nothing.
     */
    replaceSurfaceOwners(rows, expectedToken) {
        if (expectedToken.includes("\0"))
            throw new RangeError("Ownership tokens cannot contain NUL");
        const proposed = ownerIndices(rows);
        const mod = this.mod;
        scratch(mod, 4 * Math.max(proposed.length, 1) + 16384, (base) => {
            const diag = base + 4 * Math.max(proposed.length, 1);
            mod.HEAP32.set(proposed, base >> 2);
            mod.HEAPU8[diag] = 0;
            const rc = this.raw.swmm_surface_owner_replace(this.handle, proposed.length ? base : 0, proposed.length, expectedToken, diag, 16384);
            const text = mod.UTF8ToString(diag, 16384);
            if (rc)
                raiseForCode(rc, text || undefined);
        });
    }
    /** Rainfall at a SWMM DateTime (or `Date`), in SI m/s, from the saved-report clock. */
    getReportRainfallBulk(reportDate) {
        const when = reportDate instanceof Date ? datetimeToOadate(reportDate) : reportDate;
        return this.cellArray((p) => this.raw.swmm_2d_get_report_rainfall_bulk(this.handle, when, p));
    }
    /** A cell's prescribed initial water-surface elevation (mesh units; NaN when none). */
    getTriangleInitHgl(idx) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_triangle_get_init_hgl(this.handle, idx, p));
    }
    /** Prescribe a cell's initial water-surface elevation (NaN clears it); saved in `[2D_INITIAL_HGL]`. */
    setTriangleInitHgl(idx, hgl) {
        raiseForCode(this.raw.swmm_2d_set_triangle_init_hgl(this.handle, idx, hgl));
    }
    /** @internal */
    _couplingRecord(nodeIdx, couplingType, params, authored, validate) {
        const rows = Object.entries(params ?? {}).map(([k, v]) => [String(k), String(v)]);
        if (rows.some(([k, v]) => k.includes("\0") || v.includes("\0"))) {
            throw new RangeError("Coupling parameters cannot contain null bytes");
        }
        const fn = validate
            ? this.raw.swmm_node_validate_2d_coupling
            : this.raw.swmm_node_replace_2d_coupling;
        withStructs(this.mod, "SWMM_NodeCoupling2DParam", rows.map(([key, value]) => ({ key, value })), (p) => raiseForCode(fn(this.handle, nodeIdx, authored ? 1 : 0, couplingType, rows.length ? p : 0, rows.length)));
    }
    /** Validate a complete node coupling row without changing anything (before initialization). */
    validateNodeCoupling(nodeIdx, couplingType, params = null, { authored = true } = {}) {
        this._couplingRecord(nodeIdx, couplingType, params, authored, true);
    }
    /** Replace a node coupling row atomically; parameters in authored project units. */
    replaceNodeCoupling(nodeIdx, couplingType, params = null, { authored = true } = {}) {
        this._couplingRecord(nodeIdx, couplingType, params, authored, false);
    }
    /** A node's effective coupling type and whether it has a `[2D_NODE_COUPLING]` row. */
    getNodeCouplingType(nodeIdx) {
        return scratch(this.mod, 8, (p) => {
            this.mod.HEAP32.fill(0, p >> 2, (p >> 2) + 2);
            raiseForCode(this.raw.swmm_node_get_2d_coupling_type(this.handle, nodeIdx, p, p + 4));
            return [this.mod.HEAP32[p >> 2], this.mod.HEAP32[(p + 4) >> 2] !== 0];
        });
    }
    /** A node's class default coupling type. */
    getNodeCouplingDefaultType(nodeIdx) {
        return withInt(this.mod, (p) => this.raw.swmm_node_get_2d_coupling_default_type(this.handle, nodeIdx, p));
    }
    /** Author a node's coupling type (parameters that do not apply are dropped). */
    setNodeCouplingType(nodeIdx, couplingType) {
        raiseForCode(this.raw.swmm_node_set_2d_coupling_type(this.handle, nodeIdx, couplingType));
    }
    /** Remove a node's `[2D_NODE_COUPLING]` row (back to the class default). */
    resetNodeCoupling(nodeIdx) {
        raiseForCode(this.raw.swmm_node_reset_2d_coupling(this.handle, nodeIdx));
    }
    /** An authored coupling parameter as its section token (`D`, `CREST`, `LAW`, ...). */
    getNodeCouplingParam(nodeIdx, key) {
        return scratch(this.mod, 128, (buf) => {
            this.mod.HEAPU8[buf] = 0;
            raiseForCode(this.raw.swmm_node_get_2d_coupling_param(this.handle, nodeIdx, key, buf, 128));
            return this.mod.UTF8ToString(buf, 128);
        });
    }
    /** Author a coupling parameter from its token; `null` or `""` clears it. */
    setNodeCouplingParam(nodeIdx, key, value) {
        raiseForCode(this.raw.swmm_node_set_2d_coupling_param(this.handle, nodeIdx, key, value === null ? "" : String(value)));
    }
    /**
     * Surface-transported species in native row order: pollutants, MSX
     * species, `__WATER_AGE__`, `__TEMPERATURE__` (empty without transport).
     */
    get species() {
        const n = withInt(this.mod, (p) => this.raw.swmm_2d_species_count(this.handle, p));
        return Array.from({ length: n }, (_, i) => withCString(this.mod, TAG_BYTES, (b, len) => this.raw.swmm_2d_species_name(this.handle, i, b, len)));
    }
    /** Per-cell concentration of one species row (declared units; temperature °C, age s). */
    concentrations(species) {
        const n = this.nTriangles;
        return scratch(this.mod, 8 * Math.max(n, 1) + 4, (p) => {
            const written = p + 8 * Math.max(n, 1);
            this.mod.HEAP32[written >> 2] = 0;
            raiseForCode(this.raw.swmm_2d_get_cell_conc(this.handle, species, p, n, written));
            return new Float64Array(this.mod.HEAPU8.buffer, p, this.mod.HEAP32[written >> 2]).slice();
        });
    }
    /** Whether a cell edge is on the exterior (after {@link prepareForEdit}). */
    edgeIsExterior(cell, edge) {
        return (withInt(this.mod, (p) => this.raw.swmm_2d_edge_is_exterior(this.handle, cell, edge, p)) !== 0);
    }
    /** Inflow quality of a boundary edge by species name; omitted species arrive at zero. */
    setEdgeBcConcentrations(cell, edge, concentrations) {
        const names = this.species;
        const unknown = Object.keys(concentrations).filter((k) => !names.includes(k));
        if (unknown.length)
            throw new RangeError(`Unknown or disabled species: [${unknown.sort().join(", ")}]`);
        withDoubleInput(this.mod, names.map((n) => concentrations[n] ?? 0), (p) => this.raw.swmm_2d_set_edge_bc_concentrations(this.handle, cell, edge, p, names.length));
    }
    /** Restore the boundary prescription that preceded runtime API edits. */
    clearEdgeBc(cell, edge) {
        raiseForCode(this.raw.swmm_2d_clear_edge_bc(this.handle, cell, edge));
    }
    /** Python `clear_boundary`: {@link clearEdgeBc}. */
    clearBoundary(cell, edge) {
        this.clearEdgeBc(cell, edge);
    }
    /** The last published window-mean outward flow through a boundary edge, total m³/s. */
    boundaryFlow(cell, edge) {
        this.getEdgeBcType(cell, edge); // validates the cell and edge
        return this.getEdgeFluxBulk()[cell * this.edgeStride + edge];
    }
    // ---- runtime sources and boundaries (Python `_coupling.DomainSources`) ----
    /** Runtime external sources and cumulative accepted-transfer receipts. */
    get sources() {
        if (!this._owner)
            throw new TypeError("Obtain the surface through solver.surface2d");
        return new DomainSources(this._owner, "surface");
    }
    /** Prescribe a runtime head (m) on an exterior edge. */
    setHeadBoundary(cell, edge, headM, concentrations = null) {
        this.sources.setBoundary(cell, edge, 1, headM, concentrations);
    }
    /** Total outward m³/s, with inflow quality; overrides authored series. */
    setFlowBoundary(cell, edge, flowM3S, concentrations = null) {
        this.sources.setBoundary(cell, edge, 2, flowM3S, concentrations);
    }
    /** Applied boundary transfer, positive inward, including advective heat. */
    boundaryReceipt(cell, edge) {
        return this.sources.boundaryReceipt(cell, edge);
    }
    /** Every surface ledger term of one species, in its mass units. */
    speciesLedger(species) {
        return this.sources.speciesLedger(species);
    }
    /** Water source on one or more cells (m³/s each); see {@link DomainSources.setSource}. */
    setWaterSource(cells, flowM3S, options = {}) {
        this.sources.setSource(cells, flowM3S, options);
    }
    /** Heat source (W) supplied to the water of one or more cells. */
    setHeatSource(cells, heatW, { sourceId = "heat", untilSeconds = null } = {}) {
        this.sources.setSource(cells, 0, { heatW, sourceId, untilSeconds });
    }
    /** Species sources (concentration unit × m³/s) without water. */
    setSpeciesSource(cells, speciesRates, { sourceId = "species", untilSeconds = null } = {}) {
        this.sources.setSource(cells, 0, { speciesRates, sourceId, untilSeconds });
    }
    /** Clear a source ID on every cell, or on one cell. */
    clearSource(sourceId = "external", cell = null) {
        this.sources.clearSource(sourceId, cell);
    }
    /** Cumulative receipt of one source on one cell. */
    sourceReceipt(sourceId = "external", cell = 0) {
        return this.sources.sourceReceipt(sourceId, cell);
    }
    /** @internal */
    _qualityRows(count, get) {
        const mod = this.mod;
        const n = withInt(mod, (p) => count(this.handle, p));
        return scratch(mod, 16, (o) => Array.from({ length: n }, (_, i) => {
            mod.HEAPU8.fill(0, o, o + 16);
            const [tag, species] = withCStrings(mod, TAG_BYTES, 2, ([tb, sb], len) => get(this.handle, i, o, tb, len, o + 4, sb, len, o + 8));
            return {
                scope: mod.HEAP32[o >> 2],
                tag,
                cell: mod.HEAP32[(o + 4) >> 2],
                species,
                conc: mod.HEAPF64[(o + 8) >> 3],
            };
        }));
    }
    /** Authored `[2D_INITIAL_QUALITY]` rows. */
    get initialQuality() {
        return this._qualityRows(this.raw.swmm_2d_initial_quality_count, this.raw.swmm_2d_get_initial_quality);
    }
    /** Add or replace an initial concentration: a `cell` (0-based), a `tag`, or neither for `*`. */
    setInitialQuality(species, conc, { tag = null, cell = null } = {}) {
        const scope = cell !== null ? 2 : tag ? 1 : 0;
        raiseForCode(this.raw.swmm_2d_set_initial_quality(this.handle, scope, tag ?? "", cell ?? -1, species, conc));
    }
    /** Remove an initial-quality row; later rows shift. */
    removeInitialQuality(index) {
        raiseForCode(this.raw.swmm_2d_remove_initial_quality(this.handle, index));
    }
    /** Authored `[2D_INITIAL_BED_QUALITY]` rows. */
    get initialBedQuality() {
        return this._qualityRows(this.raw.swmm_2d_initial_bed_quality_count, this.raw.swmm_2d_get_initial_bed_quality);
    }
    /** Add or replace an initial bed-porewater concentration (scope as {@link setInitialQuality}). */
    setInitialBedQuality(species, conc, { tag = null, cell = null } = {}) {
        const scope = cell !== null ? 2 : tag ? 1 : 0;
        raiseForCode(this.raw.swmm_2d_set_initial_bed_quality(this.handle, scope, tag ?? "", cell ?? -1, species, conc));
    }
    /** Remove an initial bed-quality row; later rows shift. */
    removeInitialBedQuality(index) {
        raiseForCode(this.raw.swmm_2d_remove_initial_bed_quality(this.handle, index));
    }
    /** Authored `[2D_BOUNDARY_QUALITY]` rows. */
    get boundaryQuality() {
        const mod = this.mod;
        const n = withInt(mod, (p) => this.raw.swmm_2d_boundary_quality_count(this.handle, p));
        return scratch(mod, 16, (o) => Array.from({ length: n }, (_, i) => {
            mod.HEAPU8.fill(0, o, o + 16);
            const [species] = withCStrings(mod, TAG_BYTES, 1, ([sb], len) => this.raw.swmm_2d_get_boundary_quality(this.handle, i, o, o + 4, sb, len, o + 8));
            return {
                cell: mod.HEAP32[o >> 2],
                edge: mod.HEAP32[(o + 4) >> 2],
                species,
                conc: mod.HEAPF64[(o + 8) >> 3],
            };
        }));
    }
    /** Add or replace the inflow concentration of a species through a boundary edge. */
    setBoundaryQuality(cell, edge, species, conc) {
        raiseForCode(this.raw.swmm_2d_set_boundary_quality(this.handle, cell, edge, species, conc));
    }
    /** Remove a boundary-quality row; later rows shift. */
    removeBoundaryQuality(index) {
        raiseForCode(this.raw.swmm_2d_remove_boundary_quality(this.handle, index));
    }
    /** Author a boundary group token (after {@link prepareForEdit}); `""` clears it. */
    setEdgeBcGroup(triIdx, edge, group) {
        if (group.includes("\0"))
            throw new RangeError("Boundary group cannot contain NUL");
        raiseForCode(this.raw.swmm_2d_set_edge_bc_group(this.handle, triIdx, edge, group));
    }
    /** Tangential WALL drag coefficient Cw (0 is free slip). */
    getEdgeWallDrag(triIdx, edge) {
        return withDouble(this.mod, (p) => this.raw.swmm_2d_get_edge_wall_drag(this.handle, triIdx, edge, p));
    }
    /** Author exterior WALL drag before a run (finite, >= 0). */
    setEdgeWallDrag(triIdx, edge, cw) {
        raiseForCode(this.raw.swmm_2d_set_edge_wall_drag(this.handle, triIdx, edge, cw));
    }
    // ---- sub-views ---------------------------------------------------------------------
    /** Per-cell infiltration on the mesh (Python `surface2d.infiltration`). */
    get infiltration() {
        this._infiltration ?? (this._infiltration = new Infiltration2D(this.mod, this.handle, this.raw));
        return this._infiltration;
    }
    /** Mesh snow configuration and cell snapshots (Python `surface2d.snow`). */
    get snow() {
        return new MeshSnow(this.mod, this.handle, this.raw);
    }
    /** Coverages, loadings, curb lengths and buildup (Python `surface2d.quality`). */
    get quality() {
        return new SurfaceQuality(this.mod, this.handle, this.raw);
    }
    // ---- helpers -------------------------------------------------------------------------
    cellArray(call) {
        return withDoubleArray(this.mod, this.nTriangles, call);
    }
    edgeArray(call) {
        return withDoubleArray(this.mod, this.nTriangles * this.edgeStride, call);
    }
    cellInts(_idx, call) {
        return scratch(this.mod, 20, (p) => {
            raiseForCode(call(p, p + 16));
            const nv = Math.max(0, Math.min(this.mod.getValue(p + 16, "i32"), 4));
            return Array.from({ length: nv }, (_, k) => this.mod.getValue(p + 4 * k, "i32"));
        });
    }
    ints3(call) {
        return scratch(this.mod, 12, (p) => {
            raiseForCode(call(p));
            return [
                this.mod.getValue(p, "i32"),
                this.mod.getValue(p + 4, "i32"),
                this.mod.getValue(p + 8, "i32"),
            ];
        });
    }
    doubles3(call) {
        return scratch(this.mod, 24, (p) => {
            raiseForCode(call(p));
            return [
                this.mod.getValue(p, "double"),
                this.mod.getValue(p + 8, "double"),
                this.mod.getValue(p + 16, "double"),
            ];
        });
    }
}
function forcing(opts) {
    return [opts.mode ?? SurfaceForcingMode.OVERRIDE, opts.persist ?? ForcingPersist.RESET];
}
// =============================================================================
// Infiltration2D
// =============================================================================
const ROW = STRUCTS.SWMM_Infil2DRow;
const MAX_PARAMS = ROW.fields.p.count;
/**
 * Per-cell infiltration on the 2D mesh (`solver.surface2d.infiltration`).
 *
 * Rows are positional and in project units, as legacy `[INFILTRATION]`
 * (see {@link Infil2DRow}). Defaults are keyed by triangle tag; a cell's own
 * row overrides its tag's default. Rows can change until initialize.
 */
export class Infiltration2D {
    /** @internal Obtain through {@link Surface2D.infiltration}. */
    constructor(mod, handle, raw) {
        this.mod = mod;
        this.handle = handle;
        this.raw = raw;
    }
    /** Evaluation cadence (s); `<= 0` uses the project `WET_STEP`. */
    get infilStep() {
        return withDouble(this.mod, (p) => this.raw.swmm_infil2d_get_options(this.handle, p));
    }
    set infilStep(seconds) {
        scratch(this.mod, STRUCTS.SWMM_Infil2DOptions.size, (p) => {
            this.mod.setValue(p + STRUCTS.SWMM_Infil2DOptions.fields.infil_step.offset, seconds, "double");
            raiseForCode(this.raw.swmm_infil2d_set_options(this.handle, p));
        });
    }
    /** Tag-keyed default rows, a live mapping (Python `defaults`, `Infil2DDefaults`). */
    get defaults() {
        return new Infil2DDefaults(this);
    }
    /** @internal */
    _defaultTags() {
        const n = withInt(this.mod, (p) => this.raw.swmm_infil2d_defaults_count(this.handle, p));
        return Array.from({ length: n }, (_, i) => withCString(this.mod, TAG_BYTES, (b, len) => this.raw.swmm_infil2d_get_default_tag(this.handle, i, b, len)));
    }
    /** @internal */
    _defaultAt(i) {
        return this.readRow((p) => this.raw.swmm_infil2d_get_default(this.handle, i, p));
    }
    /** Ordered raw records with cell/tag, row and the explicit-destination flag. */
    authoredRows() {
        const mod = this.mod;
        const size = STRUCTS.SWMM_Infil2DAuthoredRow.size;
        const count = withInt(mod, (p) => this.raw.swmm_infil2d_get_authored_rows(this.handle, 0, 0, p));
        return scratch(mod, size * Math.max(count, 1) + 4, (rows) => {
            const written = rows + size * Math.max(count, 1);
            mod.HEAPU8.fill(0, rows, written + 4);
            raiseForCode(this.raw.swmm_infil2d_get_authored_rows(this.handle, rows, count, written));
            return Array.from({ length: mod.HEAP32[written >> 2] }, (_, i) => {
                const r = readStruct(mod, "SWMM_Infil2DAuthoredRow", rows + i * size);
                return {
                    cell: r.cell,
                    tag: r.tag,
                    row: {
                        method: r.row.has_method ? r.row.method : null,
                        params: r.row.p,
                        dest: r.row.dest,
                    },
                    destExplicit: r.dest_explicit !== 0,
                };
            });
        });
    }
    /** Restore ordered records atomically before initialization; an invalid batch changes nothing. */
    replaceAuthoredRows(records) {
        const rows = Array.from(records, (rec) => {
            const tag = rec.tag ?? "";
            if (tag.includes("\0") || new TextEncoder().encode(tag).length >= 4096) {
                throw new RangeError("Tags must fit 4095 UTF-8 bytes and contain no NUL");
            }
            const params = rec.row.params ?? [];
            if (params.length > MAX_PARAMS) {
                throw new BadParamError(`an infiltration row takes at most ${MAX_PARAMS} parameters`);
            }
            return {
                cell: Math.trunc(rec.cell),
                tag,
                row: {
                    has_method: rec.row.method === null ? 0 : 1,
                    method: rec.row.method ?? 0,
                    p: [...params, ...new Array(MAX_PARAMS - params.length).fill(0)],
                    dest: rec.row.dest ?? SurfaceInfilDest.LOST,
                },
                dest_explicit: rec.destExplicit ? 1 : 0,
            };
        });
        withStructs(this.mod, "SWMM_Infil2DAuthoredRow", rows, (p) => raiseForCode(this.raw.swmm_infil2d_replace_authored_rows(this.handle, rows.length ? p : 0, rows.length)));
    }
    /**
     * `[owner, aquiferRow, conflict]` of a cell before initialization. Owners:
     * 0 disabled, 1 surface bank, 2 aquifer. Conflicts: 0 none, 1 explicit cell
     * method, 2 obsolete destination. Aquifer row -1 is implicit.
     */
    ownership(cell) {
        return scratch(this.mod, 12, (p) => {
            this.mod.HEAP32.set([0, -1, 0], p >> 2);
            raiseForCode(this.raw.swmm_infil2d_get_ownership(this.handle, cell, p, p + 4, p + 8));
            const h = this.mod.HEAP32;
            return [h[p >> 2], h[(p >> 2) + 1], h[(p >> 2) + 2]];
        });
    }
    /** Owners, aquifer rows and conflicts of every cell. */
    ownershipBulk() {
        const n = withInt(this.mod, (p) => this.raw.swmm_2d_triangle_count(this.handle, p));
        const m = Math.max(n, 1);
        return scratch(this.mod, 12 * m + 4, (p) => {
            const written = p + 12 * m;
            this.mod.HEAP32[written >> 2] = 0;
            raiseForCode(this.raw.swmm_infil2d_get_ownership_bulk(this.handle, p, p + 4 * m, p + 8 * m, n, written));
            const w = this.mod.HEAP32[written >> 2];
            const col = (k) => new Int32Array(this.mod.HEAPU8.buffer, p + 4 * m * k, w).slice();
            return [col(0), col(1), col(2)];
        });
    }
    /**
     * Frozen-ground state of every triangle: ground slab temperature (°C), the
     * frozen share of its freezable water (0 to 1) and the multiplier applied to
     * the cell's intake (0 to 1). A cell no `[2D_FROZEN_GROUND]` row covers
     * reports 0, 0 and 1.
     */
    frozenGround() {
        const n = withInt(this.mod, (p) => this.raw.swmm_2d_triangle_count(this.handle, p));
        const m = Math.max(n, 1);
        return scratch(this.mod, 24 * m, (p) => {
            raiseForCode(this.raw.swmm_infil2d_get_frozen_ground_bulk(this.handle, p, p + 8 * m, p + 16 * m, m));
            const col = (k) => new Float64Array(this.mod.HEAPU8.buffer, p + 8 * m * k, n).slice();
            return [col(0), col(1), col(2)];
        });
    }
    /** Set (or with `null`, remove) the default row for a triangle tag. */
    setDefault(tag, row) {
        if (row === null) {
            raiseForCode(this.raw.swmm_infil2d_remove_default(this.handle, tag));
            return;
        }
        this.withRow(row, (p) => this.raw.swmm_infil2d_set_default(this.handle, tag, p));
    }
    /** The cell's effective row and whether it is the cell's own. */
    cell(tri) {
        return scratch(this.mod, 4, (flag) => {
            const row = this.readRow((p) => this.raw.swmm_infil2d_get_cell(this.handle, tri, p, flag));
            return { row, isOverride: this.mod.getValue(flag, "i32") !== 0 };
        });
    }
    /** Give a cell its own row, or with `null` return it to its tag's default. */
    setCell(tri, row) {
        if (row === null) {
            raiseForCode(this.raw.swmm_infil2d_set_cell(this.handle, tri, 0));
            return;
        }
        this.withRow(row, (p) => this.raw.swmm_infil2d_set_cell(this.handle, tri, p));
    }
    /** {@link setCell} for many cells at once. */
    setCells(tris, row) {
        const n = tris.length;
        if (n === 0)
            return; // as Python: nothing to set
        scratch(this.mod, 4 * n, (t) => {
            this.mod.HEAP32.set(Array.from(tris), t / 4);
            if (row === null) {
                raiseForCode(this.raw.swmm_infil2d_set_cells(this.handle, t, n, 0));
            }
            else {
                this.withRow(row, (p) => this.raw.swmm_infil2d_set_cells(this.handle, t, n, p));
            }
        });
    }
    /** Current infiltration rate per cell (m/s). */
    rate() {
        const n = withInt(this.mod, (p) => this.raw.swmm_2d_triangle_count(this.handle, p));
        return withDoubleArray(this.mod, n, (p) => this.raw.swmm_infil2d_get_rate_bulk(this.handle, p, n));
    }
    /** Cumulative infiltrated depth per cell (m). */
    cumulative() {
        const n = withInt(this.mod, (p) => this.raw.swmm_2d_triangle_count(this.handle, p));
        return withDoubleArray(this.mod, n, (p) => this.raw.swmm_infil2d_get_cum_bulk(this.handle, p, n));
    }
    /** Total infiltrated volume (m³). */
    get totalVolume() {
        return withDouble(this.mod, (p) => this.raw.swmm_infil2d_get_total_volume(this.handle, p));
    }
    readRow(call) {
        return scratch(this.mod, ROW.size, (p) => {
            this.mod.HEAPU8.fill(0, p, p + ROW.size);
            raiseForCode(call(p));
            const has = this.mod.getValue(p + ROW.fields.has_method.offset, "i32") !== 0;
            const params = Array.from({ length: MAX_PARAMS }, (_, k) => this.mod.getValue(p + ROW.fields.p.offset + 8 * k, "double"));
            return {
                method: has
                    ? this.mod.getValue(p + ROW.fields.method.offset, "i32")
                    : null,
                params,
                dest: has
                    ? this.mod.getValue(p + ROW.fields.dest.offset, "i32")
                    : SurfaceInfilDest.LOST,
            };
        });
    }
    withRow(row, call) {
        const params = row.params ?? [];
        if (params.length > MAX_PARAMS) {
            throw new BadParamError(`an infiltration row takes at most ${MAX_PARAMS} parameters`);
        }
        scratch(this.mod, ROW.size, (p) => {
            this.mod.HEAPU8.fill(0, p, p + ROW.size);
            this.mod.setValue(p + ROW.fields.has_method.offset, row.method === null ? 0 : 1, "i32");
            this.mod.setValue(p + ROW.fields.method.offset, row.method ?? 0, "i32");
            params.forEach((v, k) => this.mod.setValue(p + ROW.fields.p.offset + 8 * k, v, "double"));
            this.mod.setValue(p + ROW.fields.dest.offset, row.dest ?? SurfaceInfilDest.LOST, "i32");
            raiseForCode(call(p));
        });
    }
}
function ownerIndices(rows) {
    const values = Array.from(rows, (v) => Math.trunc(v));
    if (values.some((v) => !(v >= 0 && v <= 2147483647))) {
        throw new RangeError("Ownership indices must be nonnegative C integers");
    }
    return values;
}
/**
 * `surface2d.infiltration.defaults`: tag → {@link Infil2DRow}, a live view of
 * `[2D_INFILTRATION_DEFAULTS]` (`"*"` is the mesh-wide fallback). Writes are
 * accepted before the solver initializes.
 */
export class Infil2DDefaults {
    /** @internal */
    constructor(_view) {
        this._view = _view;
    }
    get length() {
        return this._view._defaultTags().length;
    }
    /** The tags, in file order. */
    [Symbol.iterator]() {
        return this._view._defaultTags()[Symbol.iterator]();
    }
    /** `[tag, row]` pairs in file order. */
    entries() {
        return this._view._defaultTags().map((tag, i) => [tag, this._view._defaultAt(i)]);
    }
    has(tag) {
        return this._view._defaultTags().includes(tag);
    }
    get(tag) {
        const i = this._view._defaultTags().indexOf(tag);
        if (i < 0)
            throw new ElementNotFoundError(tag);
        return this._view._defaultAt(i);
    }
    set(tag, row) {
        this._view.setDefault(tag, row);
    }
    delete(tag) {
        if (!this.has(tag))
            throw new ElementNotFoundError(tag);
        this._view.setDefault(tag, null);
    }
}
//# sourceMappingURL=Surface2D.js.map