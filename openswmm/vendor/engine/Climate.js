/**
 * @file Climate.ts
 * @brief `solver.climate`: temperature, evaporation, wind, humidity, snowmelt,
 *        areal depletion and monthly adjustments (Python
 *        `openswmm.engine._climate`).
 *
 * Monthly arrays have 12 values (January first); areal depletion curves 10.
 *
 * @license  Apache-2.0
 */
import { STRUCTS } from "./raw.js";
import { BadParamError, raiseForCode } from "./errors.js";
import { datetimeToOadate } from "./dates.js";
import { checkedAlloc, withCString, withDouble, withInt } from "./mem.js";
import { readStruct, withStruct } from "./structs.js";
import { SolverView } from "./view.js";
const PREVIEW_FIELDS = new Set([
    "evap_type",
    "evap_monthly",
    "pan_coeff",
    "adjust_evaporation",
    "evap_timeseries",
    "temp_source",
    "temp_timeseries",
    "climate_file_path",
    "climate_file_start",
    "climate_file_temp_units",
    "latitude",
    "longitude_correction_minutes",
    "adjust_temperature",
]);
/** `solver.climate`. */
export class Climate extends SolverView {
    /** @internal */
    _i(get) {
        return withInt(this._mod, (p) => get(this._h, p));
    }
    /** @internal */
    _d(get) {
        return withDouble(this._mod, (p) => get(this._h, p));
    }
    /** @internal */
    _set(set, v) {
        raiseForCode(set(this._h, v));
    }
    /** @internal */
    _s(get) {
        return withCString(this._mod, 256, (buf, len) => get(this._h, buf, len));
    }
    /** @internal */
    _setS(set, v) {
        raiseForCode(set(this._h, v));
    }
    /** @internal */
    _arr(get, n) {
        const p = checkedAlloc(this._mod, 8 * n);
        try {
            raiseForCode(get(this._h, p, n));
            return Array.from(this._mod.HEAPF64.subarray(p >> 3, (p >> 3) + n));
        }
        finally {
            this._mod._free(p);
        }
    }
    /** @internal */
    _setArr(set, values, n) {
        if (values.length !== n)
            throw new BadParamError(`expected ${n} values, got ${values.length}`);
        const p = checkedAlloc(this._mod, 8 * n);
        try {
            this._mod.HEAPF64.set(Array.from(values), p >> 3);
            raiseForCode(set(this._h, p, n));
        }
        finally {
            this._mod._free(p);
        }
    }
    /** Temperature source code. */
    get tempSource() {
        return this._i(this._raw.swmm_climate_get_temp_source);
    }
    set tempSource(v) {
        this._set(this._raw.swmm_climate_set_temp_source, v);
    }
    /** Temperature time series id. */
    get tempTimeseries() {
        return this._s(this._raw.swmm_climate_get_temp_timeseries);
    }
    set tempTimeseries(v) {
        this._setS(this._raw.swmm_climate_set_temp_timeseries, v);
    }
    /** Climate-file start date (OADate). */
    get tempFileStart() {
        return this._d(this._raw.swmm_climate_get_temp_file_start);
    }
    set tempFileStart(v) {
        this._set(this._raw.swmm_climate_set_temp_file_start, v);
    }
    /** Climate-file temperature units: 0 tenths of degC, 1 degC, 2 degF, -1 the reader's default. */
    get tempUnits() {
        return this._i(this._raw.swmm_climate_get_temp_units);
    }
    set tempUnits(v) {
        this._set(this._raw.swmm_climate_set_temp_units, v);
    }
    /** Site elevation. */
    get elevation() {
        return this._d(this._raw.swmm_climate_get_elevation);
    }
    set elevation(v) {
        this._set(this._raw.swmm_climate_set_elevation, v);
    }
    /** Site latitude (degrees). */
    get latitude() {
        return this._d(this._raw.swmm_climate_get_latitude);
    }
    set latitude(v) {
        this._set(this._raw.swmm_climate_set_latitude, v);
    }
    /** Longitude correction (minutes). */
    get longitudeCorrection() {
        return this._d(this._raw.swmm_climate_get_longitude_correction);
    }
    set longitudeCorrection(v) {
        this._set(this._raw.swmm_climate_set_longitude_correction, v);
    }
    /** Evaporation source (an `EvapType` value). */
    get evapType() {
        return this._i(this._raw.swmm_climate_get_evap_type);
    }
    set evapType(v) {
        this._set(this._raw.swmm_climate_set_evap_type, v);
    }
    /** Monthly evaporation rates. */
    get evapMonthly() {
        return this._arr(this._raw.swmm_climate_get_evap_monthly, 12);
    }
    set evapMonthly(v) {
        this._setArr(this._raw.swmm_climate_set_evap_monthly, v, 12);
    }
    /** Evaporation time series id. */
    get evapTimeseries() {
        return this._s(this._raw.swmm_climate_get_evap_timeseries);
    }
    set evapTimeseries(v) {
        this._setS(this._raw.swmm_climate_set_evap_timeseries, v);
    }
    /** Monthly pan coefficients. */
    get panCoeff() {
        return this._arr(this._raw.swmm_climate_get_pan_coeff, 12);
    }
    set panCoeff(v) {
        this._setArr(this._raw.swmm_climate_set_pan_coeff, v, 12);
    }
    /** Recovery pattern id for infiltration capacity. */
    get evapRecovery() {
        return this._s(this._raw.swmm_climate_get_evap_recovery);
    }
    set evapRecovery(v) {
        this._setS(this._raw.swmm_climate_set_evap_recovery, v);
    }
    /** Wind source (0 monthly, 1 climate file). */
    get windType() {
        return this._i(this._raw.swmm_climate_get_wind_type);
    }
    set windType(v) {
        this._set(this._raw.swmm_climate_set_wind_type, v);
    }
    /** Monthly average wind speeds. */
    get windMonthly() {
        return this._arr(this._raw.swmm_climate_get_wind_monthly, 12);
    }
    set windMonthly(v) {
        this._setArr(this._raw.swmm_climate_set_wind_monthly, v, 12);
    }
    /** Humidity source (0 constant, 1 monthly, 2 time series). */
    get humidityType() {
        return this._i(this._raw.swmm_climate_get_humidity_type);
    }
    set humidityType(v) {
        this._set(this._raw.swmm_climate_set_humidity_type, v);
    }
    /** Humidity variable (0 relative humidity, 1 dew point). */
    get humidityVariable() {
        return this._i(this._raw.swmm_climate_get_humidity_variable);
    }
    set humidityVariable(v) {
        this._set(this._raw.swmm_climate_set_humidity_variable, v);
    }
    /** Monthly humidity values. */
    get humidityMonthly() {
        return this._arr(this._raw.swmm_climate_get_humidity_monthly, 12);
    }
    set humidityMonthly(v) {
        this._setArr(this._raw.swmm_climate_set_humidity_monthly, v, 12);
    }
    /** Humidity time series id. */
    get humidityTimeseries() {
        return this._s(this._raw.swmm_climate_get_humidity_timeseries);
    }
    set humidityTimeseries(v) {
        this._setS(this._raw.swmm_climate_set_humidity_timeseries, v);
    }
    /** Air temperature below which precipitation is snow. */
    get snowTemp() {
        return this._d(this._raw.swmm_climate_get_snow_temp);
    }
    set snowTemp(v) {
        this._set(this._raw.swmm_climate_set_snow_temp, v);
    }
    /** Antecedent temperature index weight. */
    get atiWeight() {
        return this._d(this._raw.swmm_climate_get_ati_weight);
    }
    set atiWeight(v) {
        this._set(this._raw.swmm_climate_set_ati_weight, v);
    }
    /** Negative melt ratio. */
    get negMeltRatio() {
        return this._d(this._raw.swmm_climate_get_neg_melt_ratio);
    }
    set negMeltRatio(v) {
        this._set(this._raw.swmm_climate_set_neg_melt_ratio, v);
    }
    /** Areal depletion curve of impervious areas (10 values). */
    get adcImpervious() {
        return this._arr(this._raw.swmm_climate_get_adc_impervious, 10);
    }
    set adcImpervious(v) {
        this._setArr(this._raw.swmm_climate_set_adc_impervious, v, 10);
    }
    /** Areal depletion curve of pervious areas (10 values). */
    get adcPervious() {
        return this._arr(this._raw.swmm_climate_get_adc_pervious, 10);
    }
    set adcPervious(v) {
        this._setArr(this._raw.swmm_climate_set_adc_pervious, v, 10);
    }
    /** Monthly temperature adjustments. */
    get adjustTemperature() {
        return this._arr(this._raw.swmm_climate_get_adjust_temperature, 12);
    }
    set adjustTemperature(v) {
        this._setArr(this._raw.swmm_climate_set_adjust_temperature, v, 12);
    }
    /** Monthly evaporation adjustments. */
    get adjustEvaporation() {
        return this._arr(this._raw.swmm_climate_get_adjust_evaporation, 12);
    }
    set adjustEvaporation(v) {
        this._setArr(this._raw.swmm_climate_set_adjust_evaporation, v, 12);
    }
    /** Monthly rainfall multipliers. */
    get adjustRainfall() {
        return this._arr(this._raw.swmm_climate_get_adjust_rainfall, 12);
    }
    set adjustRainfall(v) {
        this._setArr(this._raw.swmm_climate_set_adjust_rainfall, v, 12);
    }
    /** Monthly conductivity multipliers. */
    get adjustConductivity() {
        return this._arr(this._raw.swmm_climate_get_adjust_conductivity, 12);
    }
    set adjustConductivity(v) {
        this._setArr(this._raw.swmm_climate_set_adjust_conductivity, v, 12);
    }
    /**
     * Sample the evaporation source between `start` and `end` every
     * `intervalDays`, from the model's settings or, with `config`, from draft
     * values (any of the evaporation, temperature-source and climate-file
     * fields; the rest come from the model). Live runtime forcing is excluded.
     */
    previewEvaporation(start, end, intervalDays, { config } = {}) {
        const first = start instanceof Date ? datetimeToOadate(start) : start;
        const last = end instanceof Date ? datetimeToOadate(end) : end;
        let draft = null;
        if (config) {
            const unknown = Object.keys(config).filter((k) => !PREVIEW_FIELDS.has(k));
            if (unknown.length)
                throw new BadParamError(`Unknown evaporation preview fields: ${unknown.sort().join(", ")}`);
            const pick = (key, fallback) => key in config ? config[key] : fallback;
            const climateFile = withCString(this._mod, 1024, (a, len) => {
                const o = checkedAlloc(this._mod, len);
                try {
                    return this._raw.swmm_file_path_get(this._h, 7, "", a, len, o, len);
                }
                finally {
                    this._mod._free(o);
                }
            });
            const twelve = (key, fallback) => {
                const v = Array.from(pick(key, fallback));
                if (v.length !== 12)
                    throw new BadParamError(`${key} must contain twelve values`);
                return v;
            };
            draft = {
                evap_type: pick("evap_type", this.evapType),
                evap_monthly: twelve("evap_monthly", this.evapMonthly),
                pan_coeff: twelve("pan_coeff", this.panCoeff),
                adjust_evaporation: twelve("adjust_evaporation", this.adjustEvaporation),
                evap_timeseries: pick("evap_timeseries", this.evapTimeseries),
                temp_source: pick("temp_source", this.tempSource),
                temp_timeseries: pick("temp_timeseries", this.tempTimeseries),
                climate_file_path: pick("climate_file_path", climateFile),
                climate_file_start: pick("climate_file_start", this.tempFileStart),
                climate_file_temp_units: pick("climate_file_temp_units", this.tempUnits),
                latitude: pick("latitude", this.latitude),
                longitude_correction_minutes: pick("longitude_correction_minutes", this.longitudeCorrection),
                adjust_temperature: twelve("adjust_temperature", this.adjustTemperature),
            };
        }
        const run = (cfg) => withStruct(this._mod, "SWMM_EvapPreviewSummary", (summary) => {
            const diagnostic = checkedAlloc(this._mod, 4096 + 4);
            const count = diagnostic + 4096;
            try {
                const call = (samples, capacity) => {
                    this._mod.HEAPU8[diagnostic] = 0;
                    const rc = cfg
                        ? this._raw.swmm_climate_preview_evaporation_with_config(this._h, cfg, first, last, intervalDays, samples, capacity, count, summary, diagnostic, 4096)
                        : this._raw.swmm_climate_preview_evaporation(this._h, first, last, intervalDays, samples, capacity, count, summary, diagnostic, 4096);
                    raiseForCode(rc, this._mod.UTF8ToString(diagnostic, 4096));
                };
                call(0, 0);
                const n = this._mod.HEAP32[count >> 2];
                const size = STRUCTS.SWMM_EvapPreviewSample.size;
                const buf = checkedAlloc(this._mod, size * Math.max(n, 1));
                try {
                    call(buf, n);
                    const rows = Array.from({ length: this._mod.HEAP32[count >> 2] }, (_, i) => readStruct(this._mod, "SWMM_EvapPreviewSample", buf + i * size));
                    const s = readStruct(this._mod, "SWMM_EvapPreviewSummary", summary);
                    return {
                        samples: rows,
                        summary: { ...s, runtime_forcing_unknown: s.runtime_forcing_unknown !== 0 },
                        diagnostic: this._mod.UTF8ToString(diagnostic, 4096),
                    };
                }
                finally {
                    this._mod._free(buf);
                }
            }
            finally {
                this._mod._free(diagnostic);
            }
        });
        if (!draft)
            return run(0);
        return withStruct(this._mod, "SWMM_EvapPreviewConfig", (cfg) => run(cfg), draft);
    }
}
//# sourceMappingURL=Climate.js.map