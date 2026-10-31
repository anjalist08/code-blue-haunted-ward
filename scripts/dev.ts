// Runs the API (agents + Relay + OpenAI) and the Vite web app together.
// Start the actor runtime first in another terminal: `bun run dev:actors`.
const procs = [
    Bun.spawn(["bun", "--watch", "src/server/index.ts"], { stdout: "inherit", stderr: "inherit" }),
    Bun.spawn(["bunx", "vite"], { stdout: "inherit", stderr: "inherit" })
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
