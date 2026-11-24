/**
 * @file Solver.ts
 * @brief Main engine lifecycle controller for the OpenSWMM WASM bindings.
 *
 * @details Mirrors the Python `_solver.pyi` specification. `Solver` wraps the
 * full lifecycle of a SWMM engine context:
 *
 * ```
 * create → open → initialize → start → [step/stride …] → end → report → close → destroy
 * ```
 *
 * The class also exposes typed accessors for nodes, links, subcatchments,
 * gages, controls, forcing, transport and the 2D surface ({@link Solver.surface2d}).
 *
 * ### Virtual filesystem
 * The WASM engine uses the Emscripten MEMFS virtual filesystem. Call
 * {@link Solver.writeFile} to upload .inp, hot-start, and other files before
 * opening the engine. After the simulation you can read the .rpt/.out files
 * back with {@link Solver.readFile}.
 *
 * ### Example
 * ```ts
 * import createOpenSwmmModule from "./dist/openswmm_engine.js";
 * import { Solver } from "@hydrocouple/openswmm-engine-wasm";
 *
 * const mod = await createOpenSwmmModule();
 * const solver = new Solver(mod);
 *
 * solver.writeFile("/model.inp", inpBytes);
 * solver.open("/model.inp", "/model.rpt", "/model.out");
 * solver.initialize();
 * solver.start(true);
 *
 * while (solver.step() > 0) {
 *   const depths = solver.nodes.depths;
 *   // … react to state …
 * }
 *
 * solver.end();
 * solver.report();
 * solver.close();
 * solver.destroy();
 *
 * const rpt = solver.readFile("/model.rpt", "utf8");
 * console.log(rpt);
 * ```
 *
 * @author   Caleb Buahin <caleb.buahin@gmail.com>
 * @copyright Copyright (c) 2026 Caleb Buahin. All rights reserved.
 * @license  Apache-2.0
 */
import { EngineState, FilePathRole } from "./enums.js";
import { BadHandleError, EngineError, LifecycleError, raiseForCode } from "./errors.js";
import { Nodes } from "./Nodes.js";
import { Links } from "./Links.js";
import { Subcatchments } from "./Subcatchments.js";
import { Gages } from "./Gages.js";
import { SECONDS_PER_DAY } from "./units.js";
import { Controls } from "./Controls.js";
import { Transport, effectiveThreads, threadInfo, transportMatrix, } from "./Transport.js";
import { Forcing } from "./Forcing.js";
import { Fields } from "./Fields.js";
import { Surface2D } from "./Surface2D.js";
import { Patterns, Tables } from "./Tables.js";
import { CALLBACK_SIGNATURES } from "./raw.js";
import { checkedAlloc, rawOf, withCString, withCStrings, withDouble, withDoubleInput, withInt, } from "./mem.js";
import { datetimeToOadate, oadateToDatetime } from "./dates.js";
import { EventsView, SimulationOptions, UserFlags } from "./SolverViews.js";
import { Snow } from "./Snow.js";
import { Aquifers, Snowpacks } from "./NamedObjects.js";
import { InitialQuality } from "./InitialQuality.js";
import { MassBalance } from "./MassBalance.js";
import { Pollutants } from "./Pollutants.js";
import { Quality } from "./Quality.js";
import { Climate } from "./Climate.js";
import { Statistics } from "./Statistics.js";
import { Inflows } from "./Inflows.js";
import { Checkpoints } from "./Checkpoints.js";
import { SaveSchedule } from "./HotStart.js";
import { Results } from "./Results.js";
import { Spatial } from "./Spatial.js";
import { ModelEditor } from "./Edit.js";
import { Infrastructure } from "./Infrastructure.js";
import { ProcessComponents } from "./ProcessComponents.js";
import { WaterAge } from "./WaterAge.js";
import { Reactions } from "./Reactions.js";
import { Heat } from "./Heat.js";
import { Coupling } from "./Coupling.js";
import { MaterialSplitParticipant, SplitParticipant } from "./Split.js";
import { PassiveExchange } from "./PassiveExchange.js";
/** Plugin id of the built-in GeoPackage model writer. */
const GEOPACKAGE_PLUGIN_ID = "org.hydrocouple.openswmm.plugins.geopackage";
// =============================================================================
// Solver
// =============================================================================
/**
 * Lifecycle controller for a SWMM engine instance.
 *
 * Each `Solver` manages exactly one `SWMM_Engine` handle. The handle is
 * created in the constructor and destroyed in {@link Solver.destroy} (or when
 * used as a `using` resource in environments that support the TC39
 * Explicit Resource Management proposal).
 */
export class Solver {
    get handle() {
        this._assertAlive();
        return this._handle;
    }
    _assertAlive() {
        if (!this._handle)
            throw new BadHandleError("Solver has been destroyed");
    }
    _invalidateViews() {
        this._generation++;
        this.nodes.generation++;
        this.links.generation++;
        this.subcatchments.generation++;
        this.gages.generation++;
        this.tables.generation++;
        this.patterns.generation++;
    }
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    /**
     * Create a new engine context and domain collection wrappers.
     *
     * @param mod             The Emscripten module returned by `createOpenSwmmModule()`.
     * @param existingHandle  Optional existing engine handle (e.g. from {@link ModelBuilder.toSolver}).
     *                        When provided, the solver takes ownership of this handle without
     *                        calling `swmm_engine_create`.
     * @throws {@link EngineError} if a new engine context cannot be allocated.
     */
    constructor(mod, existingHandle) {
        /** @internal */
        this._generation = 0;
        /** @internal First error a JavaScript callback raised during the current native call. */
        this._callbackError = undefined;
        /** @internal Function-table slots of the registered callbacks, by kind. */
        this._callbackSlots = new Map();
        /** @internal Cleanup of the state a registered callback keeps, by kind. */
        this._callbackReleases = new Map();
        /** @internal Paths of the last open (Python `_inp`, `_out`). */
        this._inp = "";
        this._out = "";
        /** @internal Native calls in progress that can run JavaScript callbacks. */
        this._active = 0;
        this._mod = mod;
        this._raw = rawOf(mod);
        let h;
        if (existingHandle !== undefined && existingHandle !== 0) {
            h = existingHandle;
        }
        else {
            h = rawOf(mod).swmm_engine_create();
            if (!h)
                throw new EngineError(7, "swmm_engine_create() returned NULL");
        }
        this._handle = h;
        this.nodes = new Nodes(mod, h, () => this._assertAlive(), this);
        this.links = new Links(mod, h, () => this._assertAlive(), this);
        this.subcatchments = new Subcatchments(mod, h, () => this._assertAlive(), this);
        this.gages = new Gages(mod, h, () => this._assertAlive(), this);
        this.controls = new Controls(mod, h, () => this._assertAlive());
        this.transport = new Transport(mod, h, () => this._assertAlive());
        this.forcing = new Forcing(mod, h, () => this._assertAlive());
        this.surface2d = new Surface2D(mod, h, () => this._assertAlive(), this);
        this.fields = new Fields(mod, () => this.handle);
        this.tables = new Tables(mod, h, this, () => this._assertAlive());
        this.patterns = new Patterns(mod, h, this, () => this._assertAlive());
        const host = {
            mod,
            raw: this._raw,
            solver: this,
            get handle() {
                return this.solver.handle;
            },
        };
        this.options = new SimulationOptions(host);
        this.userflags = new UserFlags(host);
        this.events = new EventsView(host);
    }
    // -------------------------------------------------------------------------
    // Virtual filesystem helpers
    // -------------------------------------------------------------------------
    /**
     * Write bytes or a string to the Emscripten virtual filesystem.
     *
     * @param path  Absolute path inside the WASM virtual filesystem.
     * @param data  File contents.
     */
    writeFile(path, data) {
        this._mod.FS.writeFile(path, data);
    }
    /**
     * Read a file from the virtual filesystem.
     */
    readFile(path, encoding) {
        if (encoding === "utf8") {
            return this._mod.FS.readFile(path, { encoding: "utf8" });
        }
        return this._mod.FS.readFile(path, { encoding: "binary" });
    }
    /** Save the currently opened model to a file in the virtual filesystem. */
    writeModel(path, outputPluginId = "") {
        this._requireIdle();
        const h = this.handle;
        const rc = this._operation(() => outputPluginId
            ? this._raw.swmm_model_write_with_plugin(h, path, outputPluginId)
            : this._raw.swmm_model_write(h, path));
        this._rethrowCallbackError();
        raiseForCode(rc, rc ? this._raw.swmm_get_last_error_msg(h) : undefined);
    }
    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------
    /**
     * Allow the engine to continue past non-fatal parse errors.
     *
     * Must be called before {@link Solver.open}.
     *
     * @param on  `true` to enable lenient mode.
     */
    setLenientOpen(on) {
        this._raw.swmm_engine_set_lenient_open(this.handle, on ? 1 : 0);
    }
    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------
    /**
     * Open a SWMM model from .inp/.rpt/.out paths on the virtual filesystem.
     *
     * @param inp        Path to the SWMM input (.inp) file.
     * @param rpt        Path where the report (.rpt) file will be written.
     * @param out        Path where the binary output (.out) file will be written.
     * @param pluginLib  Optional path to a SWMM plugin library (pass `""` if none).
     *
     * @throws {@link FileError}   if any file path is inaccessible.
     * @throws {@link ParseError}  if the input file contains errors (unless
     *                              lenient mode is enabled).
     * @throws {@link LifecycleError} if the engine is not in `CREATED` state.
     */
    open(inp, rpt, out, pluginLib = "") {
        this._requireIdle();
        this._invalidateViews();
        this._inp = inp;
        this._out = out;
        const rc = this._operation(() => this._raw.swmm_engine_open(this.handle, inp, rpt, out, pluginLib || null));
        this._rethrowCallbackError();
        if (rc !== 0) {
            const msg = this._raw.swmm_get_last_error_msg(this.handle);
            raiseForCode(rc, msg);
        }
    }
    /**
     * Apply initial conditions to the opened model.
     *
     * @throws {@link LifecycleError} if not in `OPENED` state.
     */
    initialize() {
        this._requireIdle();
        const rc = this._operation(() => this._raw.swmm_engine_initialize(this.handle));
        this._rethrowCallbackError();
        if (rc !== 0) {
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
        }
    }
    /**
     * Prepare the solver for time-stepping.
     *
     * @param saveResults  Write results to the binary output file (default: `true`).
     * @throws {@link LifecycleError} if not in `INITIALIZED` state.
     */
    start(saveResults = true) {
        this._requireIdle();
        const rc = this._operation(() => this._raw.swmm_engine_start(this.handle, saveResults ? 1 : 0));
        this._rethrowCallbackError();
        if (rc !== 0) {
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
        }
    }
    /**
     * Advance the simulation by one routing step.
     *
     * @returns Elapsed simulation time in seconds since the simulation start.
     *          Returns `0` when the simulation has reached its end time.
     *
     * @throws {@link NumericalError}  on divergence.
     * @throws {@link LifecycleError}  if not in `STARTED` or `RUNNING` state.
     */
    step() {
        this._requireIdle();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            const rc = this._operation(() => this._raw.swmm_engine_step(this.handle, ptr));
            this._rethrowCallbackError();
            if (rc !== 0) {
                raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
            }
            // Elapsed is in OA days; convert to seconds.
            return this._mod.getValue(ptr, "double") * SECONDS_PER_DAY;
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /**
     * Advance the simulation by `nSteps` routing steps.
     *
     * @param nSteps  Number of routing steps to take.
     * @returns Elapsed simulation time in seconds after the stride.
     *          Returns `0` when the end time has been reached.
     */
    stride(nSteps) {
        this._requireIdle();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            const rc = this._operation(() => this._raw.swmm_engine_stride(this.handle, nSteps, ptr));
            this._rethrowCallbackError();
            if (rc !== 0) {
                raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
            }
            return this._mod.getValue(ptr, "double") * SECONDS_PER_DAY;
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /**
     * Finalize the simulation (compute mass balances, etc.).
     *
     * @throws {@link LifecycleError} if not in `RUNNING` or `STARTED` state.
     */
    end() {
        this._requireIdle();
        const rc = this._operation(() => this._raw.swmm_engine_end(this.handle));
        this._rethrowCallbackError();
        if (rc !== 0) {
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
        }
    }
    /**
     * Write the human-readable report to the .rpt file.
     *
     * @throws {@link LifecycleError} if not in `ENDED` state.
     */
    report() {
        this._requireIdle();
        const rc = this._operation(() => this._raw.swmm_engine_report(this.handle));
        this._rethrowCallbackError();
        if (rc !== 0) {
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
        }
    }
    /**
     * Release simulation memory (but keep the handle valid for re-open).
     *
     * @throws {@link LifecycleError} if not in `ENDED` state.
     */
    close() {
        this._requireIdle();
        this._invalidateViews();
        const rc = this._operation(() => this._raw.swmm_engine_close(this.handle));
        this._rethrowCallbackError();
        if (rc !== 0) {
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
        }
    }
    /**
     * Free the engine context. After calling `destroy` this `Solver` instance
     * must not be used.
     */
    destroy() {
        if (!this._handle)
            return;
        this._requireIdle();
        this._raw.swmm_engine_destroy(this._handle);
        this._handle = 0;
        for (const slot of this._callbackSlots.values())
            this._mod.removeFunction(slot);
        this._callbackSlots.clear();
        for (const release of this._callbackReleases.values())
            release();
        this._callbackReleases.clear();
        this._invalidateViews();
    }
    /**
     * Run a complete simulation from open to close in a single call.
     *
     * The engine is opened, initialized, started, stepped until completion,
     * ended, reported, and closed. The handle remains valid for inspection or
     * re-opening; call {@link Solver.destroy} when done.
     *
     * @param inp         .inp file path (virtual FS).
     * @param rpt         .rpt file path (virtual FS).
     * @param out         .out file path (virtual FS).
     * @param saveResults Write binary output (default `true`).
     * @param pluginLib   Optional plugin library path.
     */
    run(inp, rpt, out, saveResults = true, pluginLib = "") {
        let opened = false;
        try {
            this.open(inp, rpt, out, pluginLib);
            opened = true;
            this.initialize();
            this.start(saveResults);
            while (this.step() > 0) {
                /* step until completion */
            }
            this.end();
            this.report();
            this.close();
        }
        catch (error) {
            try {
                if (opened)
                    this.close();
            }
            catch (cleanupError) {
                if (error instanceof Error) {
                    error.message += `; cleanup also failed: ${String(cleanupError)}`;
                }
            }
            finally {
                this.destroy();
            }
            throw error;
        }
    }
    // -------------------------------------------------------------------------
    // State & time queries
    // -------------------------------------------------------------------------
    /**
     * Current lifecycle state of the engine.
     */
    get state() {
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_engine_get_state(this.handle, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Configured simulation start (`[OPTIONS] START_DATE/TIME`, UTC wall clock). */
    get startDatetime() {
        return this._oadate(this._raw.swmm_options_get_start_date);
    }
    set startDatetime(value) {
        raiseForCode(this._raw.swmm_options_set_start_date(this.handle, datetimeToOadate(value)));
    }
    /** Configured simulation end (`[OPTIONS] END_DATE/TIME`). */
    get endDatetime() {
        return this._oadate(this._raw.swmm_options_get_end_date);
    }
    set endDatetime(value) {
        raiseForCode(this._raw.swmm_options_set_end_date(this.handle, datetimeToOadate(value)));
    }
    /** Configured report start (`[OPTIONS] REPORT_START_DATE/TIME`). */
    get reportStartDatetime() {
        return this._oadate(this._raw.swmm_options_get_report_start);
    }
    set reportStartDatetime(value) {
        raiseForCode(this._raw.swmm_options_set_report_start(this.handle, datetimeToOadate(value)));
    }
    /** Resolved simulation start the engine runs from (`swmm_get_start_time`). */
    get simStartTime() {
        return this._oadate(this._raw.swmm_get_start_time);
    }
    /** Resolved simulation end (`swmm_get_end_time`). */
    get simEndTime() {
        return this._oadate(this._raw.swmm_get_end_time);
    }
    /** @internal Read an OADate through `getter(engine, double*)`. */
    _oadate(getter) {
        return oadateToDatetime(withDouble(this._mod, (p) => getter(this.handle, p)));
    }
    /**
     * Current simulation date/time.
     * Only valid during and after the simulation loop.
     */
    get currentDatetime() {
        // swmm_get_current_time reports ELAPSED SECONDS since the start, not an
        // OADate (Python's current_datetime makes the same correction).
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_get_current_time(this.handle, ptr));
            const elapsedSeconds = this._mod.getValue(ptr, "double");
            return new Date(this.simStartTime.getTime() + elapsedSeconds * 1000);
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /**
     * Hydraulic routing time step (seconds).
     * Only valid after {@link Solver.initialize}.
     */
    get routingStep() {
        const ptr = checkedAlloc(this._mod, 8);
        try {
            raiseForCode(this._raw.swmm_get_routing_step(this.handle, ptr));
            return this._mod.getValue(ptr, "double");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /**
     * Flow unit system in use.
     * Only valid after {@link Solver.open}.
     */
    get flowUnits() {
        const ptr = checkedAlloc(this._mod, 4);
        try {
            raiseForCode(this._raw.swmm_get_flow_units(this.handle, ptr));
            return this._mod.getValue(ptr, "i32");
        }
        finally {
            this._mod._free(ptr);
        }
    }
    // -------------------------------------------------------------------------
    // Error helpers
    // -------------------------------------------------------------------------
    /**
     * Return the last C API error code (0 = no error).
     */
    get lastErrorCode() {
        return this._raw.swmm_get_last_error(this.handle);
    }
    /**
     * Return the last C API error message string (empty if no error).
     */
    get lastErrorMessage() {
        return this._raw.swmm_get_last_error_msg(this.handle) ?? "";
    }
    /**
     * Translate a numeric error code to a human-readable message string.
     */
    errorMessage(code) {
        return this._raw.swmm_error_message(code) ?? "";
    }
    // -------------------------------------------------------------------------
    // Python Solver members (wave A4)
    // -------------------------------------------------------------------------
    /** Model generation: bumped on open/close; views from an older generation are stale. */
    get generation() {
        return this._generation;
    }
    /** @internal The WASM module this solver runs in. */
    get module() {
        return this._mod;
    }
    /**
     * @internal Run a native call that may call back into JavaScript (Python
     * `_operation`); lifecycle calls are refused until it returns.
     */
    _operation(fn) {
        this._active++;
        try {
            return fn();
        }
        finally {
            this._active--;
        }
    }
    /** @internal Python `require_idle`: no lifecycle change from a native call or callback. */
    _requireIdle() {
        if (this._active) {
            throw new LifecycleError("Cannot change lifecycle during a native call or callback");
        }
    }
    /** @internal A structural edit happened: invalidate views, as Python's `_bump_generation`. */
    _bumpGeneration() {
        this._invalidateViews();
    }
    /** Snow model, UEB packs, radiation and snow state (Python `solver.snow`). */
    get snow() {
        return new Snow(this);
    }
    /** The `[AQUIFERS]` entries (Python `solver.aquifers`). */
    get aquifers() {
        return new Aquifers(this);
    }
    /** The `[SNOWPACKS]` entries (Python `solver.snowpacks`). */
    get snowpacks() {
        return new Snowpacks(this);
    }
    /** The `[POLLUTANTS]` entries (Python `solver.pollutants`). */
    get pollutants() {
        return new Pollutants(this);
    }
    /** Land uses, buildup, washoff and treatment (Python `solver.quality`). */
    get quality() {
        return new Quality(this);
    }
    /** The `[INITIAL_QUALITY]` rows (Python `solver.initial_quality`). */
    get initialQuality() {
        return new InitialQuality(this);
    }
    /** Continuity errors and totals (Python `solver.mass_balance`). */
    get massBalance() {
        return new MassBalance(this);
    }
    /** Temperature, evaporation, wind, humidity and snowmelt settings (Python `solver.climate`). */
    get climate() {
        return new Climate(this);
    }
    /** Run statistics and report summary tables (Python `solver.statistics`). */
    get statistics() {
        return new Statistics(this);
    }
    /** External, dry-weather and RDII inflows and unit hydrographs (Python `solver.inflows`). */
    get inflows() {
        return new Inflows(this);
    }
    /**
     * Delete objects with their references, undo recorded deletes, convert
     * types, split and fuse conduits (Python `solver.editor`).
     */
    get editor() {
        this._assertAlive();
        return (this._editor ?? (this._editor = new ModelEditor(this)));
    }
    /** The `[PROCESS_COMPONENTS]` registrations (Python `solver.process_components`). */
    get processComponents() {
        return new ProcessComponents(this);
    }
    /** Two-zone aquifer authoring and runtime snapshots (Python `solver.groundwater2d`; `surface2d.groundwater`). */
    get groundwater2d() {
        return this.surface2d.groundwater;
    }
    /** Heat-transport configuration and diagnostics (Python `solver.heat`). */
    get heat() {
        return new Heat(this);
    }
    /**
     * Authored frozen-ground rows as `{ name: values }`: `[FROZEN_GROUND]`
     * (subcatchments or `*`), or with `mesh` `[2D_FROZEN_GROUND]` (mesh tags or
     * `*`). Each row has ten values: thickness (m), conductivity (W/m/K), heat
     * capacity (J/m³/K), freezable water content, deep temperature (°C), deep
     * depth (m), initial temperature (°C), exponent, snow conductivity (W/m/K)
     * and snow density (kg/m³).
     */
    frozenGroundRows(mesh = false) {
        const h = this.handle;
        const target = mesh ? 1 : 0;
        const n = withInt(this._mod, (p) => this._raw.swmm_frozen_ground_count(h, target, p));
        const values = checkedAlloc(this._mod, 80);
        try {
            const rows = {};
            for (let i = 0; i < n; i++) {
                const name = withCString(this._mod, 256, (buf, len) => this._raw.swmm_frozen_ground_get(h, target, i, buf, len, values));
                rows[name] = Array.from(this._mod.HEAPF64.subarray(values >> 3, (values >> 3) + 10));
            }
            return rows;
        }
        finally {
            this._mod._free(values);
        }
    }
    /**
     * Add or replace one frozen-ground row (see {@link frozenGroundRows}). The
     * row is authored input and takes effect when the model is next initialized.
     */
    setFrozenGround(name, values, mesh = false) {
        if (values.length !== 10)
            throw new RangeError("a frozen-ground row has ten values");
        const h = this.handle;
        withDoubleInput(this._mod, Array.from(values), (p) => this._raw.swmm_frozen_ground_set(h, mesh ? 1 : 0, name, p));
    }
    /** Remove the frozen-ground row with this name. */
    removeFrozenGround(name, mesh = false) {
        raiseForCode(this._raw.swmm_frozen_ground_remove(this.handle, mesh ? 1 : 0, name));
    }
    /** Runtime exchange sources, boundaries and forcing of the default provider (Python `solver.coupling`). */
    get coupling() {
        return new Coupling(this);
    }
    /** Experimental native water peer and owned phase snapshots (Python `solver.split`). */
    get split() {
        return new SplitParticipant(this);
    }
    /** Experimental in-process material peer and schema-10 packet codec (Python `solver.material_split`). */
    get materialSplit() {
        return new MaterialSplitParticipant(this);
    }
    /** Experimental integrated passive exchange and exact V1 observations (Python `solver.passive_exchange`). */
    get passiveExchange() {
        return new PassiveExchange(this);
    }
    /** The multi-species reaction system, `[REACTION_*]` / `.rxn` (Python `solver.reactions`). */
    get reactions() {
        return new Reactions(this);
    }
    /** The `[WATER_AGE_SOURCES]` table (Python `solver.water_age`). */
    get waterAge() {
        return new WaterAge(this);
    }
    /** Process-wide hardware and OpenMP limits (Python `solver.thread_info`). */
    get threadInfo() {
        return threadInfo(this._mod);
    }
    /** Thread team sizes for this model; 0 requests automatic selection. */
    effectiveThreads(requested = 0) {
        return effectiveThreads(this, requested);
    }
    /** Transport capability matrix keyed by domain and species class, with reasons. */
    get transportMatrix() {
        return transportMatrix(this);
    }
    /** Transects, streets, inlets, inlet placements and LIDs (Python `solver.infrastructure`). */
    get infrastructure() {
        return new Infrastructure(this);
    }
    /**
     * Write the model to an OGC GeoPackage (`.gpkg`) with the built-in writer:
     * nodes, links, subcatchments and rain gages as feature layers. A `crs`
     * (e.g. `"EPSG:2284"`) is applied through `spatial.crs` first so features
     * carry that SRS; without one the model's CRS is kept.
     */
    writeGeopackage(path, crs = null) {
        if (crs !== null)
            this.spatial.crs = crs;
        this.writeWithPlugin(path, GEOPACKAGE_PLUGIN_ID);
    }
    /** Coordinates, polygons, `[MAP]` and the CRS (Python `solver.spatial`). */
    get spatial() {
        return new Spatial(this);
    }
    /** Engine checkpoint sessions (Python `solver.checkpoints`). */
    get checkpoints() {
        return new Checkpoints(this);
    }
    /** The `[SAVE HOTSTART]` schedule (Python `solver.save_schedule`). */
    get saveSchedule() {
        return new SaveSchedule(this);
    }
    /**
     * Python's `create()`. The constructor already creates the engine, so this
     * only checks it is alive; a destroyed solver cannot be recreated (make a new one).
     */
    create() {
        this._assertAlive();
        this._requireIdle();
    }
    /**
     * Open only the model's metadata (no simulation state), for inspecting or
     * editing a model without running it.
     */
    openMetadata(inp) {
        this._requireIdle();
        this._invalidateViews();
        this._inp = inp;
        const rc = this._operation(() => this._raw.swmm_engine_open_metadata(this.handle, inp));
        this._rethrowCallbackError();
        if (rc !== 0)
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
    }
    /**
     * Open the model only as far as its simulation period: the 2D mesh and the
     * rows that address its cells are skipped, so a large 2D model opens fast.
     */
    openSimulationPeriod(inp) {
        this._requireIdle();
        this._invalidateViews();
        this._inp = inp;
        const rc = this._operation(() => this._raw.swmm_engine_open_simulation_period(this.handle, inp));
        this._rethrowCallbackError();
        if (rc !== 0)
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
    }
    /**
     * Step until the elapsed time reaches `seconds` (or the run ends).
     * @returns Elapsed seconds actually reached.
     */
    advanceTo(seconds) {
        this._requireIdle();
        const ptr = checkedAlloc(this._mod, 8);
        try {
            const rc = this._operation(() => this._raw.swmm_engine_advance_to(this.handle, seconds, ptr));
            this._rethrowCallbackError();
            if (rc !== 0)
                raiseForCode(rc, this._raw.swmm_get_last_error_msg(this.handle));
            return this._mod.HEAPF64[ptr >> 3];
        }
        finally {
            this._mod._free(ptr);
        }
    }
    /** Step to the end, yielding the elapsed seconds after each routing step. */
    *steps() {
        for (;;) {
            const elapsed = this.step();
            if (!elapsed)
                return;
            yield elapsed;
        }
    }
    /**
     * Step until `target`: a `Date` (UTC wall clock) or elapsed seconds from the
     * configured start. Returns the elapsed seconds reached, which is less than
     * the target when the run ends first (0 at the end, like {@link step}).
     */
    until(target) {
        const targetSeconds = target instanceof Date ? (target.getTime() - this.startDatetime.getTime()) / 1000 : target;
        if (typeof targetSeconds !== "number" || Number.isNaN(targetSeconds)) {
            throw new TypeError("until(target) expects a Date or elapsed seconds");
        }
        const now = this.elapsed;
        if (targetSeconds <= now)
            return now;
        for (;;) {
            const elapsed = this.step();
            if (!elapsed || elapsed >= targetSeconds)
                return elapsed;
        }
    }
    /** Elapsed simulation time in seconds. */
    get elapsed() {
        return withDouble(this._mod, (p) => this._raw.swmm_engine_get_elapsed_seconds(this.handle, p));
    }
    /** Errors recorded while opening the model (lenient open keeps going). */
    get openErrors() {
        const h = this.handle;
        const n = this._raw.swmm_get_error_count(h);
        return Array.from({ length: n }, (_, i) => this._raw.swmm_get_error_at(h, i) ?? "");
    }
    /** Warnings recorded while opening or writing the model. */
    get openWarnings() {
        const h = this.handle;
        const n = this._raw.swmm_get_warning_count(h);
        return Array.from({ length: n }, (_, i) => this._raw.swmm_get_warning_at(h, i) ?? "");
    }
    /**
     * Open result readers for this solver's files (Python `open_results`).
     * Call after {@link end}; while the engine is alive the configured 2D
     * `OUTPUT_FILE` is found automatically (relative paths resolve against the
     * input file's folder), after {@link destroy} pass `surface`. With `live`,
     * only the binary 1D output is opened, during a run. The returned
     * {@link Results} owns its readers and is closed separately.
     */
    openResults({ surface, live = false, } = {}) {
        this._requireIdle();
        let surfacePath = surface ?? null;
        if (this._handle) {
            const state = this.state;
            if (!live && state !== EngineState.ENDED && state !== EngineState.CLOSED) {
                throw new LifecycleError("Call end() before opening saved results, or use live for 1D output");
            }
            if (surfacePath === null && !live) {
                let configured = "";
                try {
                    const [absolute, original] = withCStrings(this._mod, 4096, 2, ([a, o], len) => this._raw.swmm_file_path_get(this._handle, FilePathRole.OUTPUT_2D, "", a, len, o, len));
                    configured = absolute || original;
                }
                catch (err) {
                    if (!(err instanceof EngineError))
                        throw err;
                }
                if (configured) {
                    const slash = this._inp.lastIndexOf("/");
                    const folder = slash < 0 ? "." : this._inp.slice(0, slash) || "/";
                    surfacePath = configured.startsWith("/") ? configured : `${folder}/${configured}`;
                }
            }
        }
        return Results.open(this._mod, this._out || null, { surface: surfacePath, live });
    }
    /** Coordinate reference system of the model (empty when none). */
    get crs() {
        return withCString(this._mod, 1024, (buf, len) => this._raw.swmm_get_crs(this.handle, buf, len));
    }
    /** True while the current time falls between `[EVENTS]` periods. */
    get isBetweenEvents() {
        return withInt(this._mod, (p) => this._raw.swmm_is_between_events(this.handle, p)) !== 0;
    }
    /** Skip steady-state periods (`[OPTIONS] SKIP_STEADY_STATE`). */
    get steadyStateSkip() {
        return withInt(this._mod, (p) => this._raw.swmm_get_steady_state_skip(this.handle, p)) !== 0;
    }
    set steadyStateSkip(value) {
        raiseForCode(this._raw.swmm_set_steady_state_skip(this.handle, value ? 1 : 0));
    }
    /** Number of `[EVENTS]` entries. */
    get eventCount() {
        return withInt(this._mod, (p) => this._raw.swmm_get_event_count(this.handle, p));
    }
    /** `"US"` (CFS, GPM, MGD) or `"SI"` (CMS, LPS, MLD). */
    get unitSystem() {
        return withInt(this._mod, (p) => this._raw.swmm_get_unit_system(this.handle, p)) === 1
            ? "SI"
            : "US";
    }
    /** Write the model to an `.inp` file (Python `write`). */
    write(path) {
        this.writeModel(path);
    }
    /** Write the model through an output plugin (`""` = built-in INP writer). */
    writeWithPlugin(path, outputPluginId = "") {
        this.writeModel(path, outputPluginId);
    }
    /**
     * Write FULL, OpenSWMM-legacy or stock EPA SWMM 5 input ({@link InpProfile}).
     * Conversion warnings appear in {@link openWarnings}; the model is unchanged.
     */
    writeCompat(path, profile) {
        this._requireIdle();
        const h = this.handle;
        const rc = this._operation(() => this._raw.swmm_model_write_compat(h, path, profile));
        this._rethrowCallbackError();
        if (rc !== 0)
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(h));
    }
    /**
     * Write the built-in INP outputs to staging paths: `mapper(finalPath, kind)`
     * (kind 0 = model, 1 = mesh, 2 = component configuration) returns where to
     * write each output, or `null` to refuse it. References stay relative to
     * `finalPath`; publishing the staged files is up to the caller. The mapper
     * must not use the engine.
     */
    writeStaged(finalPath, mapper) {
        const mod = this._mod;
        let current = 0;
        let failure = undefined;
        const release = () => {
            if (current)
                mod._free(current);
            current = 0;
        };
        const slot = mod.addFunction((_user, pathPtr, kind) => {
            release();
            if (failure !== undefined)
                return 0;
            try {
                const staged = mapper(mod.UTF8ToString(pathPtr), kind);
                if (!staged)
                    return 0;
                const bytes = mod.lengthBytesUTF8(staged) + 1;
                current = checkedAlloc(mod, bytes);
                mod.stringToUTF8(staged, current, bytes);
                return current;
            }
            catch (err) {
                failure = err;
                return 0;
            }
        }, "iiii");
        try {
            const h = this.handle;
            const rc = this._operation(() => this._raw.swmm_model_write_staged(h, finalPath, slot, 0));
            if (failure !== undefined)
                throw failure;
            this._rethrowCallbackError();
            if (rc !== 0)
                raiseForCode(rc, this._raw.swmm_get_last_error_msg(h));
        }
        finally {
            release();
            mod.removeFunction(slot);
        }
    }
    /** Open a runoff interface file to save runoff results into. */
    openRunoffInterfaceWrite(path) {
        raiseForCode(this._raw.swmm_runoff_iface_open_write(this.handle, path));
    }
    /** Open a runoff interface file to route previously saved runoff. */
    openRunoffInterfaceRead(path) {
        raiseForCode(this._raw.swmm_runoff_iface_open_read(this.handle, path));
    }
    /** Save the current runoff step (`dt` in seconds) to the interface file. */
    saveRunoffStep(dt) {
        raiseForCode(this._raw.swmm_runoff_iface_save_step(this.handle, dt));
    }
    /** Read the next runoff step; false when the file has no more data. */
    readRunoffStep() {
        return withInt(this._mod, (p) => this._raw.swmm_runoff_iface_read_step(this.handle, p)) !== 0;
    }
    /** Close the runoff interface file. */
    closeRunoffInterface() {
        raiseForCode(this._raw.swmm_runoff_iface_close(this.handle));
    }
    // ---- callbacks ------------------------------------------------------------
    //
    // A callback must not throw across the engine's C++ frames, so each one is
    // wrapped: its first error is kept, later callbacks of the same native call
    // are skipped, and the error is rethrown when that call returns. `null`
    // removes the callback. Callbacks may read the model; they must not change
    // it or call back into stepping.
    /** @internal Rethrow the first error a callback raised during the last native call. */
    _rethrowCallbackError() {
        if (this._callbackError !== undefined) {
            const err = this._callbackError;
            this._callbackError = undefined;
            throw err;
        }
    }
    /**
     * @internal Install (or with `fn === null`, remove) one kind of callback.
     * A callback that returns a status hands `failed` back to native code when
     * it throws, or when an earlier callback of the same native call did.
     * `release` runs once the registration is replaced, removed or destroyed.
     * `check` raises for a nonzero setter code (default: the engine's last error).
     */
    _setCallback(kind, setter, signature, fn, { failed, release, check, } = {}) {
        this._requireIdle();
        const h = this.handle;
        const previous = this._callbackSlots.get(kind);
        let slot = 0;
        if (fn) {
            slot = this._mod.addFunction((...args) => {
                if (this._callbackError !== undefined)
                    return failed;
                try {
                    return fn(...args);
                }
                catch (err) {
                    this._callbackError = err;
                    return failed;
                }
            }, signature);
        }
        const rc = setter(h, slot, 0);
        if (rc !== 0) {
            if (slot)
                this._mod.removeFunction(slot);
            release?.();
            if (check)
                check(rc);
            raiseForCode(rc, this._raw.swmm_get_last_error_msg(h));
        }
        if (previous)
            this._mod.removeFunction(previous);
        this._callbackReleases.get(kind)?.();
        this._callbackReleases.delete(kind);
        if (slot)
            this._callbackSlots.set(kind, slot);
        else
            this._callbackSlots.delete(kind);
        if (slot && release)
            this._callbackReleases.set(kind, release);
    }
    /** `callback(elapsedFraction)` as the run progresses, fraction in [0, 1]. */
    setProgressCallback(callback) {
        this._setCallback("progress", this._raw.swmm_set_progress_callback, CALLBACK_SIGNATURES.SWMM_ProgressCallback, callback && ((_engine, fraction) => callback(fraction)));
    }
    /** `callback(code, message)` for each engine warning. */
    setWarningCallback(callback) {
        this._setCallback("warning", this._raw.swmm_set_warning_callback, CALLBACK_SIGNATURES.SWMM_WarningCallback, callback &&
            ((_engine, code, message) => callback(code, message ? this._mod.UTF8ToString(message) : "")));
    }
    /** `callback(simTime, dt)` before each routing step. */
    setStepBeginCallback(callback) {
        this._setCallback("stepBegin", this._raw.swmm_set_step_begin_callback, CALLBACK_SIGNATURES.SWMM_StepBeginCallback, callback && ((_engine, simTime, dt) => callback(simTime, dt)));
    }
    /** `callback(simTime, dt)` after each routing step. */
    setStepEndCallback(callback) {
        this._setCallback("stepEnd", this._raw.swmm_set_step_end_callback, CALLBACK_SIGNATURES.SWMM_StepEndCallback, callback && ((_engine, simTime, dt) => callback(simTime, dt)));
    }
    /** `callback(phase, startSeconds, endSeconds)` for each engine phase of a step. */
    setPhaseCallback(callback) {
        this._setCallback("phase", this._raw.swmm_set_phase_callback, CALLBACK_SIGNATURES.SWMM_PhaseCallback, callback && ((_engine, phase, start, end) => callback(phase, start, end)));
    }
    // -------------------------------------------------------------------------
    // Explicit resource management (TC39 proposal Stage 3)
    // -------------------------------------------------------------------------
    /**
     * Dispose of the engine context (alias for {@link Solver.destroy}).
     *
     * Enables use of `await using solver = new Solver(mod)` in TypeScript 5.2+
     * environments that support the TC39 Explicit Resource Management proposal.
     */
    [Symbol.dispose]() {
        this.destroy();
    }
}
// =============================================================================
// Module-level functions (Python `abi_tag`, `run`, `run_with_callback`)
// =============================================================================
/** The engine's ABI tag, the identity plugins and bindings are checked against. */
export function abiTag(mod) {
    return rawOf(mod).swmm_engine_abi_tag() ?? "";
}
/** Run a whole simulation from files in the virtual filesystem. */
export function run(mod, inp, rpt = null, out = null, { pluginLib = null } = {}) {
    raiseForCode(rawOf(mod).swmm_engine_run(inp, rpt, out, pluginLib));
}
/**
 * {@link run} with `callback(elapsedFraction)` as the run progresses. An error
 * the callback throws is rethrown when the run returns.
 */
export function runWithCallback(mod, inp, rpt = null, out = null, callback = null, { pluginLib = null } = {}) {
    let failure = undefined;
    const slot = callback
        ? mod.addFunction((_engine, fraction) => {
            if (failure !== undefined)
                return;
            try {
                callback(fraction);
            }
            catch (err) {
                failure = err;
            }
        }, CALLBACK_SIGNATURES.SWMM_ProgressCallback)
        : 0;
    try {
        const rc = rawOf(mod).swmm_engine_run_with_callback(inp, rpt, out, pluginLib, slot, 0);
        if (failure !== undefined)
            throw failure;
        raiseForCode(rc);
    }
    finally {
        if (slot)
            mod.removeFunction(slot);
    }
}
//# sourceMappingURL=Solver.js.map