#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "==> Building ToME 2.3.8-ah native binary..."
cd "$PROJECT_ROOT/game/src"
make -j4
echo "==> Build complete: $PROJECT_ROOT/game/tome"
