import { useEffect, useRef } from "react"

import type { WardState } from "../../sim/types"
import { ecgSample, type BeatClock } from "../beat"

// Sweep-style monitor trace (like a real bedside monitor): a write head moves left to right,
// erasing just ahead of itself. Shape follows the rhythm; ST elevation shows while the RCA is shut.

export function Ecg({ state, clock, height = 120 }: { state: WardState | null; clock: BeatClock; height?: number }) {
    const canvas = useRef<HTMLCanvasElement>(null)
    const stateRef = useRef(state)
    stateRef.current = state

    useEffect(() => {
        const el = canvas.current!
        const ctx = el.getContext("2d")!
        let raf = 0
        let x = 0
        let lastY: number | null = null
        let lastT = performance.now()
        const SECONDS = 5

        const resize = () => {
            const dpr = window.devicePixelRatio || 1
            el.width = el.clientWidth * dpr
            el.height = el.clientHeight * dpr
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            ctx.fillStyle = "#020a05"
            ctx.fillRect(0, 0, el.clientWidth, el.clientHeight)
            x = 0
            lastY = null
        }
        resize()
        const observer = new ResizeObserver(resize)
        observer.observe(el)

        const frame = (now: number) => {
            const s = stateRef.current
            clock.update(s, now)
            const w = el.clientWidth
            const h = el.clientHeight
            const pxPerMs = w / (SECONDS * 1000)
            const r = s?.vitals.rhythm
            const color = !s || s.vitals.pulse ? "#39ff88" : r === "asystole" ? "#ffd84d" : "#ff4d4d"
            ctx.lineWidth = 1.8
            ctx.strokeStyle = color
            ctx.shadowColor = color
            ctx.shadowBlur = 6
            if (now - lastT > 1000) lastT = now - 1000 // tab was hidden
            for (let t = lastT; t < now; t += 4) {
                const nx = x + 4 * pxPerMs
                // Erase ahead of the write head.
                ctx.shadowBlur = 0
                ctx.fillStyle = "#020a05"
                ctx.fillRect(nx, 0, 14, h)
                ctx.shadowBlur = 6
                const y = h * 0.58 - ecgSample(s, clock, t) * h * 0.36
                if (lastY !== null && nx > x) {
                    ctx.beginPath()
                    ctx.moveTo(x, lastY)
                    ctx.lineTo(nx, y)
                    ctx.stroke()
                }
                lastY = y
                x = nx
                if (x > w) {
                    x = 0
                    lastY = null
                }
            }
            lastT = now
            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        return () => {
            cancelAnimationFrame(raf)
            observer.disconnect()
        }
    }, [clock])

    return <canvas ref={canvas} className="ecg" style={{ height }} aria-label="ECG trace" />
}
