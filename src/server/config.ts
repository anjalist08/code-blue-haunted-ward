import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { join } from "node:path"

const env = process.env

export const STATE_DIR = join(process.cwd(), ".ward")
mkdirSync(STATE_DIR, { recursive: true })

export function readJson<T>(name: string, fallback: T): T {
    try {
        return JSON.parse(readFileSync(join(STATE_DIR, name), "utf8")) as T
    } catch {
        return fallback
    }
}

export function writeJson(name: string, value: unknown) {
    writeFileSync(join(STATE_DIR, name), JSON.stringify(value, null, 2), { mode: 0o600 })
}

function sessionSecret(): string {
    if (env.SESSION_SECRET) return env.SESSION_SECRET
    const file = join(STATE_DIR, "secret")
    if (existsSync(file)) return readFileSync(file, "utf8").trim()
    const secret = randomBytes(32).toString("hex")
    writeFileSync(file, secret, { mode: 0o600 })
    return secret
}

export const config = {
    port: Number(env.API_PORT ?? 3001),
    publicUrl: env.PUBLIC_URL?.replace(/\/$/, "") ?? "",
    secret: sessionSecret(),
    openaiKey: env.OPENAI_API_KEY ?? "",
    openaiBase: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    agentModel: env.OPENAI_AGENT_MODEL ?? "gpt-4.1-mini",
    realtimeModel: env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-mini",
    realtimeVoice: env.OPENAI_REALTIME_VOICE ?? "ash",
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
    voiceMaxSeconds: Number(env.VOICE_MAX_SECONDS ?? 180),
    // Hard cap on agent LLM calls per server process, a second line of defence after the dashboard limit.
    llmBudgetCalls: Number(env.LLM_BUDGET_CALLS ?? 1500),
    relayDisabled: env.RELAY_DISABLED === "1",
    relayBaseUrl: env.RELAY_BASE_URL || undefined,
    relayWorkspaceKey: env.RELAY_WORKSPACE_KEY || undefined
}
