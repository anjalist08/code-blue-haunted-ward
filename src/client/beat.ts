import type { Rhythm, WardState } from "../sim/types"

// One beat clock drives the 3D heart, the ECG trace and the monitor beep, so they stay in sync.

export type Beat = { t: number; wide: boolean }

export class BeatClock {
    beats: Beat[] = [{ t: 0, wide: false }]
    next = 0
    count = 0
    private listeners = new Set<(beat: Beat) => void>()

    onBeat(fn: (beat: Beat) => void) {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }

    /** Advance to `now` (ms). Safe to call from several render loops. */
    update(state: WardState | null, now: number) {
        const rhythm: Rhythm = state?.vitals.rhythm ?? "sinus"
        const organized = rhythm === "sinus" || rhythm === "pvc" || rhythm === "vtach"
        if (!state || state.phase === "lobby") {
            // Resting heart in the lobby: slow, calm.
            if (now >= this.next) this.fire(now, false, 1000)
            return
        }
        if (!organized) {
            this.next = now + 400
            return
        }
        if (now < this.next) return
        const hr = Math.max(30, state.vitals.hr || 80)
        let interval = 60000 / hr
        let wide = rhythm === "vtach"
        if (rhythm === "pvc" && this.count % 4 === 3) {
            wide = true
            interval *= 1.5 // compensatory pause after the early beat
        } else if (rhythm === "pvc" && this.count % 4 === 2) {
            interval *= 0.62 // the next beat comes early: that's the PVC
        }
        if (rhythm === "vtach") interval *= 0.96 + Math.random() * 0.08
        this.fire(now, wide, interval)
    }

    private fire(now: number, wide: boolean, interval: number) {
        const beat = { t: now, wide }
        this.beats = [...this.beats.slice(-6), beat]
        this.next = now + interval
        this.count++
        for (const fn of this.listeners) fn(beat)
    }

    last(): Beat {
        return this.beats[this.beats.length - 1]!
    }
}

/** 0..1 contraction amount for the 3D heart at time `now`. */
export function beatShape(state: WardState, clock: BeatClock, now: number): number {
    clock.update(state, now)
    const r = state.vitals.rhythm
    if (r === "vfib" || r === "asystole") return 0
    const phase = (now - clock.last().t) / 1000
    const strength = clock.last().wide ? 0.75 : state.phys.rcaOpen ? 1 : 0.55 + state.phys.perfusion * 0.5
    if (phase < 0.1) return (phase / 0.1) * strength
    if (phase < 0.38) return (1 - (phase - 0.1) / 0.28) * strength
    return 0
}

/** ECG lead II voltage at time ts (ms), given the clock's beat history. */
export function ecgSample(state: WardState | null, clock: BeatClock, ts: number): number {
    const r = state?.vitals.rhythm ?? "sinus"
    const now = ts / 1000
    const cpr = state ? state.phys.cprUntil > state.now && !state.vitals.pulse : false
    const artifact = cpr ? 0.55 * Math.max(0, Math.sin(now * Math.PI * 2 * 1.85)) ** 3 : 0
    const noise = (Math.random() - 0.5) * 0.03
    if (r === "asystole") return Math.sin(now * 0.7) * 0.03 + noise + artifact
    if (r === "vfib") {
        const amp = 0.3 + 0.18 * Math.sin(now * 0.9)
        return amp * (Math.sin(now * 31) * 0.6 + Math.sin(now * 43 + 1.3) * 0.4 + Math.sin(now * 19 + 0.4) * 0.5) + noise + artifact
    }
    // Find the beat that precedes ts.
    let beat = clock.beats[0]!
    for (const b of clock.beats) if (b.t <= ts) beat = b
    const tb = (ts - beat.t) / 1000
    const toNext = (clock.next - ts) / 1000
    const stElevation = state && !state.phys.rcaOpen && state.phase !== "lobby" ? 0.22 : 0
    let v = noise
    if (beat.wide) {
        if (tb < 0.18) v += 1.15 * Math.sin((Math.PI * tb) / 0.18)
        else if (tb < 0.42) v -= 0.42 * Math.sin((Math.PI * (tb - 0.18)) / 0.24)
        return v
    }
    // P wave just before the next beat.
    if (toNext > 0 && toNext < 0.14) v += 0.12 * Math.sin((Math.PI * (0.14 - toNext)) / 0.14)
    // QRS
    if (tb < 0.02) v -= 0.12 * (tb / 0.02)
    else if (tb < 0.045) v += -0.12 + 1.22 * ((tb - 0.02) / 0.025)
    else if (tb < 0.07) v += 1.1 - 1.45 * ((tb - 0.045) / 0.025)
    else if (tb < 0.09) v += -0.35 + (0.35 + stElevation) * ((tb - 0.07) / 0.02)
    // ST segment + T wave
    else if (tb < 0.2) v += stElevation
    else if (tb < 0.38) v += stElevation * (1 - (tb - 0.2) / 0.18) + 0.28 * Math.sin((Math.PI * (tb - 0.2)) / 0.18)
    return v
}
