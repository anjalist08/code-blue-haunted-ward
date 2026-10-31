import { useState } from "react"

import { api, lastName, loadSession, saveSession, type Session } from "./api"

export function Landing() {
    const [name, setName] = useState(lastName() || "Dr. Night")
    const [code, setCode] = useState("")
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)

    async function create() {
        setBusy(true)
        setError("")
        try {
            const res = await api<Session & { code: string }>("/api/rooms", { name })
            saveSession(res.code, { token: res.token, identity: res.identity })
            location.href = `/room/${res.code}`
        } catch (e) {
            setError((e as Error).message)
            setBusy(false)
        }
    }

    return (
        <main className="landing">
            <div className="fog" />
            <h1 className="title">
                CODE BLUE<span>Haunted Ward</span>
            </h1>
            <p className="tagline">A flight simulator for the heart. 3:00 AM. Bed 13. He's been dying every night.</p>
            <div className="landing-cards">
                <section className="card">
                    <h2>Open a ward</h2>
                    <p className="muted">For the big screen. Students scan the QR code to join as doctors.</p>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
                    <button className="primary" disabled={busy} onClick={create}>
                        {busy ? "Opening…" : "Open Bed 13"}
                    </button>
                </section>
                <section className="card">
                    <h2>Join with a code</h2>
                    <p className="muted">Enter the 4-letter code shown on the big screen.</p>
                    <form
                        onSubmit={e => {
                            e.preventDefault()
                            if (code.trim()) location.href = `/join/${code.trim().toUpperCase()}`
                        }}
                    >
                        <input className="code-input" value={code} onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="ABCD" aria-label="Room code" autoCapitalize="characters" />
                        <button className="primary">Join</button>
                    </form>
                </section>
            </div>
            {error && <p className="error">{error}</p>}
            <p className="disclaimer">Educational simulation, not medical advice.</p>
        </main>
    )
}

export function Join({ code }: { code: string }) {
    const existing = loadSession(code)
    const [name, setName] = useState(existing?.identity.name ?? lastName())
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)

    async function join(role: "doctor" | "observer") {
        setBusy(true)
        setError("")
        try {
            const res = await api<Session>(`/api/rooms/${code}/join`, { name: name || "Doctor", role })
            saveSession(code, res)
            location.href = `/room/${code}`
        } catch (e) {
            setError((e as Error).message)
            setBusy(false)
        }
    }

    return (
        <main className="landing">
            <div className="fog" />
            <h1 className="title small">
                CODE BLUE<span>Haunted Ward</span>
            </h1>
            <section className="card join-card">
                <p className="muted">Ward code</p>
                <div className="big-code">{code}</div>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name, Doctor" aria-label="Your name" autoFocus />
                <button className="primary" disabled={busy} onClick={() => join("doctor")}>
                    🩺 Join as Doctor
                </button>
                <button className="ghost" disabled={busy} onClick={() => join("observer")}>
                    👁 Watch only
                </button>
                {existing && (
                    <a className="muted small-link" href={`/room/${code}`}>
                        Rejoin as {existing.identity.name} ({existing.identity.role})
                    </a>
                )}
                {error && <p className="error">{error}</p>}
            </section>
            <p className="disclaimer">Educational simulation, not medical advice.</p>
        </main>
    )
}
