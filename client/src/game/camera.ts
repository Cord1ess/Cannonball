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

  constructor(camera: THREE.PerspectiveCamera) {
    this.#camera = camera
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
    // pulled back and raised, angled down at the player (M1 feedback)
    const dist = 10.5
    const height = 4.4 + this.pitch * 5
    const fx = this.forwardX
    const fz = this.forwardZ

    const wantX = tx - fx * dist
    const wantY = ty + height
    const wantZ = tz - fz * dist
    const k = 1 - Math.exp(-14 * dt)
    this.#pos.x += (wantX - this.#pos.x) * k
    this.#pos.y += (wantY - this.#pos.y) * k
    this.#pos.z += (wantZ - this.#pos.z) * k

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
