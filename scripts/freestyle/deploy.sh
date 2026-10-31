#!/usr/bin/env bash
# Publish Code Blue: Haunted Ward on a Freestyle VM, at https://<slug>.style.dev
#
#   1. Redeem credits:  https://dash.freestyle.sh/redeem/SPOOKYTHON2026
#   2. Log in once:     npx freestyle@latest login      (or export FREESTYLE_API_KEY=...)
#   3. From the repo:   bun run deploy:freestyle
#
# Re-running redeploys the latest commit to the same VM and URL. Patients/rooms survive redeploys.
# Options (env vars): FREESTYLE_SLUG (default code-blue-haunted-ward), FREESTYLE_DOMAIN (default <slug>.style.dev)
set -euo pipefail
cd "$(dirname "$0")/../.."

SLUG="${FREESTYLE_SLUG:-code-blue-haunted-ward}"
DOMAIN="${FREESTYLE_DOMAIN:-$SLUG.style.dev}"
URL="https://$DOMAIN"
if command -v npx >/dev/null 2>&1; then FS=(npx -y freestyle@latest); else FS=(bunx freestyle@latest); fi
fs() { "${FS[@]}" "$@"; }
json() { bun -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=JSON.parse(s);console.log(($1)??'')}catch{console.log('')}})"; }
log() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }

[ -f .env ] || { echo "No .env here. Run: cp .env.example .env  and add OPENAI_API_KEY"; exit 1; }
grep -q '^OPENAI_API_KEY=sk-' .env || echo "⚠️  .env has no OPENAI_API_KEY: agents fall back to scripted lines and voice is off."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "⚠️  Uncommitted changes are NOT deployed (deploying the last commit: $(git rev-parse --short HEAD))."; fi

log "Freestyle account"
fs whoami || { echo "Not logged in. Run: npx freestyle@latest login   (or export FREESTYLE_API_KEY=...)"; exit 1; }

log "VM '$SLUG'"
VM_ID="$(fs vm get "$SLUG" --output json 2>/dev/null | json 'v.id' || true)"
if [ -z "$VM_ID" ]; then
    # --idle-timeout-seconds=-1: never pause for inactivity, so the patient keeps deteriorating
    # (the durable actor's alarm) even when nobody is watching.
    VM_ID="$(fs vm create --slug "$SLUG" --idle-timeout-seconds=-1 --no-ssh --output json | json 'v.id')"
    [ -n "$VM_ID" ] || { echo "VM creation failed"; exit 1; }
    echo "created $VM_ID"
else
    echo "reusing $VM_ID"
    fs vm start "$VM_ID" >/dev/null 2>&1 || true
    fs vm update "$VM_ID" --idle-timeout-seconds=-1 >/dev/null 2>&1 || true
fi

log "Package (commit $(git rev-parse --short HEAD))"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git archive --format=tar.gz -o "$TMP/code-blue.tgz" HEAD
# VM .env: your keys, with the public URL (so QR codes point at it) and hosted Agent Relay.
grep -v -E '^(PUBLIC_URL|RELAY_BASE_URL|RELAY_WORKSPACE_KEY|DURABLE_ACTORS_[A-Z_]+|PORT|API_PORT)=' .env > "$TMP/code-blue.env" || true
{
    echo "PUBLIC_URL=$URL"
    echo "DURABLE_ACTORS_CONTROL_PLANE_URL=http://127.0.0.1:7100"
    echo "DURABLE_ACTORS_PORT=7100"
    echo "PORT=3000"
    echo "API_PORT=3001"
} >> "$TMP/code-blue.env"
du -h "$TMP/code-blue.tgz" | cut -f1

log "Upload"
fs vm scp "$TMP/code-blue.tgz" "$VM_ID:/tmp/code-blue.tgz"
fs vm scp "$TMP/code-blue.env" "$VM_ID:/tmp/code-blue.env"
fs vm scp scripts/freestyle/remote-setup.sh "$VM_ID:/tmp/remote-setup.sh"

log "Install, build and start on the VM (2-4 min)"
fs vm exec "$VM_ID" --timeout-ms 900000 -- bash /tmp/remote-setup.sh

log "Publish $URL"
if fs tls list --vm "$VM_ID" --output json 2>/dev/null | grep -q "\"$DOMAIN\""; then
    echo "already published"
else
    fs tls create --domain "$DOMAIN" --from public --to "vm=$VM_ID,port=3000"
fi

log "Check"
for i in $(seq 1 30); do
    if curl -fsS "$URL/api/config" >/dev/null 2>&1; then
        echo "✅ Live: $URL"
        echo "   Open it on the big screen → Open Bed 13 → students scan the QR code."
        echo "   Logs:     npx freestyle@latest vm exec $VM_ID -- tail -n 50 /opt/code-blue/logs/api.log"
        echo "   Redeploy: bun run deploy:freestyle"
        exit 0
    fi
    sleep 4
done
echo "⚠️  $URL didn't answer yet (TLS can take a minute). Try it in a browser shortly."
echo "   Logs: npx freestyle@latest vm exec $VM_ID -- tail -n 50 /opt/code-blue/logs/*.log"
