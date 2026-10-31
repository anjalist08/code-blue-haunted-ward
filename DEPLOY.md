# Publish on Freestyle

The whole app (Terse actor runtime, API + Relay agents, web app) runs on one Freestyle VM and is
published with HTTPS at **https://code-blue-haunted-ward.style.dev**. HTTPS also unlocks the
microphone on phones, so students can use voice from their own devices.

## Once

1. Redeem the Haunted Hacks credits: https://dash.freestyle.sh/redeem/SPOOKYTHON2026 (sign in, confirm).
2. Log in from the repo folder (opens the browser):

   ```bash
   npx freestyle@latest login
   ```

   Or use an API key from the dashboard instead: `export FREESTYLE_API_KEY=...`. Never commit it.

3. Make sure `.env` has your `OPENAI_API_KEY` (the deploy copies it to the VM; it is not committed).

## Deploy (and redeploy)

```bash
bun run deploy:freestyle
```

It deploys the **last commit**, so commit first. It:

1. creates (or reuses) a VM with the slug `code-blue-haunted-ward`, set to never pause when idle, so
   the patient keeps deteriorating with nobody watching,
2. uploads the code and a VM copy of your `.env` (with `PUBLIC_URL` set to the public address, so the
   QR codes point there),
3. installs Bun, builds, and starts the three processes under a supervisor (systemd when available):
   crashed processes restart within seconds, and everything comes back after a reboot,
4. publishes `code-blue-haunted-ward.style.dev` → VM port 3000 (`freestyle tls create`), and checks it answers.

Re-running it ships the latest commit to the same VM and URL. Rooms and patients survive redeploys.

Use another name: `FREESTYLE_SLUG=my-ward bun run deploy:freestyle` → `https://my-ward.style.dev`.

## "There's nothing here yet" / "no VM is mapped"

The domain has no rule pointing at a VM yet, usually because the deploy stopped before its last
step. Run the publish step on its own: it finds the VM, removes any stale rule for the domain,
creates the right one, and checks the app is answering inside the VM:

```bash
bun run publish:freestyle
```

If it says the app isn't answering inside the VM, run the full deploy again and read its output.
Every step is numbered (1/5 … 5/5), so the failing one is easy to spot:

```bash
bun run deploy:freestyle
```

## Operate

```bash
npx freestyle@latest vm exec code-blue-haunted-ward --linux-user root -- tail -n 50 /opt/code-blue/logs/api.log
```
```bash
npx freestyle@latest vm ssh code-blue-haunted-ward
```
```bash
npx freestyle@latest vm pause code-blue-haunted-ward
```

Logs are in `/opt/code-blue/logs/` (`actors.log`, `api.log`, `web.log`).

## Cost and safety

- The URL is public, and anyone with a room code can play. OpenAI spend is capped per server run
  (`LLM_BUDGET_CALLS`, default 1500 agent calls) and voice sessions hang up after `VOICE_MAX_SECONDS`.
  Also set a hard limit in the OpenAI dashboard.
- Pause or delete the VM after the event: `npx freestyle@latest vm delete code-blue-haunted-ward`.
- Agent Relay: the VM runs Agent Relay's open-source server itself (Node 22 + `@relaycast/engine`, on
  port 8787, supervised like the rest), so the header shows **Agent Relay** without depending on the hosted
  service. To use hosted Relay instead: `FREESTYLE_RELAY=hosted bun run deploy:freestyle`. If Relay can't
  start at all, the app falls back to its in-process bus and the header shows **Local bus**.
- Voice on phones: open the `https://` address in Safari or Chrome (not a QR scanner's in-app browser),
  tap **Voice**, and allow the microphone. If it was denied once, the app explains how to re-allow it.
