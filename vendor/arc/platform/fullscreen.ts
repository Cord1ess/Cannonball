/**
 * Fullscreen + pointer-lock, normalized: requests resolve to booleans
 * (rejection is ordinary UX — no gesture, user pressed Esc — not an
 * exception), exits never throw, and missing APIs read as unsupported.
 */

export interface FullscreenElement {
  requestFullscreen?(): Promise<void>
  requestPointerLock?(): Promise<void> | void
}

export interface FullscreenDocument {
  readonly fullscreenElement?: unknown
  exitFullscreen?(): Promise<void>
  readonly pointerLockElement?: unknown
  exitPointerLock?(): void
}

export async function requestFullscreen(element: FullscreenElement): Promise<boolean> {
  if (element.requestFullscreen === undefined) return false
  try {
    await element.requestFullscreen()
    return true
  } catch {
    return false
  }
}

export async function exitFullscreen(doc: FullscreenDocument): Promise<void> {
  if (doc.fullscreenElement == null || doc.exitFullscreen === undefined) return
  try {
    await doc.exitFullscreen()
  } catch {
    // already exited — nothing to do
  }
}

export function isFullscreen(doc: FullscreenDocument): boolean {
  return doc.fullscreenElement != null
}

export async function requestPointerLock(element: FullscreenElement): Promise<boolean> {
  if (element.requestPointerLock === undefined) return false
  try {
    await element.requestPointerLock()
    return true
  } catch {
    return false
  }
}

export function exitPointerLock(doc: FullscreenDocument): void {
  doc.exitPointerLock?.()
}

export function isPointerLocked(doc: FullscreenDocument): boolean {
  return doc.pointerLockElement != null
}
