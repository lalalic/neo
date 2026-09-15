#!/bin/bash
set -euo pipefail

ACTION="${1:-status}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
REPO="$SKILL_DIR/mac-developer-bridge"
DATA_DIR="$SKILL_DIR/.state"
TUNNEL_LOG="$SKILL_DIR/cloudflared.log"
UPSTREAM="${MAC_DEV_BRIDGE_UPSTREAM:-https://github.com/alexanderradahl/mac-developer-bridge.git}"
TOKEN_FILE="$DATA_DIR/http-token"
OAUTH_STATE_FILE="$DATA_DIR/oauth-state.json"
ACK="I_UNDERSTAND_THIS_GRANTS_FULL_ACCESS"

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ensure_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "Mac Developer Bridge requires macOS"
}

ensure_command() {
  local command_name="$1" package_name="$2"
  command -v "$command_name" >/dev/null 2>&1 && return
  command -v brew >/dev/null 2>&1 || fail "$command_name is missing and Homebrew is unavailable"
  brew install "$package_name"
}

ensure_prerequisites() {
  ensure_command node node
  ensure_command cloudflared cloudflared
  command -v git >/dev/null 2>&1 || fail "git is required"
  command -v openssl >/dev/null 2>&1 || fail "openssl is required"
  npx pm2 --version >/dev/null
}

ensure_repo() {
  if [[ ! -d "$REPO/.git" ]]; then
    say "Cloning Mac Developer Bridge into $REPO"
    git clone "$UPSTREAM" "$REPO"
    return
  fi

  local origin
  origin="$(git -C "$REPO" remote get-url origin 2>/dev/null || true)"
  [[ "$origin" == *"mac-developer-bridge"* ]] || fail "unexpected repository at $REPO"

  if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
    say "Checkout is dirty; preserving it without update"
    return
  fi

  git -C "$REPO" fetch origin --prune
  git -C "$REPO" pull --ff-only
}

ensure_state() {
  mkdir -p "$DATA_DIR"
  chmod 700 "$DATA_DIR"

  if [[ ! -s "$TOKEN_FILE" ]]; then
    openssl rand -hex 32 > "$TOKEN_FILE"
  fi
  chmod 600 "$TOKEN_FILE"

  printf '%s\n' "$ACK" > "$DATA_DIR/FULL_ACCESS_ENABLED"
  chmod 600 "$DATA_DIR/FULL_ACCESS_ENABLED"
}

start_http() {
  npx pm2 delete macdevbridge-http >/dev/null 2>&1 || true
  (
    export MAC_DEV_BRIDGE_DATA_DIR="$DATA_DIR"
    export MAC_DEV_BRIDGE_HTTP_TOKEN_FILE="$TOKEN_FILE"
    npx pm2 start "$REPO/mcp-http.mjs"       --name macdevbridge-http       --cwd "$REPO"       --interpreter "$(command -v node)"       --time
  )

  local attempt pm2_pid
  for attempt in {1..20}; do
    pm2_pid="$(npx pm2 pid macdevbridge-http 2>/dev/null | tail -1)"
    if [[ "$pm2_pid" =~ ^[1-9][0-9]*$ ]] \
      && curl -fsS --max-time 2 http://127.0.0.1:8787/healthz >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  npx pm2 logs macdevbridge-http --lines 30 --nostream || true
  fail "macdevbridge-http did not become healthy under PM2; check whether port 8787 is already occupied"
}

start_tunnel() {
  local cloudflared_bin
  cloudflared_bin="$(command -v cloudflared)"
  npx pm2 delete macdevbridge-tunnel >/dev/null 2>&1 || true
  : > "$TUNNEL_LOG"
  npx pm2 start "$cloudflared_bin"     --name macdevbridge-tunnel     --interpreter none     --error "$TUNNEL_LOG"     -- tunnel --url http://127.0.0.1:8787 --no-autoupdate

  local attempt
  for attempt in {1..30}; do
    current_tunnel_url >/dev/null && return
    sleep 1
  done
  fail "Cloudflare Quick Tunnel URL was not found in $TUNNEL_LOG"
}

current_tunnel_url() {
  grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1
}

oauth_client_id() {
  [[ -s "$OAUTH_STATE_FILE" ]] || return 1
  node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!value?.client?.id) process.exit(1);
    process.stdout.write(value.client.id);
  ' "$OAUTH_STATE_FILE"
}

connection_info() {
  local url client_id
  url="$(current_tunnel_url || true)"
  client_id="$(oauth_client_id || true)"
  [[ -n "$url" ]] || fail "Server URL is unavailable; inspect $TUNNEL_LOG"
  [[ -n "$client_id" ]] || fail "OAuth Client ID is unavailable; inspect $OAUTH_STATE_FILE"
  printf 'server_url=%s/mcp\n' "$url"
  printf 'oauth_client_id=%s\n' "$client_id"
}

copy_token() {
  [[ -s "$TOKEN_FILE" ]] || fail "token file not found: $TOKEN_FILE"
  local mode
  mode="$(stat -f '%OLp' "$TOKEN_FILE")"
  [[ "$mode" == "600" || "$mode" == "400" ]] || fail "unsafe token file mode: $mode"
  command -v pbcopy >/dev/null 2>&1 || fail "pbcopy is unavailable"
  pbcopy < "$TOKEN_FILE"
  say "Consent token copied to clipboard; value not printed"
}

status() {
  local http_pid tunnel_pid
  http_pid="$(npx pm2 pid macdevbridge-http 2>/dev/null | tail -1)"
  tunnel_pid="$(npx pm2 pid macdevbridge-tunnel 2>/dev/null | tail -1)"
  if [[ "$http_pid" =~ ^[1-9][0-9]*$ ]]; then
    say "macdevbridge_http=online"
  else
    say "macdevbridge_http=stopped"
  fi
  if [[ "$tunnel_pid" =~ ^[1-9][0-9]*$ ]]; then
    say "macdevbridge_tunnel=online"
  else
    say "macdevbridge_tunnel=stopped"
  fi
  if curl -fsS --max-time 2 http://127.0.0.1:8787/healthz >/dev/null 2>&1; then
    say "local_health=up"
  else
    say "local_health=down"
  fi
  local url
  url="$(current_tunnel_url || true)"
  printf 'server_url=%s\n' "${url:+$url/mcp}"
}

setup_all() {
  ensure_macos
  ensure_prerequisites
  ensure_repo
  ensure_state
  start_http
  start_tunnel
  npx pm2 save >/dev/null
  connection_info
}

stop_all() {
  npx pm2 stop macdevbridge-tunnel >/dev/null 2>&1 || true
  npx pm2 stop macdevbridge-http >/dev/null 2>&1 || true
  npx pm2 save >/dev/null
  say "Mac Developer Bridge services stopped"
}

case "$ACTION" in
  setup|start) setup_all ;;
  repo) ensure_macos; ensure_prerequisites; ensure_repo ;;
  restart)
    ensure_macos
    ensure_prerequisites
    ensure_repo
    ensure_state
    start_http
    npx pm2 save >/dev/null
    connection_info
    ;;
  restart-tunnel)
    ensure_macos
    ensure_prerequisites
    start_tunnel
    npx pm2 save >/dev/null
    connection_info
    ;;
  stop) stop_all ;;
  status) status ;;
  info) connection_info ;;
  copy-token) copy_token ;;
  *) fail "usage: $0 {setup|start|repo|restart|restart-tunnel|stop|status|info|copy-token}" ;;
esac
