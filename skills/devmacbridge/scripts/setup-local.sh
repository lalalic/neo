#!/bin/bash
set -euo pipefail

ACTION="${1:-status}"
REPO="${MAC_DEV_BRIDGE_REPO:-$HOME/Workspace/neo/mac-developer-bridge}"
UPSTREAM="${MAC_DEV_BRIDGE_UPSTREAM:-https://github.com/alexanderradahl/mac-developer-bridge.git}"
NEO_ROOT="${NEO_ROOT:-$HOME/Workspace/neo}"
EVENTS_DIR="${NEO_EVENTS_BUS_DIR:-$NEO_ROOT/skills/events-bus}"
DATA_DIR="${MAC_DEV_BRIDGE_DATA_DIR:-$HOME/Library/Application Support/MacDeveloperBridge}"
REGISTRY="${MAC_DEV_BRIDGE_MCP_SERVERS:-$DATA_DIR/mcp-servers.json}"
TOKEN_FILE="${MAC_DEV_BRIDGE_HTTP_TOKEN_FILE:-$DATA_DIR/http-token}"

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ensure_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "Mac Developer Bridge setup requires macOS"
}

ensure_brew_package() {
  local command_name="$1" package_name="$2"
  command -v "$command_name" >/dev/null 2>&1 && return 0
  command -v brew >/dev/null 2>&1 || fail "$command_name is missing and Homebrew is unavailable"
  say "Installing Homebrew package: $package_name"
  brew install "$package_name"
}

ensure_repo() {
  if [[ ! -d "$REPO/.git" ]]; then
    mkdir -p "$(dirname "$REPO")"
    say "Cloning Mac Developer Bridge into $REPO"
    git clone "$UPSTREAM" "$REPO"
    return
  fi

  local origin
  origin="$(git -C "$REPO" remote get-url origin 2>/dev/null || true)"
  [[ "$origin" == *"mac-developer-bridge"* ]] || fail "existing checkout has unexpected origin: ${origin:-<none>}"

  if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
    say "Existing Mac Developer Bridge checkout is dirty; preserving it without update: $REPO"
    return
  fi

  say "Updating clean Mac Developer Bridge checkout (fast-forward only)"
  git -C "$REPO" fetch origin --prune
  git -C "$REPO" pull --ff-only
}

ensure_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js 18+ is required"
  local major
  major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  (( major >= 18 )) || fail "Node.js 18+ is required; found $(node --version)"
}

ensure_events_bus() {
  [[ -f "$EVENTS_DIR/mcp/server.mjs" ]] || { say "events-bus skill not found; skipping federation setup"; return 0; }

  ensure_brew_package nats-server nats-server

  local nats_bin
  nats_bin="$(command -v nats-server)"
  if ! npx pm2 jlist 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let a=JSON.parse(s);process.exit(a.some(p=>p.name==="events-bus"&&p.pm2_env?.status==="online")?0:1)}catch{process.exit(1)}})
  '; then
    say "Starting loopback NATS as PM2 service neo/events-bus"
    npx pm2 delete events-bus >/dev/null 2>&1 || true
    npx pm2 start "$nats_bin" --name events-bus --namespace neo -- -a 127.0.0.1 -p 4222
  fi
  npx pm2 save >/dev/null

  node "$EVENTS_DIR/transport/nats.mjs" ping >/dev/null || fail "NATS did not become healthy"

  mkdir -p "$DATA_DIR"
  chmod 700 "$DATA_DIR" 2>/dev/null || true
  local node_bin
  node_bin="$(command -v node)"
  python3 - "$REGISTRY" "$node_bin" "$EVENTS_DIR" <<'PY'
import json, os, sys
registry, node_bin, events_dir = sys.argv[1:]
try:
    with open(registry, encoding='utf-8') as f:
        data=json.load(f)
except FileNotFoundError:
    data={}
providers=data.get('providers')
if not isinstance(providers, list):
    providers=[]
provider={
    'key':'events',
    'command':node_bin,
    'args':[os.path.join(events_dir,'mcp','server.mjs')],
    'cwd':events_dir,
    'env':{'NEO_NATS_URL':'nats://127.0.0.1:4222'},
    'mode':'isolated',
    'callTimeoutMs':35000,
    'maxResultBytes':4000000,
}
out=[]
replaced=False
for item in providers:
    if isinstance(item,dict) and item.get('key')=='events':
        if not replaced:
            out.append(provider); replaced=True
    else:
        out.append(item)
if not replaced:
    out.append(provider)
data['providers']=out
os.makedirs(os.path.dirname(registry), exist_ok=True)
tmp=registry+'.tmp'
with open(tmp,'w',encoding='utf-8') as f:
    json.dump(data,f,indent=2); f.write('\n')
os.chmod(tmp,0o600)
os.replace(tmp,registry)
PY
  chmod 600 "$REGISTRY"
  say "Configured events-bus federation in $REGISTRY (bridge restart required if already running)"
}

build_local() {
  ensure_node
  ensure_brew_package cloudflared cloudflared
  command -v swiftc >/dev/null 2>&1 || fail "swiftc is missing; install Xcode Command Line Tools"

  say "Validating Mac Developer Bridge source"
  (cd "$REPO" && npm run check)

  say "Building/installing MacDevBridge.app"
  (cd "$REPO" && ./menubar/build.sh)

  if [[ -f "$HOME/Library/Application Support/Google/Chrome/Local State" ]]; then
    say "Installing background-Chrome native host"
    (cd "$REPO" && ./scripts/install-background-chrome.sh)
  else
    say "Chrome profile not found; skipping background-Chrome native host until Chrome is installed/signed in"
  fi
}

status() {
  local repo_state="missing" app="missing" http="down" events="unavailable" federation="missing" chrome_host="missing" oauth="missing" tunnel_mode="none"
  if [[ -d "$REPO/.git" ]]; then
    if [[ -n "$(git -C "$REPO" status --porcelain 2>/dev/null || true)" ]]; then repo_state="dirty"; else repo_state="clean"; fi
  fi
  [[ -d /Applications/MacDevBridge.app || -d "$HOME/Applications/MacDevBridge.app" ]] && app="installed"
  curl -fsS --max-time 2 http://127.0.0.1:8787/healthz >/dev/null 2>&1 && http="up"
  [[ -f "$DATA_DIR/oauth-client-id" ]] && oauth="present"
  [[ -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/io.github.alexanderradahl.mac_developer_bridge.json" ]] && chrome_host="installed"
  if [[ -f "$EVENTS_DIR/transport/nats.mjs" ]] && node "$EVENTS_DIR/transport/nats.mjs" ping >/dev/null 2>&1; then events="healthy"; fi
  if [[ -f "$REGISTRY" ]] && python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); raise SystemExit(0 if any(isinstance(p,dict) and p.get("key")=="events" for p in d.get("providers",[])) else 1)' "$REGISTRY" >/dev/null 2>&1; then
    federation="configured"
  fi
  if [[ -f "$HOME/.cloudflared/config.yml" ]]; then
    tunnel_mode="named-config-present"
  elif ps -axo command= | grep '[c]loudflared tunnel --url' >/dev/null; then
    tunnel_mode="quick"
  fi
  cat <<OUT
repo=$REPO
repo_state=$repo_state
app=$app
http_frontend=$http
oauth_client_id=$oauth
background_chrome_native_host=$chrome_host
events_bus=$events
events_federation=$federation
tunnel_mode=$tunnel_mode
registry=$REGISTRY
token_file=$TOKEN_FILE
OUT
}

connection_info() {
  [[ -f "$DATA_DIR/oauth-client-id" ]] || fail "OAuth client id not found; start MacDevBridge.app first"
  printf 'oauth_client_id=%s\n' "$(cat "$DATA_DIR/oauth-client-id")"
  if [[ -f "$HOME/.cloudflared/config.yml" ]]; then
    python3 - "$HOME/.cloudflared/config.yml" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text(errors='replace')
m=re.search(r'(?m)^\s*hostname:\s*([^\s#]+)',text)
if m: print('server_url=https://'+m.group(1).strip()+'/mcp')
else: print('server_url=<named-tunnel-hostname-not-found>')
PY
  else
    local url
    url="$(grep -Eo 'https://[A-Za-z0-9-]+\.trycloudflare\.com' "$HOME/Library/Logs/MacDeveloperBridge/http.stderr.log" 2>/dev/null | tail -1 || true)"
    if [[ -n "$url" ]]; then printf 'server_url=%s/mcp\n' "$url"; else printf 'server_url=<not-discovered>\n'; fi
  fi
}

copy_token() {
  [[ -f "$TOKEN_FILE" ]] || fail "HTTP token file not found: $TOKEN_FILE"
  local mode
  mode="$(stat -f '%OLp' "$TOKEN_FILE")"
  [[ "$mode" == "600" || "$mode" == "400" ]] || fail "refusing to copy token from unsafe file mode $mode"
  command -v pbcopy >/dev/null 2>&1 || fail "pbcopy is unavailable"
  pbcopy < "$TOKEN_FILE"
  say "Mac Developer Bridge consent token copied to clipboard (value not printed)"
}

case "$ACTION" in
  all) ensure_macos; ensure_repo; build_local; ensure_events_bus; status ;;
  repo) ensure_macos; ensure_repo ;;
  build) ensure_macos; ensure_repo; build_local ;;
  events) ensure_macos; ensure_events_bus ;;
  status) status ;;
  info) connection_info ;;
  copy-token) copy_token ;;
  *) fail "usage: $0 {all|repo|build|events|status|info|copy-token}" ;;
esac
