# ToME 2.3.8-ah Mobile Web Terminal

Native compilation of Tales of Middle-earth (ToME 2.3.8-ah) on Termux with a lightweight mobile web frontend.

## Quickstart

### Build
```bash
./scripts/build.sh
```

### Run Tests
```bash
./scripts/test.sh
```

### Launch Native Game in Terminal
```bash
./scripts/run.sh
```

## Architecture
- **Engine**: C legacy roguelike engine with embedded Lua 4.0 scripting.
- **Frontend (Native)**: Curses (`main-gcu.c`) on `libncursesw`.
- **Platform**: Termux (Android aarch64 native Linux environment).
- **Transport & Web UI**: (In progress) WebSocket/PTY bridge and mobile touch keyboard interface.

## Directory Structure
- `game/`: C source code (`game/src`), assets & Lua data (`game/lib`), and compiled binary (`game/tome`).
- `web/`: Mobile-friendly web terminal UI.
- `scripts/`: Build, run, and test utilities.
- `saves/`: Game savefiles.
- `docs/`: Technical specifications and build documentation.
