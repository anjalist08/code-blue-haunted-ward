// Optional: a private Agent Relay server on this machine (no account needed).
// Then set RELAY_BASE_URL=http://127.0.0.1:8787 in .env. Without it, the app uses hosted Relay.
import { mkdirSync } from "node:fs"

mkdirSync(".ward", { recursive: true })
const port = process.env.RELAY_LOCAL_PORT ?? "8787"
const proc = Bun.spawn(["npx", "-y", "@relaycast/engine@12", "--db", ".ward/relaycast.db", "--port", port], { stdout: "inherit", stderr: "inherit" })
process.on("SIGINT", () => proc.kill())
await proc.exited
