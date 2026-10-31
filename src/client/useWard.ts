import { useEffect, useRef, useState } from "react"

import type { Outgoing, WardState } from "../sim/types"
import { api, type Session } from "./api"

export type Link = "connecting" | "live" | "reconnecting"

/** Live WardRoom state over the Terse actor WebSocket (proxied through our own origin). */
export function useWard(code: string, session: Session | null) {
    const [state, setState] = useState<WardState | null>(null)
    const [link, setLink] = useState<Link>("connecting")
    const [offset, setOffset] = useState(0) // server clock - local clock
    const socketRef = useRef<WebSocket | null>(null)

    useEffect(() => {
        if (!session) return
        let alive = true
        let retry = 0
        let timer: ReturnType<typeof setTimeout> | undefined

        async function connect() {
            try {
                const { path } = await api<{ path: string }>(`/api/rooms/${code}/socket`, { token: session!.token })
                if (!alive) return
                const proto = location.protocol === "https:" ? "wss" : "ws"
                const socket = new WebSocket(`${proto}://${location.host}${path}`)
                socketRef.current = socket
                socket.onopen = () => {
                    retry = 0
                    setLink("live")
                }
                socket.onmessage = event => {
                    const message = JSON.parse(event.data as string) as Outgoing
                    if (message.type === "snapshot") {
                        setState(message.state)
                        setOffset(message.state.now - Date.now())
                    }
                }
                socket.onclose = () => {
                    if (!alive) return
                    setLink("reconnecting")
                    timer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++))
                }
            } catch {
                if (!alive) return
                setLink("reconnecting")
                timer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++))
            }
        }
        void connect()
        return () => {
            alive = false
            clearTimeout(timer)
            socketRef.current?.close()
        }
    }, [code, session?.token])

    return { state, link, offset }
}
