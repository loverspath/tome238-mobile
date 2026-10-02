# ToME 2.3.8-ah Mobile Web Terminal

Native compilation of Tales of Middle-earth (ToME 2.3.8-ah) on Termux with a lightweight mobile web frontend.

## Quickstart

### 1. Build Native Engine
```bash
./scripts/build.sh
```

### 2. Run Headless PTY Smoke Test
```bash
./scripts/test.sh
```

### 3. Launch Mobile Web Terminal (Port 8080)
```bash
./scripts/run_web.sh
# Then open http://localhost:8080 or http://<device-ip>:8080 in mobile browser
```

### 4. Run Automated Web Integration Test
```bash
python3 ./scripts/test_web.py
```

### 5. Launch Native Game Directly in Termux CLI
```bash
./scripts/run.sh
```

## Features
- **Native Termux Engine**: Runs upstream Curses (`main-gcu.c` + `libncursesw`) natively on ARM64 Linux without Android NDK/APK overhead.
- **Thin Transport Daemon**: Python async WebSocket-PTY bridge streaming raw terminal output to modern web browsers.
- **Offline Mobile Web UI**:
  - Embedded offline `xterm.js` bundle (zero external CDN reliance).
  - 3x3 Directional Pad supporting 8 directions + wait (with auto-repeat on hold).
  - Top action ribbon with essential game keys (`Esc`, `Enter`, `Space`, `Tab`, `Rest`, `Inven`, `Magic`, `Look`, etc.).
  - Context sniffer automatically surfacing `(y/n)` confirmations.
  - Modifiers: `Shift`, `Ctrl`, and `RUN` (`.` + direction).
  - Opacity toggle (`Ghost` mode) for maximum map visibility on small screens.

## Directory Structure
- `game/`: C source code (`game/src`), assets & Lua data (`game/lib`), and compiled binary (`game/tome`).
- `web/`: Mobile-friendly web terminal UI, offline vendor assets, and PTY server (`server.py`).
- `scripts/`: Build, run, web launch, and automated test utilities.
- `saves/`: Game savefiles.
- `docs/`: Technical specifications and build documentation.
