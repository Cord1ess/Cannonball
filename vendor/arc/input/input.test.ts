import { describe, expect, it } from 'vitest'
import { createInputCapture, type InputEventSource } from './capture.ts'
import { createInput } from './input.ts'
import type { InputMessage } from './messages.ts'

function jumpAndMove() {
  return createInput({
    actions: { jump: ['Space', 'Mouse0'] },
    axes: { moveX: { negative: ['KeyA', 'ArrowLeft'], positive: ['KeyD', 'ArrowRight'] } },
  })
}

describe('createInput — actions', () => {
  it('tracks pressed state with edge flags across pumps', () => {
    const input = jumpAndMove()
    input.inject({ kind: 'keyDown', code: 'Space', repeat: false })
    input.pump()
    expect(input.pressed('jump')).toBe(true)
    expect(input.justPressed('jump')).toBe(true)
    expect(input.justReleased('jump')).toBe(false)

    input.pump() // still held, no new messages
    expect(input.pressed('jump')).toBe(true)
    expect(input.justPressed('jump')).toBe(false)

    input.inject({ kind: 'keyUp', code: 'Space' })
    input.pump()
    expect(input.pressed('jump')).toBe(false)
    expect(input.justReleased('jump')).toBe(true)
  })

  it('latches a same-frame tap: down+up in one pump still fires both edges', () => {
    const input = jumpAndMove()
    input.inject({ kind: 'keyDown', code: 'Space', repeat: false })
    input.inject({ kind: 'keyUp', code: 'Space' })
    input.pump()
    expect(input.pressed('jump')).toBe(false)
    expect(input.justPressed('jump')).toBe(true)
    expect(input.justReleased('jump')).toBe(true)
  })

  it('multiple bindings hold an action until ALL are released', () => {
    const input = jumpAndMove()
    input.inject({ kind: 'keyDown', code: 'Space', repeat: false })
    input.inject({ kind: 'mouseDown', code: 'Mouse0' })
    input.pump()
    input.inject({ kind: 'keyUp', code: 'Space' })
    input.pump()
    expect(input.pressed('jump')).toBe(true) // mouse still holds it
    input.inject({ kind: 'mouseUp', code: 'Mouse0' })
    input.pump()
    expect(input.pressed('jump')).toBe(false)
  })

  it('key repeats do not re-fire justPressed', () => {
    const input = jumpAndMove()
    input.inject({ kind: 'keyDown', code: 'Space', repeat: false })
    input.pump()
    input.inject({ kind: 'keyDown', code: 'Space', repeat: true })
    input.pump()
    expect(input.justPressed('jump')).toBe(false)
  })

  it('unknown actions read as neutral, never throw', () => {
    const input = createInput()
    input.pump()
    expect(input.pressed('ghost')).toBe(false)
    expect(input.axis('ghost')).toBe(0)
  })
})

describe('createInput — axes and pointer', () => {
  it('axes combine opposing keys and clamp to [-1, 1]', () => {
    const input = jumpAndMove()
    input.inject({ kind: 'keyDown', code: 'KeyD', repeat: false })
    input.pump()
    expect(input.axis('moveX')).toBe(1)
    input.inject({ kind: 'keyDown', code: 'KeyA', repeat: false })
    input.pump()
    expect(input.axis('moveX')).toBe(0) // both held cancel out
    input.inject({ kind: 'keyUp', code: 'KeyD' })
    input.pump()
    expect(input.axis('moveX')).toBe(-1)
  })

  it('pointer deltas accumulate per frame and reset on pump', () => {
    const input = createInput()
    input.inject({ kind: 'mouseMove', x: 10, y: 20, dx: 3, dy: -1 })
    input.inject({ kind: 'mouseMove', x: 14, y: 18, dx: 4, dy: -2 })
    input.inject({ kind: 'wheel', dx: 0, dy: 120 })
    input.pump()
    expect(input.pointerDeltaX).toBe(7)
    expect(input.pointerDeltaY).toBe(-3)
    expect(input.wheelDelta).toBe(120)
    expect(input.pointerX).toBe(14)
    expect(input.pointerY).toBe(18)

    input.pump()
    expect(input.pointerDeltaX).toBe(0)
    expect(input.wheelDelta).toBe(0)
    expect(input.pointerX).toBe(14) // position persists; deltas do not
  })

  it('exposes the pumped frame messages verbatim — the recordable stream', () => {
    const input = createInput()
    const tap: InputMessage[] = [
      { kind: 'keyDown', code: 'Space', repeat: false },
      { kind: 'keyUp', code: 'Space' },
    ]
    for (const message of tap) input.inject(message)
    input.pump()
    expect(input.frameMessages()).toEqual(tap)
    input.pump()
    expect(input.frameMessages()).toEqual([])
  })
})

describe('createInputCapture', () => {
  it('translates DOM-shaped events into messages and detaches cleanly', () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const source: InputEventSource = {
      addEventListener: (type, listener) => listeners.set(type, listener as (event: unknown) => void),
      removeEventListener: (type) => listeners.delete(type),
    }
    const received: InputMessage[] = []
    const dispose = createInputCapture(source, (message) => received.push(message))

    listeners.get('keydown')!({ code: 'KeyW', repeat: false })
    listeners.get('mousedown')!({ button: 0, clientX: 5, clientY: 6 })
    listeners.get('mousemove')!({ button: 0, clientX: 7, clientY: 9, movementX: 2, movementY: 3 })
    listeners.get('wheel')!({ deltaX: 0, deltaY: -120 })

    expect(received).toEqual([
      { kind: 'keyDown', code: 'KeyW', repeat: false },
      { kind: 'mouseDown', code: 'Mouse0' },
      { kind: 'mouseMove', x: 7, y: 9, dx: 2, dy: 3 },
      { kind: 'wheel', dx: 0, dy: -120 },
    ])

    dispose()
    expect(listeners.size).toBe(0)
  })
})
