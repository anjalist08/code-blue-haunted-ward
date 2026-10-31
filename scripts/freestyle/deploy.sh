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
source scripts/freestyle/lib.sh

[ -f .env ] || die "No .env here. Run: cp .env.example .env  and add OPENAI_API_KEY"
grep -q '^OPENAI_API_KEY=sk-' .env || echo "⚠️  .env has no OPENAI_API_KEY: agents fall back to scripted lines and voice is off."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "⚠️  Uncommitted changes are NOT deployed (deploying the last commit: $(git rev-parse --short HEAD))."; fi

step "1/5 Freestyle account"
fs whoami || die "Not logged in. Run: $FS_HINT login   (or export FREESTYLE_API_KEY=...)"

step "2/5 VM '$SLUG'"
VM_ID="$(vm_id)"
if [ -z "$VM_ID" ]; then
    # Never pause for inactivity, so the patient keeps deteriorating with nobody watching.
    VM_ID="$(fs vm create --slug "$SLUG" --idle-timeout-seconds=-1 --no-ssh --output json | json 'v.id')" || true
    if [ -z "$VM_ID" ]; then
        echo "retrying without the idle-timeout setting"
        VM_ID="$(fs vm create --slug "$SLUG" --no-ssh --output json | json 'v.id')" || true
    fi
    [ -n "$VM_ID" ] || die "VM creation failed. Run: $FS_HINT vm create --slug $SLUG --no-ssh   to see why."
    echo "created $VM_ID"
else
    echo "reusing $VM_ID"
    fs vm start "$VM_ID" >/dev/null 2>&1 || true
fi
fs vm update "$VM_ID" --idle-timeout-seconds=-1 >/dev/null 2>&1 || echo "(couldn't disable idle pause; the VM may pause when nobody is connected)"

step "3/5 Package + upload (commit $(git rev-parse --short HEAD))"
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
fs vm scp "$TMP/code-blue.tgz" "$VM_ID:/tmp/code-blue.tgz" || die "Upload failed"
fs vm scp "$TMP/code-blue.env" "$VM_ID:/tmp/code-blue.env" || die "Upload failed"
fs vm scp scripts/freestyle/remote-setup.sh "$VM_ID:/tmp/remote-setup.sh" || die "Upload failed"

step "4/5 Install, build and start on the VM (2-4 min)"
# Run setup in the background on the VM and poll it: long single execs can hit the VM agent's
# 5-minute command limit on older agents.
fs vm exec "$VM_ID" --linux-user root --timeout-ms 30000 -- bash -c 'rm -f /tmp/code-blue-setup.log; setsid nohup bash /tmp/remote-setup.sh > /tmp/code-blue-setup.log 2>&1 < /dev/null & echo started' \
    || die "Couldn't start setup on the VM"
SEEN=0
for i in $(seq 1 90); do
    sleep 5
    LOG="$(fs vm exec "$VM_ID" --linux-user root --timeout-ms 20000 -- cat /tmp/code-blue-setup.log 2>/dev/null || true)"
    LINES="$(printf '%s\n' "$LOG" | wc -l | tr -d ' ')"
    if [ "$LINES" -gt "$SEEN" ]; then printf '%s\n' "$LOG" | tail -n +"$((SEEN + 1))"; SEEN="$LINES"; fi
    if printf '%s' "$LOG" | grep -q "✅ up"; then break; fi
    if printf '%s' "$LOG" | grep -q "❌"; then die "Setup failed on the VM (log above). Fix, commit, and run again."; fi
    [ "$i" = 90 ] && die "Setup didn't finish in 7.5 min. Log: $FS_HINT vm exec $VM_ID --linux-user root -- tail -n 60 /tmp/code-blue-setup.log"
done

step "5/5 Publish"
bash scripts/freestyle/publish.sh "$VM_ID"
echo
echo "   Open $URL on the big screen → Open Bed 13 → students scan the QR code."
echo "   Logs:      $FS_HINT vm exec $SLUG --linux-user root -- tail -n 50 /opt/code-blue/logs/api.log"
echo "   Re-point:  bun run publish:freestyle      Redeploy: bun run deploy:freestyle"
