/**
 * @file types.ts
 * @brief TypeScript type declarations for the Emscripten-generated WASM module.
 *
 * @details Declares the shape of the object returned by `createOpenSwmmModule()`
 * so that `Solver` and the domain collection classes can call into the WASM
 * engine with full type safety.
 *
 * These types are structural (duck-typed) interfaces — the actual object is
 * produced at runtime by the Emscripten glue code.
 *
 * @author   Caleb Buahin <caleb.buahin@gmail.com>
 * @copyright Copyright (c) 2026 Caleb Buahin. All rights reserved.
 * @license  Apache-2.0
 */
// =============================================================================
// Emscripten Module interface
// =============================================================================
/**
 * Low-level Emscripten filesystem API exposed for .inp/.rpt/.out file I/O.
 */
import { MS_PER_DAY } from "./units.js";
// =============================================================================
// OADate helpers
// =============================================================================
/**
 * OADate epoch: 30 December 1899 00:00:00 UTC.
 *
 * The engine stores all timestamps as OA (OLE Automation) dates — decimal
 * days since this epoch. Values before 1 March 1900 require a special
 * correction because the original Lotus 1-2-3 / Excel bug treated 1900 as a
 * leap year; the engine already corrects for this, so we handle it too.
 */
const OA_EPOCH_MS = Date.UTC(1899, 11, 30); // 30 Dec 1899
/**
 * Convert an OADate (decimal days since 30 Dec 1899) to a JavaScript `Date`.
 *
 * @param oadate OADate value from the engine.
 */
export function oadateToDate(oadate) {
    return new Date(OA_EPOCH_MS + oadate * MS_PER_DAY);
}
/**
 * Convert a JavaScript `Date` to an OADate.
 *
 * @param date JavaScript `Date` object.
 */
export function dateToOadate(date) {
    return (date.getTime() - OA_EPOCH_MS) / MS_PER_DAY;
}
//# sourceMappingURL=types.js.map