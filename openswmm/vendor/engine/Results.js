/**
 * @file Results.ts
 * @brief Discoverable, lazy result fields over the 1D and 2D readers (Python
 *        `openswmm.engine._results`).
 *
 * `Results` owns an {@link OutputReader} (binary `.out`), an
 * {@link Output2DReader} (2D HDF5 results) or both. Fields describe a recorded
 * variable (name, units, named dimensions, shape, times) and load values only
 * when read. Python's attribute shortcuts (`results.nodes.depth`,
 * `surface.depth`) are the `variables` maps here:
 * `results.nodes.variables.get("depth")`.
 *
 * @license  Apache-2.0
 */
import { FlowUnits, OutLinkVar, OutNodeVar, OutSubcatchVar, OutSystemVar } from "./enums.js";
import { BadIndexError, ElementNotFoundError } from "./errors.js";
import { isSlice, selectionAxes, slice, sliceRange, stack, } from "./ndarray.js";
import { Output2DReader } from "./Output2D.js";
import { OutputReader } from "./OutputReader.js";
import { SECONDS_PER_DAY } from "./units.js";
/** Python `_indices`: resolve a selector without allocating the whole axis. */
function indices(selection, size, names = []) {
    if (selection === null || selection === undefined)
        return [sliceRange({}, size), false];
    if (Array.isArray(selection)) {
        return [
            selection.map((key) => indices(key, size, names)[0][0]),
            false,
        ];
    }
    if (isSlice(selection))
        return [sliceRange(selection, size), false];
    if (typeof selection === "string") {
        const index = names.indexOf(selection);
        if (index < 0)
            throw new ElementNotFoundError(selection);
        return [[index], true];
    }
    if (typeof selection !== "number" || !Number.isInteger(selection)) {
        throw new TypeError("A result selector is an index, an id, a slice or a list");
    }
    const index = selection < 0 ? selection + size : selection;
    if (index < 0 || index >= size)
        throw new RangeError("Result index out of range");
    return [[index], true];
}
const isFull = (key) => key === null || key === undefined || isSlice(key);
/** A lazy numeric field: inspect its metadata, then call {@link read}. */
export class ResultField {
    /** Python `field[selection]`. */
    get(selection) {
        return this.read({ selection });
    }
}
const FLOW_UNIT_LABELS = {
    CFS: "ft3/s",
    GPM: "gal/min",
    MGD: "million gal/day",
    CMS: "m3/s",
    LPS: "L/s",
    MLD: "million L/day",
};
/** Units of a recorded 1D variable (Python `_units`). */
function seriesUnits(reader, name) {
    const flow = reader.flowUnits;
    const si = flow >= FlowUnits.CMS;
    const [length, rain] = si ? ["m", "mm"] : ["ft", "in"];
    if (name === "evap" || name === "pet")
        return `${rain}/day`;
    if (name === "rainfall" || name === "infil")
        return `${rain}/h`;
    if (name === "snow_depth")
        return rain;
    if (name === "depth" || name === "head" || name === "gw_elev")
        return length;
    if (name === "volume" || name === "storage")
        return `${length}3`;
    if (name === "velocity")
        return `${length}/s`;
    if (["capacity", "soil_moist", "snow_albedo", "snow_cover"].includes(name))
        return "1";
    if (name === "temperature")
        return si ? "degC" : "degF";
    if (name === "snow_surface_temp" || name === "snow_bulk_temp")
        return "degC";
    if (name === "snow_energy")
        return "kJ/m2";
    if (name === "snow_swe")
        return "m";
    if (["snow_melt", "snow_input", "snow_sublimation"].includes(name))
        return "m/s";
    if (name === "snow_time")
        return "s";
    return FLOW_UNIT_LABELS[FlowUnits[flow]];
}
/** One recorded 1D variable, optionally bound to one object. */
export class SeriesField extends ResultField {
    /** @internal */
    constructor(_collection, name, 
    /** @internal */ _code, units, _objectIndex = null) {
        super();
        this._collection = _collection;
        this.name = name;
        this._code = _code;
        this.units = units;
        this._objectIndex = _objectIndex;
        this.dimensions =
            _objectIndex !== null || _collection.kind === "system" ? ["time"] : ["time", "object"];
    }
    get shape() {
        const size = this._collection.reader.periodCount;
        return this.dimensions.length === 1 ? [size] : [size, this._collection.length];
    }
    get times() {
        return this._collection.reader.periodTimes;
    }
    /** Ids along the object axis. */
    get objectIds() {
        return [...this._collection.ids];
    }
    read({ periods, objects, species, selection } = {}) {
        if (species !== undefined && species !== null) {
            throw new RangeError("Select a named species through the species mapping first");
        }
        if (selection !== undefined && selection !== null) {
            if (periods != null || objects != null) {
                throw new RangeError("Use selection or named selectors, not both");
            }
            const keys = selectionAxes(selection, this.dimensions.length);
            periods = keys[0];
            objects = keys.length > 1 ? keys[1] : null;
        }
        const collection = this._collection;
        const [times, scalarTime] = indices(periods, collection.reader.periodCount);
        const scalarField = this.dimensions.length === 1;
        if (objects !== null && objects !== undefined && scalarField) {
            throw new RangeError("This field is already bound to one object or the system");
        }
        const [objectIndices, scalarObject] = scalarField
            ? [[this._objectIndex ?? -1], true]
            : indices(objects, collection.length, collection.ids);
        const rows = times.length;
        const cols = objectIndices.length;
        const values = new Float32Array(rows * cols);
        if (rows && cols) {
            let low = times[0];
            let high = times[0];
            for (const t of times) {
                low = Math.min(low, t);
                high = Math.max(high, t);
            }
            // Bulk snapshots read every object; small selections read object
            // histories and never load the other ids.
            if (!scalarField && (objects === null || objects === undefined)) {
                times.forEach((period, row) => values.set(collection._result(period, this._code), row * cols));
            }
            else {
                objectIndices.forEach((index, col) => {
                    const series = collection._series(index, this._code, low, high);
                    times.forEach((t, row) => (values[row * cols + col] = series[t - low]));
                });
            }
        }
        let shape = [rows, cols];
        if (scalarField || scalarObject)
            shape = [rows];
        if (scalarTime)
            shape = shape.slice(1);
        return { shape, data: values };
    }
}
/** One recorded object (Python `_ResultObject`). */
export class ResultObject {
    /** @internal */
    constructor(_collection, _index) {
        this._collection = _collection;
        this._index = _index;
    }
    get id() {
        return this._collection.ids[this._index];
    }
    /** The collection's variables, bound to this object. */
    get variables() {
        return this._bind(this._collection.variables);
    }
    /** The collection's species, bound to this object. */
    get species() {
        return this._bind(this._collection.species);
    }
    /** @internal */
    _bind(fields) {
        return new Map([...fields].map(([name, f]) => [
            name,
            new SeriesField(this._collection, f.name, f._code, f.units, this._index),
        ]));
    }
}
/** Recorded objects of one kind and their variables; index by id or position. */
export class ResultCollection {
    /** @internal */
    constructor(reader, kind) {
        this.reader = reader;
        this.kind = kind;
        const codes = {
            node: OutNodeVar,
            link: OutLinkVar,
            subcatchment: OutSubcatchVar,
            system: OutSystemVar,
        }[kind];
        this.ids =
            kind === "node"
                ? reader.nodeIds
                : kind === "link"
                    ? reader.linkIds
                    : kind === "subcatchment"
                        ? reader.subcatchmentIds
                        : [];
        const fields = new Map();
        const seen = new Set();
        for (const [key, code] of Object.entries(codes)) {
            // Enum members in declaration order; aliases (a repeated code) are skipped.
            if (typeof code !== "number" || seen.has(code))
                continue;
            seen.add(code);
            if (key === "POLLUT_BASE")
                continue;
            if (kind === "subcatchment" && !reader.hasSubcatchVariable(code))
                continue;
            const name = key.toLowerCase();
            fields.set(name, new SeriesField(this, name, code, seriesUnits(reader, name)));
        }
        this.variables = fields;
        const base = codes.POLLUT_BASE;
        const species = new Map();
        if (kind !== "system" && base !== undefined) {
            const units = reader.pollutantUnits;
            reader.pollutantIds.forEach((name, i) => species.set(name, new SeriesField(this, name, base + i, units[i])));
        }
        this.species = species;
    }
    get length() {
        return this.ids.length;
    }
    [Symbol.iterator]() {
        return this.ids[Symbol.iterator]();
    }
    /** One object by id or index. */
    get(key) {
        const [found, scalar] = indices(key, this.ids.length, this.ids);
        if (!scalar)
            throw new TypeError("Select one object by name or index");
        return new ResultObject(this, found[0]);
    }
    /** @internal Every object's value at one period. */
    _result(period, code) {
        const r = this.reader;
        if (this.kind === "node")
            return r.nodeResult(period, code);
        if (this.kind === "link")
            return r.linkResult(period, code);
        if (this.kind === "subcatchment")
            return r.subcatchmentResult(period, code);
        return Float32Array.of(r.systemResult(period, code));
    }
    /** @internal One object's history over an inclusive period range. */
    _series(index, code, start, end) {
        const r = this.reader;
        const range = { start, end };
        if (this.kind === "node")
            return r.nodeSeries(index, code, range);
        if (this.kind === "link")
            return r.linkSeries(index, code, range);
        if (this.kind === "subcatchment")
            return r.subcatchmentSeries(index, code, range);
        return r.systemSeries(code, range);
    }
}
const slashes = (path) => (path.match(/\//g) ?? []).length;
/** Named axes of a stored 2D dataset (Python `_axis_names`). */
function axisNames(reader, path, shape, attrs) {
    const rank = shape.length;
    let names = Array.from({ length: rank }, (_, i) => `axis_${i}`);
    const layout = /\[([^\]]+)\]/.exec(attrs.layout ?? "");
    if (layout) {
        const tokens = layout[1].split(",").map((v) => v.trim().toLowerCase());
        if (tokens.length === rank) {
            const aliases = {
                face: "cell",
                nface: "cell",
                ntime: "time",
                nspecies: "species",
                node: "vertex",
                nnode: "vertex",
            };
            names = tokens.map((t) => aliases[t] ?? t);
        }
    }
    const timed = reader.unlimitedAxes(path).includes(0) && slashes(path) === 1;
    if (timed)
        names[0] = "time";
    if (attrs.location === "face" && !names.includes("cell") && rank)
        names[rank - 1] = "cell";
    if (path === "/Mesh2_edge_flux")
        names = ["time", "cell", "edge"];
    else if (path.startsWith("/Mesh2_node_") && timed && rank === 2)
        names = ["time", "vertex"];
    else if (path === "/Mesh2_face_nodes")
        names = ["cell", "corner"];
    else if (rank === 1 && path.startsWith("/Mesh2_face_"))
        names = ["cell"];
    else if (path.startsWith("/Mesh2_edge_") && rank === 2)
        names = ["cell", "edge"];
    if (rank >= 3 && "species_names" in attrs && !names.includes("species"))
        names[1] = "species";
    // Unknown diagnostics keep positional axes rather than inventing a clock.
    return names;
}
/** A stored 2D dataset with named axes and optionally a bound cell or species. */
export class SurfaceField extends ResultField {
    /** @internal */
    constructor(_surface, path, fixed = {}) {
        super();
        this._surface = _surface;
        this.path = path;
        this._fixed = { ...fixed };
        this.name = path.slice(path.lastIndexOf("/") + 1).replace(/^Mesh2_face_/, "");
        this.attributes = Object.freeze(_surface.reader.attributes(path));
        const [shape] = _surface.reader.shape(path);
        this._axes = axisNames(_surface.reader, path, shape, this.attributes);
        this.dimensions = this._axes.filter((axis) => !(axis in this._fixed));
        this.speciesNames = (this.attributes.species_names ?? "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
        let units = this.attributes.units ?? null;
        if ("species" in this._fixed) {
            const labels = (this.attributes.species_units ?? "").split(",");
            const index = this._fixed.species;
            units = index < labels.length && labels[index].trim() ? labels[index].trim() : null;
        }
        this.units = units;
    }
    get shape() {
        const [shape] = this._surface.reader.shape(this.path);
        return shape.filter((_, i) => !(this._axes[i] in this._fixed));
    }
    get times() {
        if (!this.dimensions.includes("time"))
            return null;
        const times = this._surface.periodTimes;
        if (times.length !== this.shape[this.dimensions.indexOf("time")]) {
            throw new RangeError(`${this.path} has incomplete report rows; inspect it with selection explicitly`);
        }
        return times;
    }
    /** A field with some axes fixed, e.g. `bind({ cell: 3 })`. */
    bind(axes) {
        const unknown = Object.keys(axes).filter((a) => !this._axes.includes(a));
        if (unknown.length)
            throw new RangeError(`Field has no axes: [${unknown.sort().join(", ")}]`);
        return new SurfaceField(this._surface, this.path, { ...this._fixed, ...axes });
    }
    read({ periods, objects, species, selection } = {}) {
        const reader = this._surface.reader;
        const [shape] = reader.shape(this.path);
        const keys = this._axes.map((axis) => axis in this._fixed ? this._fixed[axis] : null);
        if (selection !== undefined && selection !== null) {
            if (periods != null || objects != null || species != null) {
                throw new RangeError("Use selection or named selectors, not both");
            }
            const selected = selectionAxes(selection, this.dimensions.length);
            const free = this._axes.flatMap((axis, i) => (axis in this._fixed ? [] : [i]));
            free.forEach((axis, j) => (keys[axis] = selected[j]));
        }
        const named = [
            ["time", periods],
            ["cell", objects],
            ["species", species],
        ];
        for (const [axis, given] of named) {
            if (given === null || given === undefined)
                continue;
            if (!this.dimensions.includes(axis))
                throw new RangeError(`Field has no unbound ${axis} axis`);
            let key = given;
            if (axis === "species" && typeof key === "string") {
                const index = this.speciesNames.indexOf(key);
                if (index < 0)
                    throw new ElementNotFoundError(key);
                key = index;
            }
            keys[this._axes.indexOf(axis)] = key;
        }
        // Ordered or repeated cell lists read one bounded slab per cell.
        const cellAxis = this._axes.indexOf("cell");
        if (cellAxis >= 0 && Array.isArray(keys[cellAxis])) {
            const [cells] = indices(keys[cellAxis], shape[cellAxis]);
            const outAxis = keys.slice(0, cellAxis).filter(isFull).length;
            if (cells.length) {
                const chunks = cells.map((cell) => {
                    const slab = [...keys];
                    slab[cellAxis] = cell;
                    return reader.read(this.path, slab);
                });
                return stack(chunks, outAxis);
            }
            keys[cellAxis] = slice(0, 0);
        }
        return reader.read(this.path, keys);
    }
}
/** One mesh cell (Python `_SurfaceCell`). */
export class SurfaceCell {
    /** @internal */
    constructor(_surface, index) {
        this._surface = _surface;
        this.index = index;
    }
    /** Species concentration fields bound to this cell. */
    get species() {
        return new Map([...this._surface.species].map(([name, f]) => [name, f.bind({ cell: this.index })]));
    }
}
/** The mesh cells, by native zero-based index (Python `_SurfaceCells`). */
export class SurfaceCells {
    /** @internal */
    constructor(_surface) {
        this._surface = _surface;
    }
    get length() {
        return this._surface.reader.shape("/Mesh2_face_nodes")[0][0];
    }
    get(index) {
        const [found, scalar] = indices(index, this.length);
        if (!scalar)
            throw new TypeError("Select one cell by its native zero-based index");
        return new SurfaceCell(this._surface, found[0]);
    }
}
/** Parse a CF reference date (`YYYY-MM-DD[ T]hh:mm[:ss[.f]]`) as UTC. */
function cfReference(text) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*$/.exec(text.trim());
    if (!m)
        throw new RangeError(`Unsupported time reference: '${text}'`);
    const [, y, mo, d, h = "0", mi = "0", s = "0", frac = ""] = m;
    const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms);
}
/** Saved 2D results; every recorded dataset is reachable through {@link field}. */
export class SurfaceResults {
    /** @internal */
    constructor(reader) {
        this.reader = reader;
        this._fields = new Map();
        this.cells = new SurfaceCells(this);
        this._paths = new Set(reader.datasets);
    }
    /** Top-level datasets by short name (`Mesh2_face_` dropped), `/time` excluded. */
    get variables() {
        return new Map([...this._paths]
            .sort()
            .filter((p) => slashes(p) === 1 && p !== "/time")
            .map((p) => [p.slice(1).replace(/^Mesh2_face_/, ""), this.field(p)]));
    }
    /** A dataset by full path, nested diagnostic groups included. */
    field(path) {
        const full = "/" + path.replace(/^\/+/, "");
        if (!this._paths.has(full)) {
            throw new ElementNotFoundError(full, `Variable was not recorded: ${full}`);
        }
        let field = this._fields.get(full);
        if (!field) {
            field = new SurfaceField(this, full);
            this._fields.set(full, field);
        }
        return field;
    }
    /** Report dates from the file's CF time units (millisecond precision). */
    get periodTimes() {
        const values = this.reader.read("/time").data;
        const units = this.reader.attributes("/time").units ?? "";
        const m = /^(days|hours|minutes|seconds) since (.+)$/.exec(units);
        if (!m)
            throw new RangeError(`Unsupported or missing time units: '${units}'`);
        const scale = { days: SECONDS_PER_DAY, hours: 3600, minutes: 60, seconds: 1 }[m[1]];
        if (!values.every(Number.isFinite))
            throw new RangeError("Non-finite report dates in output");
        const base = cfReference(m[2]);
        return Array.from(values, (v) => new Date(base + Math.round(Math.round(v * scale * 1e6) / 1000)));
    }
    /** The stored mesh in model coordinates, cells renumbered from zero. */
    get mesh() {
        const r = this.reader;
        const [xs, ys, zs] = ["x", "y", "z"].map((a) => r.read(`/Mesh2_node_${a}`).data);
        const nv = xs.length;
        const vertices = new Float64Array(nv * 3);
        for (let i = 0; i < nv; i++) {
            vertices[3 * i] = xs[i];
            vertices[3 * i + 1] = ys[i];
            vertices[3 * i + 2] = zs[i];
        }
        const raw = r.read("/Mesh2_face_nodes");
        const attrs = r.attributes("/Mesh2_face_nodes");
        const fill = Number(attrs._FillValue ?? "-1");
        const startIndex = Number(attrs.start_index ?? "0");
        const [nc, corners] = raw.shape;
        const cells = Int32Array.from(raw.data, (v) => {
            const n = Number(v);
            return n !== fill && n >= 0 ? n - startIndex : -1;
        });
        let counts;
        if (this._paths.has("/Mesh2_face_nv")) {
            counts = Int32Array.from(r.read("/Mesh2_face_nv").data, (v) => Number(v));
            if (counts.some((c) => c < 3 || c > corners)) {
                throw new RangeError("Invalid mesh cell vertex counts");
            }
            for (let c = 0; c < nc; c++) {
                for (let j = counts[c]; j < corners; j++)
                    cells[c * corners + j] = -1;
            }
        }
        else {
            counts = Int32Array.from({ length: nc }, (_, c) => cells.subarray(c * corners, (c + 1) * corners).reduce((n, v) => n + (v >= 0 ? 1 : 0), 0));
        }
        if (cells.some((v) => v >= nv))
            throw new RangeError("Mesh connectivity exceeds vertex count");
        let crs = {};
        try {
            crs = r.attributes("/crs");
        }
        catch (err) {
            if (!(err instanceof BadIndexError))
                throw err;
        }
        return {
            vertices: { shape: [nv, 3], data: vertices },
            cells: { shape: [nc, corners], data: cells },
            vertexCounts: counts,
            crs: crs.model_crs ?? null,
            metresPerModelUnit: "metres_per_model_unit" in crs ? Number(crs.metres_per_model_unit) : null,
            coordinateUnits: crs.units || r.attributes("/Mesh2_node_x").units || null,
        };
    }
    /** Species concentration fields, by species name. */
    get species() {
        const path = "/Mesh2_face_species_conc";
        if (!this._paths.has(path))
            return new Map();
        const field = this.field(path);
        return new Map(field.speciesNames.map((name, i) => [name, field.bind({ species: i })]));
    }
    /** The `/mass_balance_2d` totals, plus `continuity_error` when stored. */
    get massBalance() {
        const prefix = "/mass_balance_2d/";
        const result = new Map([...this._paths]
            .sort()
            .filter((p) => p.startsWith(prefix))
            .map((p) => [p.slice(prefix.length), Number(this.reader.read(p).data[0])]));
        if (result.size) {
            const attrs = this.reader.attributes("/mass_balance_2d");
            if ("continuity_error" in attrs)
                result.set("continuity_error", Number(attrs.continuity_error));
        }
        return result;
    }
}
/**
 * Independent readers for a 1D output, a 2D output or both. Their reporting
 * clocks stay separate. 2D files must be closed (immutable); `live` applies
 * only to the binary 1D output. Close with {@link close} or `using`.
 */
export class Results {
    constructor(mod, path, { surface, live = false } = {}) {
        this.output = null;
        this.surface = null;
        this._open = [];
        if ((path === null || path === undefined) && (surface === null || surface === undefined)) {
            throw new RangeError("Provide a 1D output path, a 2D surface path, or both");
        }
        try {
            if (path !== null && path !== undefined) {
                const output = new OutputReader(mod, path, { live });
                this._open.push(output);
                this.output = output;
                this.nodes = new ResultCollection(output, "node");
                this.links = new ResultCollection(output, "link");
                this.subcatchments = new ResultCollection(output, "subcatchment");
                this.system = new ResultCollection(output, "system");
            }
            if (surface !== null && surface !== undefined) {
                const reader = new Output2DReader(mod, surface);
                this._open.push(reader);
                this.surface = new SurfaceResults(reader);
            }
        }
        catch (err) {
            this.close();
            throw err;
        }
    }
    /** Python `Results.open(path, surface=..., live=...)`. */
    static open(mod, path, options = {}) {
        return new Results(mod, path, options);
    }
    /** 1D report dates; the surface has its own `periodTimes`. */
    get times() {
        if (!this.output)
            throw new RangeError("No 1D output was opened; use surface.periodTimes");
        return this.output.periodTimes;
    }
    /** Pick up completed 1D report periods (the 2D file is not tailed). */
    refresh() {
        if (!this.output)
            throw new RangeError("No 1D output was opened");
        return this.output.refresh();
    }
    /** Close every reader (last opened first). Repeated calls are harmless. */
    close() {
        while (this._open.length)
            this._open.pop().close();
    }
    [Symbol.dispose]() {
        this.close();
    }
}
//# sourceMappingURL=Results.js.map