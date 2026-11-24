/**
 * @file Heat.ts
 * @brief `solver.heat`: heat-transport configuration and diagnostics (Python
 *        `openswmm.engine._heat`).
 *
 * `[HEAT_FLUXES]` toggles, `[RADIATIVE_FLUXES]`, `[SOLAR_RADIATION]`,
 * `[CLOUD_COVER]` and `[SEDIMENT_EXCHANGE]` parameters, the `[HEAT_SOURCES]`
 * inlet temperatures with node overrides, per-element overrides, mesh,
 * ground and channel-ground diagnostics, snapshots and atomic edits. Edits
 * are live (re-read every routing step). Values are refused, never clamped:
 * a refused write throws and keeps the previous value. Enum keys accept a
 * member, its code or its name in any case.
 *
 * @license  Apache-2.0
 */
import { EngineState, ErrorCode, HeatAttr, HeatCloudParam, HeatFluxModule, HeatOverrideScope, HeatRadiativeParam, HeatSedimentParam, HeatShortwaveMode, HeatSolarParam, HeatSourceKind, } from "./enums.js";
import { resolveIndex } from "./element.js";
import { ElementNotFoundError, StaleObjectError, raiseForCode } from "./errors.js";
import { checkedAlloc, rawOf, withCString, withCStrings, withDouble, withInt } from "./mem.js";
import { CALLBACK_SIGNATURES, STRUCTS } from "./raw.js";
import { readStruct, withStruct } from "./structs.js";
import { SolverView } from "./view.js";
/** Python `_member`: an enum member, its code, or its name (case-insensitive). */
function member(enumObj, label, key) {
    if (typeof key === "string") {
        const v = enumObj[key.toUpperCase()];
        if (typeof v === "number")
            return v;
    }
    else if (typeof enumObj[key] === "string") {
        return key;
    }
    const valid = Object.keys(enumObj)
        .filter((k) => typeof enumObj[k] === "number")
        .join(", ");
    throw new ElementNotFoundError(String(key), `'${String(key)}' is not a valid ${label}; valid members: ${valid}`);
}
function codes(enumObj) {
    return Object.values(enumObj).filter((v) => typeof v === "number");
}
/** A mapping keyed by one enum's members, read and written through C calls. */
class EnumTable extends SolverView {
    get length() {
        return codes(this._enum).length;
    }
    [Symbol.iterator]() {
        return codes(this._enum)[Symbol.iterator]();
    }
    get(key) {
        return this._read(member(this._enum, this._label, key));
    }
    set(key, value) {
        this._write(member(this._enum, this._label, key), value);
    }
    /** @internal */
    _code(key) {
        return member(this._enum, this._label, key);
    }
    /** @internal */
    _double(fn, code) {
        return withDouble(this._mod, (p) => fn(this._h, code, p));
    }
}
/** `heat.modules`: `[HEAT_FLUXES]` toggles keyed by {@link HeatFluxModule} (Python `_HeatModules`). */
export class HeatModules extends EnumTable {
    constructor() {
        super(...arguments);
        this._enum = HeatFluxModule;
        this._label = "HeatFluxModule";
    }
    _read(code) {
        return withInt(this._mod, (p) => this._raw.swmm_heat_get_module(this._h, code, p)) !== 0;
    }
    _write(code, on) {
        raiseForCode(this._raw.swmm_heat_set_module(this._h, code, on ? 1 : 0));
    }
}
/**
 * `heat.radiative`: `[RADIATIVE_FLUXES]` keyed by {@link HeatRadiativeParam}
 * (Python `_HeatRadiative`). SHORTWAVE in W/m², LANDCOVER_TEMPERATURE in °C
 * (NaN inherits air), the rest fractions in [0, 1]. SHORTWAVE is writable in
 * CONSTANT shortwave mode only.
 */
export class HeatRadiative extends EnumTable {
    constructor() {
        super(...arguments);
        this._enum = HeatRadiativeParam;
        this._label = "HeatRadiativeParam";
    }
    _read(code) {
        return this._double(this._raw.swmm_heat_get_radiative, code);
    }
    _write(code, value) {
        raiseForCode(this._raw.swmm_heat_set_radiative(this._h, code, value));
    }
}
/**
 * `heat.solar`: `[SOLAR_RADIATION]` keyed by {@link HeatSolarParam}, read in
 * COMPUTED shortwave mode (Python `_HeatSolar`). Writing LATITUDE or
 * LONGITUDE marks it explicitly provided ({@link Heat.solarSited}).
 */
export class HeatSolar extends EnumTable {
    constructor() {
        super(...arguments);
        this._enum = HeatSolarParam;
        this._label = "HeatSolarParam";
    }
    _read(code) {
        return this._double(this._raw.swmm_heat_get_solar, code);
    }
    _write(code, value) {
        raiseForCode(this._raw.swmm_heat_set_solar(this._h, code, value));
    }
    /** Clear the shared site before initialization (COMPUTED mode then refuses it). */
    clear() {
        raiseForCode(this._raw.swmm_heat_clear_solar_site(this._h));
    }
}
/**
 * `heat.cloud`: `[CLOUD_COVER]` keyed by {@link HeatCloudParam} (Python
 * `_HeatCloud`). Writing any parameter marks cloud cover configured.
 */
export class HeatCloud extends EnumTable {
    constructor() {
        super(...arguments);
        this._enum = HeatCloudParam;
        this._label = "HeatCloudParam";
    }
    _read(code) {
        return this._double(this._raw.swmm_heat_get_cloud, code);
    }
    _write(code, value) {
        raiseForCode(this._raw.swmm_heat_set_cloud(this._h, code, value));
    }
    /** The bound time series name (`""` when none). */
    get timeseries() {
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_heat_get_cloud_timeseries(this._h, buf, len));
    }
    /** Whether a `[CLOUD_COVER]` section is in effect. */
    get configured() {
        return withInt(this._mod, (p) => this._raw.swmm_heat_get_cloud_configured(this._h, p)) !== 0;
    }
    /** Cloud fraction at the current step, [0, 1] (state, not configuration). */
    get current() {
        return withDouble(this._mod, (p) => this._raw.swmm_heat_get_current_cloud(this._h, p));
    }
    /** Bind a `[TIMESERIES]` as the cloud-fraction record. */
    setTimeseries(name) {
        raiseForCode(this._raw.swmm_heat_set_cloud_timeseries(this._h, name));
    }
    /** Remove `[CLOUD_COVER]`: clear sky again. */
    clear() {
        raiseForCode(this._raw.swmm_heat_clear_cloud(this._h));
    }
}
/**
 * `heat.sources`: GLOBAL inlet temperature (°C) per {@link HeatSourceKind}
 * (Python `_HeatSources`). A source with no row reads the 20 °C default;
 * {@link isConfigured} tells the two apart.
 */
export class HeatSources extends EnumTable {
    constructor() {
        super(...arguments);
        this._enum = HeatSourceKind;
        this._label = "HeatSourceKind";
    }
    get length() {
        return withInt(this._mod, (p) => this._raw.swmm_heat_source_count(this._h, p));
    }
    [Symbol.iterator]() {
        return Array.from({ length: this.length }, (_, i) => i)[Symbol.iterator]();
    }
    _read(code) {
        return this._double(this._raw.swmm_heat_get_source_temp, code);
    }
    _write(code, tempC) {
        raiseForCode(this._raw.swmm_heat_set_source_temp(this._h, code, tempC));
    }
    has(key) {
        try {
            this._code(key);
            return true;
        }
        catch {
            return false;
        }
    }
    /** Whether the model set this source explicitly (or it takes the default). */
    isConfigured(source) {
        const s = this._code(source);
        return (withInt(this._mod, (p) => this._raw.swmm_heat_get_source_configured(this._h, s, p)) !== 0);
    }
    /** Back to the 20 °C default, unconfigured; node overrides are untouched. */
    clear(source) {
        raiseForCode(this._raw.swmm_heat_clear_source_temp(this._h, this._code(source)));
    }
    /** The temperature this source's water enters a node at: the override, else GLOBAL. */
    effective(source, node) {
        const s = this._code(source);
        const n = resolveIndex(this._raw, this._h, "node", node);
        return withDouble(this._mod, (p) => this._raw.swmm_heat_get_effective_source_temp(this._h, s, n, p));
    }
}
/** `heat.sediment`: `[SEDIMENT_EXCHANGE]` keyed by {@link HeatSedimentParam} (Python `_HeatSediment`). */
export class HeatSediment extends EnumTable {
    constructor() {
        super(...arguments);
        this._enum = HeatSedimentParam;
        this._label = "HeatSedimentParam";
    }
    _read(code) {
        return this._double(this._raw.swmm_heat_get_sediment, code);
    }
    _write(code, value) {
        raiseForCode(this._raw.swmm_heat_set_sediment(this._h, code, value));
    }
    /** Whether GLOBAL GROUND_SOURCE was authored explicitly (PRESCRIBED included). */
    get groundSourceConfigured() {
        return (withInt(this._mod, (p) => this._raw.swmm_heat_ground_source_configured(this._h, p)) !== 0);
    }
    /** Restore the default PRESCRIBED channel ground selection (before a run). */
    clearGroundSource() {
        raiseForCode(this._raw.swmm_heat_clear_ground_source(this._h));
    }
    /** Whether GROUND_TEMPERATURE or INITIAL_TEMPERATURE was authored. */
    isConfigured(key) {
        const p0 = this._code(key);
        return (withInt(this._mod, (p) => this._raw.swmm_heat_sediment_temperature_configured(this._h, p0, p)) !== 0);
    }
    /** Restore temperature inheritance (ground reset also clears its series). */
    clear(key) {
        raiseForCode(this._raw.swmm_heat_clear_sediment_temperature(this._h, this._code(key)));
    }
    /** Time series driving the ground temperature (`""` for the constant). */
    get groundTimeseries() {
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_heat_get_sediment_ground_timeseries(this._h, buf, len));
    }
    set groundTimeseries(name) {
        raiseForCode(this._raw.swmm_heat_set_sediment_ground_timeseries(this._h, name ?? ""));
    }
}
/** `heat.nodeOverrides`: NODE-scope rows by position (Python `_HeatNodeOverrides`). */
export class HeatNodeOverrides extends SolverView {
    get length() {
        return withInt(this._mod, (p) => this._raw.swmm_heat_node_override_count(this._h, p));
    }
    *[Symbol.iterator]() {
        const n = this.length;
        for (let i = 0; i < n; i++)
            yield this.get(i);
    }
    get(rowIndex) {
        const n = this.length;
        const i = rowIndex < 0 ? rowIndex + n : rowIndex;
        if (!(i >= 0 && i < n))
            throw new RangeError(String(rowIndex));
        const mod = this._mod;
        const p = checkedAlloc(mod, 16);
        try {
            mod.HEAP32[p >> 2] = 0;
            mod.HEAP32[(p + 4) >> 2] = -1;
            mod.HEAPF64[(p + 8) >> 3] = 0;
            raiseForCode(this._raw.swmm_heat_get_node_override(this._h, i, p, p + 4, p + 8));
            return {
                source: mod.HEAP32[p >> 2],
                nodeIndex: mod.HEAP32[(p + 4) >> 2],
                tempC: mod.HEAPF64[(p + 8) >> 3],
            };
        }
        finally {
            mod._free(p);
        }
    }
    /** Add or update the override of `(source, node)`; temperatures in [-50, 100] °C. */
    set(source, node, tempC) {
        const s = member(HeatSourceKind, "HeatSourceKind", source);
        const n = resolveIndex(this._raw, this._h, "node", node);
        raiseForCode(this._raw.swmm_heat_set_node_override(this._h, s, n, tempC));
        this._solver._bumpGeneration();
    }
    /** Remove one row by index; later rows shift down. */
    remove(rowIndex) {
        raiseForCode(this._raw.swmm_heat_remove_node_override(this._h, rowIndex));
        this._solver._bumpGeneration();
    }
}
/** `heat.elementOverrides`: radiative and sediment attribute overrides (Python `_HeatElementOverrides`). */
export class HeatElementOverrides extends SolverView {
    get length() {
        return withInt(this._mod, (p) => this._raw.swmm_heat_element_override_count(this._h, p));
    }
    *[Symbol.iterator]() {
        const n = this.length;
        for (let i = 0; i < n; i++)
            yield this.get(i);
    }
    get(rowIndex) {
        const n = this.length;
        const i = rowIndex < 0 ? rowIndex + n : rowIndex;
        if (!(i >= 0 && i < n))
            throw new RangeError(String(rowIndex));
        const mod = this._mod;
        const p = checkedAlloc(mod, 16);
        try {
            mod.HEAPU8.fill(0, p, p + 16);
            const [name] = withCStrings(mod, 256, 1, ([buf], len) => this._raw.swmm_heat_get_element_override(this._h, i, p, p + 4, buf, len, p + 8));
            return {
                attr: mod.HEAP32[p >> 2],
                scope: mod.HEAP32[(p + 4) >> 2],
                name,
                value: mod.HEAPF64[(p + 8) >> 3],
            };
        }
        finally {
            mod._free(p);
        }
    }
    /**
     * Add or update the override of `(attr, scope, name)`. Sediment attributes
     * take LINK or TAG scope only; an unknown element or tag is refused.
     */
    set(attr, scope, name, value) {
        const a = member(HeatAttr, "HeatAttr", attr);
        const s = member(HeatOverrideScope, "HeatOverrideScope", scope);
        raiseForCode(this._raw.swmm_heat_set_element_override(this._h, a, s, name, value));
        this._solver._bumpGeneration();
    }
    /** Remove one row; later rows shift down. */
    remove(rowIndex) {
        raiseForCode(this._raw.swmm_heat_remove_element_override(this._h, rowIndex));
        this._solver._bumpGeneration();
    }
}
const camelKey = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
/** Read a status struct (its `struct_size` set first) as a camelCase record; ints in `flags` become booleans. */
function readStatus(solver, name, flags, call) {
    const mod = solver.module;
    return withStruct(mod, name, (p) => {
        raiseForCode(call(solver.handle, p));
        const r = readStruct(mod, name, p);
        const out = {};
        for (const [k, v] of Object.entries(r)) {
            if (k === "struct_size")
                continue;
            out[camelKey(k)] = flags.includes(k) ? v !== 0 : v;
        }
        return out;
    }, { struct_size: STRUCTS[name].size });
}
function contactOf(r) {
    return {
        link: r.link,
        cell: r.cell,
        layer: r.layer,
        beginFraction: r.begin_fraction,
        endFraction: r.end_fraction,
        share: r.share,
        invertM: r.invert_m,
    };
}
/**
 * A pre-run heat (or, with `complete`, whole hydrothermal) configuration
 * memento. Lifecycle and structural edits invalidate it; restore may be
 * repeated. Close it, or use `using`.
 */
export class HeatSnapshot {
    constructor(solver, { complete = false } = {}) {
        const h = solver.handle;
        this._raw = rawOf(solver.module);
        const state = solver.state;
        if (state !== EngineState.OPENED && state !== EngineState.BUILDING) {
            raiseForCode(ErrorCode.LIFECYCLE);
        }
        this._owner = solver;
        this._generation = solver.generation;
        this._complete = complete;
        this._snapshot = complete
            ? this._raw.swmm_config_snapshot_create(h)
            : this._raw.swmm_heat_snapshot_create(h);
        if (!this._snapshot)
            throw new Error("Cannot capture heat configuration");
    }
    /** Restore the captured settings, refusing a stale snapshot. */
    restore() {
        if (!this._snapshot || !this._owner)
            throw new RangeError("HeatSnapshot is closed");
        if (this._generation !== this._owner.generation) {
            throw new StaleObjectError("HeatSnapshot was invalidated by a lifecycle or structural edit");
        }
        const h = this._owner.handle;
        raiseForCode(this._complete
            ? this._raw.swmm_config_snapshot_restore(h, this._snapshot)
            : this._raw.swmm_heat_snapshot_restore(h, this._snapshot));
        this._owner._bumpGeneration();
        this._generation = this._owner.generation;
    }
    /** Release the memento (safe after the solver is destroyed). */
    close() {
        if (this._snapshot) {
            if (this._complete)
                this._raw.swmm_config_snapshot_destroy(this._snapshot);
            else
                this._raw.swmm_heat_snapshot_destroy(this._snapshot);
            this._snapshot = 0;
        }
        this._owner = null;
    }
    [Symbol.dispose]() {
        this.close();
    }
}
/** `solver.heat`: heat-transport configuration. */
export class Heat extends SolverView {
    /** Whether `[OPTIONS] HEAT_TRANSPORT` is on. */
    get enabled() {
        return withInt(this._mod, (p) => this._raw.swmm_heat_get_enabled(this._h, p)) !== 0;
    }
    get modules() {
        return (this._modules ?? (this._modules = new HeatModules(this._solver)));
    }
    get radiative() {
        return (this._radiative ?? (this._radiative = new HeatRadiative(this._solver)));
    }
    get solar() {
        return (this._solar ?? (this._solar = new HeatSolar(this._solver)));
    }
    get cloud() {
        return (this._cloud ?? (this._cloud = new HeatCloud(this._solver)));
    }
    get sources() {
        return (this._sources ?? (this._sources = new HeatSources(this._solver)));
    }
    get nodeOverrides() {
        return (this._nodeOverrides ?? (this._nodeOverrides = new HeatNodeOverrides(this._solver)));
    }
    get sediment() {
        return (this._sediment ?? (this._sediment = new HeatSediment(this._solver)));
    }
    get elementOverrides() {
        return (this._elementOverrides ?? (this._elementOverrides = new HeatElementOverrides(this._solver)));
    }
    /**
     * Where incoming shortwave comes from. Exactly one mode is read; switching
     * keeps the other modes' settings. COMPUTED needs {@link solarSited};
     * TIMESERIES needs a bound series.
     */
    get shortwaveMode() {
        return withInt(this._mod, (p) => this._raw.swmm_heat_get_shortwave_mode(this._h, p));
    }
    set shortwaveMode(value) {
        const mode = member(HeatShortwaveMode, "HeatShortwaveMode", value);
        raiseForCode(this._raw.swmm_heat_set_shortwave_mode(this._h, mode));
    }
    /** The bound shortwave time series (`""` when none). */
    get shortwaveTimeseries() {
        return withCString(this._mod, 256, (buf, len) => this._raw.swmm_heat_get_shortwave_timeseries(this._h, buf, len));
    }
    /** Bind a `[TIMESERIES]` as the shortwave record (switches to TIMESERIES mode). */
    setShortwaveTimeseries(name) {
        raiseForCode(this._raw.swmm_heat_set_shortwave_timeseries(this._h, name));
    }
    /** Resolved incoming shortwave at the current step, W/m², cloud applied. */
    get currentShortwave() {
        return withDouble(this._mod, (p) => this._raw.swmm_heat_get_current_shortwave(this._h, p));
    }
    /** Whether latitude and longitude were both set explicitly (needed by COMPUTED). */
    get solarSited() {
        return withInt(this._mod, (p) => this._raw.swmm_heat_get_solar_sited(this._h, p)) !== 0;
    }
    /** Dry-element temperature policy: HOLD 0, AIR 1, DEFAULT 2. */
    get dryPolicy() {
        return withInt(this._mod, (p) => this._raw.swmm_heat_get_dry_policy(this._h, p));
    }
    set dryPolicy(policy) {
        raiseForCode(this._raw.swmm_heat_set_dry_policy(this._h, policy));
    }
    /** LID conduction material assumptions (SI). */
    get lidMaterial() {
        const mod = this._mod;
        const p = checkedAlloc(mod, 32);
        try {
            mod.HEAPF64.fill(0, p >> 3, (p >> 3) + 4);
            raiseForCode(this._raw.swmm_heat_get_lid_material(this._h, p));
            const f = mod.HEAPF64;
            return {
                waterConductivity: f[p >> 3],
                soilConductivity: f[(p >> 3) + 1],
                soilDensity: f[(p >> 3) + 2],
                soilSpecificHeat: f[(p >> 3) + 3],
            };
        }
        finally {
            mod._free(p);
        }
    }
    /** Provenance bits: configured 1, shared site 2, explicit lat/lon/timezone/elevation 4/8/16/32. */
    get authoringFlags() {
        const mod = this._mod;
        const p = checkedAlloc(mod, 4);
        try {
            mod.HEAPU32[p >> 2] = 0;
            raiseForCode(this._raw.swmm_heat_get_authoring_flags(this._h, p));
            return mod.HEAPU32[p >> 2];
        }
        finally {
            mod._free(p);
        }
    }
    /** The NODE/LINK/CELL2D precedence value of an attribute and its origin. */
    effectiveElement(attr, scope, name) {
        const a = member(HeatAttr, "HeatAttr", attr);
        const s = member(HeatOverrideScope, "HeatOverrideScope", scope);
        if (name.includes("\0"))
            throw new RangeError("Element name contains a null byte");
        const mod = this._mod;
        const p = checkedAlloc(mod, 16);
        try {
            mod.HEAPU8.fill(0, p, p + 16);
            const [sourceName] = withCStrings(mod, 256, 1, ([buf], len) => this._raw.swmm_heat_get_effective_element(this._h, a, s, name, p, p + 8, buf, len));
            return { value: mod.HEAPF64[p >> 3], source: mod.HEAP32[(p + 8) >> 2], sourceName };
        }
        finally {
            mod._free(p);
        }
    }
    /** Requested and initialized mesh heat, active modules and the capability reason. */
    get meshStatus() {
        return readStatus(this._solver, "SWMM_Heat2DStatus", [
            "requested",
            "initialized",
            "surface_active",
            "radiative_active",
            "bed_active",
            "experimental",
        ], this._raw.swmm_heat_get_2d_status);
    }
    /** @internal Read `count` doubles from a range call. */
    _range(count, call) {
        if (count < 0)
            throw new RangeError("count must be nonnegative");
        const mod = this._mod;
        const p = checkedAlloc(mod, Math.max(8 * count, 8));
        try {
            raiseForCode(call(count ? p : 0));
            return Array.from(new Float64Array(mod.HEAPU8.buffer, p, count));
        }
        finally {
            mod._free(p);
        }
    }
    /** A contiguous range of mesh cells' heat values, SI (kinds as `SWMM_Heat2DValue`). */
    meshValues(kind, firstCell, count) {
        return this._range(count, (p) => this._raw.swmm_heat_get_2d_values(this._h, kind, firstCell, count, p));
    }
    /** Requested and measured soil heat, owner counts and the capability reason. */
    groundStatus() {
        return readStatus(this._solver, "SWMM_GroundHeatStatus", ["requested", "initialized", "conduction_active", "lateral_active", "experimental"], this._raw.swmm_heat_get_ground_status);
    }
    /** Soil heat values over mesh cells (kinds as `SWMM_GroundHeatValue`); unmodeled cells NaN. */
    groundValues(kind, firstCell, count) {
        return this._range(count, (p) => this._raw.swmm_heat_get_ground_values(this._h, kind, firstCell, count, p));
    }
    /** Fixed depth layers of one cell (kinds 0..7). */
    groundLayers(cell, kind, firstLayer, count) {
        return this._range(count, (p) => this._raw.swmm_heat_get_ground_layers(this._h, cell, kind, firstLayer, count, p));
    }
    /** Requested channel ground choice and measured mapping/activity counts. */
    channelGroundStatus() {
        return readStatus(this._solver, "SWMM_ChannelGroundStatus", ["requested", "initialized", "exchange_active", "experimental"], this._raw.swmm_heat_get_channel_ground_status);
    }
    /** Mapped channel fields over links (kinds 0..4); unmapped links NaN. */
    channelGroundValues(kind, firstLink, count) {
        return this._range(count, (p) => this._raw.swmm_heat_get_channel_ground_values(this._h, kind, firstLink, count, p));
    }
    /** One initialized channel-to-soil contact. */
    channelGroundContact(index) {
        return withStruct(this._mod, "SWMM_ChannelGroundContact", (p) => {
            raiseForCode(this._raw.swmm_heat_get_channel_ground_contact(this._h, index, p));
            return contactOf(readStruct(this._mod, "SWMM_ChannelGroundContact", p));
        }, { struct_size: STRUCTS.SWMM_ChannelGroundContact.size });
    }
    /**
     * Pre-run XY coverage of a link (does not initialize heat). Leave `first`
     * out for every contact, or page with `first` and `limit`. `progress(stage,
     * percent)` may return true to cancel (stage 1 mesh, 2 mapping); its
     * errors are rethrown after the native call.
     */
    previewChannelGroundMap(link, { first = null, limit = 256, progress = null, } = {}) {
        if (progress !== null && typeof progress !== "function") {
            throw new TypeError("progress must be callable");
        }
        const mod = this._mod;
        const h = this._h;
        const li = resolveIndex(this._raw, h, "link", link);
        const offset = first === null ? 0 : first;
        let capacity = first === null ? 0 : limit;
        if (offset < 0 || capacity < 0)
            throw new RangeError("first and limit must be nonnegative");
        let error = undefined;
        const slot = progress
            ? mod.addFunction((_e, stage, percent) => {
                try {
                    return progress(stage, percent) ? 1 : 0;
                }
                catch (err) {
                    error = err;
                    return 1;
                }
            }, CALLBACK_SIGNATURES.SWMM_CancelCallback)
            : 0;
        const contactSize = STRUCTS.SWMM_ChannelGroundContact.size;
        const required = checkedAlloc(mod, 4);
        let contacts = 0;
        try {
            return withStruct(mod, "SWMM_ChannelGroundPreview", (pp) => {
                const call = (cp, cap) => first !== null
                    ? this._raw.swmm_heat_preview_channel_ground_map_page(h, li, pp, offset, cp, cap, required, slot, 0)
                    : slot
                        ? this._raw.swmm_heat_preview_channel_ground_map_with_progress(h, li, pp, cp, cap, required, slot, 0)
                        : this._raw.swmm_heat_preview_channel_ground_map(h, li, pp, cp, cap, required);
                mod.HEAP32[required >> 2] = 0;
                if (first === null) {
                    const rc = this._solver._operation(() => call(0, 0));
                    if (error !== undefined)
                        throw error;
                    raiseForCode(rc);
                    capacity = mod.HEAP32[required >> 2];
                }
                contacts = checkedAlloc(mod, Math.max(contactSize * capacity, contactSize));
                mod.HEAPU8.fill(0, contacts, contacts + contactSize * Math.max(capacity, 1));
                const rc = this._solver._operation(() => call(contacts, capacity));
                if (error !== undefined)
                    throw error;
                raiseForCode(rc);
                const total = mod.HEAP32[required >> 2];
                const copied = Math.max(0, Math.min(capacity, total - offset));
                const r = readStruct(mod, "SWMM_ChannelGroundPreview", pp);
                return {
                    link: r.link,
                    valid: r.valid !== 0,
                    contactCells: r.contact_cells,
                    contactIntervals: r.contact_intervals,
                    lengthM: r.length_m,
                    coveredLengthM: r.covered_length_m,
                    uncoveredLengthM: r.uncovered_length_m,
                    reason: r.reason,
                    required: total,
                    first: offset,
                    contacts: Array.from({ length: copied }, (_, i) => contactOf(readStruct(mod, "SWMM_ChannelGroundContact", contacts + i * contactSize))),
                };
            }, { struct_size: STRUCTS.SWMM_ChannelGroundPreview.size });
        }
        finally {
            if (contacts)
                mod._free(contacts);
            mod._free(required);
            if (slot)
                mod.removeFunction(slot);
        }
    }
    /** Capture pre-run settings; `complete` also captures climate, snow and registrations. */
    snapshot({ complete = false } = {}) {
        return new HeatSnapshot(this._solver, { complete });
    }
    /**
     * Apply `callback(solver)` before initialization, rolled back on any
     * error (which is rethrown after the native rollback). Only climate, snow,
     * heat, HEAT_TRANSPORT, component registrations and climate-file paths
     * may change. Returns the callback's result.
     */
    editAtomic(callback) {
        if (typeof callback !== "function")
            throw new TypeError("callback must be callable");
        const mod = this._mod;
        const solver = this._solver;
        let error = undefined;
        let result;
        const slot = mod.addFunction(() => {
            try {
                result = callback(solver);
                return 0;
            }
            catch (err) {
                error = err;
                return ErrorCode.BADPARAM;
            }
        }, CALLBACK_SIGNATURES.SWMM_HydrothermalEdit);
        let rc;
        try {
            const h = this._h;
            rc = solver._operation(() => this._raw.swmm_hydrothermal_edit_atomic(h, slot, 0));
        }
        finally {
            mod.removeFunction(slot);
        }
        solver._bumpGeneration();
        if (error !== undefined)
            throw error;
        raiseForCode(rc);
        return result;
    }
}
//# sourceMappingURL=Heat.js.map