#!/bin/bash
set -euo pipefail

ACTION="${1:-status}"
ARG2="${2:-}"
ARG3="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
REPO="$SKILL_DIR/devmacbridge"
DATA_DIR="$SKILL_DIR/.state"
CONFIG_FILE="$DATA_DIR/config.env"
TUNNEL_LOG="$SKILL_DIR/devmacbridge-tunnel.log"
UPSTREAM="${MAC_DEV_BRIDGE_UPSTREAM:-https://github.com/alexanderradahl/mac-developer-bridge.git}"
SOURCE_REF="${MAC_DEV_BRIDGE_UPSTREAM_REF:-fea70d1a3c5524164f2159f6063ba685fef91324}"
RUNTIME_PATCH="$SKILL_DIR/patches/devmacbridge-runtime.patch"
TOKEN_FILE="$DATA_DIR/http-token"
OAUTH_STATE_FILE="$DATA_DIR/oauth-state.json"
MCP_SERVERS_FILE="$DATA_DIR/mcp-servers.json"
ACK="I_UNDERSTAND_THIS_GRANTS_FULL_ACCESS"

HTTP_PORT="${MAC_DEV_BRIDGE_HTTP_PORT:-8788}"
PUBLIC_URL="${MAC_DEV_BRIDGE_PUBLIC_URL:-}"
TUNNEL_NAME="${MAC_DEV_BRIDGE_TUNNEL_NAME:-devmacbridge}"
OAUTH_REDIRECT_URIS="${MAC_DEV_BRIDGE_OAUTH_REDIRECT_URIS:-https://grok.com/connectors-oauth-exchange-code/,https://claude.ai/api/mcp/auth_callback}"
EVENTS_BUS_DIR="${DEV_MAC_BRIDGE_EVENTS_BUS_DIR:-$SKILL_DIR/../events-bus}"
NATS_URL="${NEO_NATS_URL:-nats://127.0.0.1:4222}"

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ensure_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "DevMacBridge requires macOS"
}

load_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
  fi
  HTTP_PORT="${MAC_DEV_BRIDGE_HTTP_PORT:-$HTTP_PORT}"
  PUBLIC_URL="${MAC_DEV_BRIDGE_PUBLIC_URL:-$PUBLIC_URL}"
  TUNNEL_NAME="${MAC_DEV_BRIDGE_TUNNEL_NAME:-$TUNNEL_NAME}"
  OAUTH_REDIRECT_URIS="${MAC_DEV_BRIDGE_OAUTH_REDIRECT_URIS:-$OAUTH_REDIRECT_URIS}"
  EVENTS_BUS_DIR="${DEV_MAC_BRIDGE_EVENTS_BUS_DIR:-$EVENTS_BUS_DIR}"
  NATS_URL="${NEO_NATS_URL:-$NATS_URL}"
}

validate_hostname() {
  local hostname="$1"
  [[ "$hostname" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
    && [[ "$hostname" == *.* ]] \
    && [[ "$hostname" != *..* ]] \
    || fail "invalid public hostname: $hostname"
}

validate_config() {
  load_config
  [[ "$HTTP_PORT" =~ ^[0-9]+$ ]] && (( HTTP_PORT >= 1024 && HTTP_PORT <= 65535 )) \
    || fail "MAC_DEV_BRIDGE_HTTP_PORT must be 1024-65535"
  [[ -n "$PUBLIC_URL" ]] || fail "public URL is not configured; run: $0 configure <hostname> [tunnel-name]"
  [[ "$PUBLIC_URL" =~ ^https://[^/]+$ ]] || fail "MAC_DEV_BRIDGE_PUBLIC_URL must be an https origin without a path"
  validate_hostname "${PUBLIC_URL#https://}"
  [[ "$TUNNEL_NAME" =~ ^[A-Za-z0-9_-]+$ ]] || fail "invalid tunnel name: $TUNNEL_NAME"
}

configure() {
  ensure_macos
  local hostname="$ARG2"
  local tunnel_name="${ARG3:-devmacbridge}"
  [[ -n "$hostname" ]] || fail "usage: $0 configure <hostname> [tunnel-name]"
  hostname="${hostname#https://}"
  hostname="${hostname%/}"
  validate_hostname "$hostname"
  [[ "$tunnel_name" =~ ^[A-Za-z0-9_-]+$ ]] || fail "invalid tunnel name: $tunnel_name"
  mkdir -p "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  cat > "$CONFIG_FILE" <<CONFIG
MAC_DEV_BRIDGE_HTTP_PORT=8788
MAC_DEV_BRIDGE_PUBLIC_URL=https://$hostname
MAC_DEV_BRIDGE_TUNNEL_NAME=$tunnel_name
MAC_DEV_BRIDGE_OAUTH_REDIRECT_URIS=https://grok.com/connectors-oauth-exchange-code/,https://claude.ai/api/mcp/auth_callback
CONFIG
  chmod 600 "$CONFIG_FILE"
  say "configured_public_url=https://$hostname"
  say "configured_tunnel_name=$tunnel_name"
}

ensure_command() {
  local command_name="$1" package_name="$2"
  command -v "$command_name" >/dev/null 2>&1 && return
  command -v brew >/dev/null 2>&1 || fail "$command_name is missing and Homebrew is unavailable"
  brew install "$package_name"
}

ensure_pm2() {
  command -v pm2 >/dev/null 2>&1 && return
  command -v npm >/dev/null 2>&1 || fail "npm is required to install PM2"
  say "Installing PM2 globally"
  npm install --global pm2
  command -v pm2 >/dev/null 2>&1 || fail "PM2 installation completed but pm2 is not on PATH"
}

ensure_prerequisites() {
  ensure_command node node
  ensure_command cloudflared cloudflared
  command -v git >/dev/null 2>&1 || fail "git is required"
  command -v openssl >/dev/null 2>&1 || fail "openssl is required"
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  ensure_pm2
}

ensure_runtime_patch() {
  [[ -s "$RUNTIME_PATCH" ]] || fail "required runtime patch is missing: $RUNTIME_PATCH"
  if git -C "$REPO" apply --reverse --check "$RUNTIME_PATCH" >/dev/null 2>&1; then
    say "runtime_patch=already_applied"
    return
  fi
  if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
    fail "source checkout is dirty and the required runtime patch is not fully present; preserving it for manual review"
  fi
  git -C "$REPO" apply --check "$RUNTIME_PATCH" \
    || fail "runtime patch does not apply cleanly to source ref $SOURCE_REF"
  git -C "$REPO" apply "$RUNTIME_PATCH"
  say "runtime_patch=applied"
}

ensure_repo() {
  if [[ ! -d "$REPO/.git" ]]; then
    say "Cloning DevMacBridge source into $REPO"
    git clone "$UPSTREAM" "$REPO"
  fi
  [[ -f "$REPO/mcp-http.mjs" && -f "$REPO/bridge.mjs" ]] \
    || fail "unexpected repository contents at $REPO"

  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  if [[ "$head" != "$SOURCE_REF" ]]; then
    if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
      fail "source checkout is dirty at $head; expected pinned ref $SOURCE_REF. Preserving it for manual review."
    fi
    say "Checking out pinned DevMacBridge source ref: $SOURCE_REF"
    git -C "$REPO" fetch origin "$SOURCE_REF"
    git -C "$REPO" checkout --detach "$SOURCE_REF"
  fi
  ensure_runtime_patch
}

ensure_named_tunnel() {
  validate_config
  local hostname="${PUBLIC_URL#https://}"
  local tunnel_id
  if ! cloudflared tunnel list >/dev/null 2>&1; then
    fail "Cloudflare tunnel credentials are unavailable. Run 'cloudflared tunnel login' once, then rerun setup."
  fi
  tunnel_id="$(cloudflared tunnel list 2>/dev/null | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}')"
  if [[ -z "$tunnel_id" ]]; then
    [[ -f "$HOME/.cloudflared/cert.pem" ]] \
      || fail "Cloudflare account login is required. Run 'cloudflared tunnel login', then rerun setup."
    say "Creating Cloudflare named tunnel: $TUNNEL_NAME"
    cloudflared tunnel create "$TUNNEL_NAME"
    tunnel_id="$(cloudflared tunnel list 2>/dev/null | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}')"
    [[ -n "$tunnel_id" ]] || fail "named tunnel was not created successfully"
  fi
  [[ -f "$HOME/.cloudflared/$tunnel_id.json" ]] \
    || fail "tunnel $TUNNEL_NAME exists but its local credentials file is missing: $HOME/.cloudflared/$tunnel_id.json"
  say "Ensuring $hostname routes to tunnel $TUNNEL_NAME"
  cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$hostname" >/dev/null
}

ensure_events_federation() {
  [[ -e "$MCP_SERVERS_FILE" ]] && return
  [[ -f "$EVENTS_BUS_DIR/mcp/server.mjs" ]] || {
    say "events_bus=not_configured (sibling events-bus skill not found)"
    return
  }
  local node_bin
  node_bin="$(command -v node)"
  NODE_BIN="$node_bin" EVENTS_DIR="$EVENTS_BUS_DIR" NATS="$NATS_URL" OUT="$MCP_SERVERS_FILE" node <<'NODE'
const fs = require('fs');
const value = {servers:[{key:'events',command:process.env.NODE_BIN,args:[process.env.EVENTS_DIR+'/mcp/server.mjs'],cwd:process.env.EVENTS_DIR,env:{NEO_NATS_URL:process.env.NATS}}]};
fs.writeFileSync(process.env.OUT, JSON.stringify(value, null, 2) + '\n', {mode:0o600});
NODE
  chmod 600 "$MCP_SERVERS_FILE"
  say "events_bus=configured"
}

ensure_state() {
  validate_config
  mkdir -p "$DATA_DIR" "$DATA_DIR/logs"
  chmod 700 "$DATA_DIR" "$DATA_DIR/logs"
  [[ -f "$CONFIG_FILE" ]] && chmod 600 "$CONFIG_FILE"
  if [[ ! -s "$TOKEN_FILE" ]]; then
    openssl rand -hex 32 > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    say "Generated a new devmacbridge bearer token"
  fi
  chmod 600 "$TOKEN_FILE"
  printf '%s\n' "$ACK" > "$DATA_DIR/FULL_ACCESS_ENABLED"
  chmod 600 "$DATA_DIR/FULL_ACCESS_ENABLED"
  ensure_events_federation
}

start_http() {
  validate_config
  pm2 delete devmacbridge-http >/dev/null 2>&1 || true
  (
    export MAC_DEV_BRIDGE_DATA_DIR="$DATA_DIR"
    export MAC_DEV_BRIDGE_HTTP_TOKEN_FILE="$TOKEN_FILE"
    export MAC_DEV_BRIDGE_HTTP_PORT="$HTTP_PORT"
    export MAC_DEV_BRIDGE_PUBLIC_URL="$PUBLIC_URL"
    export MAC_DEV_BRIDGE_OAUTH_REDIRECT_URIS="$OAUTH_REDIRECT_URIS"
    export MAC_DEV_BRIDGE_UNLOCK_FILE="$DATA_DIR/FULL_ACCESS_ENABLED"
    export MAC_DEV_BRIDGE_LOG_DIR="$DATA_DIR/logs"
    export MAC_DEV_BRIDGE_MCP_SERVERS_FILE="$MCP_SERVERS_FILE"
    pm2 start "$REPO/mcp-http.mjs" --name devmacbridge-http --cwd "$REPO" --interpreter "$(command -v node)" --time --update-env >/dev/null
  )
  local attempt pm2_pid
  for attempt in {1..20}; do
    pm2_pid="$(pm2 pid devmacbridge-http 2>/dev/null | tail -1)"
    if [[ "$pm2_pid" =~ ^[1-9][0-9]*$ ]] && curl -fsS --max-time 2 "http://127.0.0.1:$HTTP_PORT/healthz" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  pm2 logs devmacbridge-http --lines 40 --nostream || true
  fail "devmacbridge-http did not become healthy on 127.0.0.1:$HTTP_PORT"
}

start_tunnel() {
  validate_config
  local cloudflared_bin="$(command -v cloudflared)"
  pm2 delete devmacbridge-tunnel >/dev/null 2>&1 || true
  : > "$TUNNEL_LOG"
  pm2 start "$cloudflared_bin" --name devmacbridge-tunnel --cwd "$SKILL_DIR" --interpreter none --output "$TUNNEL_LOG" --error "$TUNNEL_LOG" --merge-logs -- tunnel --no-autoupdate run --url "http://127.0.0.1:$HTTP_PORT" "$TUNNEL_NAME" >/dev/null
  local attempt
  for attempt in {1..30}; do
    if curl -fsS --max-time 4 "$PUBLIC_URL/healthz" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  pm2 logs devmacbridge-tunnel --lines 40 --nostream || true
  fail "named tunnel did not make $PUBLIC_URL healthy"
}

oauth_client_id() {
  [[ -s "$OAUTH_STATE_FILE" ]] || return 1
  node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!v?.client?.id)process.exit(1);process.stdout.write(v.client.id)' "$OAUTH_STATE_FILE"
}

connection_info() {
  validate_config
  local client_id="$(oauth_client_id || true)"
  [[ -n "$client_id" ]] || fail "OAuth Client ID is unavailable; start the HTTP service first"
  printf 'server_url=%s/mcp\n' "$PUBLIC_URL"
  printf 'oauth_client_id=%s\n' "$client_id"
  printf 'http_port=%s\n' "$HTTP_PORT"
  printf 'public_url=%s\n' "$PUBLIC_URL"
  printf 'tunnel_name=%s\n' "$TUNNEL_NAME"
  printf 'source_ref=%s\n' "$SOURCE_REF"
}

copy_token() {
  [[ -s "$TOKEN_FILE" ]] || fail "token file not found: $TOKEN_FILE"
  local mode="$(stat -f '%OLp' "$TOKEN_FILE")"
  [[ "$mode" == "600" || "$mode" == "400" ]] || fail "unsafe token file mode: $mode"
  command -v pbcopy >/dev/null 2>&1 || fail "pbcopy is unavailable"
  pbcopy < "$TOKEN_FILE"
  say "Consent token copied to clipboard; value not printed"
}

status() {
  load_config
  local http_pid="" tunnel_pid=""
  if command -v pm2 >/dev/null 2>&1; then
    http_pid="$(pm2 pid devmacbridge-http 2>/dev/null | tail -1 || true)"
    tunnel_pid="$(pm2 pid devmacbridge-tunnel 2>/dev/null | tail -1 || true)"
  fi
  [[ "$http_pid" =~ ^[1-9][0-9]*$ ]] && say "devmacbridge_http=online" || say "devmacbridge_http=stopped"
  [[ "$tunnel_pid" =~ ^[1-9][0-9]*$ ]] && say "devmacbridge_tunnel=online" || say "devmacbridge_tunnel=stopped"
  if [[ "$HTTP_PORT" =~ ^[0-9]+$ ]] && curl -fsS --max-time 2 "http://127.0.0.1:$HTTP_PORT/healthz" >/dev/null 2>&1; then say "local_health=up"; else say "local_health=down"; fi
  if [[ -n "$PUBLIC_URL" ]] && curl -fsS --max-time 4 "$PUBLIC_URL/healthz" >/dev/null 2>&1; then say "public_health=up"; else say "public_health=down"; fi
  [[ -n "$PUBLIC_URL" ]] && printf 'server_url=%s/mcp\n' "$PUBLIC_URL" || say "server_url=not_configured"
}

doctor() {
  ensure_macos
  load_config
  local failed=0 cmd
  for cmd in node git openssl cloudflared pm2 curl; do
    if command -v "$cmd" >/dev/null 2>&1; then say "$cmd=ok"; else say "$cmd=missing"; failed=1; fi
  done
  if [[ -n "$PUBLIC_URL" ]] && validate_config >/dev/null 2>&1; then say "config=ok"; else say "config=missing_or_invalid"; failed=1; fi
  [[ -d "$REPO/.git" ]] && say "source_checkout=present" || say "source_checkout=missing (setup will clone)"
  [[ -f "$MCP_SERVERS_FILE" ]] && say "events_federation=configured" || say "events_federation=not_configured"
  status
  return "$failed"
}

setup_all() {
  ensure_macos
  ensure_prerequisites
  validate_config
  ensure_repo
  ensure_state
  ensure_named_tunnel
  start_http
  start_tunnel
  pm2 save >/dev/null
  connection_info
  say "NOTE: for reboot auto-start, run 'pm2 startup' once, follow the command it prints, then run 'pm2 save'."
}

stop_all() {
  command -v pm2 >/dev/null 2>&1 || { say "PM2 is not installed"; return; }
  pm2 stop devmacbridge-tunnel >/dev/null 2>&1 || true
  pm2 stop devmacbridge-http >/dev/null 2>&1 || true
  pm2 save >/dev/null || true
  say "DevMacBridge services stopped"
}

case "$ACTION" in
  configure) configure ;;
  setup|start) setup_all ;;
  repo) ensure_macos; ensure_prerequisites; ensure_repo ;;
  restart) ensure_macos; ensure_prerequisites; ensure_repo; ensure_state; start_http; pm2 save >/dev/null; connection_info ;;
  restart-tunnel) ensure_macos; ensure_prerequisites; ensure_state; ensure_named_tunnel; start_tunnel; pm2 save >/dev/null; connection_info ;;
  stop) stop_all ;;
  status) status ;;
  doctor) doctor ;;
  info) connection_info ;;
  copy-token) copy_token ;;
  *) fail "usage: $0 {configure <hostname> [tunnel-name]|setup|start|repo|restart|restart-tunnel|stop|status|doctor|info|copy-token}" ;;
esac
