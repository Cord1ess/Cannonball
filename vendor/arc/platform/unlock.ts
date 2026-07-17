/**
 * The shipped-game shell (docs/systems/architecture.md, BLUEPRINT §17):
 * everything a browser game needs around the engine, each piece taking its
 * host objects as STRUCTURAL parameters — window/document satisfy them, and
 * so do test fakes, so all of it runs in Node CI.
 */

export interface GestureTarget {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const

/**
 * Browsers gate audio (and some APIs) behind a user gesture. This arms
 * one-shot listeners for the common gesture events and calls `unlock` on the
 * FIRST of them — e.g. `installAutoplayUnlock(() => audio.resume(), window)`.
 * Unlock errors are swallowed (the gate may already be open).
 */
export function installAutoplayUnlock(
  unlock: () => void | Promise<void>,
  target: GestureTarget,
): () => void {
  let disposed = false
  const onGesture = (): void => {
    if (disposed) return
    detach()
    try {
      void Promise.resolve(unlock()).catch(() => undefined)
    } catch {
      // a throwing unlock must not break the gesture handler
    }
  }
  const detach = (): void => {
    disposed = true
    for (const type of GESTURE_EVENTS) target.removeEventListener(type, onGesture)
  }
  for (const type of GESTURE_EVENTS) target.addEventListener(type, onGesture)
  return detach
}
