import { useEffect, useRef } from "react"

import type { FeedItem, WardState } from "../../sim/types"

const WHO: Record<FeedItem["from"], { icon: string; name: string }> = {
    nurse: { icon: "🧑‍⚕️", name: "Nurse Okafor" },
    pharmacist: { icon: "💊", name: "Pharmacist" },
    "lab-tech": { icon: "🧪", name: "Lab Tech" },
    attending: { icon: "🩺", name: "Dr. Vance (Attending)" },
    patient: { icon: "🛏️", name: "Mr. Holloway" },
    doctor: { icon: "👩‍⚕️", name: "Doctor" },
    system: { icon: "📟", name: "Monitor" },
    scribe: { icon: "📝", name: "Scribe" }
}

/** The live Agent Relay chatter: every message the care team sends each other lands here. */
export function Feed({ state, relayMode }: { state: WardState | null; relayMode?: "relay" | "local" }) {
    const list = useRef<HTMLDivElement>(null)
    const feed = state?.feed ?? []
    useEffect(() => {
        list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" })
    }, [feed.length])
    const t0 = state?.startedAt || state?.createdAt || 0
    return (
        <section className="feed">
            <header>
                <h3>Care team</h3>
                <span className={`pill ${relayMode === "relay" ? "ok" : "warn"}`} title={relayMode === "relay" ? "Agents are messaging each other over Agent Relay" : "Agent Relay unreachable: in-process fallback bus"}>
                    {relayMode === "relay" ? "⚡ Agent Relay #ward-" + (state?.code.toLowerCase() ?? "") : "local bus"}
                </span>
            </header>
            <div className="feed-list" ref={list}>
                {feed.length === 0 && <p className="muted">The ward is quiet. Too quiet.</p>}
                {feed.map(item => {
                    const who = WHO[item.from] ?? WHO.system
                    const mins = t0 ? Math.max(0, (item.at - t0) / 1000) : 0
                    return (
                        <div key={item.id} className={`msg from-${item.from}`}>
                            <div className="msg-head">
                                <span className="who">
                                    {who.icon} {item.from === "doctor" && item.by ? item.by : who.name}
                                </span>
                                {item.to?.length ? <span className="to">→ {item.to.map(t => `@${t}`).join(" ")}</span> : null}
                                <span className="time">
                                    {String(Math.floor(mins / 60)).padStart(2, "0")}:{String(Math.floor(mins % 60)).padStart(2, "0")}
                                </span>
                                {item.via === "relay" && <span className="via" title="Delivered over Agent Relay">⚡</span>}
                            </div>
                            <div className="msg-text">{item.text}</div>
                        </div>
                    )
                })}
            </div>
        </section>
    )
}
