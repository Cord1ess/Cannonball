import type { InputMessage } from './messages.ts'

/**
 * Named actions and axes over raw codes — gameplay reads INTENT ('jump',
 * 'moveX'), bindings decide devices. KB/M bindings are the M1 floor
 * (BLUEPRINT §26); gamepad/touch arrive as more message kinds + binding
 * forms, not a redesign.
 */
export interface InputConfig {
  /** action name → codes that trigger it ('Space', 'KeyW', 'Mouse0', …) */
  readonly actions?: { readonly [name: string]: readonly string[] }
  /** axis name → codes pulling toward -1 / +1; result is clamped [-1, 1] */
  readonly axes?: {
    readonly [name: string]: { readonly negative: readonly string[]; readonly positive: readonly string[] }
  }
}

export interface Input {
  /** Feed one message (capture adapters and replay both land here). */
  inject(message: InputMessage): void
  /** Drains buffered messages into action state. Runs once per frame. */
  pump(): void

  /** Held this frame. */
  pressed(action: string): boolean
  /** Went down since the last pump — latched, so a same-frame tap still counts. */
  justPressed(action: string): boolean
  justReleased(action: string): boolean
  axis(name: string): number
  /** Pointer movement accumulated over the frame's messages. */
  readonly pointerDeltaX: number
  readonly pointerDeltaY: number
  readonly wheelDelta: number
  /** Last known pointer position (-1 before any move). */
  readonly pointerX: number
  readonly pointerY: number

  /** The messages consumed by the LAST pump — the recordable frame input. */
  frameMessages(): readonly InputMessage[]
}

interface ActionState {
  readonly codes: readonly string[]
  pressed: boolean
  justPressed: boolean
  justReleased: boolean
}

/**
 * Buffered messages → per-frame action state. Edges are LATCHED during the
 * pump: a key that goes down and back up between two frames still reports
 * one justPressed and one justReleased on the next frame — taps are never
 * lost to frame timing.
 */
export function createInput(config?: InputConfig): Input {
  const queue: InputMessage[] = []
  let frame: InputMessage[] = []
  const down = new Set<string>()

  const actions = new Map<string, ActionState>()
  for (const [name, codes] of Object.entries(config?.actions ?? {})) {
    actions.set(name, { codes, pressed: false, justPressed: false, justReleased: false })
  }
  const axes = new Map<string, { negative: readonly string[]; positive: readonly string[] }>()
  for (const [name, spec] of Object.entries(config?.axes ?? {})) {
    axes.set(name, spec)
  }

  let pointerDeltaX = 0
  let pointerDeltaY = 0
  let wheelDelta = 0
  let pointerX = -1
  let pointerY = -1

  function anyDown(codes: readonly string[]): boolean {
    for (const code of codes) if (down.has(code)) return true
    return false
  }

  function pump(): void {
    for (const state of actions.values()) {
      state.justPressed = false
      state.justReleased = false
    }
    pointerDeltaX = 0
    pointerDeltaY = 0
    wheelDelta = 0

    frame = queue.splice(0, queue.length)
    for (const message of frame) {
      switch (message.kind) {
        case 'keyDown':
        case 'mouseDown': {
          if (message.kind === 'keyDown' && message.repeat) break
          const code = message.code
          down.add(code)
          for (const state of actions.values()) {
            if (!state.pressed && state.codes.includes(code)) {
              state.pressed = true
              state.justPressed = true // latched for this frame
            }
          }
          break
        }
        case 'keyUp':
        case 'mouseUp': {
          down.delete(message.code)
          for (const state of actions.values()) {
            if (state.pressed && !anyDown(state.codes)) {
              state.pressed = false
              state.justReleased = true // latched for this frame
            }
          }
          break
        }
        case 'mouseMove':
          pointerDeltaX += message.dx
          pointerDeltaY += message.dy
          pointerX = message.x
          pointerY = message.y
          break
        case 'wheel':
          wheelDelta += message.dy
          break
      }
    }
  }

  return {
    inject: (message) => {
      queue.push(message)
    },
    pump,
    pressed: (action) => actions.get(action)?.pressed ?? false,
    justPressed: (action) => actions.get(action)?.justPressed ?? false,
    justReleased: (action) => actions.get(action)?.justReleased ?? false,
    axis(name) {
      const spec = axes.get(name)
      if (spec === undefined) return 0
      return (anyDown(spec.positive) ? 1 : 0) - (anyDown(spec.negative) ? 1 : 0)
    },
    get pointerDeltaX() {
      return pointerDeltaX
    },
    get pointerDeltaY() {
      return pointerDeltaY
    },
    get wheelDelta() {
      return wheelDelta
    },
    get pointerX() {
      return pointerX
    },
    get pointerY() {
      return pointerY
    },
    frameMessages: () => frame,
  }
}
