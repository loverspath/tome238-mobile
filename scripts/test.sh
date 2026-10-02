#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "==> Running ToME 2.3.8-ah smoke test..."
python3 "$PROJECT_ROOT/scripts/smoke_test.py"
