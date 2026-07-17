import { createInputCapture } from '@vendor/input/capture.ts'
import { createInput, type Input } from '@vendor/input/input.ts'

/** Keyboard + mouse bindings over the vendored latched-edge input stack. */
export function createGameInput(): Input {
  const input = createInput({
    actions: {
      jump: ['Space'],
      dive: ['Mouse0', 'ControlLeft'], // airborne: dive/header
      sprint: ['ShiftLeft'],
      restart: ['KeyR'],
    },
    axes: {
      moveX: { negative: ['KeyA'], positive: ['KeyD'] },
      moveZ: { negative: ['KeyS'], positive: ['KeyW'] },
      lean: { negative: ['KeyQ'], positive: ['KeyE'] }, // tilt left/right, ground AND air
    },
  })
  createInputCapture(window, (message) => input.inject(message))
  return input
}
