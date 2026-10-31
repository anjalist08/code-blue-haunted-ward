import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// One origin for everything, so a phone that scans the QR code only needs to reach this port:
//   /api/*       -> Bun backend (agents, Relay, OpenAI)
//   /v1/socket   -> Terse durable-actors gateway (WebSocket)
export default defineConfig(({ mode }) => {
    const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") }
    const api = `http://127.0.0.1:${env.API_PORT ?? 3001}`
    const actors = env.DURABLE_ACTORS_CONTROL_PLANE_URL ?? "http://127.0.0.1:7100"
    const proxy = {
        "/api": { target: api, changeOrigin: false, xfwd: true },
        "/v1/socket": { target: actors.replace(/^http/, "ws"), ws: true, changeOrigin: true }
    }
    return {
        plugins: [react()],
        server: { host: "0.0.0.0", port: Number(env.PORT ?? 3000), allowedHosts: true, proxy, fs: { deny: [".env", ".env.*", "**/.durable-actors/**", "**/.ward/**", "**/.git/**"] } },
        preview: { host: "0.0.0.0", port: Number(env.PORT ?? 3000), allowedHosts: true, proxy }
    }
})
