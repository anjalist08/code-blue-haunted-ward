import { config } from "./config"

// Thin OpenAI Chat Completions wrapper for the agents' "brain" (a cheap mini model).
// Every call has a timeout and a per-process budget; callers always have a scripted fallback.

let calls = 0

export const llmEnabled = () => Boolean(config.openaiKey) && calls < config.llmBudgetCalls
export const llmStats = () => ({ calls, budget: config.llmBudgetCalls, model: config.agentModel, enabled: Boolean(config.openaiKey) })

type ChatMessage = { role: "system" | "user" | "assistant"; content: string }

async function chat(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number; timeoutMs?: number } = {}): Promise<string | null> {
    if (!llmEnabled()) return null
    calls++
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 9000)
    try {
        const res = await fetch(`${config.openaiBase}/chat/completions`, {
            method: "POST",
            signal: controller.signal,
            headers: { Authorization: `Bearer ${config.openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: config.agentModel,
                messages,
                max_tokens: opts.maxTokens ?? 220,
                temperature: 0.6,
                ...(opts.json ? { response_format: { type: "json_object" } } : {})
            })
        })
        if (!res.ok) {
            console.warn(`[llm] ${res.status} ${(await res.text()).slice(0, 200)}`)
            return null
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        return data.choices?.[0]?.message?.content?.trim() ?? null
    } catch (error) {
        console.warn(`[llm] ${(error as Error).message}`)
        return null
    } finally {
        clearTimeout(timer)
    }
}

export async function complete(system: string, user: string, maxTokens = 160): Promise<string | null> {
    return chat(
        [
            { role: "system", content: system },
            { role: "user", content: user }
        ],
        { maxTokens }
    )
}

export async function completeJson<T>(system: string, user: string, maxTokens = 400): Promise<T | null> {
    const text = await chat(
        [
            { role: "system", content: `${system}\nRespond with a single JSON object only.` },
            { role: "user", content: user }
        ],
        { json: true, maxTokens, timeoutMs: 12000 }
    )
    if (!text) return null
    try {
        return JSON.parse(text) as T
    } catch {
        return null
    }
}

/** Mint a short-lived OpenAI Realtime client secret so the browser can talk to the model directly over WebRTC. */
export async function realtimeClientSecret(instructions: string, tools: unknown[]): Promise<{ value: string; expiresAt: number } | null> {
    if (!config.openaiKey) return null
    const res = await fetch(`${config.openaiBase}/realtime/client_secrets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            expires_after: { anchor: "created_at", seconds: 120 },
            session: {
                type: "realtime",
                model: config.realtimeModel,
                instructions,
                max_output_tokens: 300,
                audio: {
                    input: {
                        transcription: { model: config.transcribeModel },
                        turn_detection: { type: "server_vad", silence_duration_ms: 600, create_response: true, interrupt_response: true }
                    },
                    output: { voice: config.realtimeVoice }
                },
                tools,
                tool_choice: "auto"
            }
        })
    })
    if (!res.ok) {
        console.warn(`[voice] ${res.status} ${(await res.text()).slice(0, 300)}`)
        return null
    }
    const data = (await res.json()) as { value: string; expires_at: number }
    return { value: data.value, expiresAt: data.expires_at }
}
