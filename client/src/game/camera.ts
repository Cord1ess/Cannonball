import * as THREE from 'three'

/**
 * Third-person chase camera (idea.md §1): pointer-lock mouse look, soft
 * follow, small kick reserve for header feedback. Yaw convention matches
 * shared/sim/physics.ts: forward = (sin(yaw), cos(yaw)) in XZ.
 */
export class ChaseCamera {
  yaw = 0
  pitch = 0.28

  #camera: THREE.PerspectiveCamera
  #pos = new THREE.Vector3(0, 4, -9)
  #look = new THREE.Vector3()
  #shake = 0
  /** arena bound so the camera never passes through the stadium wall */
  #boundR = 999

  constructor(camera: THREE.PerspectiveCamera) {
    this.#camera = camera
  }

  /** the interior radius the camera must stay inside — INSIDE the wall so the
   *  camera stays over the pitch and never clips into the stadium structure */
  setArenaRadius(r: number): void {
    this.#boundR = r - 1.5
  }

  addMouse(dx: number, dy: number): void {
    this.yaw -= dx * 0.0028
    this.pitch = Math.min(0.6, Math.max(-0.12, this.pitch + dy * 0.002))
  }

  kick(amount: number): void {
    this.#shake = Math.min(1, this.#shake + amount)
  }

  get forwardX(): number {
    return Math.sin(this.yaw)
  }
  get forwardZ(): number {
    return Math.cos(this.yaw)
  }

  /** eliminated spectators drift around the arena rim */
  updateOrbit(dt: number, radius: number, height: number): void {
    this.yaw += dt * 0.12
    this.#pos.set(Math.cos(this.yaw) * radius, height, Math.sin(this.yaw) * radius)
    this.#camera.position.copy(this.#pos)
    this.#look.set(0, 1, 0)
    this.#camera.lookAt(this.#look)
  }

  update(dt: number, tx: number, ty: number, tz: number): void {
    const dist = 10.5
    const fx = this.forwardX
    const fz = this.forwardZ

    // desired boom position behind the player
    let wantX = tx - fx * dist
    let wantY = ty + 4.4 + this.pitch * 5
    let wantZ = tz - fz * dist

    // ROBUST WALL GUARD (two stages):
    // (a) shorten the boom so the *ideal* spot is inside — camera sits closer.
    let boom = dist
    const bDot = tx * fx + tz * fz
    const cc = tx * tx + tz * tz - this.#boundR * this.#boundR
    const disc = bDot * bDot - cc
    if (cc < 0 && disc > 0) {
      // player inside the bound: the boom may exit it — cap boom at the exit
      const dExit = bDot + Math.sqrt(disc)
      if (dExit < boom) boom = Math.max(2.0, dExit)
    }
    wantX = tx - fx * boom
    wantZ = tz - fz * boom
    // (b) as the boom shrinks, RAISE the camera so it looks down over the wall
    const shrink = 1 - boom / dist // 0 normal .. 1 fully pulled in
    wantY += shrink * 5.5

    const k = 1 - Math.exp(-14 * dt)
    this.#pos.x += (wantX - this.#pos.x) * k
    this.#pos.y += (wantY - this.#pos.y) * k
    this.#pos.z += (wantZ - this.#pos.z) * k

    // (c) HARD CLAMP the smoothed position's radius every frame — a guarantee
    // that the camera can NEVER be outside the bound, even mid-smoothing.
    const posR = Math.hypot(this.#pos.x, this.#pos.z)
    if (posR > this.#boundR) {
      const s = this.#boundR / posR
      this.#pos.x *= s
      this.#pos.z *= s
    }

    this.#shake = Math.max(0, this.#shake - dt * 3.5)
    const s = this.#shake * this.#shake * 0.18
    this.#camera.position.set(
      this.#pos.x + (Math.random() - 0.5) * s,
      this.#pos.y + (Math.random() - 0.5) * s,
      this.#pos.z + (Math.random() - 0.5) * s,
    )

    this.#look.set(tx + fx * 0.6, ty + 0.9, tz + fz * 0.6)
    this.#camera.lookAt(this.#look)
  }
}
