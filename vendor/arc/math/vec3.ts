import type { Mat4, Vec3 } from './types.ts'

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x
  out[1] = y
  out[2] = z
  return out
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out[0] = a[0]!
  out[1] = a[1]!
  out[2] = a[2]!
  return out
}

export function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0]! + b[0]!
  out[1] = a[1]! + b[1]!
  out[2] = a[2]! + b[2]!
  return out
}

export function subtract(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0]! - b[0]!
  out[1] = a[1]! - b[1]!
  out[2] = a[2]! - b[2]!
  return out
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out[0] = a[0]! * s
  out[1] = a[1]! * s
  out[2] = a[2]! * s
  return out
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
}

export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ax = a[0]!,
    ay = a[1]!,
    az = a[2]!
  const bx = b[0]!,
    by = b[1]!,
    bz = b[2]!
  out[0] = ay * bz - az * by
  out[1] = az * bx - ax * bz
  out[2] = ax * by - ay * bx
  return out
}

export function length(a: Vec3): number {
  return Math.hypot(a[0]!, a[1]!, a[2]!)
}

export function normalize(out: Vec3, a: Vec3): Vec3 {
  const len = length(a)
  return len === 0 ? set(out, 0, 0, 0) : scale(out, a, 1 / len)
}

export function lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out[0] = a[0]! + (b[0]! - a[0]!) * t
  out[1] = a[1]! + (b[1]! - a[1]!) * t
  out[2] = a[2]! + (b[2]! - a[2]!) * t
  return out
}

/** Transforms a POINT (w = 1) by a column-major Mat4. */
export function transformMat4(out: Vec3, a: Vec3, m: Mat4): Vec3 {
  const x = a[0]!,
    y = a[1]!,
    z = a[2]!
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
  return out
}
