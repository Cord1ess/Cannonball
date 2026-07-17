import { mouseButtonCode, type InputMessage } from './messages.ts'

/** The slice of a DOM event source we need — window satisfies it structurally. */
export interface InputEventSource {
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
}

interface KeyEventLike {
  readonly code: string
  readonly repeat?: boolean
}

interface MouseEventLike {
  readonly button: number
  readonly clientX: number
  readonly clientY: number
  readonly movementX?: number
  readonly movementY?: number
}

interface WheelEventLike {
  readonly deltaX: number
  readonly deltaY: number
}

/**
 * The DOM adapter: translates device events into InputMessages and hands them
 * to `sink` (an Input's inject). This is the ONLY browser-coupled piece of
 * the input stack — replay and tests skip it and inject messages directly.
 */
export function createInputCapture(
  source: InputEventSource,
  sink: (message: InputMessage) => void,
): () => void {
  const onKeyDown = (event: KeyEventLike): void => {
    sink({ kind: 'keyDown', code: event.code, repeat: event.repeat ?? false })
  }
  const onKeyUp = (event: KeyEventLike): void => {
    sink({ kind: 'keyUp', code: event.code })
  }
  const onMouseDown = (event: MouseEventLike): void => {
    sink({ kind: 'mouseDown', code: mouseButtonCode(event.button) })
  }
  const onMouseUp = (event: MouseEventLike): void => {
    sink({ kind: 'mouseUp', code: mouseButtonCode(event.button) })
  }
  const onMouseMove = (event: MouseEventLike): void => {
    sink({
      kind: 'mouseMove',
      x: event.clientX,
      y: event.clientY,
      dx: event.movementX ?? 0,
      dy: event.movementY ?? 0,
    })
  }
  const onWheel = (event: WheelEventLike): void => {
    sink({ kind: 'wheel', dx: event.deltaX, dy: event.deltaY })
  }

  source.addEventListener('keydown', onKeyDown as (event: unknown) => void)
  source.addEventListener('keyup', onKeyUp as (event: unknown) => void)
  source.addEventListener('mousedown', onMouseDown as (event: unknown) => void)
  source.addEventListener('mouseup', onMouseUp as (event: unknown) => void)
  source.addEventListener('mousemove', onMouseMove as (event: unknown) => void)
  source.addEventListener('wheel', onWheel as (event: unknown) => void)

  return () => {
    source.removeEventListener('keydown', onKeyDown as (event: unknown) => void)
    source.removeEventListener('keyup', onKeyUp as (event: unknown) => void)
    source.removeEventListener('mousedown', onMouseDown as (event: unknown) => void)
    source.removeEventListener('mouseup', onMouseUp as (event: unknown) => void)
    source.removeEventListener('mousemove', onMouseMove as (event: unknown) => void)
    source.removeEventListener('wheel', onWheel as (event: unknown) => void)
  }
}
