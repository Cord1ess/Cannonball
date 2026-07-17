/**
 * Input as MESSAGES (docs/systems/architecture.md frame loop; the time-travel
 * moonshot invariant): every device event becomes a plain-data message before
 * anything gameplay-visible happens. Messages are buffered, pumped once per
 * frame into action state, and — because they are pure data — recordable and
 * replayable byte-for-byte. Codes follow KeyboardEvent.code ('KeyW', 'Space');
 * mouse buttons are 'Mouse0'..'Mouse4'.
 */
export type InputMessage =
  | { readonly kind: 'keyDown'; readonly code: string; readonly repeat: boolean }
  | { readonly kind: 'keyUp'; readonly code: string }
  | { readonly kind: 'mouseDown'; readonly code: string }
  | { readonly kind: 'mouseUp'; readonly code: string }
  | {
      readonly kind: 'mouseMove'
      readonly x: number
      readonly y: number
      readonly dx: number
      readonly dy: number
    }
  | { readonly kind: 'wheel'; readonly dx: number; readonly dy: number }

export function mouseButtonCode(button: number): string {
  return `Mouse${button}`
}
