import { useEffect, useRef } from "react"

import type { WardState } from "../sim/types"
import type { BeatClock } from "./beat"

// Monitor beeps: pitch tracks SpO2 like a real pulse oximeter; arrest rhythms sound an alarm.

export function useBeeper(clock: BeatClock, state: WardState | null, enabled: boolean) {
    const ctx = useRef<AudioContext | null>(null)
    const stateRef = useRef(state)
    stateRef.current = state

    useEffect(() => {
        if (!enabled) return
        ctx.current ??= new AudioContext()
        void ctx.current.resume()
        const tone = (freq: number, ms: number, gain = 0.08, type: OscillatorType = "sine") => {
            const ac = ctx.current!
            const osc = ac.createOscillator()
            const g = ac.createGain()
            osc.type = type
            osc.frequency.value = freq
            g.gain.setValueAtTime(gain, ac.currentTime)
            g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000)
            osc.connect(g).connect(ac.destination)
            osc.start()
            osc.stop(ac.currentTime + ms / 1000)
        }
        const off = clock.onBeat(() => {
            const s = stateRef.current
            if (!s || s.phase !== "running") return
            const spo2 = s.vitals.spo2 ?? 85
            tone(440 + (spo2 - 80) * 22, 90)
        })
        const alarm = setInterval(() => {
            const s = stateRef.current
            if (!s || s.phase !== "running") return
            if (!s.vitals.pulse) {
                tone(980, 160, 0.06, "square")
                setTimeout(() => tone(780, 160, 0.06, "square"), 200)
            } else if (s.vitals.rhythm === "vtach") tone(880, 120, 0.04, "triangle")
        }, 1000)
        return () => {
            off()
            clearInterval(alarm)
        }
    }, [enabled, clock])
}
