#!/usr/bin/env bash
# Point https://<slug>.style.dev at the VM's port 3000, fixing a missing or stale rule.
#   bun run publish:freestyle
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/freestyle/lib.sh

VM_ID="${1:-$(vm_id)}"
[ -n "$VM_ID" ] || die "No VM with slug '$SLUG'. Run: bun run deploy:freestyle"

step "Publish $URL → $VM_ID port $PORT_PUBLIC"
RULES="$(fs tls list --output json)" || die "Couldn't list TLS rules (logged in? $FS_HINT whoami)"
MATCHES="$(printf '%s' "$RULES" | json "(v.rules||[]).filter(r=>r.domain==='$DOMAIN').map(r=>[r.id,r.destination&&r.destination.vmId,r.destination&&r.destination.port].join(' ')).join('\n')")"
OK=""
while read -r RID RVM RPORT; do
    [ -n "${RID:-}" ] || continue
    if [ "$RVM" = "$VM_ID" ] && [ "$RPORT" = "$PORT_PUBLIC" ]; then
        OK="$RID"
        echo "rule $RID already points here"
    else
        echo "removing stale rule $RID (→ ${RVM:-?} port ${RPORT:-?})"
        fs tls delete "$RID" >/dev/null
    fi
done <<< "$MATCHES"
if [ -z "$OK" ]; then
    fs tls create --domain "$DOMAIN" --from public --to "vm=$VM_ID,port=$PORT_PUBLIC" --output json | json '"created rule "+v.id+": "+v.domain+" → "+v.destination.vmId+":"+v.destination.port' \
        || die "tls create failed for $DOMAIN (is the name taken by another account? try FREESTYLE_SLUG=another-name)"
fi

step "Is the app answering inside the VM?"
if fs vm exec "$VM_ID" --linux-user root --timeout-ms 20000 -- curl -fsS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$PORT_PUBLIC/api/config"; then
    echo "yes"
else
    echo "⚠️  Not answering on port $PORT_PUBLIC inside the VM. The app isn't running: check the setup log:"
    echo "   $FS_HINT vm exec $VM_ID --linux-user root -- tail -n 40 /tmp/code-blue-setup.log"
    exit 1
fi

step "Public check"
for i in $(seq 1 20); do
    if curl -fsS "$URL/api/config" >/dev/null 2>&1; then
        echo "✅ Live: $URL"
        exit 0
    fi
    sleep 3
done
echo "⚠️  The rule exists and the app is up, but $URL isn't answering yet. Give it a minute, then reload."
