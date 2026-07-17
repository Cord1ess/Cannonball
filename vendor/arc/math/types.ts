/**
 * Conventions (fixed for the engine's lifetime, Three-compatible):
 * - right-handed, Y-up
 * - column-major Mat4, flat 16 elements (translation in indices 12,13,14)
 * - quaternions as [x, y, z, w]
 *
 * All functions are allocation-free: they write into an `out` parameter and
 * return it. Callers own scratch buffers; hot paths reuse them.
 */

export type Vec3 = number[] | Float64Array
export type Quat = number[] | Float64Array
export type Mat4 = number[] | Float64Array

export const EPSILON = 1e-9
