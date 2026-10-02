#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TERM="${TERM:-xterm-256color}"
export TOME_PATH="$PROJECT_ROOT/game/lib"

if [ ! -f "$PROJECT_ROOT/game/tome" ]; then
    echo "Binary not found. Running build..."
    "$PROJECT_ROOT/scripts/build.sh"
fi

cd "$PROJECT_ROOT/game"
exec ./tome "$@"
