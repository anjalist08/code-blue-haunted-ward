import type { Role } from "../sim/types"

export type Identity = { id: string; code: string; name: string; role: Role }
export type Session = { token: string; identity: Identity }
export type ServerConfig = {
    joinBase: string
    relay: { mode: "relay" | "local"; detail: string; workspace?: string }
    llm: { calls: number; budget: number; model: string; enabled: boolean }
    voice: boolean
    voiceMaxSeconds: number
    realtimeModel: string
}

const key = (code: string) => `ward:${code.toUpperCase()}`

export function loadSession(code: string): Session | null {
    try {
        return JSON.parse(localStorage.getItem(key(code)) ?? "null") as Session | null
    } catch {
        return null
    }
}

export function saveSession(code: string, session: Session) {
    localStorage.setItem(key(code), JSON.stringify(session))
    localStorage.setItem("ward:name", session.identity.name)
}

export const lastName = () => localStorage.getItem("ward:name") ?? ""

export async function api<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
    return data
}

export const roomApi = (code: string, session: Session) => ({
    start: () => api(`/api/rooms/${code}/start`, { token: session.token }),
    reset: () => api(`/api/rooms/${code}/reset`, { token: session.token }),
    mode: (mode: "guided" | "exam") => api(`/api/rooms/${code}/mode`, { token: session.token, mode }),
    order: (input: { key?: string; text?: string }) => api<{ kind: string; placed: { orderId: string; label: string }[] }>(`/api/rooms/${code}/orders`, { token: session.token, ...input }),
    transcript: (from: "patient" | "doctor", text: string) => api(`/api/rooms/${code}/transcript`, { token: session.token, from, text }),
    debrief: () => api<{ debrief: string }>(`/api/rooms/${code}/debrief`, { token: session.token }),
    voice: () => api<{ clientSecret: string; model: string; maxSeconds: number }>(`/api/rooms/${code}/voice`, { token: session.token }),
    voiceInstructions: () => api<{ instructions: string }>(`/api/rooms/${code}/voice-instructions`, { token: session.token })
})
