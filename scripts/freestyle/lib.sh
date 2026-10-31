# Shared helpers for the Freestyle scripts (sourced, not run).
SLUG="${FREESTYLE_SLUG:-code-blue-haunted-ward}"
DOMAIN="${FREESTYLE_DOMAIN:-$SLUG.style.dev}"
URL="https://$DOMAIN"
PORT_PUBLIC=3000
if command -v npx >/dev/null 2>&1; then FS=(npx -y freestyle@latest); else FS=(bunx freestyle@latest); fi
fs() { "${FS[@]}" "$@"; }
# json '<js expression over v>' : evaluate against JSON on stdin, print the result ('' on any error)
json() { bun -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=JSON.parse(s);const r=($1);console.log(r==null?'':typeof r==='object'?JSON.stringify(r):r)}catch{console.log('')}})"; }
step() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }
vm_id() { fs vm get "$SLUG" --output json 2>/dev/null | json 'v.id'; }
