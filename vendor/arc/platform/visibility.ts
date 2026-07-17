export interface VisibilityDocument {
  readonly visibilityState: string
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/**
 * Tab visibility as one boolean callback — the pause/resume hook (games
 * typically set timeScale 0 and suspend audio while hidden). Fires once
 * immediately with the current state so callers never special-case startup.
 */
export function onVisibilityChange(
  doc: VisibilityDocument,
  callback: (visible: boolean) => void,
): () => void {
  const notify = (): void => callback(doc.visibilityState === 'visible')
  doc.addEventListener('visibilitychange', notify)
  notify()
  return () => doc.removeEventListener('visibilitychange', notify)
}
