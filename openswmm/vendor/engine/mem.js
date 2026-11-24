/**
 * @file mem.ts
 * @brief Raw-layer access and WASM heap helpers shared by the wrapper classes.
 *
 * @author   Caleb Buahin <caleb.buahin@gmail.com>
 * @copyright Copyright (c) 2026 Caleb Buahin. All rights reserved.
 * @license  Apache-2.0
 */
import { bindRaw } from "./raw.js";
import { raiseForCode } from "./errors.js";
const rawCache = new WeakMap();
/** The generated raw C-API table for `mod` (bound once per module instance). */
export function rawOf(mod) {
    let raw = rawCache.get(mod);
    if (!raw) {
        raw = bindRaw(mod);
        rawCache.set(mod, raw);
    }
    return raw;
}
/** Allocate a nonempty wasm32 block or fail before touching the heap. */
export function checkedAlloc(mod, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 0xffffffff)
        throw new RangeError("Invalid engine allocation size");
    const ptr = mod._malloc(bytes);
    if (!ptr)
        throw new RangeError("Cannot allocate engine buffer");
    return ptr;
}
/**
 * Call a C function that fills a caller-provided `char* buf, int buflen` and
 * return the string. Throws the mapped `EngineError` on a non-zero code.
 */
export function withCString(mod, size, call) {
    return withCStrings(mod, size, 1, ([buf], len) => call(buf, len))[0];
}
/** Read one or more success-on-truncation native strings without splitting UTF-8. */
export function withCStrings(mod, initialSize, count, call) {
    if (!Number.isInteger(count) || count < 1)
        throw new RangeError("String buffer count must be positive");
    const limit = 64 * 1024 * 1024;
    for (let size = Math.max(256, initialSize); size <= limit; size *= 2) {
        const buffers = [];
        try {
            for (let i = 0; i < count; i++) {
                const ptr = checkedAlloc(mod, size);
                buffers.push(ptr);
                mod.HEAPU8.fill(0, ptr, ptr + size);
            }
            raiseForCode(call(buffers, size));
            // Legacy getters report success for truncated strings. A value reaching
            // the penultimate byte is ambiguous, so retry before UTF-8 decoding.
            if (buffers.some((ptr) => mod.HEAPU8[ptr + size - 2] !== 0))
                continue;
            return buffers.map((ptr) => mod.UTF8ToString(ptr, size));
        }
        finally {
            for (const ptr of buffers)
                mod._free(ptr);
        }
    }
    throw new RangeError("Engine string exceeds 64 MiB");
}
/** Call a C function with a `double*` out-parameter and return the value. */
export function withDouble(mod, call) {
    const ptr = checkedAlloc(mod, 8);
    try {
        raiseForCode(call(ptr));
        return mod.getValue(ptr, "double");
    }
    finally {
        mod._free(ptr);
    }
}
/** Call a C function with an `int*` out-parameter and return the value. */
export function withInt(mod, call) {
    const ptr = checkedAlloc(mod, 4);
    try {
        raiseForCode(call(ptr));
        return mod.getValue(ptr, "i32");
    }
    finally {
        mod._free(ptr);
    }
}
/**
 * Call a C bulk getter that fills `double* out` for `n` elements and return
 * a copy as `Float64Array` (the WASM heap may move on growth, so no views).
 */
export function withDoubleArray(mod, n, call) {
    if (!Number.isSafeInteger(n) || n < 0 || n > 0x1fffffff)
        throw new RangeError("Invalid engine array length");
    if (n === 0)
        return new Float64Array(0);
    const ptr = checkedAlloc(mod, 8 * n);
    try {
        raiseForCode(call(ptr));
        return new Float64Array(mod.HEAPF64.buffer, ptr, n).slice();
    }
    finally {
        mod._free(ptr);
    }
}
/** Copy `values` into a temporary `double*` block, call, and free it. */
export function withDoubleInput(mod, values, call) {
    const n = values.length;
    if (!Number.isSafeInteger(n) || n < 0 || n > 0x1fffffff)
        throw new RangeError("Invalid engine array length");
    const input = Array.from(values);
    const ptr = checkedAlloc(mod, 8 * Math.max(n, 1));
    try {
        mod.HEAPF64.set(input, ptr / 8);
        raiseForCode(call(ptr, n));
    }
    finally {
        mod._free(ptr);
    }
}
/** Keep high-level views attached to their owner; raw C access stays explicit. */
export function guardedRaw(mod, check) {
    return Object.fromEntries(Object.entries(rawOf(mod)).map(([name, fn]) => [
        name,
        (...args) => {
            check();
            return fn(...args);
        },
    ]));
}
//# sourceMappingURL=mem.js.map