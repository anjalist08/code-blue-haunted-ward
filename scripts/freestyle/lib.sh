# Shared helpers for the Freestyle scripts (sourced, not run).
# Never fail silently: name the line and command that stopped the script.
trap 'code=$?; printf "\n\033[1;31m✖ stopped (exit %s) at %s line %s: %s\033[0m\n" "$code" "${BASH_SOURCE[0]##*/}" "$LINENO" "$BASH_COMMAND" >&2' ERR
SLUG="${FREESTYLE_SLUG:-code-blue-haunted-ward}"
DOMAIN="${FREESTYLE_DOMAIN:-$SLUG.style.dev}"
URL="https://$DOMAIN"
PORT_PUBLIC=3000
if [ -n "${FREESTYLE_CLI:-}" ]; then FS=($FREESTYLE_CLI)
elif command -v npx >/dev/null 2>&1; then FS=(npx -y freestyle@latest)
else FS=(bunx freestyle@latest); fi
fs() { "${FS[@]}" "$@"; }
FS_HINT="${FS[*]}"; FS_HINT="${FS_HINT/ -y / }"   # how to run the CLI by hand on this machine
# json '<js expression over v>' : evaluate against JSON on stdin, print the result ('' on any error)
json() { bun -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=JSON.parse(s);const r=($1);console.log(r==null?'':typeof r==='object'?JSON.stringify(r):r)}catch{console.log('')}})"; }
step() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }
# Prints the VM id, or nothing when there is no such VM. Never fails (callers run under set -e).
vm_id() { { fs vm get "$SLUG" --output json 2>/dev/null || true; } | json 'v.id'; }
