// Production: the API (agents + Relay + OpenAI) and the built web app (vite preview, which
// proxies /api and the actor WebSocket like the dev server). Run `bun run build` first.
// The actor runtime runs separately: `bun run dev:actors` (it is the local Terse runtime).
const procs = [
    Bun.spawn(["bun", "src/server/index.ts"], { stdout: "inherit", stderr: "inherit" }),
    Bun.spawn(["bunx", "vite", "preview", "--strictPort"], { stdout: "inherit", stderr: "inherit" })
]
const stop = () => {
    for (const p of procs) p.kill()
    process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
await Promise.race(procs.map(p => p.exited))
stop()

export {}
