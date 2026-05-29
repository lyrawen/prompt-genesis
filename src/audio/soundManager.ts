/**
 * Prompt Genesis — Web Audio API sound manager.
 * Zero external assets. All sounds are code-generated via oscillators + noise.
 *
 * Architecture:
 *   masterGain → destination
 *   reverbSend → convolver → masterGain  (shared reverb for spatial depth)
 *   Each sound plugs into masterGain or reverbSend
 */

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let reverbSend: GainNode | null = null

/* ── Helpers ──────────────────────────────────────────── */

function noiseBuffer(length: number, rate: number): AudioBuffer {
  const buf = ctx!.createBuffer(1, length, rate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function createReverb(duration = 1.8): ConvolverNode | null {
  if (!ctx) return null
  const rate = ctx.sampleRate
  const len = Math.floor(rate * duration)
  const buffer = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (rate * (0.2 + Math.random() * 0.2)))
    }
  }
  const c = ctx.createConvolver()
  c.buffer = buffer
  return c
}

/* ── Lifecycle ────────────────────────────────────────── */

function initSound(): boolean {
  try {
    ctx = new AudioContext()
    masterGain = ctx.createGain()
    masterGain.gain.value = 0.3
    masterGain.connect(ctx.destination)

    // Shared reverb bus
    const convolver = createReverb()
    if (convolver) {
      reverbSend = ctx.createGain()
      reverbSend.gain.value = 0.35
      reverbSend.connect(convolver)
      convolver.connect(masterGain)
    }
    return true
  } catch {
    return false
  }
}

function ensureResumed(): Promise<void> {
  if (ctx?.state === 'suspended') {
    return ctx.resume().catch(() => {/* autoplay policy prevented resume */})
  }
  return Promise.resolve()
}

/** Call on first user gesture before any SFX — fixes silent first click. */
export function prepareSound(): void {
  if (!isReady()) initSound()
  ensureResumed()
}

export function isReady(): boolean {
  return ctx !== null && masterGain !== null
}

/* ── Ambient drone + wind layer ───────────────────────── */

interface AmbientNodes {
  osc1: OscillatorNode
  osc2: OscillatorNode
  gain: GainNode
  filter: BiquadFilterNode
  noiseSource: AudioBufferSourceNode | null
  noiseGain: GainNode
  noiseFilter: BiquadFilterNode
}
let ambient: AmbientNodes | null = null

export function startAmbient(): void {
  if (!ctx || !masterGain || ambient) return
  ensureResumed()

  // Drone oscillators
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 300
  filter.Q.value = 0.5

  const gain = ctx.createGain()
  gain.gain.value = 0

  const osc1 = ctx.createOscillator()
  osc1.type = 'sine'; osc1.frequency.value = 72

  const osc2 = ctx.createOscillator()
  osc2.type = 'triangle'; osc2.frequency.value = 108

  osc1.connect(gain); osc2.connect(gain)
  gain.connect(filter); filter.connect(masterGain)
  osc1.start(); osc2.start()

  // Wind / rain noise layer
  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = 'lowpass'
  noiseFilter.frequency.value = 800
  noiseFilter.Q.value = 0.3

  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0

  const noiseSrc = ctx.createBufferSource()
  noiseSrc.buffer = noiseBuffer(Math.floor(ctx.sampleRate * 4), ctx.sampleRate)
  noiseSrc.loop = true
  noiseSrc.connect(noiseFilter)
  noiseFilter.connect(noiseGain)
  noiseGain.connect(masterGain)
  noiseSrc.start()

  ambient = { osc1, osc2, gain, filter, noiseSource: noiseSrc, noiseGain, noiseFilter }

  // Fade in
  gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 2)
  noiseGain.gain.linearRampToValueAtTime(0.012, ctx.currentTime + 3)
}

export function updateAmbientIntensity(timeLeft: number): void {
  if (!ambient || !ctx) return

  const crisis = 1 - Math.max(0, timeLeft) / 60
  const now = ctx.currentTime

  // Drone gain: 0.08 → 0.28
  ambient.gain.gain.linearRampToValueAtTime(0.08 + crisis * 0.2, now + 0.5)
  // Filter opens: 300Hz → 2000Hz
  ambient.filter.frequency.linearRampToValueAtTime(300 + crisis * 1700, now + 0.5)
  // Oscillators drift up
  ambient.osc1.frequency.linearRampToValueAtTime(72 + crisis * 48, now + 0.5)
  ambient.osc2.frequency.linearRampToValueAtTime(108 + crisis * 62, now + 0.5)

  // Wind noise: gain 0.012 → 0.08, filter 800 → 4000
  ambient.noiseGain.gain.linearRampToValueAtTime(0.012 + crisis * 0.068, now + 0.5)
  ambient.noiseFilter.frequency.linearRampToValueAtTime(800 + crisis * 3200, now + 0.5)
}

/* ── Divine gong (with reverb) ────────────────────────── */

export function playGong(): void {
  if (!ctx || !masterGain) return
  ensureResumed()

  const dest = reverbSend ?? masterGain

  // Layer 1: fundamental sweep
  const osc1 = ctx.createOscillator()
  osc1.type = 'sine'
  osc1.frequency.setValueAtTime(880, ctx.currentTime)
  osc1.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 1.0)
  const g1 = ctx.createGain()
  g1.gain.setValueAtTime(0.15, ctx.currentTime)
  g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2)
  osc1.connect(g1); g1.connect(dest)
  osc1.start(); osc1.stop(ctx.currentTime + 1.5)

  // Layer 2: harmonic shimmer (higher octave, decays faster)
  const osc2 = ctx.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(1320, ctx.currentTime)
  osc2.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.6)
  const g2 = ctx.createGain()
  g2.gain.setValueAtTime(0.06, ctx.currentTime)
  g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
  osc2.connect(g2); g2.connect(dest)
  osc2.start(); osc2.stop(ctx.currentTime + 1.0)
}

/* ── NPC action sounds ────────────────────────────────── */

/** Chop — short noise burst like wood impact */
export function playChop(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  const len = Math.floor(ctx.sampleRate * 0.08)
  const buf = noiseBuffer(len, ctx.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buf

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 800
  bp.Q.value = 2

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.12, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)

  src.connect(bp); bp.connect(gain); gain.connect(masterGain)
  src.start(); src.stop(ctx.currentTime + 0.2)
}

/** Page flip — soft filtered noise rustle */
export function playPageFlip(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  const len = Math.floor(ctx.sampleRate * 0.12)
  const buf = noiseBuffer(len, ctx.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buf

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2000
  bp.Q.value = 1.5

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.04, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)

  src.connect(bp); bp.connect(gain); gain.connect(masterGain)
  src.start(); src.stop(ctx.currentTime + 0.2)
}

/** Snore — low oscillator with slow vibrato */
let snoreInterval: ReturnType<typeof setInterval> | null = null
export function startSnore(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  stopSnore()
  const playSnoreCycle = (): void => {
    if (!ctx || !masterGain) return
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(90, ctx.currentTime)
    osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.3)
    osc.frequency.linearRampToValueAtTime(90, ctx.currentTime + 0.6)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.15)
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6)
    osc.connect(gain); gain.connect(masterGain!)
    osc.start(); osc.stop(ctx.currentTime + 0.7)
  }
  playSnoreCycle()
  snoreInterval = setInterval(playSnoreCycle, 1800)
}
export function stopSnore(): void {
  if (snoreInterval !== null) { clearInterval(snoreInterval); snoreInterval = null }
}

/* ── Countdown urgency ────────────────────────────────── */

let tickTimer: ReturnType<typeof setInterval> | null = null
let countdownTicksActive = false

function playTick(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  // Very short noise click
  const len = Math.floor(ctx.sampleRate * 0.02)
  const buf = noiseBuffer(len, ctx.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3000; bp.Q.value = 1
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.06, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04)
  src.connect(bp); bp.connect(gain); gain.connect(masterGain)
  src.start(); src.stop(ctx.currentTime + 0.08)
}

export function startCountdownTicks(): void {
  if (countdownTicksActive) return
  countdownTicksActive = true
  playTick()
  tickTimer = setInterval(playTick, 1000)
}

export function stopCountdownTicks(): void {
  countdownTicksActive = false
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

/* ── Crisis heartbeat ─────────────────────────────────── */

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function beat(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  const osc = ctx.createOscillator()
  osc.type = 'sine'; osc.frequency.value = 55
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.15, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
  osc.connect(gain); gain.connect(masterGain)
  osc.start(); osc.stop(ctx.currentTime + 0.25)
}

export function startHeartbeat(): void {
  stopHeartbeat()
  beat()
  heartbeatTimer = setInterval(beat, 1500)
}

export function updateHeartbeatBPM(timeLeft: number): void {
  if (timeLeft > 30) { stopHeartbeat(); return }
  const bpm = Math.min(120, Math.round(40 + (30 - Math.max(0, timeLeft)) * 2.67))
  const intervalMs = Math.round(60000 / bpm)
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  heartbeatTimer = setInterval(beat, intervalMs)
}

export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

/* ── UI sounds ────────────────────────────────────────── */

function playClick(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 600
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.06, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
  osc.connect(gain)
  gain.connect(masterGain)
  osc.start(t)
  osc.stop(t + 0.08)
}

function playHover(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 1200
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.02, t)
  gain.gain.linearRampToValueAtTime(0, t + 0.08)
  osc.connect(gain)
  gain.connect(masterGain)
  osc.start(t)
  osc.stop(t + 0.1)
}

/** mousedown → playClick; mouseenter → playHover (debounced per button). */
export function bindButtonSounds(...buttons: (HTMLElement | null)[]): void {
  for (const btn of buttons) {
    if (!btn) continue
    btn.addEventListener('mousedown', () => {
      prepareSound()
      playClick()
    })
    btn.addEventListener('mouseenter', () => {
      prepareSound()
      playHover()
    })
  }
}

/* ── Result jingles ───────────────────────────────────── */

export function playVictory(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  const dest = reverbSend ?? masterGain
  ;([523, 659, 784, 1047] as const).forEach((freq: number, i: number) => {
    const osc = ctx!.createOscillator()
    osc.type = 'sine'; osc.frequency.value = freq
    const gain = ctx!.createGain()
    const t = ctx!.currentTime + i * 0.14
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.12, t + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7)
    osc.connect(gain); gain.connect(dest)
    osc.start(t); osc.stop(t + 0.8)
  })
}

export function playDefeat(): void {
  if (!ctx || !masterGain) return
  ensureResumed()
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(350, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 1.8)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.08, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.8)
  osc.connect(gain); gain.connect(masterGain)
  osc.start(); osc.stop(ctx.currentTime + 2.2)
}

/* ── Cleanup ──────────────────────────────────────────── */

export function stopAll(): void {
  stopHeartbeat()
  stopSnore()
  stopCountdownTicks()
  if (ambient) {
    try { ambient.osc1.stop() } catch { /* already stopped */ }
    try { ambient.osc2.stop() } catch { /* already stopped */ }
    try { ambient.noiseSource?.stop() } catch { /* already stopped */ }
    ambient = null
  }
}
