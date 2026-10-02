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
├── web/           # Mobile web frontend (Xterm.js / canvas + virtual keyboard)
├── scripts/       # Operational scripts (build.sh, run.sh, test.sh, smoke_test.py)
├── saves/         # Player savefiles directory (symlinked from game/lib/save)
├── docs/          # Technical specifications and guides
├── AGENTS.md      # Agent handover instructions
└── README.md      # Project overview and quickstart
```

## 3. Current Project State (Phase 1 Baseline)
- **Status**: Phase 1 (Native Build & Smoke Test) complete.
- **Artifacts**:
  - `game/src/Makefile`: Clang/ncursesw build configuration targeting Termux native environment.
  - `game/tome`: Successfully compiled ELF 64-bit executable.
  - `scripts/test.sh` / `scripts/smoke_test.py`: PTY-based headless verification passing with exit code 0.
- **Upcoming Work**:
  - Phase 2: Design and implementation of the thin transport daemon (pty/websocket bridge).
  - Phase 3: Web frontend and touch keyboard layout adapted for mobile screen.
