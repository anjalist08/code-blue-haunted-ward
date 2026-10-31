import { networkInterfaces } from "node:os"

import QRCode from "qrcode"

import { catalogByKey } from "../sim/case"
import type { Role } from "../sim/types"
import { askPatient, askTeam, debrief, interpret, placeOrder, startAgents } from "./agents"
import { busStatus, ensureRoom, startBus } from "./bus"
import { config } from "./config"
import { llmStats } from "./llm"
import { canOrder, createRoom, getState, grantFor, issueToken, normalizeCode, rewatchRunningRooms, roomExists, verifyToken, ward, watch, type Identity } from "./rooms"
import { instructions, mintVoiceSession } from "./voice"

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } })
const fail = (status: number, error: string) => json({ error }, status)

function lanAddress(): string | null {
    for (const list of Object.values(networkInterfaces())) {
        for (const net of list ?? []) if (net.family === "IPv4" && !net.internal) return net.address
    }
    return null
}

/** The URL phones should open. PUBLIC_URL wins (use it with a tunnel for HTTPS/mic on phones). */
function joinBase(req: Request): string {
    if (config.publicUrl) return config.publicUrl
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? `localhost:${config.port}`
    const [hostname, port] = host.split(":")
    const proto = req.headers.get("x-forwarded-proto") ?? "http"
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        const lan = lanAddress()
        if (lan) return `${proto}://${lan}${port ? `:${port}` : ""}`
    }
    return `${proto}://${host}`
}

async function body<T>(req: Request): Promise<Partial<T>> {
    try {
        return (await req.json()) as Partial<T>
    } catch {
        return {}
    }
}

async function auth(req: Request, code: string, payload: { token?: string }): Promise<Identity | null> {
    return verifyToken(payload.token ?? req.headers.get("authorization")?.replace(/^Bearer /, ""), code)
}

type Route = (req: Request, code: string) => Promise<Response>

const roomRoutes: Record<string, Route> = {
    "GET ": async (_req, code) => json({ exists: roomExists(code), code }),

    "POST join": async (req, code) => {
        if (!roomExists(code)) return fail(404, "No ward with that code. Check the code on the big screen.")
        const b = await body<{ name: string; role: Role }>(req)
        const role: Role = b.role === "observer" ? "observer" : "doctor"
        const { token, identity } = issueToken(code, b.name ?? "Doctor", role)
        void watch(code).catch(() => undefined)
        void ensureRoom(code)
        return json({ token, identity })
    },

    "POST socket": async (req, code) => {
        const who = await auth(req, code, await body<{ token: string }>(req))
        if (!who) return fail(401, "Invalid token")
        void watch(code).catch(() => undefined)
        return json(await grantFor(code, who))
    },

    "POST start": async (req, code) => {
        const who = await auth(req, code, await body<{ token: string }>(req))
        if (!who || !canOrder(who)) return fail(403, "Only doctors can start the case")
        await ensureRoom(code)
        await watch(code).catch(() => undefined)
        return json(await ward(code).start())
    },

    "POST reset": async (req, code) => {
        const who = await auth(req, code, await body<{ token: string }>(req))
        if (!who || who.role !== "host") return fail(403, "Only the host can reset")
        return json(await ward(code).reset())
    },

    "POST mode": async (req, code) => {
        const b = await body<{ token: string; mode: "guided" | "exam" }>(req)
        const who = await auth(req, code, b)
        if (!who || who.role !== "host") return fail(403, "Only the host can change mode")
        return json(await ward(code).setMode(b.mode === "exam" ? "exam" : "guided"))
    },

    "POST orders": async (req, code) => {
        const b = await body<{ token: string; key: string; text: string }>(req)
        const who = await auth(req, code, b)
        if (!who || !canOrder(who)) return fail(403, "Observers can't place orders")
        const s = await getState(code)
        if (s.phase !== "running") return fail(409, s.phase === "lobby" ? "Start the case first." : "The case has ended. Reset to play again.")
        await ensureRoom(code)
        if (b.key) {
            const item = catalogByKey.get(b.key)
            if (!item) return fail(400, "Unknown order")
            return json({ kind: "orders", placed: [await placeOrder(code, item, who.name, b.text)] })
        }
        const text = (b.text ?? "").trim().slice(0, 400)
        if (!text) return fail(400, "Say or type an order")
        const intent = await interpret(text)
        if (intent.kind === "orders") {
            const placed = []
            for (const item of intent.items) placed.push(await placeOrder(code, item, who.name, intent.items.length === 1 ? text : undefined))
            return json({ kind: "orders", placed })
        }
        if (intent.kind === "patient") await askPatient(code, who.name, text)
        else await askTeam(code, who.name, text)
        return json({ kind: intent.kind, placed: [] })
    },

    "POST transcript": async (req, code) => {
        const b = await body<{ token: string; from: "patient" | "doctor"; text: string }>(req)
        const who = await auth(req, code, b)
        if (!who || !b.text) return fail(403, "Invalid token")
        await ward(code).postFeed({ from: b.from === "patient" ? "patient" : "doctor", text: b.text.slice(0, 400), by: b.from === "patient" ? undefined : who.name, via: "actor" })
        return json({ ok: true })
    },

    "POST voice": async (req, code) => {
        const who = await auth(req, code, await body<{ token: string }>(req))
        if (!who || !canOrder(who)) return fail(403, "Only doctors can use voice")
        if (!config.openaiKey) return fail(503, "OPENAI_API_KEY is not set on the server")
        const session = await mintVoiceSession(await getState(code))
        return session ? json(session) : fail(502, "Couldn't start a Realtime session")
    },

    "POST voice-instructions": async (req, code) => {
        const who = await auth(req, code, await body<{ token: string }>(req))
        if (!who) return fail(401, "Invalid token")
        return json({ instructions: instructions(await getState(code)) })
    },

    "POST debrief": async (req, code) => {
        const who = await auth(req, code, await body<{ token: string }>(req))
        if (!who) return fail(401, "Invalid token")
        return json({ debrief: await debrief(code) })
    },

    "GET qr.svg": async (req, code) => {
        const url = `${joinBase(req)}/join/${code}`
        const svg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#e8ffe8", light: "#00000000" }, errorCorrectionLevel: "M" })
        return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } })
    }
}

async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === "/api/config" && req.method === "GET") {
        return json({ joinBase: joinBase(req), relay: busStatus(), llm: llmStats(), voice: Boolean(config.openaiKey), voiceMaxSeconds: config.voiceMaxSeconds, realtimeModel: config.realtimeModel })
    }

    if (path === "/api/rooms" && req.method === "POST") {
        const b = await body<{ name: string }>(req)
        const code = await createRoom(b.name ?? "Host")
        const { token, identity } = issueToken(code, b.name ?? "Host", "host")
        void ensureRoom(code)
        void watch(code).catch(() => undefined)
        return json({ code, token, identity })
    }

    const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/?([a-z.-]*)$/)
    if (m) {
        const code = normalizeCode(m[1]!)
        const route = roomRoutes[`${req.method} ${m[2] ?? ""}`]
        if (!route) return fail(404, "Not found")
        return route(req, code)
    }
    return fail(404, "Not found")
}

const status = await startBus()
console.log(`[relay] ${status.mode}: ${status.detail}${status.workspace ? ` (workspace ${status.workspace})` : ""}`)
startAgents()
void rewatchRunningRooms().then(codes => codes.length && console.log(`[watch] re-attached to running rooms: ${codes.join(", ")}`))

Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",
    async fetch(req) {
        try {
            return await handle(req)
        } catch (error) {
            console.error(error)
            return fail(500, (error as Error).message)
        }
    }
})
console.log(`[api] http://127.0.0.1:${config.port}  (open the app via Vite on :3000)`)
console.log(`[llm] agents: ${config.agentModel}, voice: ${config.realtimeModel}, key ${config.openaiKey ? "set" : "MISSING"}`)
