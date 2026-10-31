import { useEffect, useMemo, useRef, useState } from "react"

import type { WardState } from "../sim/types"
import { api, loadSession, roomApi, type ServerConfig } from "./api"
import { BeatClock } from "./beat"
import { Feed } from "./components/Feed"
import { Monitor } from "./components/Monitor"
import { Options } from "./components/Options"
import { OrderBar } from "./components/OrderBar"
import { SceneViews } from "./components/SceneViews"
import { useHeartModel } from "./heartModel"
import { useBeeper } from "./sound"
import { useWard } from "./useWard"

export function Ward({ code }: { code: string }) {
    const session = useMemo(() => loadSession(code), [code])
    useEffect(() => {
        if (!session) location.replace(`/join/${code}`)
    }, [session, code])
    const { state, link } = useWard(code, session)
    const [config, setConfig] = useState<ServerConfig | null>(null)
    const [qrOpen, setQrOpen] = useState(false)
    const [toast, setToast] = useState<string | null>(null)
    const [debriefOpen, setDebriefOpen] = useState(false)
    const [sound, setSound] = useState(false)
    const clock = useMemo(() => new BeatClock(), [])
    const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const model = useHeartModel()
    useBeeper(clock, state, sound)

    useEffect(() => {
        const load = () => void api<ServerConfig>("/api/config").then(setConfig).catch(() => undefined)
        load()
        const id = setInterval(load, 15000)
        return () => clearInterval(id)
    }, [])

    useEffect(() => {
        if (state?.phase === "ended" && !state.debrief) setDebriefOpen(true)
    }, [state?.phase])

    if (!session) return null
    const who = session.identity
    const rooms = roomApi(code, session)
    const canOrder = who.role === "host" || who.role === "doctor"
    const isHost = who.role === "host"
    const notify = (text: string) => {
        setToast(text)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), Math.min(12000, 3800 + text.length * 45)) // long help stays readable
    }
    const act = (fn: () => Promise<unknown>) => () => void fn().catch(e => notify((e as Error).message))
    const joinUrl = `${config?.joinBase ?? location.origin}/join/${code}`
    const crashing = state && (!state.vitals.pulse || state.vitals.rhythm === "vtach")

    return (
        <div className={`ward${crashing ? " crashing" : ""}${state?.outcome === "died" ? " died" : ""}`}>
            <SceneViews state={state} clock={clock} />

            <header className="topbar">
                <div className="brand">
                    CODE BLUE <span>Haunted Ward</span>
                </div>
                <button className="room-code" onClick={() => setQrOpen(true)} title="Show the join QR code">
                    <span>BED 13 · CODE</span>
                    <b>{code}</b>
                    <img src={`/api/rooms/${code}/qr.svg`} alt="" />
                </button>
                <SimClock state={state} />
                <div className="members">
                    {(state?.members ?? []).map(m => (
                        <span key={m.id} className={`member ${m.role}`} title={m.role}>
                            {m.role === "observer" ? "👁" : m.role === "host" ? "🖥️" : "🩺"} {m.name}
                        </span>
                    ))}
                </div>
                <div className="status">
                    <span className={`pill ${link === "live" ? "ok" : "warn"}`} title="WebSocket to the Terse durable actor">
                        ● Terse actor {link === "live" ? "live" : link}
                    </span>
                    <span className={`pill ${config?.relay.mode === "relay" ? "ok" : "warn"}`} title={config?.relay.detail}>
                        ● {config?.relay.mode === "relay" ? "Agent Relay" : "Local bus"}
                    </span>
                    <button className={`pill ${sound ? "ok" : ""}`} onClick={() => setSound(!sound)} title="Monitor beeps">
                        {sound ? "🔊" : "🔈"}
                    </button>
                </div>
                <div className="controls">
                    {state?.phase === "lobby" && canOrder && <button className="primary" onClick={act(rooms.start)}>▶ Start case</button>}
                    {isHost && state?.phase !== "lobby" && <button onClick={act(rooms.reset)}>↺ Reset</button>}
                    {isHost && (
                        <button onClick={act(() => rooms.mode(state?.mode === "exam" ? "guided" : "exam"))} title="Guided shows the Attending's suggestions. Exam hides them.">
                            {state?.mode === "exam" ? "Exam mode" : "Guided mode"}
                        </button>
                    )}
                    {state?.phase !== "lobby" && <button onClick={() => setDebriefOpen(true)}>📋 Debrief</button>}
                </div>
            </header>

            <aside className="left">
                <Monitor state={state} clock={clock} />
                <Results state={state} />
            </aside>

            <aside className="right">
                <Feed state={state} relayMode={config?.relay.mode} />
            </aside>

            <footer className="bottom">
                <Options state={state} canOrder={canOrder} onOrder={async key => void (await rooms.order({ key }).catch(e => notify((e as Error).message)))} />
                <OrderBar state={state} api={rooms} canOrder={canOrder} voiceEnabled={Boolean(config?.voice)} onToast={notify} />
            </footer>

            {state?.phase === "lobby" && (
                <div className="lobby">
                    <div className="lobby-card">
                        <h2>Night shift, Bed 13</h2>
                        <p className="muted">Scan to join as a doctor, or go to the site and enter the code.</p>
                        <img className="qr" src={`/api/rooms/${code}/qr.svg`} alt={`QR code to join ${joinUrl}`} />
                        <div className="big-code">{code}</div>
                        <a className="join-url" href={joinUrl}>
                            {joinUrl}
                        </a>
                        <div className="lobby-members">{(state.members ?? []).filter(m => m.role === "doctor").length} doctor(s) joined</div>
                        {canOrder ? (
                            <button className="primary big" onClick={act(rooms.start)}>
                                ▶ Start the night shift
                            </button>
                        ) : (
                            <p className="muted">Waiting for the doctors to start the case…</p>
                        )}
                    </div>
                </div>
            )}

            {qrOpen && (
                <div className="modal" onClick={() => setQrOpen(false)}>
                    <div className="lobby-card">
                        <img className="qr" src={`/api/rooms/${code}/qr.svg`} alt="Join QR code" />
                        <div className="big-code">{code}</div>
                        <p className="join-url">{joinUrl}</p>
                    </div>
                </div>
            )}

            {debriefOpen && <Debrief state={state} rooms={rooms} onClose={() => setDebriefOpen(false)} />}
            {toast && (
                <div className="toast" role="status" onClick={() => setToast(null)}>
                    {toast}
                </div>
            )}
            <div className="footnote">
                Educational simulation, not medical advice.{model?.credit ? ` Heart model: ${model.credit}.` : ""} · {who.role === "observer" ? "👁" : "🩺"} {who.name}
            </div>
        </div>
    )
}

function SimClock({ state }: { state: WardState | null }) {
    const [now, setNow] = useState(Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [])
    const elapsed = state?.startedAt ? Math.max(0, ((state.phase === "ended" ? state.endedAt : now) - state.startedAt) / 1000) : 0
    const mm = Math.floor(elapsed / 60)
    const ss = Math.floor(elapsed % 60)
    return (
        <div className="simclock" title="Time since the case started">
            <b>03:{String(mm).padStart(2, "0")}</b>
            <span>
                AM · +{mm}:{String(ss).padStart(2, "0")}
            </span>
        </div>
    )
}

function Results({ state }: { state: WardState | null }) {
    if (!state) return null
    const orders = [...state.orders].reverse().slice(0, 8)
    return (
        <section className="results">
            <h3>Orders & results</h3>
            {orders.length === 0 && <p className="muted">No orders yet.</p>}
            <ul>
                {orders.map(o => (
                    <li key={o.id} className={`order ${o.status}`}>
                        <span className="status-dot" />
                        <span className="olabel">{o.label}</span>
                        <span className="ostatus">{o.status}</span>
                        {o.note && (o.status === "done" || o.status === "held" || o.status === "refused") && <span className="onote">{o.note}</span>}
                    </li>
                ))}
            </ul>
        </section>
    )
}

function Debrief({ state, rooms, onClose }: { state: WardState | null; rooms: ReturnType<typeof roomApi>; onClose: () => void }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    async function generate() {
        setBusy(true)
        setError("")
        try {
            await rooms.debrief()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="modal" onClick={onClose}>
            <div className="debrief" onClick={e => e.stopPropagation()}>
                <h2>{state?.outcome === "stabilized" ? "🫀 He made it." : state?.outcome === "died" ? "💀 Time of death" : "📋 Debrief (case still running)"}</h2>
                {state?.debrief ? <pre>{state.debrief}</pre> : <p className="muted">The Attending will review your timeline: every order, delay and rhythm change.</p>}
                {error && <p className="error">{error}</p>}
                <div className="debrief-actions">
                    <button className="primary" disabled={busy} onClick={generate}>
                        {busy ? "Dr. Vance is reviewing…" : state?.debrief ? "Regenerate" : "Generate AI debrief"}
                    </button>
                    <button onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    )
}
