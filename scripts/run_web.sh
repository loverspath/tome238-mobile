#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8080}"
HOST="0.0.0.0"

if [ ! -f "$PROJECT_ROOT/game/tome" ]; then
    echo "==> Game binary not found. Compiling first..."
    "$PROJECT_ROOT/scripts/build.sh"
fi

echo "=========================================================="
echo " Starting ToME 2.3.8-ah Mobile Web Terminal Server"
echo " Access locally at: http://localhost:${PORT}"
echo " Access on LAN at:  http://$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1 || echo '<device-ip>'):${PORT}"
echo "=========================================================="

cd "$PROJECT_ROOT"
exec python3 "$PROJECT_ROOT/web/server.py" --host "$HOST" --port "$PORT"
