// OpenAI Realtime over WebRTC. The patient talks back; the student's orders arrive as
// `place_order` tool calls and go down the same path as a tapped option.

type Events = {
    onStatus: (status: VoiceStatus, detail?: string) => void
    onCaption: (who: "doctor" | "patient", text: string) => void
    onOrder: (text: string) => Promise<string>
}

export type VoiceStatus = "idle" | "connecting" | "live" | "error"

export class RealtimeVoice {
    private pc: RTCPeerConnection | null = null
    private dc: RTCDataChannel | null = null
    private mic: MediaStream | null = null
    private audio: HTMLAudioElement | null = null
    private timer: ReturnType<typeof setTimeout> | undefined
    endsAt = 0

    constructor(private events: Events) {}

    async start(session: { clientSecret: string; model: string; maxSeconds: number }) {
        this.events.onStatus("connecting")
        try {
            if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone needs HTTPS (or localhost). Use PUBLIC_URL with a tunnel for phones.")
            this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
            const pc = new RTCPeerConnection()
            this.pc = pc
            this.audio = new Audio()
            this.audio.autoplay = true
            pc.ontrack = e => {
                this.audio!.srcObject = e.streams[0]!
            }
            pc.addTrack(this.mic.getAudioTracks()[0]!, this.mic)
            const dc = pc.createDataChannel("oai-events")
            this.dc = dc
            dc.onmessage = e => void this.handle(JSON.parse(e.data as string))
            dc.onopen = () => this.events.onStatus("live")
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            const res = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(session.model)}`, {
                method: "POST",
                body: offer.sdp,
                headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" }
            })
            if (!res.ok) throw new Error(`Realtime connect failed (${res.status})`)
            await pc.setRemoteDescription({ type: "answer", sdp: await res.text() })
            // Some venue/corporate networks block WebRTC (UDP). Don't spin forever.
            setTimeout(() => {
                if (this.dc === dc && dc.readyState !== "open") {
                    this.stop()
                    this.events.onStatus("error", "Couldn't open the audio connection. This network may block WebRTC; try a phone hotspot.")
                }
            }, 15000)
            // Budget guard: hang up automatically.
            this.endsAt = Date.now() + session.maxSeconds * 1000
            this.timer = setTimeout(() => this.stop("Voice session limit reached (budget guard)."), session.maxSeconds * 1000)
        } catch (error) {
            this.stop()
            this.events.onStatus("error", (error as Error).message)
        }
    }

    updateInstructions(instructions: string) {
        this.send({ type: "session.update", session: { type: "realtime", instructions } })
    }

    private send(event: unknown) {
        if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event))
    }

    private async handle(event: { type: string; [k: string]: unknown }) {
        switch (event.type) {
            case "conversation.item.input_audio_transcription.completed":
                if (typeof event.transcript === "string" && event.transcript.trim()) this.events.onCaption("doctor", event.transcript.trim())
                break
            case "response.output_audio_transcript.done":
            case "response.audio_transcript.done":
                if (typeof event.transcript === "string" && event.transcript.trim()) this.events.onCaption("patient", event.transcript.trim())
                break
            case "response.function_call_arguments.done": {
                if (event.name !== "place_order") break
                let text = ""
                try {
                    text = (JSON.parse(String(event.arguments)) as { text?: string }).text ?? ""
                } catch {
                    /* ignore */
                }
                const output = text ? await this.events.onOrder(text).catch(e => `Order failed: ${(e as Error).message}`) : "No order text"
                this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify({ result: output }) } })
                this.send({ type: "response.create" })
                break
            }
            case "error":
                console.warn("[realtime]", event)
                break
        }
    }

    stop(reason?: string) {
        clearTimeout(this.timer)
        this.dc?.close()
        this.pc?.close()
        this.mic?.getTracks().forEach(t => t.stop())
        if (this.audio) this.audio.srcObject = null
        this.pc = null
        this.dc = null
        this.mic = null
        this.endsAt = 0
        this.events.onStatus("idle", reason)
    }
}
