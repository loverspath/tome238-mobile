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

## Documentation
- [AGENTS.md](file:///data/data/com.termux/files/home/tome238-mobile/AGENTS.md): Operational guide, directory layout, reference repos, and legacy refactoring taboos.
- [docs/architecture.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/architecture.md): Full system architecture, Mermaid diagrams, PTY-WebSocket bridge, and 64KB ring buffer.
- [docs/decoupling_checkpoint.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/decoupling_checkpoint.md): Decoupling audit, coupling catalog, and generic shell architecture checkpoint.
- [docs/multiprocess_feasibility.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/multiprocess_feasibility.md): Local multiprocess (TomeNET Server + Client) feasibility study on Termux ARM64.
- [docs/gameplay_changes.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/gameplay_changes.md): Fork comparison tracker, Adventurer class spec, and Runecraft integration roadmap.

- [docs/runecraft_mapping.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/runecraft_mapping.md): 1:1 semantic mapping of TomeNET Runecraft to ToME 2.3.8-ah primitives.
- [docs/runecraft_vertical_slice_spec.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/runecraft_vertical_slice_spec.md): Fire/Cold × Bolt/Ball Zero-C prototype Lua specification.
- [docs/tomenet_runecraft_spec.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/tomenet_runecraft_spec.md): TomeNET Runecraft rules, formulas, and bitmask specification.
- [docs/mobile_keyboard_spec.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/mobile_keyboard_spec.md): Angbandroid mobile UX reverse-engineering and touch keyboard specification.
- [docs/build_guide.md](file:///data/data/com.termux/files/home/tome238-mobile/docs/build_guide.md): Native toolchain, compiler flags, and curses dependencies.


