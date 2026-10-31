#!/usr/bin/env bash
# Runs INSIDE the Freestyle VM (deploy.sh uploads and runs it).
# Installs Bun, unpacks the app, builds it, and starts the three processes under a supervisor:
#   Terse actor runtime (:7100)  ·  API + Relay agents (:3001)  ·  web app (:3000, published by Freestyle)
set -euo pipefail

if [ "$(id -u)" = 0 ]; then APP=/opt/code-blue; SUDO=""; else APP="$HOME/code-blue"; SUDO="sudo"; fi
# Testing on a machine that isn't the VM: CODE_BLUE_DIR=/tmp/x CODE_BLUE_NO_SERVICE=1 skips the
# boot-time service (systemd/cron) and just starts the supervisor for this session.
APP="${CODE_BLUE_DIR:-$APP}"
need() { command -v "$1" >/dev/null 2>&1; }
log() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }

log "System packages"
if ! need curl || ! need unzip || ! need tar; then
    if need apt-get; then
        $SUDO apt-get update -y -qq && $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl unzip tar ca-certificates >/dev/null
    elif need apk; then
        $SUDO apk add --no-cache curl unzip tar bash ca-certificates >/dev/null
    elif need dnf; then
        $SUDO dnf install -y -q curl unzip tar ca-certificates
    fi
fi

log "Bun"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
need bun || curl -fsSL https://bun.sh/install | bash >/dev/null
bun --version

log "App → $APP"
# Stop a previous deployment before replacing its files.
if [ -z "${CODE_BLUE_NO_SERVICE:-}" ] && need systemctl && [ -d /run/systemd/system ]; then $SUDO systemctl stop code-blue 2>/dev/null || true; fi
pkill -f "$APP/run.sh" 2>/dev/null || true
pkill -f "durable-actors dev" 2>/dev/null || true
pkill -f "src/server/index.ts" 2>/dev/null || true
pkill -f "vite preview" 2>/dev/null || true
sleep 1
mkdir -p "$APP"
# Keep durable state (.durable-actors = patients, .ward = rooms/Relay identities) across redeploys.
find "$APP" -mindepth 1 -maxdepth 1 ! -name .durable-actors ! -name .ward ! -name logs -exec rm -rf {} +
tar -xzf /tmp/code-blue.tgz -C "$APP"
cp /tmp/code-blue.env "$APP/.env"
chmod 600 "$APP/.env"

log "Install + build"
cd "$APP"
bun install --frozen-lockfile 2>/dev/null || bun install
bunx durable-actors generate src/actors.ts
bunx vite build --logLevel warn

log "Supervisor"
cat > "$APP/run.sh" <<RUN
#!/usr/bin/env bash
# Keeps all three processes up; anything that exits is restarted after 2 s.
cd "$APP"
export BUN_INSTALL="$BUN_INSTALL"
export PATH="$BUN_INSTALL/bin:\$PATH"
mkdir -p logs
supervise() {
    local name=\$1; shift
    while true; do
        echo "[\$(date -u +%FT%TZ)] starting \$name" >> "logs/\$name.log"
        "\$@" >> "logs/\$name.log" 2>&1 < /dev/null
        echo "[\$(date -u +%FT%TZ)] \$name exited (\$?), restarting" >> "logs/\$name.log"
        sleep 2
    done
}
supervise actors bunx durable-actors dev --no-watch &
for i in \$(seq 1 60); do grep -q "Ready" logs/actors.log 2>/dev/null && break; sleep 1; done
supervise api bun src/server/index.ts &
supervise web bunx vite preview --strictPort &
wait
RUN
chmod +x "$APP/run.sh"
mkdir -p "$APP/logs"

if [ -z "${CODE_BLUE_NO_SERVICE:-}" ] && need systemctl && [ -d /run/systemd/system ]; then
    $SUDO tee /etc/systemd/system/code-blue.service >/dev/null <<UNIT
[Unit]
Description=Code Blue: Haunted Ward
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$APP
Environment=HOME=$HOME
ExecStart=$APP/run.sh
Restart=always
RestartSec=3
KillMode=control-group

[Install]
WantedBy=multi-user.target
UNIT
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable --now code-blue >/dev/null
    echo "systemd service: code-blue (restarts on crash and on reboot)"
else
    nohup setsid "$APP/run.sh" >/dev/null 2>&1 < /dev/null &
    if [ -z "${CODE_BLUE_NO_SERVICE:-}" ] && need crontab; then
        (crontab -l 2>/dev/null | grep -v "$APP/run.sh"; echo "@reboot $APP/run.sh") | crontab -
    fi
    echo "background supervisor started (no systemd)"
fi

log "Health check"
for i in $(seq 1 120); do
    if curl -fsS http://127.0.0.1:3000/api/config >/dev/null 2>&1; then
        echo "✅ up: $(curl -fsS http://127.0.0.1:3000/api/config | head -c 200)"
        exit 0
    fi
    sleep 2
done
echo "❌ not healthy after 4 min. Last logs:"
tail -n 20 "$APP"/logs/*.log || true
exit 1
