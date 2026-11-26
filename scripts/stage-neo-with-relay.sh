#!/usr/bin/env bash
# Stage Neo with its paired Relay Prompt Builder CLI; not a live install.
set -euo pipefail
usage(){ echo "usage: stage-neo-with-relay.sh --relay-root ABS_RELAY_REPO --output ABS_NEW_DIR [--profile release|dev]" >&2; }
relay_root=''; output=''; profile='release'
while (($#)); do
 case "$1" in
 --relay-root) (($# >= 2)) || { usage;exit 2; }; relay_root="$2";shift 2 ;;
 --output) (($# >= 2)) || { usage;exit 2; }; output="$2";shift 2 ;;
 --profile) (($# >= 2)) || { usage;exit 2; }; profile="$2";shift 2 ;;
 *) usage;exit 2 ;;
 esac
done
[[ "$relay_root" = /* && "$output" = /* && ! -e "$output" ]] || { usage;exit 2; }
[[ "$profile" = release || "$profile" = dev ]] || { usage;exit 2; }
[[ -f "$relay_root/rust/Cargo.toml" ]] || { echo "Invalid Relay checkout" >&2;exit 2; }
root="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
relay_root="$(cd -- "$relay_root" && pwd -P)"
relay_target="$(printenv RELAY_CARGO_TARGET_DIR || echo "$relay_root/rust/target")"
neo_target="$(printenv NEO_CARGO_TARGET_DIR || echo "$root/target")"
folder=debug
if [[ "$profile" = release ]]; then
 folder=release
 CARGO_TARGET_DIR="$relay_target" cargo build --release --locked --manifest-path "$relay_root/rust/Cargo.toml" --bin agents-relay-rust
 CARGO_TARGET_DIR="$neo_target" cargo build --release --locked --manifest-path "$root/Cargo.toml" -p neo-harness-cli --bin neo-rs
else
 CARGO_TARGET_DIR="$relay_target" cargo build --locked --manifest-path "$relay_root/rust/Cargo.toml" --bin agents-relay-rust
 CARGO_TARGET_DIR="$neo_target" cargo build --locked --manifest-path "$root/Cargo.toml" -p neo-harness-cli --bin neo-rs
fi
relay_bin="$relay_target/$folder/agents-relay-rust"
neo_bin="$neo_target/$folder/neo-rs"
[[ -x "$relay_bin" && -x "$neo_bin" ]] || { echo "Paired native binary missing" >&2;exit 1; }
NEO_HARNESS_ROOT="$root" NEO_RELAY_EXECUTABLE="$relay_bin" "$neo_bin" package stage "$output"
echo "Staged paired Neo and Relay Prompt Builder in $output" >&2
