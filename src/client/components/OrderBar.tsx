import { useEffect, useRef, useState } from "react"

import { phaseKey } from "../../sim/case"
import type { WardState } from "../../sim/types"
import type { roomApi } from "../api"
import { RealtimeVoice, type VoiceStatus } from "../voice"

type Api = ReturnType<typeof roomApi>

/** Type or speak orders. Voice uses OpenAI Realtime: the patient answers out loud. */
export function OrderBar({ state, api, canOrder, voiceEnabled, onToast }: { state: WardState | null; api: Api; canOrder: boolean; voiceEnabled: boolean; onToast: (text: string) => void }) {
    const [text, setText] = useState("")
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState<VoiceStatus>("idle")
    const [caption, setCaption] = useState<{ who: string; text: string } | null>(null)
    const [left, setLeft] = useState(0)
    const voice = useRef<RealtimeVoice | null>(null)
    const lastPhase = useRef("")

    async function submit(input: string) {
        const words = input.trim()
        if (!words) return
        setBusy(true)
        try {
            const res = await api.order({ text: words })
            if (res.kind === "orders") onToast(`Ordered: ${res.placed.map(p => p.label).join(", ")}`)
            setText("")
        } catch (e) {
            onToast((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function toggleVoice() {
        if (voice.current && status !== "idle" && status !== "error") {
            voice.current.stop()
            return
        }
        const v = new RealtimeVoice({
            onStatus: (s, detail) => {
                setStatus(s)
                if (detail) onToast(detail)
            },
            onCaption: (who, t) => {
                setCaption({ who, text: t })
                if (who === "patient") void api.transcript("patient", t).catch(() => undefined)
            },
            onOrder: async words => {
                const res = await api.order({ text: words })
                return res.kind === "orders" ? `The nurse is on it: ${res.placed.map(p => p.label).join(", ")}` : "Passed to the team."
            }
        })
        voice.current = v
        try {
            const session = await api.voice()
            await v.start(session)
        } catch (e) {
            setStatus("error")
            onToast((e as Error).message)
        }
    }

    // Keep the patient's voice in character as he deteriorates.
    useEffect(() => {
        if (!state || status !== "live") return
        const phase = phaseKey(state)
        if (phase === lastPhase.current) return
        lastPhase.current = phase
        void api.voiceInstructions().then(r => voice.current?.updateInstructions(r.instructions)).catch(() => undefined)
    }, [state, status])

    useEffect(() => {
        if (status !== "live") return
        const id = setInterval(() => setLeft(Math.max(0, Math.round(((voice.current?.endsAt ?? 0) - Date.now()) / 1000))), 500)
        return () => clearInterval(id)
    }, [status])

    useEffect(() => () => voice.current?.stop(), [])

    if (!canOrder) return <p className="muted observer-note">👁 Watching. Join as a doctor to place orders.</p>

    return (
        <section className="orderbar">
            <form
                onSubmit={e => {
                    e.preventDefault()
                    void submit(text)
                }}
            >
                <input value={text} onChange={e => setText(e.target.value)} placeholder="Type an order or question: “Get a troponin and an ECG”" aria-label="Order" disabled={busy || state?.phase !== "running"} />
                <button className="primary" disabled={busy || !text.trim() || state?.phase !== "running"}>
                    Send
                </button>
                {voiceEnabled && (
                    <button type="button" className={`mic ${status}`} onClick={toggleVoice} disabled={state?.phase !== "running" && status === "idle"} title="Talk to the patient and give orders out loud (OpenAI Realtime)">
                        {status === "live" ? `🔴 ${left}s` : status === "connecting" ? "…" : "🎙️ Voice"}
                    </button>
                )}
            </form>
            {caption && status === "live" && (
                <p className={`caption ${caption.who}`}>
                    {caption.who === "patient" ? "🛏️" : "🗣️"} {caption.text}
                </p>
            )}
        </section>
    )
}
