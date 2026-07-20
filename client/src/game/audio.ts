import { createWebAudioBackend } from '@vendor/audio/webaudio-backend.ts'
import type { AudioBackend, ClipHandle, SoundHandle } from '@vendor/audio/backend.ts'
import { installAutoplayUnlock } from '@vendor/platform/unlock.ts'
import { onVisibilityChange } from '@vendor/platform/visibility.ts'
import { synthSfx } from './sfxSynth.ts'

/**
 * GAME AUDIO (M6). A thin party-game layer over the vendored WebAudio backend:
 * named sound slots loaded from `client/public/audio/`, game events mapped to
 * sounds with force-scaled volume + pitch, a looping music bed, autoplay unlock
 * on first gesture, and tab-mute.
 *
 * SOURCING: files are REAL recordings you drop into `client/public/audio/` with
 * the exact names below (see SOUND_FILES). A MISSING file is not an error — its
 * slot just stays silent, so the whole game runs before any audio exists and
 * each sound starts working the instant its file appears. Prefer CC0 (no
 * attribution); CC-BY is fine if you add the credit to `client/public/audio/
 * CREDITS.txt`. Formats: `.ogg` (smallest, best) or `.wav`/`.mp3`.
 *
 * The BALL sounds want to feel HEAVY (a giant ball), so they're pitched DOWN and
 * varied a little each hit so repeats don't sound machine-gunned.
 */

// --- the sound manifest — save your files under these exact names -------------
// (basename → the public path; the loader tries .ogg then .wav then .mp3)
export const SOUND_FILES = {
  // BALL — the accuracy-critical ones (real recordings)
  kick: 'kick', // a header / hard hit on the ball
  bounce: 'bounce', // ball bouncing on the pitch
  land: 'land', // ball / bean landing thud on grass
  // MATCH beats
  cannon: 'cannon', // kickoff cannon boom (everyone launches)
  whistle: 'whistle', // referee whistle (tick / kickoff)
  elim: 'elim', // a player eliminated (poof / whoosh-out)
  goal: 'goal', // GOLDEN BOOT goal scored
  tick: 'tick', // tense countdown blip in the last seconds
  save: 'save', // free-save punt
  // CROWD (you're supplying these)
  crowd: 'crowd', // ambient stadium crowd (loops under play)
  cheer: 'cheer', // crowd cheer swell (goal / elimination)
  // UI + world
  click: 'click', // menu / button click
  bang: 'bang', // floodlights switch on at nightfall
  // MUSIC
  music: 'music', // looping lo-fi background bed
} as const

export type SoundName = keyof typeof SOUND_FILES

export interface GameAudio {
  /** load every manifest file that exists (missing files silently skipped) */
  load(): Promise<void>
  /** fire a one-shot; opts scale volume/pitch (e.g. header force, ball speed) */
  play(name: SoundName, opts?: { volume?: number; rate?: number; vary?: number }): void
  /** start / restart the looping music bed (no-op if the file is absent) */
  startMusic(): void
  stopMusic(): void
  /** start / stop the ambient crowd loop */
  startCrowd(): void
  stopCrowd(): void
  /** master volume 0..1 (persisted) */
  setVolume(v: number): void
  volume(): number
  /** toggle mute (persisted); also auto-mutes when the tab is hidden */
  toggleMute(): boolean
  muted(): boolean
  dispose(): void
}

const STORE_VOL = 'cannonball.audio.vol'
const STORE_MUTE = 'cannonball.audio.mute'

export function createGameAudio(): GameAudio {
  // headless / no-AudioContext → a silent no-op audio so the game still runs
  let backend: AudioBackend | null = null
  try {
    backend = createWebAudioBackend()
  } catch {
    backend = null
  }

  const clips = new Map<SoundName, ClipHandle>()
  let musicHandle: SoundHandle | null = null
  let crowdHandle: SoundHandle | null = null
  let wantMusic = false
  let wantCrowd = false

  let vol = readNum(STORE_VOL, 0.8)
  let isMuted = readBool(STORE_MUTE, false)
  let tabHidden = false

  const applyMaster = (): void => {
    if (!backend) return
    backend.setMasterVolume(isMuted || tabHidden ? 0 : vol)
  }
  applyMaster()

  // autoplay: browsers gate audio until a user gesture — resume on the first,
  // then (re)start whatever loops were requested before the unlock.
  let unlocked = false
  if (backend) {
    installAutoplayUnlock(async () => {
      await backend!.resume()
      unlocked = true
      applyMaster()
      if (wantMusic) startMusicInternal()
      if (wantCrowd) startCrowdInternal()
    }, window)
    // auto-mute when the tab is hidden, restore on return
    onVisibilityChange(document, (visible) => {
      tabHidden = !visible
      applyMaster()
    })
  }

  async function loadOne(name: SoundName): Promise<void> {
    if (!backend) return
    const base = `/audio/${SOUND_FILES[name]}`
    for (const ext of ['ogg', 'wav', 'mp3']) {
      try {
        // ABORT the fetch if it never resolves — a missing/absent audio file must
        // never leave a request hanging. But allow plenty of time: the atmosphere
        // tracks are multi-MB and a short 4s abort was killing the crowd/music
        // download+decode before it finished (→ silent menu). The content-type
        // check below is what actually guards the index.html-fallback case (that
        // response returns instantly), so a long timeout here is safe.
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 30000)
        let res: Response
        try {
          res = await fetch(`${base}.${ext}`, { signal: ctrl.signal, cache: 'no-store' })
        } finally {
          clearTimeout(timer)
        }
        if (!res.ok) continue
        // Vite's dev server returns index.html (HTTP 200, text/html) for a
        // MISSING public file instead of a 404 — feeding that HTML into the audio
        // decoder hangs/errors. Only accept a real audio content-type.
        const ct = res.headers.get('content-type') ?? ''
        if (!ct.startsWith('audio/') && !ct.includes('octet-stream')) continue
        const bytes = await res.arrayBuffer()
        const clip = await backend.decode(bytes)
        clips.set(name, clip)
        return
      } catch {
        // missing / undecodable / aborted → try the next extension, else synth
      }
    }
    // no real file → SYNTHESIZE the slot (procedural fallback) so the game has a
    // full soundscape from just the two supplied atmosphere tracks. Real files,
    // when present, always win (we only reach here after every ext missed).
    try {
      const pcm = synthSfx(name, 44100)
      if (pcm) clips.set(name, backend.createClip(pcm, 44100))
    } catch {
      /* synth failed → that slot stays silent */
    }
  }

  function startMusicInternal(): void {
    if (!backend || !unlocked) return
    const clip = clips.get('music')
    if (clip === undefined) return
    if (musicHandle !== null) backend.stop(musicHandle)
    musicHandle = backend.play(clip, { loop: true, volume: 0.5 })
  }
  function startCrowdInternal(): void {
    if (!backend || !unlocked) return
    const clip = clips.get('crowd')
    if (clip === undefined) return
    if (crowdHandle !== null) backend.stop(crowdHandle)
    crowdHandle = backend.play(clip, { loop: true, volume: 0.35 })
  }

  return {
    async load(): Promise<void> {
      // load the two looping atmosphere tracks FIRST and kick their loops the
      // instant they're ready (they're the big files) — don't make the whole
      // soundscape wait on every one-shot decoding. If the loops were already
      // requested (startMusic/startCrowd) and we're unlocked, they start now.
      await Promise.all(
        (['music', 'crowd'] as SoundName[]).map((n) =>
          loadOne(n).then(() => {
            if (n === 'music' && wantMusic) startMusicInternal()
            if (n === 'crowd' && wantCrowd) startCrowdInternal()
          }),
        ),
      )
      // then the rest (one-shots + synth fallbacks) in the background
      await Promise.all(
        (Object.keys(SOUND_FILES) as SoundName[]).filter((n) => n !== 'music' && n !== 'crowd').map(loadOne),
      )
    },
    play(name, opts): void {
      if (!backend || !unlocked) return
      const clip = clips.get(name)
      if (clip === undefined) return
      const vary = opts?.vary ?? 0
      // slight random pitch spread so repeated hits don't machine-gun
      const jitter = vary ? 1 + (Math.random() - 0.5) * vary : 1
      backend.play(clip, {
        volume: Math.max(0, Math.min(1, opts?.volume ?? 1)),
        playbackRate: (opts?.rate ?? 1) * jitter,
      })
    },
    startMusic(): void {
      wantMusic = true
      startMusicInternal()
    },
    stopMusic(): void {
      wantMusic = false
      if (backend && musicHandle !== null) {
        backend.stop(musicHandle)
        musicHandle = null
      }
    },
    startCrowd(): void {
      wantCrowd = true
      startCrowdInternal()
    },
    stopCrowd(): void {
      wantCrowd = false
      if (backend && crowdHandle !== null) {
        backend.stop(crowdHandle)
        crowdHandle = null
      }
    },
    setVolume(v): void {
      vol = Math.max(0, Math.min(1, v))
      writeNum(STORE_VOL, vol)
      applyMaster()
    },
    volume: () => vol,
    toggleMute(): boolean {
      isMuted = !isMuted
      writeBool(STORE_MUTE, isMuted)
      applyMaster()
      return isMuted
    },
    muted: () => isMuted,
    dispose(): void {
      backend?.dispose()
    },
  }
}

// --- tiny persisted-setting helpers ------------------------------------------
function readNum(key: string, dflt: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v >= 0 ? v : dflt
  } catch {
    return dflt
  }
}
function writeNum(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    /* ignore */
  }
}
function readBool(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? dflt : v === '1'
  } catch {
    return dflt
  }
}
function writeBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}
