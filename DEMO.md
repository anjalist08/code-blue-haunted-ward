# Demo runbook

Everything you need to go from a fresh laptop to the 90-second demo.

## 1. One-time setup (≈5 min)

Install Bun (≥ 1.4.2) and Node 22 (Node is only needed for the optional local Relay server).

```bash
curl -fsSL https://bun.sh/install | bash
```

Clone and install:

```bash
git clone https://github.com/anjalist08/code-blue-haunted-ward
```
```bash
cd code-blue-haunted-ward
```
```bash
bun install
```
```bash
cp .env.example .env
```

Open `.env` and set `OPENAI_API_KEY=sk-...`. Leave the Relay lines empty to use hosted Agent Relay.

If your shell already exports an `OPENAI_API_KEY`, it overrides `.env`. Clear it in each terminal you use:

```bash
unset OPENAI_API_KEY
```

The heart model (Mesh-Magnet, CC BY 4.0) is already in `public/models/heart.glb`.

## 2. Start it (two terminals)

Terminal 1, the Terse durable actor runtime. Wait for `Ready http://127.0.0.1:7100`:

```bash
bun run dev:actors
```

Terminal 2, the agents + API + web app:

```bash
bun run dev
```

You should see:

```
[relay] relay: Agent Relay (hosted) (workspace haunted-ward-xxxxxx)
[api] http://127.0.0.1:3001
[llm] agents: gpt-4.1-mini, voice: gpt-realtime-mini, key set
VITE ready  ➜ Local: http://localhost:3000/  ➜ Network: http://192.168.x.x:3000/
```

If the first line says `falling back to the in-process bus`, hosted Relay isn't reachable from your network. Use a local Relay server instead. In a third terminal:

```bash
bun run dev:relay
```

Then add `RELAY_BASE_URL=http://127.0.0.1:8787` to `.env` and restart `bun run dev`.

## 3. Pre-flight check (1 min)

1. Open http://localhost:3000 and click **Open Bed 13**. The QR code appears.
2. In the header, both pills are green: **Terse actor live** and **Agent Relay**.
3. Scan the QR code with your phone (same Wi-Fi). If it doesn't load, allow incoming connections for `bun` in your OS firewall.
4. Click 🔈 in the header to turn the monitor beeps on.
5. Click **🎙️ Voice** once and say "hello". The patient should answer. Click again to hang up (each session costs money, and it auto-stops at 180 s).
6. Click **↺ Reset** to start clean for the real demo.

Voice on phones needs HTTPS. Use the laptop for voice, or run `cloudflared tunnel --url http://localhost:3000`, set `PUBLIC_URL=https://…trycloudflare.com` in `.env`, and restart `bun run dev`.

## 4. The 90-second demo

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Big screen on the lobby QR code | "Meet Mr. Holloway. He's been dying every night at 3 AM." |
| 0:10 | A judge scans the QR code and joins as Doctor. Click **Start the night shift** | "Everyone in the room is a doctor on the same patient." |
| 0:20 | Close the phone tab, wait 10 s, scan again | "He kept deteriorating while nobody was connected. The patient is a Terse durable actor with its own clock." |
| 0:30 | 🎙️ Voice: "Get a troponin and an ECG" | Point at the feed: doctor → `@nurse` → `@lab-tech` → `@attending`. "The care team are agents talking over Agent Relay." |
| 0:45 | Tap **Give nitroglycerin** | The Pharmacist holds it: "He took sildenafil." "The trap every intern falls into." |
| 0:55 | Wait for V-tach (≈2.5 min in, or skip ahead by letting the lobby run longer before the demo). The lights flicker | "Wide and fast. Is he stable?" Tap **Midazolam**, then **Synchronized cardioversion** → back to sinus |
| 1:10 | Tap **Aspirin** + **Activate the cath lab**, then press ⇄ to make the OR view big | The aspirin target ring sits on the clot. The catheter goes down the aorta into the RCA, then the stent, then blood flows, and the inferior wall stops glowing purple. |
| 1:20 | **📋 Debrief** → Generate | "An AI attending reviews every decision. One actor per patient, so it scales to every med school." |

Tips:

- Start the case 2 minutes before you go on stage if you want to reach V-tach during the demo. Or let it run untreated to show the crash, then **Reset**.
- Watch the **skeleton hands** in the room view: they carry out each order on his body as the chat happens (pill, syringe, electrodes, paddles, CPR).
- Two views: **Bed 13** (the patient in bed, with the heart glowing in his chest) and **OR view** (zoomed in on the heart). ⇄ swaps which one is big.
- In the OR view, tap the green dots for teaching labels. The legend explains the colours, and "Hide anatomy colours" leaves only the targets.
- **Guided mode** / **Exam mode** (host only) toggles the hints.
- Kill and restart `bun run dev:actors` mid-case: the patient picks up where he left off.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `[llm] 401` in terminal 2 | Wrong key. `unset OPENAI_API_KEY` in the shell, check `.env`. |
| Header says **Local bus** | Hosted Relay is unreachable: use `bun run dev:relay` (above). The demo still works. |
| `actor host is unavailable` | Terminal 1 isn't running or is reloading after a code edit. Wait for `Ready`. |
| Phone can't open the QR link | Same Wi-Fi? Firewall prompt? Venue Wi-Fi isolating clients? Use a phone hotspot or the cloudflared tunnel. |
| Voice button shows an error about WebRTC | The network blocks WebRTC. Try a phone hotspot. |
| Heart is the procedural one | `public/models/heart.glb` is missing or not a GLB. Try `?heart=/models/heart.glb` and check the browser console. |
