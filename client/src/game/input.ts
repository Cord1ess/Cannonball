import { createInputCapture } from '@vendor/input/capture.ts'
import { createInput, type Input } from '@vendor/input/input.ts'

/** Keyboard + mouse bindings over the vendored latched-edge input stack. */
export function createGameInput(): Input {
  const input = createInput({
    actions: {
      jump: ['Space'],
      restart: ['KeyR'],
    },
    axes: {
      moveX: { negative: ['KeyA'], positive: ['KeyD'] },
      moveZ: { negative: ['KeyS'], positive: ['KeyW'] },
    },
  })
  createInputCapture(window, (message) => input.inject(message))
  return input
}
