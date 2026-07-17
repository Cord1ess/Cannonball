/**
 * Minimal sink — back it with a single THREE.LineSegments using
 * DynamicDrawUsage buffers (grow-and-reupload on capacity change).
 * (Replaces ARC's RenderBackend seam for standalone use.)
 */
export interface DebugLineSink {
  drawDebugLines(batch: { count: number; positions: Float32Array; colors: Float32Array }): void
}

/**
 * Immediate-mode debug drawing (docs/systems/rendering.md): systems and tools
 * accumulate lines during the frame; the flush system hands ONE batch to the
 * backend in the extract phase and starts the next frame empty. Everything
 * goes through the seam — gizmos, physics wireframes, custom tooling — so a
 * worker renderer later changes nothing here.
 *
 * Colors are rgb 0..1. Buffers grow geometrically and are reused every frame
 * (zero steady-state allocation once warm).
 */
export interface DebugDraw {
  line(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    g: number,
    b: number,
  ): void
  /** Axis-aligned wireframe box: 12 segments. */
  wireBox(
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    r: number,
    g: number,
    b: number,
  ): void
  /** Three axis-aligned circles approximating a sphere. */
  wireSphere(cx: number, cy: number, cz: number, radius: number, r: number, g: number, b: number): void
  /** Raw segment soup (imported line sets). xyz endpoint pairs, one color. */
  segments(positions: ArrayLike<number>, r: number, g: number, b: number): void
  /** Segment soup with rgb per endpoint (physics debug wireframes). */
  coloredSegments(positions: ArrayLike<number>, segmentColors: ArrayLike<number>): void
  /** Lines accumulated so far this frame. */
  readonly count: number
  /** Submits this frame's lines to the backend and clears the accumulator. */
  flush(): void
}

const SPHERE_SEGMENTS = 24

export function createDebugDraw(backend: DebugLineSink): DebugDraw {
  let positions = new Float32Array(256 * 6)
  let colors = new Float32Array(256 * 6)
  let count = 0

  function ensure(extraSegments: number): void {
    const needed = (count + extraSegments) * 6
    if (positions.length >= needed) return
    const capacity = Math.max(needed, positions.length * 2)
    const grownPositions = new Float32Array(capacity)
    grownPositions.set(positions)
    positions = grownPositions
    const grownColors = new Float32Array(capacity)
    grownColors.set(colors)
    colors = grownColors
  }

  function line(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    g: number,
    b: number,
  ): void {
    ensure(1)
    const base = count * 6
    positions[base] = ax
    positions[base + 1] = ay
    positions[base + 2] = az
    positions[base + 3] = bx
    positions[base + 4] = by
    positions[base + 5] = bz
    colors[base] = r
    colors[base + 1] = g
    colors[base + 2] = b
    colors[base + 3] = r
    colors[base + 4] = g
    colors[base + 5] = b
    count++
  }

  function flush(): void {
    backend.drawDebugLines({ count, positions, colors })
    count = 0
  }

  return {
    line,

    wireBox(cx, cy, cz, hx, hy, hz, r, g, b): void {
      const x0 = cx - hx,
        x1 = cx + hx
      const y0 = cy - hy,
        y1 = cy + hy
      const z0 = cz - hz,
        z1 = cz + hz
      // bottom rectangle, top rectangle, verticals
      line(x0, y0, z0, x1, y0, z0, r, g, b)
      line(x1, y0, z0, x1, y0, z1, r, g, b)
      line(x1, y0, z1, x0, y0, z1, r, g, b)
      line(x0, y0, z1, x0, y0, z0, r, g, b)
      line(x0, y1, z0, x1, y1, z0, r, g, b)
      line(x1, y1, z0, x1, y1, z1, r, g, b)
      line(x1, y1, z1, x0, y1, z1, r, g, b)
      line(x0, y1, z1, x0, y1, z0, r, g, b)
      line(x0, y0, z0, x0, y1, z0, r, g, b)
      line(x1, y0, z0, x1, y1, z0, r, g, b)
      line(x1, y0, z1, x1, y1, z1, r, g, b)
      line(x0, y0, z1, x0, y1, z1, r, g, b)
    },

    wireSphere(cx, cy, cz, radius, r, g, b): void {
      for (let i = 0; i < SPHERE_SEGMENTS; i++) {
        const a0 = (i / SPHERE_SEGMENTS) * Math.PI * 2
        const a1 = ((i + 1) / SPHERE_SEGMENTS) * Math.PI * 2
        const c0 = Math.cos(a0) * radius,
          s0 = Math.sin(a0) * radius
        const c1 = Math.cos(a1) * radius,
          s1 = Math.sin(a1) * radius
        line(cx + c0, cy + s0, cz, cx + c1, cy + s1, cz, r, g, b) // XY
        line(cx + c0, cy, cz + s0, cx + c1, cy, cz + s1, r, g, b) // XZ
        line(cx, cy + c0, cz + s0, cx, cy + c1, cz + s1, r, g, b) // YZ
      }
    },

    segments(soup, r, g, b): void {
      const segmentCount = Math.floor(soup.length / 6)
      ensure(segmentCount)
      const base = count * 6 // soup is already xyz segment pairs — copy straight in
      for (let i = 0; i < segmentCount * 6; i++) {
        positions[base + i] = soup[i]!
        colors[base + i] = i % 3 === 0 ? r : i % 3 === 1 ? g : b
      }
      count += segmentCount
    },

    coloredSegments(soup, segmentColors): void {
      const segmentCount = Math.floor(soup.length / 6)
      ensure(segmentCount)
      const base = count * 6
      for (let i = 0; i < segmentCount * 6; i++) {
        positions[base + i] = soup[i]!
        colors[base + i] = segmentColors[i] ?? 1
      }
      count += segmentCount
    },

    get count(): number {
      return count
    },

    flush,
  }
}
