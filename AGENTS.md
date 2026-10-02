# AGENTS.md - Agent Operations & Handover Guidelines

## 1. Project Mission & Philosophy
- **Core Philosophy**:
  > «Preserve the game. Keep the transport thin. Make iteration cheap.»
- **Goal**: Deliver a high-performance, mobile-optimized web interface for ToME 2.3.8-ah running on a Termux native environment.
- **Constraints**:
  - Do NOT modify legacy C game logic unnecessarily; preserve original mechanics and data formats.
  - Do NOT build Android APK/NDK/Gradle apps. The engine runs as a native Termux executable.
  - Keep transport thin: decoupling backend headless/terminal I/O from the frontend presentation layer.

## 2. Directory Layout
```
tome238-mobile/
├── game/
│   ├── src/       # ToME 2.3.8-ah native C source, Makefile, Lua 4.0 engine
│   ├── lib/       # Runtime game assets (modules, scpt, edit, pref, etc.)
│   └── tome       # Native ARM64 ELF executable
├── web/
│   ├── index.html # Mobile web app markup
│   ├── style.css  # Mobile touch layout and theme
│   ├── app.js     # WebSocket client, Xterm.js controller & touch input mapper
│   ├── server.py  # Python async PTY <-> WebSocket server
│   └── vendor/    # Local offline xterm.js bundles
├── scripts/
│   ├── build.sh       # Native C engine compiler
│   ├── run.sh         # Termux CLI launcher
│   ├── run_web.sh     # Web server launcher
│   ├── test.sh        # Headless PTY smoke test
│   ├── smoke_test.py  # PTY test script
│   └── test_web.py    # Automated Web/WebSocket integration test
├── saves/         # Player savefiles directory (symlinked from game/lib/save)
├── docs/          # Technical specifications and guides
├── AGENTS.md      # Agent handover instructions
└── README.md      # Project overview and quickstart
```

## 3. Current Project State
- **Phase 1 (Native Build & Smoke Test)**: COMPLETE.
  - Upstream Curses (`main-gcu.c`) on `libncursesw.so.6.5`.
  - Android JNI layers cleanly isolated and excluded from build.
- **Phase 2 (Terminal Transport Daemon)**: COMPLETE.
  - `web/server.py` handles HTTP static serving and bidirectional WebSocket streaming (`/ws`).
  - Native Linux PTY integration with `fcntl`, non-blocking I/O, and `TIOCSWINSZ` 80x24 window sizing.
  - Multi-session support, reconnection preservation buffer, and graceful child process cleanup.
- **Phase 3 (Mobile Web Client & Virtual Keyboard)**: COMPLETE.
  - Fully offline `xterm.js` terminal display.
  - Angbandroid-inspired 3x3 D-Pad with long-press continuous auto-repeat (300ms delay, 75ms repeat).
  - Quick action button ribbon (`Esc`, `Enter`, `Space`, `Tab`, `Rest`, `Inven`, `Magic`, `Look`, `Target`, `Fire`, `Pickup`, `Wield`, `Quaff`, `Read`, `Use`, `Map`).
  - Real-time Context Sniffer dynamically injecting `(y/n)` buttons.
  - Modifiers: `Shift`, `Ctrl`, and `RUN` (`.` + direction).
  - `Ghost` opacity toggle for flexible screen space management.
- **Upcoming Work**:
  - Phase 4: Extended spellcasting/macros and user customization.
  - Phase 6: TomeNET Runecraft wheel integration if planned.
