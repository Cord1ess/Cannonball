import type { Quat, Vec3 } from './types.ts'

export function identity(out: Quat): Quat {
  out[0] = 0
  out[1] = 0
  out[2] = 0
  out[3] = 1
  return out
}

export function set(out: Quat, x: number, y: number, z: number, w: number): Quat {
  out[0] = x
  out[1] = y
  out[2] = z
  out[3] = w
  return out
}

export function normalize(out: Quat, a: Quat): Quat {
  const len = Math.hypot(a[0]!, a[1]!, a[2]!, a[3]!)
  if (len === 0) return identity(out)
  const inv = 1 / len
  out[0] = a[0]! * inv
  out[1] = a[1]! * inv
  out[2] = a[2]! * inv
  out[3] = a[3]! * inv
  return out
}

/** Hamilton product: rotation b followed by rotation a. */
export function multiply(out: Quat, a: Quat, b: Quat): Quat {
  const ax = a[0]!,
    ay = a[1]!,
    az = a[2]!,
    aw = a[3]!
  const bx = b[0]!,
    by = b[1]!,
    bz = b[2]!,
    bw = b[3]!
  out[0] = aw * bx + ax * bw + ay * bz - az * by
  out[1] = aw * by + ay * bw + az * bx - ax * bz
  out[2] = aw * bz + az * bw + ax * by - ay * bx
  out[3] = aw * bw - ax * bx - ay * by - az * bz
  return out
}

/**
 * Intrinsic Tait-Bryan XYZ euler (radians) → unit quaternion. Matches
 * THREE.Euler's default 'XYZ' order — the repo's rotation convention. The
 * result is a unit quaternion by construction, which is what makes euler
 * the safe editing surface (a hand-scrubbed raw quaternion denormalizes and
 * SCALES whatever it poses).
 */
export function fromEuler(out: Quat, x: number, y: number, z: number): Quat {
  const cx = Math.cos(x / 2)
  const sx = Math.sin(x / 2)
  const cy = Math.cos(y / 2)
  const sy = Math.sin(y / 2)
  const cz = Math.cos(z / 2)
  const sz = Math.sin(z / 2)
  out[0] = sx * cy * cz + cx * sy * sz
  out[1] = cx * sy * cz - sx * cy * sz
  out[2] = cx * cy * sz + sx * sy * cz
  out[3] = cx * cy * cz - sx * sy * sz
  return out
}

/**
 * Unit quaternion → intrinsic XYZ euler (radians). Inverse of fromEuler for
 * pitch inside (-π/2, π/2); at the gimbal pole z collapses into x (z = 0),
 * like THREE.Euler.setFromRotationMatrix('XYZ'). Input is normalized
 * defensively.
 */
export function toEuler(out: Vec3, q: Quat): Vec3 {
  const len = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!)
  const inv = len === 0 ? 0 : 1 / len
  const x = q[0]! * inv
  const y = q[1]! * inv
  const z = q[2]! * inv
  const w = q[3]! * inv
  const m11 = 1 - 2 * (y * y + z * z)
  const m12 = 2 * (x * y - z * w)
  const m13 = 2 * (x * z + y * w)
  const m22 = 1 - 2 * (x * x + z * z)
  const m23 = 2 * (y * z - x * w)
  const m32 = 2 * (y * z + x * w)
  const m33 = 1 - 2 * (x * x + y * y)
  const clamped = Math.min(Math.max(m13, -1), 1)
  out[1] = Math.asin(clamped)
  if (Math.abs(clamped) < 0.9999999) {
    out[0] = Math.atan2(-m23, m33)
    out[2] = Math.atan2(-m12, m11)
  } else {
    out[0] = Math.atan2(m32, m22)
    out[2] = 0
  }
  return out
}

/** Axis must be normalized. */
export function fromAxisAngle(out: Quat, axisX: number, axisY: number, axisZ: number, radians: number): Quat {
  const half = radians / 2
  const s = Math.sin(half)
  out[0] = axisX * s
  out[1] = axisY * s
  out[2] = axisZ * s
  out[3] = Math.cos(half)
  return out
}

/**
 * Normalized lerp with neighborhood correction (shortest arc). The standard
 * choice for per-frame render interpolation: cheaper than slerp and
 * indistinguishable at the small angular deltas one fixed step produces.
 */
export function nlerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
  const dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
  const sign = dot < 0 ? -1 : 1 // negated twin = same rotation, shorter path
  out[0] = a[0]! + (b[0]! * sign - a[0]!) * t
  out[1] = a[1]! + (b[1]! * sign - a[1]!) * t
  out[2] = a[2]! + (b[2]! * sign - a[2]!) * t
  out[3] = a[3]! + (b[3]! * sign - a[3]!) * t
  return normalize(out, out)
}

export function rotateVec3(out: Vec3, q: Quat, v: Vec3): Vec3 {
  const qx = q[0]!,
    qy = q[1]!,
    qz = q[2]!,
    qw = q[3]!
  const vx = v[0]!,
    vy = v[1]!,
    vz = v[2]!
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  // out = v + w * t + cross(q.xyz, t)
  out[0] = vx + qw * tx + (qy * tz - qz * ty)
  out[1] = vy + qw * ty + (qz * tx - qx * tz)
  out[2] = vz + qw * tz + (qx * ty - qy * tx)
  return out
}
